"""Per-second thought and observation logs for one husbandry run."""
from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

_LOGS = ("mind.jsonl", "thought.log", "observe.log")


def reset_logs(directory: Path) -> None:
    if not directory.exists():
        return
    for name in _LOGS:
        path = directory / name
        if path.exists():
            path.unlink()


def write_second(directory: Path, row: dict[str, Any]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    stamp = clock_label(int(row.get("second") or 0))
    with (directory / "mind.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    with (directory / "thought.log").open("a", encoding="utf-8") as handle:
        handle.write(f"{stamp}  {row.get('think') or ''}\n")
    with (directory / "observe.log").open("a", encoding="utf-8") as handle:
        handle.write(f"{stamp}  {row.get('observe') or ''}\n")


def clock_label(second: int) -> str:
    whole = max(0, second)
    return f"{whole // 60}:{whole % 60:02d}"


def park_world(run_dir: Path, worlds_dir: Path) -> None:
    """Move the leftover Minecraft server out of the readable run folder."""
    world = run_dir / "reference_world"
    if not world.exists():
        return
    worlds_dir.parent.mkdir(parents=True, exist_ok=True)
    if worlds_dir.exists():
        shutil.rmtree(worlds_dir)
    shutil.move(str(world), str(worlds_dir))


def records_from_trace(trace: dict[str, Any]) -> list[dict[str, Any]]:
    """One row per second from a finished trace, carrying the last sighting forward."""
    events = sorted(trace.get("events") or [], key=lambda event: float(event.get("t") or 0))
    origin = trace.get("agent_ready_at") or trace.get("started_at") or 0
    origin = float(origin or 0)
    end = trace.get("ended_at")
    if end is None and events:
        end = events[-1].get("t")
    end_second = max(0, int(float(end or origin) - origin))
    buckets: dict[int, list[dict[str, Any]]] = {}
    for event in events:
        second = max(0, int(float(event.get("t") or origin) - origin))
        buckets.setdefault(second, []).append(event)

    think = "Waiting to read the task."
    seen = "nothing recorded yet"
    bag = "not looted"
    pen = "pen not started"
    at = "unknown"
    left = ""
    rows: list[dict[str, Any]] = []
    for second in range(end_second + 1):
        fresh = False
        for event in buckets.get(second, []):
            data = event.get("data") if isinstance(event.get("data"), dict) else {}
            message = str(data.get("msg") or event.get("kind") or "step")
            thought = _think(message, data)
            if thought:
                think = thought
                fresh = True
            seen, bag, pen, at, left = _absorb(message, data, seen, bag, pen, at, left)
        quiet = "" if fresh else " No new sighting this second."
        observe = f"At {at}. Sees {seen}. Bag: {bag}. {pen}.{(' ' + left) if left else ''}{quiet}"
        observe = " ".join(observe.split())
        rows.append(
            {
                "second": second,
                "think": think,
                "observe": observe,
                "at": at,
                "seen": seen,
                "bag": bag,
                "pen": pen,
            }
        )
    return rows


def write_trace(trace: dict[str, Any], directory: Path) -> int:
    reset_logs(directory)
    rows = records_from_trace(trace)
    for row in rows:
        write_second(directory, row)
    return len(rows)


_QUIET = {
    "stdout",
    "viewer",
    "ready",
    "S3 dand installed",
    "S3 nav fast-fail",
    "seedx crack",
    "findBlocks check",
    "inventory resync",
}


def _think(message: str, data: dict[str, Any]) -> str | None:
    if message in _QUIET:
        return None
    if message == "targets":
        goals = []
        for target in data.get("targets") or []:
            if isinstance(target, dict):
                goals.append(f"{target.get('count')} {target.get('key')}")
        listed = " and ".join(goals) if goals else "the two species"
        return f"The task is {listed}. I pen them, breed a pair, and raise the offspring inside."
    if message == "spawn":
        return "I am at the supply chest. The fence and seeds are here, so the pen comes before any breeding."
    if message == "kit":
        return "The chest is in the bag. Next is flat ground for the fence."
    if message == "relocate":
        village = data.get("village") or []
        biome = village[3] if isinstance(village, list) and len(village) > 3 else "a village"
        return f"Food is too far from spawn. I am walking to a {biome} village that can feed the herd."
    if message == "pen ready":
        if data.get("registered") is True:
            return "The pen is registered. Animals born and grown inside it can score."
        return "The pen is still not registered, so I keep building."
    if message == "pen status":
        if data.get("valid") is True:
            return "The enclosure checks out. The gate can stay shut."
        return "The enclosure has gaps. A broken fence makes the whole score zero, so I repair it."
    if message == "census":
        return _census_think(data.get("herd") if isinstance(data.get("herd"), dict) else {})
    if message == "lure start":
        species = data.get("species") or "animal"
        item = str(data.get("item") or "food").replace("_", " ")
        return f"A wild {species} is close enough to lead home. I hold {item} so it follows."
    if message == "lure done":
        return "The lure trip ended. I check whether the animal is actually inside the pen."
    if message == "herd service":
        fed = data.get("fed")
        return f"I fed the herd {fed} times. Each feed takes 10% off the time a baby still needs."
    if message == "birth":
        species = data.get("species") or "animal"
        return f"A {species} was born in the pen. It counts only after it grows up in here."
    if message == "grew up":
        species = data.get("species") or "animal"
        kind = data.get("kind") or "animal"
        return f"A {kind} {species} became an adult. Offspring inside the pen are what the score counts."
    if message in {"site scan", "pen site", "herd site"}:
        return "I am scoring flat ground for a pen, close to the animals I have already seen."
    if message in {"pen level pass", "fill burst"}:
        return "Leveling the pen floor so the fence sits on solid blocks."
    if message in {"ring burst", "pen built"}:
        return "The fence ring is going in. It has to be registered before a birth can score."
    if message in {"register", "herd registered"}:
        return "The pen is registered and the starter babies are on the books."
    if message in {"wood", "no wood nearby"}:
        return "I need logs for the tools and the pen, so I look for trees."
    if message in {"forage", "dandelion forage", "forage: far patch", "dandelion round", "dandelions in sight"}:
        return "I am collecting food the herd can eat or plant."
    if message == "forage: dry, pausing":
        return "This patch is empty. I stop searching here."
    if message in {"compost", "compost first", "composter crafted", "composter placed"}:
        return "Bone meal grows the field faster than waiting, so I run the composter."
    if message == "hoe":
        return "The hoe is ready. The seeds can go into farmland."
    if message == "first wheat":
        return "The first wheat is in. Cows and sheep can be fed with it."
    if message == "chest looted":
        return "A chest had supplies. I take what feeds the animals or builds the pen."
    if message in {"village seen", "village trip", "seedx village", "seedx found"}:
        return "A village is the fastest food. I am going there for hay or crops."
    if message in {"village trip done", "seedx village done"}:
        return "The village trip is over. I head back with whatever food I pulled."
    if message in {"scavenge start", "scavenge end", "scavenge done"}:
        return "I pick up drops and loose food before the next trip."
    if message in {"lure: over the valve", "lure: second", "gate: animals waiting at it"}:
        return "The animal stopped at the gate. I pull it through so it is inside the pen."
    if message in {"love", "love gather", "love gather lead", "escort: love first"}:
        return "A pair can breed. I bring them together inside the pen."
    if message in {"offspring adult"}:
        return "An offspring just became an adult inside the pen. That is what the score counts."
    if message in {"escort start", "escort done"}:
        return "A baby is about to grow up. I walk it to the middle of the pen so the growth counts."
    if message in {"relocate", "relocate check", "relocate wait", "relocate done"}:
        return "Food is too far from spawn, so I move the pen toward a village that has it."
    if message in {"iron: giving up", "iron: skipped", "iron: no table", "early iron: no pickaxe", "post-pen iron", "post-pen iron again"}:
        return "Iron tools would speed this up. This attempt did not pay, so I go back to food."
    if message in {"craft failed", "craft: no result", "craft: failing, pausing tools"}:
        return "That craft did not finish. I need the table or the materials before I try again."
    if message in {"move aborted", "path failed", "swim out", "escape move", "jump out", "water trouble: avoiding water", "valve cross", "valve placed"}:
        return "The path is blocked or I am in water. I get back on ground before the next step."
    if message in {"action timeout", "step stall"}:
        return "That step is stuck. I drop it and take the next one."
    if message in {"end", "timeout"}:
        return "The clock is finished. The animals still inside the pen are what get scored."
    if message == "chunks":
        return "Waiting for the terrain around me to finish loading."
    if message == "travel end":
        return "The walk finished. I look at what is here before choosing the next step."
    if message == "place failed":
        return "A block did not place. I retry from a spot I can stand on."
    return f"I am working on {message.replace('_', ' ')}."


def _census_think(herd: dict[str, Any]) -> str:
    bits = []
    for species, row in herd.items():
        if not isinstance(row, dict):
            continue
        adults = int(row.get("adults") or 0)
        babies = int(row.get("babies") or 0)
        raised = int(row.get("offAdult") or 0)
        food = int(row.get("food") or 0)
        if adults < 2:
            bits.append(f"{species} has {adults} adult in the pen, so no pair yet")
        elif babies and food <= 0:
            bits.append(f"{species} babies have no food in hand")
        elif babies:
            bits.append(f"keep feeding {species} babies ({raised} adult offspring so far)")
        else:
            bits.append(f"{species} can breed, {raised} adult offspring so far")
    if not bits:
        return "I am counting the pen. Nothing tracked yet."
    return ". ".join(bits) + "."


def _absorb(
    message: str,
    data: dict[str, Any],
    seen: str,
    bag: str,
    pen: str,
    at: str,
    left: str,
) -> tuple[str, str, str, str, str]:
    if isinstance(data.get("at"), list) and len(data["at"]) >= 3:
        at = _xyz(data["at"])
    elif isinstance(data.get("pos"), dict):
        pos = data["pos"]
        at = _xyz([pos.get("x"), pos.get("y"), pos.get("z")])
    if isinstance(data.get("inv"), dict):
        bag = _bag(data["inv"])
    if "left_s" in data and data["left_s"] is not None:
        try:
            left = f"{clock_label(int(data['left_s']))} left."
        except (TypeError, ValueError):
            pass
    if message == "census":
        seen = _census_seen(data)
    elif message == "spawn":
        seen = "the supply chest"
    elif message == "lure start":
        species = data.get("species") or "animal"
        count = data.get("n")
        seen = f"{count} wild {species}" if count else f"a wild {species}"
    elif message == "birth":
        seen = f"a newborn {data.get('species') or 'animal'}"
    elif message == "grew up":
        seen = f"a grown {data.get('species') or 'animal'}"
    if message == "pen ready":
        pen = "pen registered" if data.get("registered") is True else "pen not registered"
    elif message == "pen status":
        pen = "pen valid" if data.get("valid") is True else "pen has gaps"
    return seen, bag, pen, at, left


def _census_seen(data: dict[str, Any]) -> str:
    parts: list[str] = []
    herd = data.get("herd") if isinstance(data.get("herd"), dict) else {}
    for species, row in herd.items():
        if not isinstance(row, dict):
            continue
        adults = int(row.get("adults") or 0)
        babies = int(row.get("babies") or 0)
        if adults or babies:
            parts.append(f"in pen {adults} adult {species}, {babies} baby {species}")
    wild = data.get("wild") if isinstance(data.get("wild"), dict) else {}
    for name, distances in wild.items():
        count = len(distances) if isinstance(distances, list) else 0
        if count:
            parts.append(f"{count} wild {name.replace('_', ' ')}")
    return ", ".join(parts) if parts else "no animals in the census"


def _bag(items: dict[str, Any]) -> str:
    rows = []
    for name, count in items.items():
        try:
            number = int(count)
        except (TypeError, ValueError):
            continue
        if number > 0 and isinstance(name, str):
            rows.append((number, name.replace("_", " ")))
    rows.sort(key=lambda row: (-row[0], row[1]))
    if not rows:
        return "empty"
    shown = [f"{count} {name}" for count, name in rows[:6]]
    if len(rows) > 6:
        shown.append(f"{len(rows) - 6} more")
    return ", ".join(shown)


def _xyz(values: list[Any]) -> str:
    try:
        return ", ".join(str(int(float(part))) for part in values[:3])
    except (TypeError, ValueError):
        return "unknown"
