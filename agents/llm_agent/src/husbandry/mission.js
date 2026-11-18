"use strict";

const B = require("../runtime/connection");

const C2 = !!require("../planning/options").C2_PIG_FEASIBILITY;

const SPECIES = ["cow", "sheep", "pig", "chicken", "rabbit"];

const ALIAS = {
  cows: "cow",
  cattle: "cow",
  sheeps: "sheep",
  pigs: "pig",
  chickens: "chicken",
  rabbits: "rabbit",
  bunny: "rabbit",
  bunnies: "rabbit",
};
function normSpecies(w) {
  const k = String(w || "").toLowerCase();
  if (SPECIES.includes(k)) return k;
  if (ALIAS[k]) return ALIAS[k];
  const s = k.replace(/s$/, "");
  return SPECIES.includes(s) ? s : null;
}

function parseTargets(prompt) {
  const text = String(prompt || ""),
    out = {};
  const add = (sp, n) => {
    if (sp && n > 0 && !(sp in out) && Object.keys(out).length < 4)
      out[sp] = Math.min(8, n);
  };
  const pats = [
    /(\d+)\s+(?:raised\s+)?(?:adult\s+)?([a-z_]+)\s+offspring/gi,
    /(\d+)\s+(?:raised\s+|bred\s+|new\s+)?(?:adult\s+|baby\s+)?([a-z_]+)/gi,
  ];
  for (const re of pats) {
    let m;
    while ((m = re.exec(text))) add(normSpecies(m[2]), parseInt(m[1], 10));
    if (Object.keys(out).length >= 2) break;
  }
  if (!Object.keys(out).length) {
    const re = /\b([a-z_]+)\s*(?:x|:|=)\s*(\d+)/gi;
    let m;
    while ((m = re.exec(text))) add(normSpecies(m[1]), parseInt(m[2], 10));
  }
  return out;
}

function isAnimalPrompt(prompt) {
  return (
    /offspring|npafarm|enclosure|herd/i.test(prompt || "") ||
    Object.keys(parseTargets(prompt)).length > 0
  );
}

async function findChest(timeoutMs = 2e4) {
  const bot = B.S.bot,
    until = B.now() + timeoutMs;
  while (B.now() < until) {
    const c = bot.findBlock({
      matching: (b) => b && b.name === "chest",
      maxDistance: 6,
    });
    if (c) return c;
    await B.sleep(300);
  }
  return null;
}

async function waitSetup(timeoutMs = 8e3) {
  const bot = B.S.bot;
  await new Promise((res) => {
    const t = setTimeout(res, timeoutMs);
    bot.once("forcedMove", () => (clearTimeout(t), res()));
  });
  await B.sleep(1500);
}

async function takeSupplies(block) {
  const bot = B.S.bot;
  let items = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    const c =
      bot.findBlock({
        matching: (b) => b && b.name === "chest",
        maxDistance: 6,
      }) || block;
    try {
      await B.goto(
        new B.goals.GoalNear(c.position.x, c.position.y, c.position.z, 2),
        { timeout: 1e4 },
      );
    } catch {}
    let win = null;
    try {
      win = await B.withTimeout(bot.openContainer(c), 2500, "open chest");
    } catch (e) {
      B.log("ah chest open failed", {
        attempt,
        err: String(e).slice(0, 120),
        at: c.position,
      });
      await B.sleep(1e3);
      continue;
    }
    items = win.containerItems().map((i) => ({ name: i.name, count: i.count }));
    const fences = items
      .filter((i) => i.name === "oak_fence")
      .reduce((a, i) => a + i.count, 0);
    if (fences < 128 && attempt < 5) {
      B.log("ah chest not full yet", { attempt, items });
      win.close();
      await B.sleep(1e3);
      continue;
    }
    B.log("ah chest", { attempt, items });
    for (const it of win.containerItems()) {
      try {
        await win.withdraw(it.type, null, it.count);
      } catch (e) {
        B.log("ah withdraw failed", {
          item: it.name,
          err: String(e).slice(0, 120),
        });
      }
    }
    win.close();
    break;
  }
  B.log("ah inventory", {
    inv: B.allItems().map((i) => `${i.name}:${i.count}`),
  });
  return items;
}

