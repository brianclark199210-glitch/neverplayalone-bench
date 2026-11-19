"""Run the LLM agent in a freshly generated Minecraft world."""
from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from npabench.agents.base import AgentSpec
from npabench.config import RESULTS_DIR
from npabench.console.mindlog import park_world
from npabench.evaluation.evaluate import AgentMode, evaluate_single_agent
from npabench.evaluation.run_trace import TraceEvent
from npabench.missions.base import Task

AGENT_DIR = Path(__file__).resolve().parents[2] / "agents" / "llm_agent"
Emit = Callable[[str, str], None]


def run_live(task: Task, prompt: str, emit: Emit) -> dict[str, Any]:
    mission_id = "animal_husbandry"

    def on_event(event: TraceEvent) -> None:
        if event.kind in {"view", "viewer", "board", "mind"}:
            emit(event.kind, event.data if isinstance(event.data, dict) else {})
            return
        emit(*format_trace_event(event))

    output_dir = RESULTS_DIR / "runs" / task.task_id
    try:
        report = evaluate_single_agent(
            AgentSpec(name="llm_agent", path=AGENT_DIR),
            mission_id=mission_id,
            seed=task.seed,
            output_dir=output_dir,
            record=False,
            agent_mode=AgentMode.HOST,
            task=task,
            materialize_prompt=False,
            on_event=on_event,
        )
    finally:
        park_world(output_dir, RESULTS_DIR / "worlds" / task.task_id)
    error = report.raw.get("error")
    return {
        "score": float(report.raw.get("score", report.score) or 0),
        "max_score": float(report.raw.get("max_score", report.max_score) or 0),
        "status": report.status,
        "counts": counts_from_report(report.raw),
        "error": None if error is None else str(error),
        "prompt": prompt,
    }


def format_trace_event(event: TraceEvent) -> tuple[str, str]:
    data = dict(event.data)
    message = str(data.pop("msg", "") or "")
    data.pop("t", None)
    parts = [message] if message else []
    for key, value in data.items():
        text = json.dumps(value, default=str) if isinstance(value, (dict, list)) else str(value)
        if len(text) > 180:
            text = text[:177] + "..."
        parts.append(f"{key}={text}")
    return event.kind, " ".join(parts) or event.kind


def counts_from_report(raw: dict[str, Any]) -> dict[str, int]:
    counts: dict[str, int] = {}
    rows = raw.get("resources")
    if not isinstance(rows, list):
        return counts
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = row.get("item") or row.get("key")
        if not isinstance(key, str):
            continue
        amount = row.get("achieved", row.get("count", 0))
        try:
            counts[key] = int(amount or 0)
        except (TypeError, ValueError):
            continue
    return counts
