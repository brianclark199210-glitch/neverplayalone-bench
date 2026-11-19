"""World seeds the Minecraft server and the validator both accept.

A Minecraft world seed is a positive signed 64-bit integer. The validator
masks its task seed to that width in ``validator.round_evaluation`` and
passes the result in as the task seed. That value is the world seed.
A wider roll is not a seed the server can use, so the level is then built
from a different random terrain than the one the task recorded.
"""

SIGNED_WORLD_SEED = 0x7FFFFFFFFFFFFFFF


def supported_world_seed(seed: int) -> int:
    return int(seed) & SIGNED_WORLD_SEED
