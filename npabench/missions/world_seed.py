"""Task seeds name the mission. World seeds are the part Minecraft can store.

A typed whole number is the task seed. Hashing its decimal text is a different
seed: the first 8 bytes of sha256("28299...7022556") are 1991516734225699350,
and that hash rolls "3 adult chicken offspring and 4 adult cow offspring"
instead of the mission for the number itself.

A Minecraft world seed is a positive signed 63-bit integer. Only the world
uses ``supported_world_seed``. The mission id, prompt, and targets stay on
the full task seed.
"""

from __future__ import annotations

import hashlib
import re

SIGNED_WORLD_SEED = 0x7FFFFFFFFFFFFFFF


def supported_world_seed(seed: int) -> int:
    return int(seed) & SIGNED_WORLD_SEED


def resolve_task_seed(seed: int | str) -> int:
    """Return the task seed. A whole number is that number; other text is hashed."""
    if isinstance(seed, bool) or not isinstance(seed, (int, str)):
        raise TypeError("seed must be a whole number or text")
    if isinstance(seed, int):
        return seed
    text = seed.strip()
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    if not text:
        raise ValueError("Type a seed.")
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") & SIGNED_WORLD_SEED
