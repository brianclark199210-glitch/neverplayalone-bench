"""Console session for one seeded animal-husbandry run.

Mine picks a seed and runs llm_agent on that animal_husbandry task.
"""
from __future__ import annotations

import random
import threading
import time
from collections.abc import Callable
from typing import Any

from npabench.console.live import run_live
from npabench.missions.animal_husbandry.mission import AnimalHusbandryMission
from npabench.missions.base import Task

Runner = Callable[[Task, str, Callable[[str, Any], None]], dict[str, Any]]

_FINISHED = {"ok", "timeout"}

_IDLE_TIMELINE: tuple[tuple[str, str, str], ...] = (
    ("seed", "Seed selected", "Press Mine to draw a seed"),
    ("mission", "Mission generated", "The seed's targets appear here"),
    ("plan", "Agent planning", "The agent has not started"),
    ("world", "Random terrain", "A new world is generated for the run"),
    ("score", "Mission scored", "The score appears when the run finishes"),
)


def _step(step_id: str, label: str, detail: str, state: str) -> dict[str, str]:
    return {"id": step_id, "label": label, "detail": detail, "state": state}


class MiningSession:
    def __init__(self, tick_seconds: float = 0.32, runner: Runner | None = None) -> None:
        self._tick = tick_seconds
        self._runner = runner or run_live
        self._lock = threading.Lock()
        self._task: Task | None = None
        self._prompt = ""
        self._status = "idle"
        self._error: str | None = None
        self._mission: dict[str, Any] | None = None
        self._targets: list[dict[str, Any]] = []
        self._timeline: list[dict[str, str]] = [
            _step(step_id, label, detail, "pending")
            for step_id, label, detail in _IDLE_TIMELINE
        ]
        self._lines: list[str] = []
        self._terrain: dict[str, Any] | None = None
        self._viewer_port: int | None = None
        self._events: list[dict[str, Any]] = []
        self._score: float | None = None
        self._max_score = 100.0
        self._duration = 1200
        self._started_at: float | None = None
        self._ended_at: float | None = None

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            body = self._state()
            body["logs"] = "\n".join(self._lines)
            body["terrain"] = None if self._terrain is None else dict(self._terrain)
            return body

    def status(self, log_from: int = 0) -> dict[str, Any]:
        """Mission state plus only the log lines the page does not have yet."""
        with self._lock:
            body = self._state()
            total = len(self._lines)
            reset = log_from < 0 or log_from > total
            start = 0 if reset else log_from
            body["reset"] = reset
            body["log_from"] = start
            body["log_count"] = total
            body["logs"] = "\n".join(self._lines[start:])
            return body

    def _state(self) -> dict[str, Any]:
        earned = self._earned()
        max_score = self._max_score or 100.0
        if self._status in {"done", "error"} and self._score is not None and max_score > 0:
            progress = max(0.0, self._score / max_score)
        else:
            progress = 0.0 if max_score <= 0 else earned / max_score
        return {
            "status": self._status,
            "error": self._error,
            "mission": None if self._mission is None else dict(self._mission),
            "targets": [dict(row) for row in self._targets],
            "progress": round(progress, 4),
            "score": self._score,
            "max_score": max_score,
            "timeline": [dict(step) for step in self._timeline],
            "viewer": None if self._viewer_port is None else {"port": self._viewer_port},
            "clock": self._clock(),
        }

    def start(self, seed: int | None = None, *, background: bool = True) -> dict[str, Any]:
        with self._lock:
            if self._status == "running":
                raise RuntimeError("a mining run is already in progress")
            chosen_seed = random.SystemRandom().randrange(1, 2**31) if seed is None else seed
            self._status = "running"
            self._error = None

        try:
            task, duration = _mission_for_seed(chosen_seed)
        except Exception as exc:
            with self._lock:
                self._status = "error"
                self._error = str(exc)
                self._append("error", str(exc))
            raise

        with self._lock:
            self._install(task, task.prompt, duration)

        if background:
            threading.Thread(target=self._play, name="mining-console", daemon=True).start()
        else:
            self._play()
        return self.snapshot()

    def _install(self, task: Task, prompt: str, duration_seconds: int) -> None:
        self._task = task
        self._prompt = prompt
        self._lines = []
        self._terrain = None
        self._viewer_port = None
        self._score = None
        self._started_at = time.time()
        self._ended_at = None
        self._targets = [
            {
                "key": target.key,
                "display_name": target.display_name,
                "role": target.role,
                "items": list(target.items),
                "target_count": target.target_count,
                "points": target.points,
                "have": 0,
            }
            for target in task.targets
        ]
        self._max_score = round(sum(target.points for target in task.targets), 1) or 100.0
        self._mission = {
            "id": task.task_id,
            "seed": task.seed,
            "minecraft_seed": task.minecraft_seed,
            "content": prompt,
            "duration_seconds": duration_seconds,
            "kind": "animal_husbandry",
        }
        self._duration = duration_seconds
        self._timeline = _opening_timeline(task)
        self._append("info", f"mission {task.task_id}")
        self._append("ready", "prompt accepted")

    def _play(self) -> None:
        try:
            with self._lock:
                task = self._task
                prompt = self._prompt
            if task is None:
                raise RuntimeError("no mission was prepared")
            result = self._runner(task, prompt, self._emit)
            with self._lock:
                self._finish(result)
        except Exception as exc:
            with self._lock:
                self._status = "error"
                self._error = str(exc)
                if self._ended_at is None:
                    self._ended_at = time.time()
                self._append("error", str(exc))

    def _emit(self, kind: str, message: Any) -> None:
        with self._lock:
            if kind == "view":
                if isinstance(message, dict):
                    self._store_view(message)
                return
            if kind == "viewer":
                if isinstance(message, dict):
                    self._remember_viewer(message)
                return
            self._append(kind, str(message))
            if "generating random terrain" in message:
                self._touch("world", "active", "Generating random terrain")
            elif message.startswith("starting minecraft server"):
                self._touch("world", "active", "Starting the Minecraft server")
            elif "prompt plan" in message:
                self._touch("plan", "done", "Prompt analyzed")
                self._touch("world", "done", "Agent is in the world")

    def _remember_viewer(self, data: dict[str, Any]) -> None:
        try:
            port = int(data.get("port") or 0)
        except (TypeError, ValueError):
            return
        if 1 <= port <= 65535:
            self._viewer_port = port

    def _store_view(self, data: dict[str, Any]) -> None:
        rows = data.get("blocks")
        if not isinstance(rows, list):
            return
        blocks: list[list[int]] = []
        for row in rows[:4000]:
            if not isinstance(row, (list, tuple)) or len(row) != 4:
                continue
            try:
                blocks.append([int(row[0]), int(row[1]), int(row[2]), int(row[3])])
            except (TypeError, ValueError):
                continue
        if not blocks:
            return
        self._terrain = {
            "x": float(data.get("x") or 0),
            "y": float(data.get("y") or 0),
            "z": float(data.get("z") or 0),
            "yaw": float(data.get("yaw") or 0),
            "blocks": blocks,
        }

    def _clock(self) -> dict[str, Any]:
        duration = self._duration
        now = time.time()
        if self._started_at is None:
            elapsed = 0.0
        else:
            end = now if self._ended_at is None else self._ended_at
            elapsed = max(0.0, end - self._started_at)
        remaining = max(0.0, duration - elapsed)
        return {
            "duration_seconds": duration,
            "elapsed_seconds": round(elapsed, 1),
            "remaining_seconds": round(remaining, 1),
            "started_at": self._started_at,
            "ended_at": self._ended_at,
            "server_now": now,
        }

    def _finish(self, result: dict[str, Any]) -> None:
        if self._ended_at is None:
            self._ended_at = time.time()
        counts = result.get("counts") or {}
        for target in self._targets:
            if target["key"] not in counts:
                continue
            target["have"] = min(target["target_count"], int(counts[target["key"]]))
            state = "done" if target["have"] >= target["target_count"] else "active"
            self._touch(
                f"raise-{target['key']}",
                state,
                f"{target['have']} / {target['target_count']}",
            )
        self._score = round(float(result.get("score") or 0), 1)
        reported_max = result.get("max_score")
        if reported_max:
            self._max_score = float(reported_max)
        status = str(result.get("status") or "error")
        if status in _FINISHED:
            self._status = "done"
            self._touch("score", "done", f"{self._score:.1f} / {self._max_score:.1f}")
            self._append("done", f"run finished  score={self._score:.1f}/{self._max_score:.1f}")
            return
        self._status = "error"
        self._error = str(result.get("error") or status)
        self._touch("score", "error", self._error)
        self._append("error", self._error)

    def _touch(self, step_id: str, state: str, detail: str | None) -> None:
        for step in self._timeline:
            if step["id"] != step_id:
                continue
            step["state"] = state
            if detail is not None:
                step["detail"] = detail
            return

    def _append(self, kind: str, message: str) -> None:
        stamp = time.strftime("%H:%M:%S")
        self._lines.append(f"{stamp}  {kind:<7} {message}")

    def _earned(self) -> float:
        total = 0.0
        for target in self._targets:
            count = target["target_count"]
            if count <= 0:
                continue
            fraction = min(1.0, target["have"] / count)
            total += fraction * float(target["points"])
        return total


def _mission_for_seed(seed: int) -> tuple[Task, int]:
    mission = AnimalHusbandryMission()
    config = mission.load_config(mission.default_config_path())
    task = mission.generate_task(config, seed)
    return task, int(config.duration_seconds)


def _opening_timeline(task: Task) -> list[dict[str, str]]:
    steps = [
        _step("seed", "Seed selected", str(task.seed), "done"),
        _step("mission", "Mission generated", task.task_id, "done"),
        _step("plan", "Agent planning", "Reading the seed's targets", "active"),
    ]
    for target in task.targets:
        steps.append(
            _step(
                f"raise-{target.key}",
                f"Raise {target.display_name}",
                f"0 / {target.target_count}",
                "pending",
            )
        )
    steps.append(_step("world", "Random terrain", "Waiting for the world", "pending"))
    steps.append(_step("score", "Mission scored", "Waiting for the run to finish", "pending"))
    return steps
