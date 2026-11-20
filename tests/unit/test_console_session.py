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
    seen = set()
    for _ in range(12):
        snapshot = session.start(background=False)
        seen.add(snapshot["mission"]["seed"])
    assert seen <= set(range(6))
    assert len(seen) >= 2
    assert calls[0].task_id.startswith("animal_husbandry_v4_1_")
    assert calls[0].prompt.startswith("Raise ")
    assert len(calls[0].targets) == 2


def test_spawn_marks_the_agent_in_the_world() -> None:
    def runner(task: Task, prompt: str, emit) -> dict:
        emit("info", "starting minecraft server")
        emit("info", "spawn at the supply chest")
        return {"score": 0.0, "max_score": 100.0, "status": "ok", "counts": {}, "error": None}

    snapshot = MiningSession(tick_seconds=0, runner=runner).start(seed=0, background=False)
    world = next(step for step in snapshot["timeline"] if step["id"] == "world")
    assert world["state"] == "done"
    assert world["detail"] == "Agent is in the world"


def test_any_whole_seed_is_accepted() -> None:
    calls: list[Task] = []
    session = MiningSession(tick_seconds=0, runner=_recording_runner(calls))
    snapshot = session.start(seed="48291", background=False)
    assert snapshot["mission"]["seed"] == 48291
    assert snapshot["mission"]["minecraft_seed"] == 48291
    assert calls[0].seed == 48291

    negative = MiningSession(tick_seconds=0, runner=_recording_runner([])).start(seed=-42, background=False)
    assert negative["mission"]["seed"] == -42
    assert negative["mission"]["minecraft_seed"] == (-42 & 0x7FFFFFFFFFFFFFFF)


def test_text_seed_builds_the_same_world_every_time() -> None:
    first = MiningSession(tick_seconds=0, runner=_recording_runner([])).start(seed="meadow-run", background=False)
    second = MiningSession(tick_seconds=0, runner=_recording_runner([])).start(seed="  meadow-run  ", background=False)
    other = MiningSession(tick_seconds=0, runner=_recording_runner([])).start(seed="12abc", background=False)
    assert first["mission"]["seed_text"] == "meadow-run"
    assert first["mission"]["seed"] == second["mission"]["seed"]
    assert first["mission"]["minecraft_seed"] == second["mission"]["minecraft_seed"]
    assert first["mission"]["seed"] != other["mission"]["seed"]
    assert first["timeline"][0]["detail"] == "meadow-run"

    huge = "28299634819238106159248760766855816119375932247633043835629792569978907022556"
    # Hashing that text used to rename the mission to animal_husbandry_v4_1_1991516734225699350_chicken3_cow4.
    kept = MiningSession(tick_seconds=0, runner=_recording_runner([])).start(seed=huge, background=False)
    assert kept["mission"]["seed_text"] == huge
    assert kept["mission"]["seed"] == int(huge)
    assert huge in kept["mission"]["id"]
    assert "1991516734225699350" not in kept["mission"]["id"]
    assert "chicken3_cow4" not in kept["mission"]["id"]
    assert {(row["key"], row["target_count"]) for row in kept["targets"]} == {("rabbit", 3), ("pig", 3)}
    assert kept["timeline"][1]["detail"] == kept["mission"]["id"]

    session = MiningSession(tick_seconds=0, runner=_recording_runner([]))
    with pytest.raises(ValueError, match="Type a seed"):
        session.start(seed="   ", background=False)
    assert session.snapshot()["status"] == "idle"


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
    assert calls[0].minecraft_seed == 4
    assert snapshot["mission"]["minecraft_seed"] == 4
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

    snapshot = MiningSession(tick_seconds=0, runner=runner).start(seed=5, background=False)
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


def test_board_reports_animal_count_growth_and_bag() -> None:
    def runner(task: Task, prompt: str, emit) -> dict:
        species = task.targets[0].key
        emit(
            "board",
            {
                "herd": {
                    species: {
                        "adults": 2,
                        "babies": 1,
                        "count": 3,
                        "starters": 2,
                        "off": 1,
                        "offAdult": 1,
                        "food": 6,
                        "growth": 40,
                    }
                },
                "bag": {"wheat": 6, "oak_fence": 40, "not an item": 3},
                "crops": {"wheat:7": 2, "wheat:0": 2, "empty": 3},
                "pen": {"registered": True, "valid": True, "issues": 0},
                "pos": [12, 64, -3],
            },
        )
        emit("info", "prompt plan herd")
        return {"score": 0.0, "max_score": 100.0, "status": "ok", "counts": {}, "error": None}

    snapshot = MiningSession(tick_seconds=0, runner=runner).start(seed=1, background=False)
    species = snapshot["targets"][0]["key"]
    board = snapshot["board"]
    animal = board["animals"][0]
    assert animal["key"] == species
    assert animal["count"] == 3
    assert animal["babies"] == 1
    assert animal["adults"] == 2
    assert animal["growth"] == 40
    assert animal["raised"] == 1
    assert snapshot["targets"][0]["have"] == 1
    assert board["animals_total"] == 3
    assert board["growth"] == 40
    assert board["bag_total"] == 46
    assert board["bag"][0] == {"item": "oak_fence", "count": 40}
    assert board["bag"][1] == {"item": "wheat", "count": 6}
    wheat = next(row for row in board["crops"] if row["name"] == "wheat")
    assert wheat == {"name": "wheat", "plots": 4, "growth": 50}
    assert board["crops"][-1] == {"name": "empty", "plots": 3, "growth": 0}
    assert board["pen"]["registered"] is True
    assert board["pos"] == [12, 64, -3]
    assert snapshot["series"][-1]["animals"] == 3
    assert snapshot["series"][-1]["growth"] == 40
    assert snapshot["series"][-1]["bag"] == 46
    assert snapshot["series"][-1]["raised"] == 1
    assert "oak_fence" not in snapshot["logs"]
    assert "starter_crops" in snapshot["mission"]