function census(radius = 96) {
  const bot = B.S.bot,
    me = bot.entity.position,
    counts = {};
  for (const e of Object.values(bot.entities)) {
    if (!e || e === bot.entity || !e.name || !SPECIES.includes(e.name))
      continue;
    const d = Math.round(e.position.distanceTo(me));
    if (d > radius) continue;
    (counts[e.name] = counts[e.name] || []).push(d);
  }
  for (const k in counts) counts[k].sort((a, b) => a - b);
  return counts;
}

async function waitChunks(R, maxMs) {
  const t0 = B.now(),
    me = B.S.bot.entity.position.floored(),
    cells = [];
  for (let dx = -R; dx <= R; dx += 16)
    for (let dz = -R; dz <= R; dz += 16) cells.push([me.x + dx, me.z + dz]);
  let loaded = 0,
    last = -1,
    changed = B.now();
  for (;;) {
    loaded = 0;
    const w = B.S.bot.world;
    for (const [x, z] of cells) {
      let c = null;
      try {
        c = w.getColumnAt(new B.Vec3(x, 0, z));
      } catch {}
      if (c) loaded++;
    }
    if (loaded !== last) ((last = loaded), (changed = B.now()));

    const stallMs =
      process.env.AH_CHUNKWAIT !== "0" && loaded < cells.length * 0.6
        ? maxMs
        : 8e3;
    if (
      loaded >= cells.length ||
      B.now() - t0 > maxMs ||
      B.now() - changed > stallMs
    )
      break;
    await B.sleep(500);
  }
  B.log("ah chunks", { loaded, cells: cells.length, waited_ms: B.now() - t0 });
}
function tryRequire(name) {
  try {
    return require(name);
  } catch (e) {
    B.log("ah module missing", { name, err: String(e).slice(0, 160) });
    return null;
  }
}

async function guarded(name, fn) {
  const t = B.secs();
  try {
    const r = await Promise.resolve().then(fn);
    B.log("ah step done", { step: name, secs: +(B.secs() - t).toFixed(1) });
    return r;
  } catch (e) {
    B.log("ah step failed", {
      step: name,
      secs: +(B.secs() - t).toFixed(1),
      err: String((e && e.stack) || e).slice(0, 300),
    });
    return null;
  }
}

function analyzeWorld(FOOD) {
  const origin = B.pos().floored();
  let biome = null;
  try {
    const here = B.blockAt(origin);
    const bio = here && here.biome;
    if (typeof bio === "string") biome = bio;
    else if (bio && typeof bio === "object") biome = bio.name || null;
  } catch {}
  const surface = {};
  let land = 0,
    water = 0,
    samples = 0;
  for (let dx = -32; dx <= 32; dx += 8)
    for (let dz = -32; dz <= 32; dz += 8) {
      let top = null;
      try {
        for (let y = origin.y + 12; y > origin.y - 24; y--) {
          const block = B.blockAt(new B.Vec3(origin.x + dx, y, origin.z + dz));
          if (!block) continue;
          if (
            B.isAir(block) ||
            /leaves|_log$|sapling|grass$|fern|flower|dandelion|poppy|tulip|orchid|daisy|cornflower|lilac|peony|rose_bush/.test(
              block.name,
            )
          )
            continue;
          if (block.boundingBox === "empty" && !/water|lava/.test(block.name))
            continue;
          top = block.name;
          break;
        }
      } catch {}
      if (!top) continue;
      samples++;
      surface[top] = (surface[top] || 0) + 1;
      if (/water|lava|ice|kelp|seagrass/.test(top)) water++;
      else land++;
    }
  const dominant = Object.entries(surface).sort((a, b) => b[1] - a[1])[0];
  const ground = (dominant && dominant[0]) || "";
  const terrain =
    !dominant
      ? "unknown"
      : water > land
        ? "water"
        : /sand/.test(ground)
          ? "sandy"
          : /snow|ice/.test(ground)
            ? "snowy"
            : /stone|deepslate|gravel|tuff|andesite|diorite|granite/.test(ground)
              ? "rocky"
              : /grass_block|podzol|mycelium|dirt|mud|moss/.test(ground)
                ? "grassy"
                : "mixed";
  let nature = {};
  try {
    if (FOOD && FOOD.nature) nature = FOOD.nature(48);
  } catch {}
  let landscape = [];
  try {
    if (FOOD && FOOD.directionScores)
      landscape = FOOD.directionScores(origin)
        .slice(0, 3)
        .map((dir) => ({
          deg: dir.deg,
          landScore: dir.score,
          water: dir.water,
        }));
  } catch {}
  const animals = census(96);
  const resources = {};
  try {
    for (const item of B.allItems())
      resources[item.name] = (resources[item.name] || 0) + item.count;
  } catch {}
  const report = {
    terrain,
    biome,
    dominant: ground || null,
    samples,
    land,
    water,
    surface,
    nature,
    landscape,
    animals,
    resources,
    at: { x: origin.x, y: origin.y, z: origin.z },
  };
  B.log("ah world", report);
  return report;
}

