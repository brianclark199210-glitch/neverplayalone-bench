from npabench.missions.animal_husbandry.mission import AnimalHusbandryMission
from npabench.missions.world_seed import resolve_task_seed, supported_world_seed

HUGE = "28299634819238106159248760766855816119375932247633043835629792569978907022556"
HASHED = 1991516734225699350


def test_a_whole_number_is_not_hashed():
    assert resolve_task_seed(HUGE) == int(HUGE)
    assert resolve_task_seed(int(HUGE)) == int(HUGE)
    assert resolve_task_seed(HUGE) != HASHED


def test_huge_seed_is_not_the_chicken_cow_mission():
    mission = AnimalHusbandryMission()
    config = mission.load_config(mission.default_config_path())
    task = mission.generate_task(config, resolve_task_seed(HUGE))
    hashed = mission.generate_task(config, HASHED)

    assert HUGE in task.task_id
    assert "1991516734225699350" not in task.task_id
    assert "chicken" not in task.prompt
    assert "cow" not in task.prompt
    assert hashed.task_id == "animal_husbandry_v4_1_1991516734225699350_chicken3_cow4"
    assert hashed.prompt == "Raise 3 adult chicken offspring and 4 adult cow offspring within 20 minutes."
    assert task.minecraft_seed == supported_world_seed(int(HUGE))
    assert task.seed == int(HUGE)
