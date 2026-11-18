from __future__ import annotations

import time
from pathlib import Path

import pytest

from npabench.console.server import viewer_upstream
from npabench.console.session import MiningSession
from npabench.evaluation.run_trace import AgentRunTrace, TraceEvent
from npabench.evaluation.single_runner import _forward_trace_events
from npabench.missions.base import Task


def _recording_runner(calls: list[Task]):
    def runner(task: Task, prompt: str, emit) -> dict:
        calls.append(task)
        emit("info", f"prompt plan {prompt}")
        emit("info", "generating random terrain")
        return {
            "score": 0.0,
            "max_score": 100.0,
            "status": "ok",
            "counts": {},
            "error": None,
        }

    return runner


def test_trace_listener_keeps_agent_events() -> None:
    seen: list[str] = []
    trace = AgentRunTrace(task_id="husbandry_seed", agent_name="llm_agent", started_at=0)
    _forward_trace_events(trace, lambda event: seen.append(event.data["msg"]))
    trace.append(TraceEvent(kind="info", data={"msg": "dig"}))
    assert seen == ["dig"]
    assert trace.events[0].kind == "info"


def test_mine_picks_a_fresh_seed_when_none_is_given() -> None:
    calls: list[Task] = []
    session = MiningSession(tick_seconds=0, runner=_recording_runner(calls))
    first = session.start(background=False)
    second = session.start(background=False)
    assert first["mission"]["seed"] != second["mission"]["seed"]
    assert calls[0].minecraft_seed != calls[1].minecraft_seed
    assert calls[0].task_id.startswith("animal_husbandry_v4_1_")
    assert calls[0].prompt.startswith("Raise ")
    assert len(calls[0].targets) == 2


def test_seed_builds_that_missions_targets() -> None:
    calls: list[Task] = []
    session = MiningSession(tick_seconds=0, runner=_recording_runner(calls))
    snapshot = session.start(seed=4, background=False)

    assert snapshot["status"] == "done"
    assert snapshot["mission"]["id"].startswith("animal_husbandry_v4_1_4_")
    assert snapshot["mission"]["seed"] == 4
    assert snapshot["mission"]["content"].startswith("Raise ")
    assert snapshot["mission"]["kind"] == "animal_husbandry"
    assert len(snapshot["targets"]) == 2
    assert calls[0].seed == 4
    assert calls[0].prompt.startswith("Raise ")
    assert "generating random terrain" in snapshot["logs"]
    assert snapshot["timeline"][-1]["id"] == "score"
    assert snapshot["timeline"][-1]["state"] == "done"


def test_live_runner_plays_the_seeded_mission(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict = {}

    class Report:
        score = 0
        max_score = 100
        status = "ok"
        raw = {
            "score": 50,
            "max_score": 100,
            "resources": [],
        }

    def fake_eval(*args, **kwargs):
        captured["mission_id"] = kwargs["mission_id"]
        captured["materialize_prompt"] = kwargs["materialize_prompt"]
        captured["task"] = kwargs["task"]
        captured["mode"] = kwargs["agent_mode"]
        captured["agent"] = args[0]
        species = kwargs["task"].targets[0].key
        Report.raw["resources"] = [{"key": species, "achieved": 2}]
        kwargs["on_event"](TraceEvent(kind="info", data={"msg": "breed", "species": species}))
        return Report()

    monkeypatch.setattr("npabench.console.live.evaluate_single_agent", fake_eval)
    session = MiningSession(tick_seconds=0)
    snapshot = session.start(seed=3, background=False)

    species = captured["task"].targets[0].key
    assert captured["mission_id"] == "animal_husbandry"
    assert captured["materialize_prompt"] is False
    assert captured["mode"].value == "host"
    assert captured["agent"].name == "llm_agent"
    assert captured["task"].task_id.startswith("animal_husbandry_v4_1_3_")
    assert f"species={species}" in snapshot["logs"]
    assert snapshot["score"] == 50
    raised = next(row for row in snapshot["targets"] if row["key"] == species)
    assert raised["have"] == 2


def test_view_events_draw_the_agent_terrain() -> None:
    def runner(task: Task, prompt: str, emit) -> dict:
        emit("info", "generating random terrain")
        emit("view", {"x": 12.5, "y": 64.2, "z": -3, "yaw": 1.2, "blocks": [[0, -1, 0, 2], [1, -1, 0, 3]]})
        emit("viewer", {"port": 3007})
        return {"score": 0.0, "max_score": 100.0, "status": "ok", "counts": {}, "error": None}

    snapshot = MiningSession(tick_seconds=0, runner=runner).start(seed=8, background=False)
    assert snapshot["terrain"]["x"] == 12.5
    assert snapshot["terrain"]["blocks"] == [[0, -1, 0, 2], [1, -1, 0, 3]]
    assert snapshot["viewer"]["port"] == 3007


def test_time_bar_shrinks_as_the_mission_runs() -> None:
    session = MiningSession(tick_seconds=0, runner=_recording_runner([]))
    finished = session.start(seed=4, background=False)
    assert finished["clock"]["duration_seconds"] == 1200
    assert finished["clock"]["remaining_seconds"] > 1190
    assert finished["clock"]["ended_at"] is not None

    session._status = "running"
    session._ended_at = None
    session._started_at = time.time() - 180
    running = session.snapshot()
    assert 1010 < running["clock"]["remaining_seconds"] < 1030


def test_status_sends_only_new_log_lines() -> None:
    session = MiningSession(tick_seconds=0, runner=_recording_runner([]))
    session.start(seed=4, background=False)
    first = session.status(0)
    assert first["reset"] is False
    assert first["log_from"] == 0
    assert first["log_count"] == first["logs"].count("\n") + 1
    assert "generating random terrain" in first["logs"]
    assert "terrain" not in first

    again = session.status(first["log_count"])
    assert again["logs"] == ""
    assert again["log_from"] == first["log_count"]

    fresh = session.status(10_000)
    assert fresh["reset"] is True
    assert fresh["log_from"] == 0
    assert "generating random terrain" in fresh["logs"]


def test_world_view_is_served_through_the_dashboard() -> None:
    assert viewer_upstream("/mc/") == "/"
    assert viewer_upstream("/mc/index.js") == "/index.js"
    assert viewer_upstream("/mc/socket.io/?EIO=4&transport=polling") == "/socket.io/?EIO=4&transport=polling"
    assert viewer_upstream("/socket.io/?EIO=4&transport=polling") == "/socket.io/?EIO=4&transport=polling"
    assert viewer_upstream("/api/session") is None


def test_second_run_waits_until_the_first_finishes() -> None:
    session = MiningSession(tick_seconds=0, runner=_recording_runner([]))
    with session._lock:
        session._status = "running"
    with pytest.raises(RuntimeError, match="already in progress"):
        session.start(seed=2, background=False)


def test_console_page_exposes_the_required_controls() -> None:
    static = Path(__file__).resolve().parents[2] / "npabench" / "console" / "static"
    html = (static / "index.html").read_text()
    css = (static / "app.css").read_text()

    assert 'id="prompt"' not in html
    assert "LLM prompt" not in html
    assert 'id="mine"' in html
    assert ">Mine</button>" in html
    assert 'id="logs"' in html
    assert "disabled" in html
    assert 'id="mission-id"' in html
    assert 'id="mission-content"' in html
    assert 'role="progressbar"' in html
    assert 'id="timeline"' in html
    assert 'id="timebar"' in html
    assert 'id="world"' in html
    assert 'id="terrain"' not in html
    assert "overflow-y: scroll" in css
    assert "white-space: pre-wrap" in css