const END_GUARD_MS = 12e3;

async function endgame(PEN, HERD, pen, targets) {
  if (!PEN || !pen) return;
  const bot = B.S.bot,
    inside = PEN.inPen(B.pos()),
    c =
      pen.center ||
      new B.Vec3(pen.x + 1 + pen.w / 2, pen.y, pen.z + 1 + pen.d / 2),
    foods =
      HERD && HERD.FOOD
        ? Object.keys(targets)
            .map((sp) => (HERD.FOOD[sp] || []).find((n) => B.count(n) > 0))
            .filter(Boolean)
        : [];
  try {
    if (inside) {
      if (B.hdist(B.pos(), c) > 2)
        await B.goto(
          new B.goals.GoalNear(Math.floor(c.x), c.y, Math.floor(c.z), 1),
          { timeoutMs: 8e3 },
        ).catch(() => null);
      if (foods[0]) await B.equip(foods[0]);
      const off =
        foods[1] &&
        foods[1] !== foods[0] &&
        bot.inventory.items().find((it) => it.name === foods[1]);
      if (off) await B.withTimeout(bot.equip(off, "off-hand"), 3e3, "off-hand");
    } else {
      await B.withTimeout(bot.unequip("hand"), 2e3, "unequip").catch(
        () => null,
      );
      await B.withTimeout(bot.unequip("off-hand"), 2e3, "unequip off").catch(
        () => null,
      );
    }
  } catch (e) {
    B.log("ah endgame hold failed", { err: String(e).slice(0, 160) });
  }
  for (let i = 0; i < 3 && B.timeLeft() > 4e3; i++) {
    const st = await guarded("checkPen", () => PEN.checkPen());
    B.log("ah endgame check", {
      i,
      valid: st && st.valid,
      issues: st && st.issues,
      left_ms: B.timeLeft(),
    });
    if (st && st.valid) break;
    PEN.repairPen && (await guarded("repairPen", () => PEN.repairPen()));
  }
  B.log("ah endgame hold", {
    inside,
    at: B.pos().floored(),
    d_center: +B.hdist(B.pos(), c).toFixed(1),
    foods: inside ? foods : [],
    gate: PEN.gateInfo ? PEN.gateInfo().state : null,
    left_ms: B.timeLeft(),
  });
}

