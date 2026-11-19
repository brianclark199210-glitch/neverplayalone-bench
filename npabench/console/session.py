"""Console session for one seeded animal-husbandry run.

Mine picks a seed and runs llm_agent on that animal_husbandry task.
"""
from __future__ import annotations

import random
import re
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from npabench.config import RESULTS_DIR
from npabench.console.live import run_live
from npabench.console.mindlog import reset_logs, write_second
from npabench.missions.animal_husbandry.mission import AnimalHusbandryMission
from npabench.missions.base import Task

Runner = Callable[[Task, str, Callable[[str, Any], None]], dict[str, Any]]

_FINISHED = {"ok", "timeout"}
SEED_MIN = 0
SEED_MAX = 5

_IDLE_TIMELINE: tuple[tuple[str, str, str], ...] = (
    ("seed", "Seed selected", "Choose a seed from 0 to 5"),
    ("mission", "Mission generated", "The seed's targets appear here"),
    ("plan", "Agent planning", "The agent has not started"),
    ("world", "Validator terrain", "The world uses the selected seed"),
    ("score", "Mission scored", "The score appears when the run finishes"),
)


def _step(step_id: str, label: str, detail: str, state: str) -> dict[str, str]:
    return {"id": step_id, "label": label, "detail": detail, "state": state}


class MiningSession:
    def __init__(
        self,
        tick_seconds: float = 0.32,
        runner: Runner | None = None,
        log_root: Path | None = None,
    ) -> None:
        self._tick = tick_seconds
        self._runner = runner or run_live
        self._log_root = log_root if log_root is not None else RESULTS_DIR / "runs"
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
        self._reset_board()
        self._mind: list[dict[str, Any]] = []
        self._mind_dir: Path | None = None

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            body = self._state()
            body["logs"] = "\n".join(self._lines)
            body["terrain"] = None if self._terrain is None else dict(self._terrain)
            return body

    def status(self, log_from: int = 0, mind_from: int = 0) -> dict[str, Any]:
        """Mission state plus only the log lines and mind seconds the page does not have yet."""
        with self._lock:
            body = self._state()
            total = len(self._lines)
            reset = log_from < 0 or log_from > total
            start = 0 if reset else log_from
            body["reset"] = reset
            body["log_from"] = start
            body["log_count"] = total
            body["logs"] = "\n".join(self._lines[start:])
            mind_total = len(self._mind)
            mind_reset = mind_from < 0 or mind_from > mind_total
            mind_start = 0 if mind_reset else mind_from
            body["mind_reset"] = mind_reset
            body["mind_from"] = mind_start
            body["mind_count"] = mind_total
            body["mind"] = [dict(row) for row in self._mind[mind_start:]]
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
            "board": self._public_board(),
            "mind_now": None if not self._mind else dict(self._mind[-1]),
        }

    def start(self, seed: int | None = None, *, background: bool = True) -> dict[str, Any]:
        with self._lock:
            if self._status == "running":
                raise RuntimeError("a mining run is already in progress")
            chosen_seed = _choose_seed(seed)
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
        self._reset_board()
        self._mind = []
        self._mind_dir = self._log_root / task.task_id / "logs"
        reset_logs(self._mind_dir)
        crops = getattr(task, "starter_crops", None) or {}
        if isinstance(crops, dict):
            self._mission["starter_crops"] = {
                str(name): int(count) for name, count in crops.items() if int(count) > 0
            }
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
            if kind == "board":
                if isinstance(message, dict):
                    self._store_board(message)
                return
            if kind == "mind":
                if isinstance(message, dict):
                    self._store_mind(message)
                return
            self._append(kind, str(message))
            if "validator terrain" in message or "generating random terrain" in message:
                self._touch("world", "active", "Building the validator terrain")
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

    def _store_mind(self, data: dict[str, Any]) -> None:
        plan = _sentence(data.get("plan") or data.get("think"))
        observe = _sentence(data.get("observe"))
        doing = _sentence(data.get("doing") or plan)
        status = _sentence(data.get("status") or "Running")
        if not plan and not observe and not doing:
            return
        second = _num(data.get("second"), limit=100_000) or len(self._mind) + 1
        row = {
            "second": second,
            "doing": doing,
            "status": status,
            "plan": plan,
            "think": plan,
            "observe": observe,
            "at": data.get("at") if isinstance(data.get("at"), list) else None,
            "left_s": None if data.get("left_s") is None else _num(data.get("left_s"), limit=100_000),
        }
        self._mind.append(row)
        if len(self._mind) > 3600:
            self._mind = self._mind[-3600:]
        if self._mind_dir is None:
            return
        try:
            write_second(self._mind_dir, row)
        except OSError:
            return

    def _reset_board(self) -> None:
        self._animals: dict[str, dict[str, int]] = {}
        self._bag: list[dict[str, Any]] = []
        self._crops: list[dict[str, Any]] = []
        self._pen = {"registered": False, "valid": None, "issues": 0}
        self._pos: list[int] | None = None

    def _store_board(self, data: dict[str, Any]) -> None:
        animals: dict[str, dict[str, int]] = {}
        herd = data.get("herd")
        if isinstance(herd, dict):
            for key, row in herd.items():
                if key not in _SPECIES or not isinstance(row, dict):
                    continue
                adults = _num(row.get("adults"))
                babies = _num(row.get("babies"))
                count = _num(row.get("count")) or adults + babies
                animals[str(key)] = {
                    "adults": adults,
                    "babies": babies,
                    "count": count,
                    "starters": _num(row.get("starters")),
                    "offspring": _num(row.get("off", row.get("offspring"))),
                    "raised": _num(row.get("offAdult", row.get("raised"))),
                    "food": _num(row.get("food"), limit=100_000),
                    "growth": _pct(row.get("growth")),
                }
        bag: list[dict[str, Any]] = []
        raw_bag = data.get("bag") if isinstance(data.get("bag"), dict) else data.get("inv")
        if isinstance(raw_bag, dict):
            for key, value in raw_bag.items():
                if not isinstance(key, str) or _ITEM.fullmatch(key) is None:
                    continue
                count = _num(value, limit=100_000)
                if count <= 0:
                    continue
                bag.append({"item": key, "count": count})
            bag.sort(key=lambda row: (-int(row["count"]), str(row["item"])))
            bag = bag[:48]
        raw_pen = data.get("pen") if isinstance(data.get("pen"), dict) else {}
        valid = raw_pen.get("valid")
        pos = None
        raw_pos = data.get("pos")
        if isinstance(raw_pos, (list, tuple)) and len(raw_pos) >= 3:
            try:
                pos = [int(raw_pos[0]), int(raw_pos[1]), int(raw_pos[2])]
            except (TypeError, ValueError):
                pos = None
        self._animals = animals
        self._bag = bag
        self._crops = _read_crops(data.get("crops"))
        self._pen = {
            "registered": raw_pen.get("registered") is True,
            "valid": True if valid is True else False if valid is False else None,
            "issues": _num(raw_pen.get("issues"), limit=999),
        }
        self._pos = pos
        if self._status != "running":
            return
        for target in self._targets:
            row = animals.get(target["key"])
            if row is None:
                continue
            target["have"] = min(target["target_count"], row["raised"])
            state = "done" if target["have"] >= target["target_count"] else "active"
            self._touch(
                f"raise-{target['key']}",
                state,
                f"{target['have']} / {target['target_count']} · growth {row['growth']}%",
            )

    def _public_board(self) -> dict[str, Any]:
        animals: list[dict[str, Any]] = []
        total = 0
        growth_weight = 0
        growth_sum = 0
        raised = 0
        for target in self._targets:
            row = self._animals.get(target["key"], {})
            count = int(row.get("count") or 0)
            growth = int(row.get("growth") or 0)
            got = int(row.get("raised") or 0)
            animals.append(
                {
                    "key": target["key"],
                    "display_name": target["display_name"],
                    "target_count": target["target_count"],
                    "count": count,
                    "adults": int(row.get("adults") or 0),
                    "babies": int(row.get("babies") or 0),
                    "starters": int(row.get("starters") or 0),
                    "offspring": int(row.get("offspring") or 0),
                    "raised": got,
                    "food": int(row.get("food") or 0),
                    "growth": growth,
                }
            )
            total += count
            raised += got
            if count:
                growth_weight += count
                growth_sum += growth * count
        return {
            "animals": animals,
            "bag": [dict(item) for item in self._bag],
            "bag_total": sum(int(item["count"]) for item in self._bag),
            "crops": [dict(row) for row in self._crops],
            "pen": dict(self._pen),
            "pos": None if self._pos is None else list(self._pos),
            "animals_total": total,
            "growth": 0 if growth_weight == 0 else int(round(growth_sum / growth_weight)),
            "raised": raised,
            "raised_goal": sum(int(target["target_count"]) for target in self._targets),
        }

    def _earned(self) -> float:
        total = 0.0
        for target in self._targets:
            count = target["target_count"]
            if count <= 0:
                continue
            fraction = min(1.0, target["have"] / count)
            total += fraction * float(target["points"])
        return total