def test_each_second_of_thinking_is_written(tmp_path: Path) -> None:
    def runner(task: Task, prompt: str, emit) -> dict:
        emit("mind", {"second": 1, "think": "Build the pen first.", "observe": "At 1, 64, 2. Sees 2 rabbit babies."})
        emit("mind", {"second": 2, "think": "Still building the fence.", "observe": "At 2, 64, 2. Sees 2 rabbit babies.", "tool": "lead", "held": "wheat"})
        emit("info", "prompt plan herd")
        return {"score": 0.0, "max_score": 100.0, "status": "ok", "counts": {}, "error": None}

    snapshot = MiningSession(tick_seconds=0, runner=runner, log_root=tmp_path).start(seed=2, background=False)
    assert snapshot["mind_now"]["second"] == 2
    assert snapshot["mind_now"]["think"] == "Still building the fence."
    assert snapshot["mind_now"]["tool"] == "lead"
    assert snapshot["mind_now"]["held"] == "wheat"
    assert "Build the pen" not in snapshot["logs"]
    log_dir = tmp_path / snapshot["mission"]["id"] / "logs"
    assert (log_dir / "thought.log").read_text().splitlines() == [
        "0:01  Build the pen first.",
        "0:02  Still building the fence.",
    ]
    observe = (log_dir / "observe.log").read_text().splitlines()
    assert len(observe) == 2
    assert "rabbit babies" in observe[0]
    assert len((log_dir / "mind.jsonl").read_text().splitlines()) == 2
    again = MiningSession(tick_seconds=0, runner=runner, log_root=tmp_path)
    # The page asks only for seconds it does not have yet.
    again.start(seed=2, background=False)
    first = again.status(0, 0)
    assert first["mind_count"] == 2
    assert len(first["mind"]) == 2
    second = again.status(first["log_count"], first["mind_count"])
    assert second["mind"] == []
    assert second["mind_now"]["second"] == 2
    assert len((log_dir / "thought.log").read_text().splitlines()) == 2


def test_finished_trace_becomes_one_row_per_second(tmp_path: Path) -> None:
    from npabench.console.mindlog import write_trace

    count = write_trace(
        {
            "agent_ready_at": 1000,
            "ended_at": 1003.2,
            "events": [
                {"t": 1000.1, "kind": "info", "data": {"msg": "spawn", "pos": {"x": 1, "y": 64, "z": 2}}},
                {"t": 1002.4, "kind": "info", "data": {"msg": "kit", "inv": {"wheat": 3}, "left_s": 1190}},
            ],
        },
        tmp_path,
    )
    assert count == 4
    thought = (tmp_path / "thought.log").read_text().splitlines()
    observe = (tmp_path / "observe.log").read_text().splitlines()
    assert len(thought) == 4
    assert "supply chest" in thought[0]
    assert "flat ground" in thought[2]
    assert "No new sighting this second." in observe[1]
    assert "3 wheat" in observe[2]


def test_status_sends_only_the_latest_mind_page(tmp_path: Path) -> None:
    def runner(task: Task, prompt: str, emit) -> dict:
        for second in range(1, 85):
            emit("mind", {"second": second, "think": f"Step {second}.", "observe": "Sees the pen."})
        return {"score": 0.0, "max_score": 100.0, "status": "ok", "counts": {}, "error": None}

    session = MiningSession(tick_seconds=0, runner=runner, log_root=tmp_path)
    session.start(seed=0, background=False)
    body = session.status(0, 0)
    assert body["mind_count"] == 84
    assert body["mind_from"] == 4
    assert len(body["mind"]) == 80
    assert body["mind"][0]["second"] == 5
    assert body["mind"][-1]["second"] == 84
    caught_up = session.status(body["log_count"], body["mind_count"])
    assert caught_up["mind"] == []


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
    assert '<input id="seed"' in html
    assert 'type="text"' in html
    assert 'max="5"' not in html
    assert "Type any text." in html
    assert 'placeholder="meadow-run"' in html
    assert "<select" not in html
    assert 'id="stat-chart"' in html
    assert ">Start run</button>" in html
    assert "Animal count" in html
    assert html.count("Carry in bag") == 1
    assert 'id="bag"' in html
    assert 'id="crops"' not in html
    assert "Crop growth" not in html
    assert 'id="stat-growth"' in html
    assert "Agent status" in html
    assert "Agent action log" in html
    assert "<th>Doing</th>" in html
    assert "<th>Status</th>" in html
    assert "<th>Planning</th>" in html
    assert "<th>Observes</th>" in html
    assert 'id="mind"' in html
    assert 'id="logs"' in html
    assert 'id="mission-id"' in html
    assert 'id="mission-content"' in html
    assert 'role="progressbar"' in html
    assert 'id="timeline"' in html
    assert 'id="timebar"' in html
    assert 'id="world"' in html
    assert 'id="terrain"' not in html
    assert "overflow-y: scroll" in css
    assert "white-space: pre-wrap" in css