const EARLY = {};
async function run() {
  let targets = null;
  try {
    targets = require("../planning/prompt").animalMap();
  } catch {}
  if (!targets) targets = parseTargets(B.ENV.PROMPT);
  B.log("ah targets", { targets });
  const foodPlan = require("./schedule").requirements(
    targets,
    (B.ENV.TIMEOUT_SEC || 1200) * 1000,
  );
  B.log("ah food plan", {
    stage: "calculate",
    left_s: Math.round(B.timeLeft() / 1000),
    species: foodPlan.species,
  });
  await waitSetup();
  const chest = await findChest();
  const kit = chest
    ? await takeSupplies(chest).catch(
        (e) => (B.log("ah chest error", { err: String(e).slice(0, 200) }), []),
      )
    : [];

  if (require("../planning/options").W1_WAIT_CHUNKS) {
    const eg =
      process.env.AH_EARLY_GATHER !== "0" &&
      (targets.chicken || targets.rabbit);
    const FOOD0 = eg ? tryRequire("../resources/supply") : null;
    if (FOOD0 && FOOD0.sweep && FOOD0.mow) {
      let done = false;
      const home = B.pos().clone(),
        tg = B.now(),
        c0 = {
          s: B.count("wheat_seeds") + B.count("beetroot_seeds"),
          d: B.count("dandelion"),
        };
      const wc = waitChunks(96, 4.5e4).finally(() => (done = true));
      const until = () => done || !B.hasBot();
      try {
        if (targets.rabbit && !until())
          await FOOD0.mow(["dandelion"], until, {
            src: "dandelion",
            items: ["dandelion"],
            max: 16,
            far: false,
          });
        for (let k = 0; k < 3 && targets.chicken && !until(); k++)
          if (
            (await FOOD0.sweep(
              ["short_grass", "tall_grass", "fern", "large_fern"],
              until,
              {
                src: "grass",
                items: [
                  "wheat_seeds",
                  "beetroot_seeds",
                  "melon_seeds",
                  "pumpkin_seeds",
                  "torchflower_seeds",
                ],
                center: home,
                radius: 28,
                findR: 20,
                legs: 6,
              },
            )) < 0
          )
            break;
      } catch (e) {
        B.log("ah early gather failed", {
          err: String((e && e.stack) || e).slice(0, 200),
        });
      }
      await wc;
      const away = B.hdist(B.pos(), home);
      if (away > 16)
        await B.goto(
          new B.goals.GoalNear(
            Math.floor(home.x),
            Math.floor(home.y),
            Math.floor(home.z),
            3,
          ),
          { timeoutMs: 1.5e4 },
        ).catch(() => null);
      B.log("ah early gather", {
        ms: B.now() - tg,
        seeds: B.count("wheat_seeds") + B.count("beetroot_seeds") - c0.s,
        dandelion: B.count("dandelion") - c0.d,
        away: Math.round(away),
        back: Math.round(B.hdist(B.pos(), home)),
      });

      EARLY.chicken = {
        ms: B.now() - tg,
        got: B.count("wheat_seeds") + B.count("beetroot_seeds") - c0.s,
      };
    } else await waitChunks(96, 4.5e4);
  }
  const PEN = tryRequire("../enclosure/construction"),
    FOOD = tryRequire("../resources/supply"),
    HERD = tryRequire("./animals");
  if (HERD && HERD.H && process.env.AH_EARLY_RATE !== "0") HERD.H.early = EARLY;
  const ctx = { targets, kit, t0: B.T0 };
  HERD && HERD.watch(targets);
  const world = analyzeWorld(FOOD);
  const nearby = Object.keys(targets).filter(
    (sp) => (world.animals[sp] || []).length,
  );
  B.log("ah animals", {
    required: targets,
    nearby,
    missing: Object.keys(targets).filter((sp) => !nearby.includes(sp)),
    distances: world.animals,
    terrain: world.terrain,
    biome: world.biome,
  });
  if (FOOD && FOOD.gather && B.timeLeft() > 3 * 60 * 1000) {
    const need = {};
    for (const [sp, row] of Object.entries(foodPlan.species))
      if (row.food > 0) need[sp] = row.food;
    B.log("ah carry food", {
      stage: "start",
      need,
      left_s: Math.round(B.timeLeft() / 1000),
    });
    const budget = nearby.length
      ? Math.min(90 * 1000, B.timeLeft() - 3 * 60 * 1000)
      : Math.min(35 * 1000, B.timeLeft() - 3 * 60 * 1000);
    if (budget > 15000 && Object.keys(need).length)
      await guarded("carry food", () =>
        FOOD.gather({ ...ctx, autoCrops: false }, need, B.now() + budget),
      );
  }

  const leavePen = async () => {
    if (HERD && HERD.goOut && HERD.H && HERD.H.pen)
      return guarded("herd goOut", () => HERD.goOut(B.pos()));
    const b = B.S.bot;
    try {
      await B.withTimeout(b.unequip("hand"), 2e3, "unequip").catch(() => null);
      await B.withTimeout(b.unequip("off-hand"), 2e3, "unequip off").catch(
        () => null,
      );
    } catch {}
    return guarded("leavePen", () => PEN.leavePen());
  };
  const village = FOOD
    ? await guarded("village scan", () => (FOOD.scan(true), FOOD.village()))
    : null;
  const prefer = HERD ? HERD.preferSite(targets) : null;
  B.log("ah plan", {
    stage: "start",
    modules: { pen: !!PEN, food: !!FOOD, herd: !!HERD },
    prefer,
    village,
    census: census(),
  });

  const penOpts = targets.sheep ? { grassW: 3 } : {};
  let pen = null;
  for (
    let i = 0;
    PEN && i < 2 && !(pen && pen.registered) && B.timeLeft() > 3e5;
    i++
  )
    pen = await guarded("buildPen", () =>
      PEN.buildPen(ctx, {
        prefer,
        deadline: B.now() + B.timeLeft() - 2.4e5,
        ...penOpts,
      }),
    );
  if (!(pen && pen.registered)) {
    B.log("ah mission failed", {
      reason: "no registered enclosure, so offspring could not be secured",
      targets,
    });
    return;
  }
  if (HERD && HERD.H && !HERD.H.regAt) HERD.H.regAt = B.now();
  FOOD && FOOD.setPen && FOOD.setPen(pen);

  let crops = false,
    deferCrops = false;
  if (FOOD && process.env.AH_EARLY_FOOD !== "0") {
    const v = FOOD.village && FOOD.village();

    const out = async () => !PEN.inPen(B.pos()) || (await leavePen());

    const penC0 =
      pen.center ||
      new B.Vec3(pen.x + 1 + pen.w / 2, pen.y, pen.z + 1 + pen.d / 2);
    if (
      (targets.cow || targets.sheep) &&
      v &&
      v.hay > 0 &&
      v.dist <= 160 &&
      B.hdist(v.at, penC0) <= 150 &&
      B.timeLeft() > 6e5
    )
      (await out()) &&
        (await guarded("hay trip", () =>
          FOOD.gather(ctx, { wheat: Math.min(9 * v.hay, 90) }, B.now() + 1.7e5),
        ));

    const pigItems =
      B.count("carrot") + B.count("potato") + B.count("beetroot");

    const cropTargets = { ...targets };

    crops =
      !!targets.sheep ||
      (!!require("../planning/options").Z5_COW_FIELD && !!targets.cow);

    ctx.autoCrops = false;

    deferCrops = false;

    if (C2 && crops && targets.pig && HERD && HERD.pigPlan) {
      const pp = HERD.pigPlan(pen);
      if (pp && pp.mode === "kit") {
        deferCrops = true;
        ctx.startDeferredCrops = async () => {
          if (!deferCrops) return;
          deferCrops = false;
          if (!(FOOD.F && FOOD.F.field) && B.timeLeft() > 5e5 && (await out()))
            await guarded("startCrops (deferred)", () =>
              FOOD.startCrops({
                ...ctx,
                targets: ctx.cropTargets,
                cropsMaxMs: 85000,
              }),
            );
          ctx.autoCrops = true;
        };
      }
    }
    B.log("ah plan", { stage: "crops", crops, defer: deferCrops, pigItems });
    if (crops && !deferCrops && !(FOOD.F && FOOD.F.field) && B.timeLeft() > 5e5)
      (await out()) &&
        (await guarded("startCrops", () =>
          FOOD.startCrops({ ...ctx, targets: cropTargets, cropsMaxMs: 85000 }),
        ));

    if (
      crops &&
      !deferCrops &&
      !(FOOD.F && FOOD.F.field) &&
      B.timeLeft() > 5e5 &&
      ((FOOD.F && FOOD.F.fieldTries) || 0) < 2
    ) {
      B.log("ah plan", { stage: "crops retry", inPen: PEN.inPen(B.pos()) });
      (await out()) &&
        (await guarded("startCrops (quick retry)", () =>
          FOOD.startCrops({ ...ctx, targets: cropTargets, cropsMaxMs: 85000 }),
        ));
    }
    if (crops && !deferCrops) ctx.autoCrops = true;
    ctx.cropTargets = cropTargets;

    const chiRab0 =
      process.env.AH_CHIRAB !== "0" &&
      targets.chicken &&
      targets.rabbit &&
      !targets.cow &&
      !targets.sheep &&
      !targets.pig;
    const chiWild =
      chiRab0 && HERD && HERD.wildNear && process.env.AH_CHIRAB_WILD !== "0"
        ? HERD.wildNear(pen, "chicken")
        : 0;
    const chiRab = chiRab0 && chiWild < 2;
    if (chiRab0)
      B.log("ah plan", { stage: "chicken first", wild: chiWild, on: chiRab });
    if (chiRab && HERD && HERD.earlyStarters && B.timeLeft() > 7.5e5)
      await guarded("early starters (chicken first)", () =>
        HERD.earlyStarters(ctx, pen, targets, "chicken", 1.5e5),
      );

    if (
      process.env.AH_EARLY_STARTERS !== "0" &&
      targets.rabbit &&
      HERD &&
      HERD.earlyStarters &&
      B.timeLeft() > 7e5
    )
      await guarded("early starters", () =>
        HERD.earlyStarters(
          ctx,
          pen,
          targets,
          "rabbit",
          chiRab ? 7e4 : targets.cow || targets.sheep ? 9e4 : 1.6e5,
        ),
      );

    if (
      process.env.AH_CHICK_EARLY === "1" &&
      targets.chicken &&
      !targets.rabbit &&
      HERD &&
      HERD.earlyStarters &&
      B.timeLeft() > 7.5e5
    )
      await guarded("early starters (chicken)", () =>
        HERD.earlyStarters(ctx, pen, targets, "chicken", 8e4),
      );

    const v2 = FOOD.village && FOOD.village();
    const vFar = v2 && v2.at ? B.hdist(v2.at, penC0) : 1e9;
    const vUse =
      v2 &&
      v2.at &&
      vFar <= 300 &&
      (v2.hay >= 2 || (targets.pig && (v2.farmland || 0) >= 8));
    const pigFood = B.count("carrot") + B.count("potato") + B.count("beetroot");
    const tripWhy =
      targets.cow && B.count("wheat") < 20
        ? "cow"
        : vUse && targets.sheep && B.count("wheat") < 12 && vFar > 140
          ? "sheep"
          : vUse && targets.pig && pigFood < 12 && vFar > 140
            ? "pig"
            : null;
    B.log("ah plan", {
      stage: "trip",
      why: tripWhy,
      village: v2 || null,
      vFar: Math.round(vFar),
      wheat: B.count("wheat"),
      pigFood,
    });

    if (
      process.env.AH_STARTER_BREED !== "0" &&
      tripWhy &&
      targets.rabbit &&
      HERD &&
      HERD.starterBreed &&
      B.timeLeft() > 7e5
    )
      await guarded("starter breed", () =>
        HERD.starterBreed(ctx, "rabbit", 1.1e5),
      );

    const pigLate = process.env.AH_PIG_LATE === "1";
    if (
      process.env.AH_PIG_FIRST !== "0" &&
      process.env.AH_TRIP !== "0" &&
      tripWhy &&
      targets.pig &&
      HERD &&
      HERD.raise &&
      HERD.pigPlan &&
      B.timeLeft() > (pigLate ? 7.6e5 : 9.7e5)
    ) {
      const pp = HERD.pigPlan(pen);
      const pc =
        pen.center ||
        new B.Vec3(pen.x + 1 + pen.w / 2, pen.y, pen.z + 1 + pen.d / 2);
      const close = HERD.pigsClose ? HERD.pigsClose(pc, 60) : 0;
      B.log("ah plan", {
        stage: "pig first check",
        mode: pp && pp.mode,
        close,
        left_s: Math.round(B.timeLeft() / 1e3),
      });
      if (pp && pp.mode === "kit" && close >= 2) {
        const HH = HERD.H || {};
        const pigBreeds = () =>
          (HH.stats && HH.stats.breeds && HH.stats.breeds.pig) || 0;
        B.log("ah plan", {
          stage: "pig first",
          close,
          left_s: Math.round(B.timeLeft() / 1e3),
        });
        const tP = B.now();
        let bredAt = 0;

        let offSince = 0;
        ctx.raiseStop = () => {
          if (pigBreeds() > 0 && !bredAt) bredAt = B.now();
          if (bredAt) return B.now() - bredAt > 1.2e4;
          const off = HH.pigPlan && HH.pigPlan.mode !== "kit";
          if (!off) offSince = 0;
          else if (!offSince) offSince = B.now();
          return (
            (off && B.now() - offSince > 2.5e4) ||
            B.timeLeft() < (pigLate ? 6.5e5 : 8.6e5) ||
            B.now() - tP > 1.1e5
          );
        };
        try {
          await guarded("pig first", () =>
            HERD.raise(ctx, pen, { pig: targets.pig }, B.now() + 1.7e5),
          );
        } finally {
          ctx.raiseStop = null;
          HH.raiseAt = null;
          HH.targets = targets;
        }
        B.log("ah plan", {
          stage: "pig first end",
          bred: pigBreeds(),
          ms: B.now() - tP,
          left_s: Math.round(B.timeLeft() / 1e3),
        });
      }
    }
    if (process.env.AH_TRIP !== "0" && tripWhy && B.timeLeft() > 6.4e5) {
      const TRIP = tryRequire("../navigation/village-trip");
      if (TRIP && (await out()))
        await guarded("village trip", () =>
          TRIP.run(ctx, FOOD, pen, targets, { noExplore: tripWhy !== "cow" }),
        );
    }
  }

  let idleMiss = 0;
  if (FOOD && HERD && process.env.AH_IDLE_FOOD !== "0")
    ctx.onIdle = async (ms) => {
      const pc =
        pen.center ||
        new B.Vec3(pen.x + 1 + pen.w / 2, pen.y, pen.z + 1 + pen.d / 2);
      const iss = (
        PEN.validateLocal && B.hdist(B.pos(), pc) < 64
          ? PEN.validateLocal() || []
          : []
      ).filter((i) => i.code !== "unloaded");
      if (iss.length) {
        B.log("ah pen idle check", {
          n: iss.length,
          codes: [...new Set(iss.map((i) => i.code))],
          left_ms: B.timeLeft(),
        });
        await guarded("repairPen (idle)", () => PEN.repairPen());
        return;
      }

      const F = FOOD.F || {};
      if (
        crops &&
        !deferCrops &&
        !F.field &&
        (F.fieldTries || 0) < 4 &&
        B.now() >= (F.fieldNextTry || 0) &&
        B.timeLeft() > 4.8e5
      ) {
        if (!PEN.inPen(B.pos()) || (await leavePen()))
          await guarded("startCrops (retry)", () =>
            FOOD.startCrops({
              ...ctx,
              targets: ctx.cropTargets,
              cropsMaxMs: 85000,
            }),
          );
        return;
      }

      const pigBred = !!(
        HERD.H &&
        HERD.H.stats &&
        HERD.H.stats.breeds &&
        HERD.H.stats.breeds.pig
      );
      if (
        deferCrops &&
        (pigBred || B.secs() > 330) &&
        !(FOOD.F && FOOD.F.field) &&
        B.timeLeft() > 5e5
      ) {
        deferCrops = false;
        if (!PEN.inPen(B.pos()) || (await leavePen()))
          await guarded("startCrops (deferred)", () =>
            FOOD.startCrops({
              ...ctx,
              targets: ctx.cropTargets,
              cropsMaxMs: 85000,
            }),
          );
        ctx.autoCrops = true;
        return;
      }

      if (
        require("../planning/options").Z1_BREED_FIRST &&
        HERD.breedWaiting &&
        HERD.breedWaiting()
      )
        return;
      const nd = HERD.needs(targets),
        need = {};
      for (const sp of Object.keys(nd))
        if (nd[sp].food > nd[sp].have) need[sp] = nd[sp].food;
      const t = B.now();

      const work = (FOOD.F && FOOD.F.field) || (FOOD.village && FOOD.village());
      if (PEN.inPen(B.pos()) && work && Object.keys(need).length)
        await leavePen();
      if (PEN.inPen(B.pos())) Object.keys(need).forEach((k) => delete need[k]);
      if (Object.keys(need).length) await FOOD.gather(ctx, need, t + ms);
      else if (FOOD.tendCrops && !PEN.inPen(B.pos()))
        await FOOD.tendCrops(ctx, t + ms);
      const reason = FOOD.lastResult && FOOD.lastResult.reason;
      B.log("ah idle food", { need, ms: B.now() - t, reason });

      idleMiss = B.now() - t < 5e3 || reason === "no source" ? idleMiss + 1 : 0;

      const retryDue =
        crops &&
        !(FOOD.F && FOOD.F.field) &&
        ((FOOD.F && FOOD.F.fieldTries) || 0) < 4 &&
        B.timeLeft() > 4.8e5;

      const fieldDue = !!targets.sheep && !!(FOOD.F && FOOD.F.field);
      if ((retryDue || fieldDue) && idleMiss >= 3)
        await B.sleep(Math.min(ms, 5e3));
      else if (idleMiss >= 3)
        ((ctx.onIdle = null), B.log("ah idle food off", { reason }));
    };
  B.log("ah plan", {
    stage: "pen",
    pen: { x: pen.x, y: pen.y, z: pen.z, w: pen.w, d: pen.d },
  });

  for (let i = 0; HERD && i < 4 && B.timeLeft() > END_GUARD_MS + 5e3; i++) {
    const r = await guarded("raise", () =>
      HERD.raise(ctx, pen, targets, B.now() + B.timeLeft() - END_GUARD_MS),
    );
    if (r) break;
    await B.sleep(1e3);
  }
  await endgame(PEN, HERD, pen, targets);
  try {
    B.log("ah guard stats", require("../enclosure/protection").G.stats);
  } catch {}
  B.log("ah end", { t: B.secs(), left_ms: B.timeLeft() });
  reportOutcome(HERD, targets);
}

function reportOutcome(HERD, targets) {
  const reasons = [];
  let snap = {};
  try {
    if (HERD && HERD.census) snap = HERD.census();
  } catch {}
  for (const [sp, goal] of Object.entries(targets || {})) {
    const got = (snap[sp] && snap[sp].oursAdult) || 0;
    if (got < goal) reasons.push(`${sp} adult offspring ${got}/${goal}`);
  }
  if (!reasons.length) {
    B.log("ah mission complete", { census: snap });
    return;
  }
  const food = [];
  for (const [sp, row] of Object.entries(snap))
    if ((row.food || 0) < 2) food.push(`${sp} food ${row.food || 0}`);
  const reason = reasons.join("; ");
  B.log("ah mission failed", {
    reason: food.length ? `${reason}; short on ${food.join(", ")}` : reason,
    census: snap,
    left_ms: B.timeLeft(),
  });
}

module.exports = { run, isAnimalPrompt, parseTargets, census, SPECIES };