_SPECIES = {"cow", "sheep", "pig", "chicken", "rabbit"}
_ITEM = re.compile(r"^[a-z0-9_]+$")


def _sentence(value: Any, limit: int = 500) -> str:
    text = " ".join(str(value or "").split())
    return text[:limit]


def _num(value: Any, *, limit: int = 500) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 0
    if number < 0:
        return 0
    return min(number, limit)


def _pct(value: Any) -> int:
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, number))


def _read_crops(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, dict):
        return []
    buckets: dict[str, list[int]] = {}
    empty = 0
    for key, value in raw.items():
        if not isinstance(key, str):
            continue
        count = _num(value, limit=5000)
        if count <= 0:
            continue
        if key == "empty":
            empty += count
            continue
        name, _, age_text = key.partition(":")
        if not name or _ITEM.fullmatch(name) is None:
            continue
        try:
            age = int(age_text)
        except ValueError:
            age = 0
        age = max(0, min(7, age))
        plots, aged = buckets.get(name, [0, 0])
        buckets[name] = [plots + count, aged + count * age]
    rows = [
        {
            "name": name,
            "plots": plots,
            "growth": 0 if plots <= 0 else max(0, min(100, round(100 * aged / (plots * 7)))),
        }
        for name, (plots, aged) in sorted(buckets.items())
    ]
    if empty:
        rows.append({"name": "empty", "plots": empty, "growth": 0})
    return rows


def _choose_seed(seed: int | None) -> int:
    if seed is None:
        return random.SystemRandom().randrange(SEED_MIN, SEED_MAX + 1)
    if type(seed) is not int or not SEED_MIN <= seed <= SEED_MAX:
        raise ValueError(f"seed must be an integer from {SEED_MIN} to {SEED_MAX}")
    return seed


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
    steps.append(
        _step("world", "Validator terrain", f"World seed {task.minecraft_seed}", "pending")
    )
    steps.append(_step("score", "Mission scored", "Waiting for the run to finish", "pending"))
    return steps
