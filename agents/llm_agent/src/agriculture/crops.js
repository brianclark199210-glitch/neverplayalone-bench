"use strict";

const B = require("../runtime/connection");
const Soil = require("./terrain");

const PLANT_OF = {
  wheat_seeds: "wheat",
  beetroot_seeds: "beetroots",
  carrot: "carrots",
  potato: "potatoes",
};
const TILLABLE = /^(grass_block|dirt|coarse_dirt|rooted_dirt|dirt_path)$/;

const COMPOST = {
  dandelion: 0.65,
  poppy: 0.65,
  blue_orchid: 0.65,
  allium: 0.65,
  azure_bluet: 0.65,
  red_tulip: 0.65,
  orange_tulip: 0.65,
  white_tulip: 0.65,
  pink_tulip: 0.65,
  oxeye_daisy: 0.65,
  cornflower: 0.65,
  lily_of_the_valley: 0.65,
  sunflower: 0.65,
  lilac: 0.65,
  rose_bush: 0.65,
  peony: 0.65,
  brown_mushroom: 0.65,
  red_mushroom: 0.65,
  lily_pad: 0.65,
  pumpkin: 0.65,
  melon: 0.65,
  carrot: 0.65,
  potato: 0.65,
  beetroot: 0.65,
  wheat: 0.65,
  apple: 0.65,
  melon_slice: 0.5,
  sugar_cane: 0.5,
  cactus: 0.5,
  wheat_seeds: 0.3,
  beetroot_seeds: 0.3,
  pumpkin_seeds: 0.3,
  melon_seeds: 0.3,
  oak_sapling: 0.3,
  birch_sapling: 0.3,
  spruce_sapling: 0.3,
  jungle_sapling: 0.3,
  acacia_sapling: 0.3,
  dark_oak_sapling: 0.3,
  cherry_sapling: 0.3,
  sweet_berries: 0.3,
  kelp: 0.3,
  pink_petals: 0.3,
  wildflowers: 0.3,
  leaf_litter: 0.3,
  short_grass: 0.3,
  fern: 0.65,
  large_fern: 0.65,
  tall_grass: 0.5,
  firefly_bush: 0.3,
  oak_leaves: 0.3,
  birch_leaves: 0.3,
  spruce_leaves: 0.3,
  jungle_leaves: 0.3,
  acacia_leaves: 0.3,
  dark_oak_leaves: 0.3,
  mangrove_leaves: 0.3,
  cherry_leaves: 0.3,
  azalea_leaves: 0.3,
  pale_oak_leaves: 0.3,
  vine: 0.5,
};

const COMPOST_BLOCKS = [
  "dandelion",
  "poppy",
  "blue_orchid",
  "allium",
  "azure_bluet",
  "red_tulip",
  "orange_tulip",
  "white_tulip",
  "pink_tulip",
  "oxeye_daisy",
  "cornflower",
  "lily_of_the_valley",
  "sunflower",
  "lilac",
  "rose_bush",
  "peony",
  "brown_mushroom",
  "red_mushroom",
  "pumpkin",
  "melon",
  "pink_petals",
  "wildflowers",
  "leaf_litter",
  "firefly_bush",
  "sugar_cane",
];

let Food = null;
const now = () => B.now();
const bot = () => B.S.bot;

function plankOf(log) {
  return log.replace(/_log$/, "_planks");
}
function anyCount(re) {
  let n = 0;
  for (const it of B.allItems()) re.test(it.name) && (n += it.count);
  return n;
}
function firstItem(re) {
  return B.allItems().find((i) => re.test(i.name)) || null;
}

function trunkLogs(center, me) {
  let ps = [];

  for (const r of [48, 112, 176]) {
    try {
      ps = Food.find(Food.LOGS, r, { point: center || me, dy: 24, count: 300 });
    } catch {}

    ps = ps.filter(
      (p) =>
        !Food.isBad(p) &&
        p.y <= me.y + 20 &&
        p.y >= me.y - 20 &&
        Food.mayDig(p),
    );
    if (ps.length) break;
  }

  const ko = Food.keepOutOf({});
  const crosses = (p) => {
    if (!ko) return false;
    for (let k = 1; k < 10; k++) {
      const x = me.x + ((p.x - me.x) * k) / 10,
        z = me.z + ((p.z - me.z) * k) / 10;
      if (x >= ko.x0 - 1 && x <= ko.x1 + 1 && z >= ko.z0 - 1 && z <= ko.z1 + 1)
        return true;
    }
    return false;
  };
  const cost = (p) => p.distanceTo(me) + (crosses(p) ? 40 : 0);

  return ps
    .filter((p) => {
      for (let d = 1; d <= 4; d++) {
        const b = B.blockAt(p.offset(0, -d, 0));
        if (!b) return false;
        if (/_log$/.test(b.name)) continue;
        return b.boundingBox === "block" && !/leaves/.test(b.name);
      }
      return false;
    })
    .sort((a, b) => cost(a) - cost(b));
}

async function seekTrees(until, center, maxMs) {
  const t0 = now(),
    home = center || B.feet(),
    end = now() + maxMs;
  const dirs = Food.directionScores(home).slice(0, 2);
  for (const d of dirs) {
    if (until() || now() > end - 1e4) break;
    const outEnd =
        now() + (end - now()) / 2 / Math.max(1, dirs.length - dirs.indexOf(d)),
      a = (d.deg * Math.PI) / 180,
      tx = Math.round(home.x + Math.sin(a) * 400),
      tz = Math.round(home.z - Math.cos(a) * 400);
    let found = null,
      last = 0;
    await B.goto(new B.goals.GoalNearXZ(tx, tz, 8), {
      timeoutMs: Math.max(3e3, outEnd - now()),
      stuckMs: 8e3,
      until: () => {
        if (now() - last > 4e3) {
          last = now();
          found = trunkLogs(null, B.pos())[0] || null;
        }
        return !!found || until() || now() > outEnd;
      },
    });
    B.log("ah food seek trees", {
      deg: d.deg,
      found,
      at: B.feet(),
      dist: Math.round(B.hdist(B.pos(), home)),
      ms: now() - t0,
    });
    if (found) return true;
    await B.goto(new B.goals.GoalNear(home.x, home.y, home.z, 4), {
      timeoutMs: Math.max(5e3, outEnd - now() + 3e4),
      stuckMs: 8e3,
    });
  }
  return false;
}
async function getLogs(n, until, center, opts = {}) {
  Food = Food || require("../resources/supply");
  const t0 = now();
  let sought = false;
  for (let round = 0; round < 8 && anyCount(/_log$/) < n && !until(); round++) {
    const me = B.pos();
    let ps = trunkLogs(center, me);
    B.log("ah food logs try", {
      round,
      have: anyCount(/_log$/),
      planks: anyCount(/_planks$/),
      want: n,
      trees: ps.length,
      nearest: ps.length ? Math.round(B.hdist(ps[0], me)) : null,
    });
    if (!ps.length) {
      if (sought || opts.seek === false) break;
      sought = true;

      const seekUntil = () => !B.hasBot() || B.timeLeft() < 6e4;
      if (!(await seekTrees(seekUntil, center, opts.seekMs || 9e4))) break;

      center = null;
      continue;
    }
    const base = ps[0];

    if (
      B.hdist(base, B.pos()) > 20 &&
      !(await Food.travelTo(base, until, 16, { oneWay: true }))
    ) {
      Food.markBad(base);
      continue;
    }

    const col = [];
    let p = base;
    while (
      B.blockAt(p.offset(0, -1, 0)) &&
      /_log$/.test(B.blockAt(p.offset(0, -1, 0)).name)
    )
      p = p.offset(0, -1, 0);
    for (let i = 0; i < 6; i++) {
      const b = B.blockAt(p.offset(0, i, 0));
      if (!b || !/_log$/.test(b.name)) break;
      col.push({ pos: p.offset(0, i, 0) });
    }
    const got = await Food.work(
      col,
      async (t) => {
        const b = B.blockAt(t.pos);
        if (!b || !/_log$/.test(b.name) || !Food.mayDig(t.pos, b)) return false;
        const ok = await B.dig(b, { hand: true, maxMs: 5e3 });
        ok || Food.markBad(t.pos);
        return ok;
      },
      () => until() || anyCount(/_log$/) >= n + 1,
      4.4,
      "logs",
    );
    got || Food.markBad(base);
    await Food.collect(p, 6, 4e3, false);
  }
  B.log("ah food logs", {
    logs: anyCount(/_log$/),
    planks: anyCount(/_planks$/),
    ms: now() - t0,
  });
  return anyCount(/_log$/);
}

async function planks(n) {
  Food = Food || require("../resources/supply");
  for (let i = 0; i < 6 && anyCount(/_planks$/) < n; i++) {
    const log = firstItem(/_log$/);
    if (!log) break;
    const need = Math.ceil((n - anyCount(/_planks$/)) / 4);
    await Food.craftN(plankOf(log.name), Math.min(need, B.count(log.name)));
  }
  return anyCount(/_planks$/);
}

async function table(at) {
  Food = Food || require("../resources/supply");
  const r = bot().registry;
  const t = bot().findBlock({
    matching: r.blocksByName.crafting_table.id,
    maxDistance: 24,
  });
  if (t) {
    B.reachOf(t.position) > 4.2 &&
      (await B.approach(t.position, { range: 2, timeoutMs: 15e3 }));
    if (B.reachOf(t.position) <= 4.5) return B.blockAt(t.position);
  }
  for (let i = 0; i < 3 && !B.count("crafting_table"); i++) {
    if ((await planks(4)) < 4) break;
    await Food.craftN("crafting_table", 1);
  }
  if (!B.count("crafting_table")) return null;

  for (let i = 0; i < 4; i++) {
    const p = await Soil.placeNear(
      i === 0 ? at || B.feet() : B.feet(),
      "crafting_table",
    );
    if (p) {
      await B.sleep(300);
      const b = B.blockAt(p);
      if (b && b.name === "crafting_table") {
        B.reachOf(p) > 4 &&
          (await B.approach(p, { reach: 3.5, timeoutMs: 8e3 }));
        return b;
      }
      B.log("ah food table: not placed", { at: p, block: b && b.name });
    }
    const [dx, dz] = [
      [5, 0],
      [0, 5],
      [-5, 0],
      [0, -5],
    ][i];
    const f = B.feet();
    await B.goto(new B.goals.GoalNear(f.x + dx, f.y, f.z + dz, 1), {
      timeoutMs: 6e3,
      stuckMs: 2500,
    });
  }
  B.log("ah food table: no place", { at: B.feet() });
  return null;
}

async function ensureHoe(until, wantComposter, center = null) {
  Food = Food || require("../resources/supply");
  if (B.count("wooden_hoe") || B.count("stone_hoe")) return true;
  const plankNeed = 4 + 2 + 2 + (wantComposter ? 6 : 0);
  const have = anyCount(/_planks$/) + 4 * anyCount(/_log$/);
  if (have < plankNeed)
    await getLogs(
      Math.ceil((plankNeed - anyCount(/_planks$/)) / 4),
      until,
      center,
    );
  await planks(plankNeed);

  if (
    anyCount(/_planks$/) + (B.count("crafting_table") ? 4 : 0) < 8 &&
    !B.count("wooden_hoe")
  )
    return (
      B.log("ah food hoe: no wood", {
        planks: anyCount(/_planks$/),
        logs: anyCount(/_log$/),
        inv: B.inventorySummary(),
      }),
      false
    );
  B.count("stick") < 2 && (await Food.craftN("stick", 1));
  let tb = null;

  for (let attempt = 0; attempt < 2 && !B.count("wooden_hoe"); attempt++) {
    tb = await table();
    if (!tb) return (B.log("ah food hoe: no table", { attempt }), false);
    await Food.craftN("wooden_hoe", 1, tb);
    if (B.count("wooden_hoe")) break;
    const here = B.blockAt(tb.position);
    B.log("ah food hoe: craft failed", {
      attempt,
      table: tb.position,
      block: here && here.name,
      reach: +B.reachOf(tb.position).toFixed(1),
      inv: B.inventorySummary(),
    });
    if (here && here.name === "crafting_table") {
      await B.dig(here, { hand: true, maxMs: 6e3 });
      await B.collectItems(tb.position, 4, new Set(["crafting_table"]), 3e3);
    }
    await B.sleep(800);
  }
  if (!tb) return false;
  if (wantComposter && !B.count("composter")) {
    const pl = B.allItems()
      .filter((i) => /_planks$/.test(i.name))
      .sort((a, b) => B.count(b.name) - B.count(a.name))[0];
    if (pl && anyCount(/_slab$/) < 7)
      await Food.craftN(pl.name.replace(/_planks$/, "_slab"), 2, tb);
    anyCount(/_slab$/) >= 7 && (await Food.craftN("composter", 1, tb));
  }

  if ((B.blockAt(tb.position) || {}).name === "crafting_table") {
    await B.dig(B.blockAt(tb.position), { hand: true, maxMs: 6e3 });
    await B.collectItems(tb.position, 4, new Set(["crafting_table"]), 3e3);
  }
  B.log("ah food tools", {
    hoe: B.count("wooden_hoe"),
    table: B.count("crafting_table"),
    composter: B.count("composter"),
    planks: anyCount(/_planks$/),
    slabs: anyCount(/_slab$/),
  });
  return B.count("wooden_hoe") > 0;
}

function cellOk(p, ctx) {
  Food = Food || require("../resources/supply");
  if (Food.inKeepOut(p, ctx, 2)) return false;
  if (nearGate(p)) return false;
  if (B.protectedCols.has(`${p.x},${p.z}`)) return false;
  const b = B.blockAt(p),
    up = B.blockAt(p.offset(0, 1, 0)),
    up2 = B.blockAt(p.offset(0, 2, 0));
  if (!b || !TILLABLE.test(b.name)) return false;

  if (
    !up ||
    !(
      B.isAir(up) ||
      /^(short_grass|fern|dandelion|poppy|short_dry_grass|bush|snow|leaf_litter|pink_petals|wildflowers)$/.test(
        up.name,
      )
    )
  )
    return false;
  if (!up2 || !(B.isAir(up2) || /grass|fern|leaves/.test(up2.name)))
    return false;
  return true;
}

const FIELD_DY =
  process.env.AH_FIELD_DY === "0" ? 0 : +(process.env.AH_FIELD_DY || 4);
function pickSite(ctx, home, nCells) {
  Food = Food || require("../resources/supply");
  const me = B.pos();
  let waters = [];
  try {
    waters = Food.find(["water"], ctx.fieldWaterR || 40, {
      point: home,
      dy: 12,
      count: 1500,
    });
  } catch {}
  let best = null;
  for (const w of waters) {
    const wb = B.blockAt(w),
      above = B.blockAt(w.offset(0, 1, 0));
    if (!wb || !above || !B.isAir(above)) continue;
    if (Food.inKeepOut(w, ctx, 2)) continue;

    if (FIELD_DY && Math.abs(w.y - home.y) > FIELD_DY) continue;
    const cells = [];
    for (let dx = -4; dx <= 4; dx++)
      for (let dz = -4; dz <= 4; dz++) {
        const p = w.offset(dx, 0, dz);
        cellOk(p, ctx) && cells.push(p);
      }
    if (cells.length < Math.min(nCells, 6)) continue;
    const score =
      Math.min(cells.length, nCells) * 4 -
      B.hdist(w, home) * 0.5 -
      B.hdist(w, me) * 0.3;
    if (!best || score > best.score) best = { water: w, cells, score };
  }
  if (best) {
    best.cells.sort(
      (a, b) => a.distanceTo(best.water) - b.distanceTo(best.water),
    );
    best.cells = best.cells.slice(0, nCells);
    return { at: best.water, water: true, cells: best.cells };
  }

  const f = home.floored();
  const cells = [];
  for (let r = 3; r <= 20 && cells.length < nCells; r++)
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (const dy of [-1, -2, 0, -3, 1]) {
          const p = new B.Vec3(f.x + dx, f.y + dy, f.z + dz);
          if (cellOk(p, ctx)) {
            cells.push(p);
            break;
          }
        }
      }
  if (!cells.length) return null;
  const c0 = cells[0];
  const sameY = cells.filter((p) => p.y === c0.y).slice(0, nCells);
  return { at: c0, water: false, cells: sameY };
}

function rectAt(ctx, x0, y, z0, alongX, L) {
  const mid = [],
    side = [];
  for (let i = 0; i < L; i++)
    for (let j = -1; j <= 1; j++) {
      const p = alongX
        ? new B.Vec3(x0 + i, y, z0 + j)
        : new B.Vec3(x0 + j, y, z0 + i);
      if (!cellOk(p, ctx)) {
        if (j === 0) return null;
        continue;
      }
      (j === 0 ? mid : side).push(p);
    }
  return { mid, side };
}
function groundY(x, z, y0) {
  for (let y = y0 + 6; y >= y0 - 16; y--) {
    const b = B.blockAt(new B.Vec3(x, y, z));
    if (!b) return null;
    if (b.boundingBox !== "block" || /leaves|_log$/.test(b.name)) continue;
    return TILLABLE.test(b.name) ? y : null;
  }
  return null;
}
function pickRect(ctx, home, L, waterOnly = false) {
  Food = Food || require("../resources/supply");
  const me = B.pos();
  let waters = [];
  try {
    waters = Food.find(["water"], ctx.fieldWaterR || 40, {
      point: home,
      dy: 12,
      count: 1500,
    });
  } catch {}
  let best = null;
  const seen = new Set();
  for (const w of waters.slice(0, 400)) {
    const above = B.blockAt(w.offset(0, 1, 0));
    if (!above || !B.isAir(above) || Food.inKeepOut(w, ctx, 2)) continue;
    if (FIELD_DY && Math.abs(w.y - home.y) > FIELD_DY) continue;
    const k = `${w.x >> 2},${w.z >> 2},${w.y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    for (const alongX of [true, false])
      for (let a = -4; a <= 4 - (L - 1); a++)
        for (let b = -3; b <= 3; b++) {
          const x0 = alongX ? w.x + a : w.x + b,
            z0 = alongX ? w.z + b : w.z + a;
          const r = rectAt(ctx, x0, w.y, z0, alongX, L);
          if (!r) continue;
          const score =
            r.side.length * 1 +
            r.mid.length * 3 -
            B.hdist(w, home) * 0.25 -
            B.hdist(w, me) * 0.15 +
            6;
          if (!best || score > best.score)
            best = { ...r, at: w, water: true, score };
        }
    if (best && best.side.length >= 2 * L - 1 && waters.indexOf(w) > 60) break;
  }
  if (best || waterOnly) return best;

  const f = home.floored();
  const rMax = Food.keepOutOf(ctx) ? 30 : 16;
  for (let r = 2; r <= rMax && !best; r += 2)
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;

        const gy = groundY(f.x + dx, f.z + dz, f.y);
        if (gy === null) continue;
        for (const alongX of [true, false]) {
          const rr = rectAt(ctx, f.x + dx, gy, f.z + dz, alongX, L);
          if (!rr) continue;
          const score =
            rr.side.length +
            rr.mid.length * 3 -
            r * 0.3 -
            Math.abs(gy - f.y) * 0.3;
          if (!best || score > best.score)
            best = {
              ...rr,
              at: new B.Vec3(f.x + dx, gy, f.z + dz),
              water: false,
              score,
            };
        }
      }
  return best;
}

async function till(p) {
  const up = B.blockAt(p.offset(0, 1, 0));
  if (up && !B.isAir(up)) await B.dig(up, { hand: true, maxMs: 1500 });
  const b = B.blockAt(p);
  if (!b || !TILLABLE.test(b.name)) return b && b.name === "farmland";
  if (!(await B.equip("wooden_hoe")) && !(await B.equip("stone_hoe")))
    return false;
  await B.useOn(b, B.v3(0, 1, 0), {
    expectAt: p,
    expect: (x) => !!x && x.name === "farmland",
    waitMs: 1200,
  });
  return (B.blockAt(p) || {}).name === "farmland";
}
async function plant(p, seed) {
  const fl = B.blockAt(p);
  if (!fl || fl.name !== "farmland" || !B.count(seed)) return false;
  const up = B.blockAt(p.offset(0, 1, 0));
  if (up && !B.isAir(up)) return false;
  return B.placeOn(fl, B.v3(0, 1, 0), seed, { waitMs: 1e3 });
}

const keepT = (ctx) => ({
  ...((ctx && ctx.keepTargets) || {}),
  ...((ctx && ctx.targets) || {}),
});

function chickenKeep(min) {
  try {
    const nd = require("../husbandry/animals").needs();
    return Math.max(min, (nd.chicken && nd.chicken.food) || 0);
  } catch {
    return min;
  }
}

function plantPlan(ctx) {
  Food = Food || require("../resources/supply");
  const t = (ctx && ctx.targets) || {},
    kt = keepT(ctx);
  const plan = [];
  const add = (seed, keep) => {
    const n = B.count(seed) - keep;
    for (let i = 0; i < n; i++) plan.push(seed);
  };
  if (t.cow || t.sheep)
    add(
      "wheat_seeds",
      kt.chicken && B.count("wheat_seeds") >= 3
        ? Math.max(0, 2 - B.count("beetroot_seeds"))
        : 0,
    );
  if (t.pig) {
    add("beetroot_seeds", 0);
    const pigKeep = (ctx && ctx.pigKeep) ?? 6;
    let spare = Math.max(0, B.count("potato") + B.count("carrot") - pigKeep);

    const pot = Math.min(spare, B.count("potato"));
    for (let i = 0; i < pot; i++) plan.push("potato");
    spare -= pot;
    if (!kt.rabbit)
      for (let i = 0; i < Math.min(spare, B.count("carrot")); i++)
        plan.push("carrot");
  } else if (t.rabbit) add("carrot", (ctx && ctx.rabbitKeep) ?? 6);
  return plan;
}

function composterOk() {
  const f = Food.F.field;
  if (f && f.composter && level(f.composter) >= 0) return f.composter;
  return nearestComposter();
}
async function ensureComposter(ctx, until) {
  Food = Food || require("../resources/supply");
  const f = Food.F.field;
  if (!f) return null;
  const have = composterOk();
  if (have) return have;
  if (now() < (Food.F.composterNextTry || 0)) return null;
  Food.F.composterNextTry = now() + 9e4;
  const t0 = now();
  if (!B.count("composter")) {
    const need = 6 + (B.count("crafting_table") ? 0 : 4);
    if (anyCount(/_planks$/) + 4 * anyCount(/_log$/) < need)
      await getLogs(Math.ceil((need - anyCount(/_planks$/)) / 4), until, f.at, {
        seekMs: 6e4,
      });
    await planks(need);
    const tb = await table(f.at);
    if (tb) {
      const pl = B.allItems()
        .filter((i) => /_planks$/.test(i.name))
        .sort((a, b) => B.count(b.name) - B.count(a.name))[0];
      if (pl && anyCount(/_slab$/) < 7)
        await Food.craftN(pl.name.replace(/_planks$/, "_slab"), 2, tb);
      anyCount(/_slab$/) >= 7 && (await Food.craftN("composter", 1, tb));
      if ((B.blockAt(tb.position) || {}).name === "crafting_table") {
        await B.dig(B.blockAt(tb.position), { hand: true, maxMs: 6e3 });
        await B.collectItems(tb.position, 4, new Set(["crafting_table"]), 3e3);
      }
    }
  }
  if (B.count("composter")) {
    if (B.hdist(f.at, B.pos()) > 8)
      await Food.travelTo(f.at, until, 4, { oneWay: true });
    const p = await Soil.placeNear(f.cells[0] || f.at, "composter");
    p && (f.composter = p);
  }
  B.log("ah food composter", {
    ok: !!f.composter,
    at: f.composter,
    planks: anyCount(/_planks$/),
    logs: anyCount(/_log$/),
    ms: now() - t0,
  });
  return f.composter || null;
}

function gateOutside(ctx) {
  const pen = (ctx && ctx.pen) || Food.F.pen;
  const g = pen && pen.gates && pen.gates[0];
  if (!g || pen.x === undefined) return null;
  let dx = 0,
    dz = 0;
  if (g.x === pen.x) dx = -2;
  else if (g.x === pen.x + pen.w + 1) dx = 2;
  else if (g.z === pen.z) dz = -2;
  else dz = 2;
  return new B.Vec3(g.x + dx, g.y, g.z + dz);
}
function nearGate(p) {
  const pen = Food.F.pen;
  if (!pen || !pen.gates) return false;
  return pen.gates.some(
    (g) => Math.max(Math.abs(g.x - p.x), Math.abs(g.z - p.z)) <= 3,
  );
}
function fieldFail(why, extra = {}) {
  Food.F.fieldFail = { at: now(), why };
  B.log("ah food field failed", { why, ...extra, inv: B.inventorySummary() });
  return null;
}
async function startCrops(ctx, food) {
  Food = food;
  const t0 = now();

  const toolsUntil = () =>
    !B.hasBot() || B.timeLeft() < 6e4 || now() - t0 > (ctx.cropsMaxMs || 15e4);

  const ko = Food.keepOutOf(ctx);
  const gate = gateOutside(ctx);
  const home =
    (ctx.home && new B.Vec3(ctx.home.x, ctx.home.y, ctx.home.z)) ||
    gate ||
    (ko &&
      new B.Vec3(
        Math.round((ko.x0 + ko.x1) / 2),
        (ctx.pen && ctx.pen.y) || B.feet().y,
        Math.round((ko.z0 + ko.z1) / 2),
      )) ||
    Food.F.home ||
    B.feet();

  if (gate && !ctx.fieldWaterR) ctx = { ...ctx, fieldWaterR: 30 };
  const plan = plantPlan(ctx);
  if (!plan.length)
    return fieldFail("nothing to plant", { targets: ctx.targets });

  const vf = villageFarm(home, ctx, plan.length);
  if (vf) return plantVillage(vf, plan, ctx, t0, toolsUntil);
  if (!(await ensureHoe(toolsUntil, ctx.composter !== false, home)))
    return fieldFail("no hoe", { home });

  const t = ctx.targets || {};
  const L = t.cow || t.sheep ? 7 : Math.max(3, Math.min(7, plan.length));
  let site =
    pickRect(ctx, home, L, true) ||
    (L > 3 && pickRect(ctx, home, 3, true)) ||
    pickRect(ctx, home, L) ||
    pickRect(ctx, home, 3);
  if (site) site.cells = [...site.mid, ...site.side];
  else site = pickSite(ctx, home, Math.max(plan.length, 8) + 4);
  if (!site) return fieldFail("no site", { home });
  const dist = Math.round(B.hdist(site.at, B.pos()));
  B.log("ah food field site", {
    at: site.at,
    water: site.water,
    cells: site.cells.length,
    strip: !!site.mid,
    dist,
    fromHome: Math.round(B.hdist(site.at, home)),
  });
  const plantEnd = now() + 45e3 + dist * 600;
  const until = () => !B.hasBot() || B.timeLeft() < 3e4 || now() > plantEnd;
  if (dist > 10) await Food.travelTo(site.at, until, 5, { oneWay: true });
  const cells = [];
  const midKeys = new Set((site.mid || []).map((p) => `${p.x},${p.z}`));

  for (
    let attempt = 0;
    attempt < 2 && cells.length < site.cells.length && !until();
    attempt++
  ) {
    const todo = site.cells.filter((p) => !cells.some((c) => c.equals(p)));
    await Food.work(
      todo.map((p) => ({ pos: p })),
      async (t) => {
        if (until()) return false;
        if (!(await till(t.pos))) return false;
        cells.push(t.pos);
        return true;
      },
      until,
      4.2,
      "till",
    );
    if (!cells.length && attempt === 0)
      await Food.travelTo(site.at, until, 3, { oneWay: true });
  }
  if (!cells.length)
    return fieldFail("till failed", {
      at: site.at,
      dist: Math.round(B.hdist(site.at, B.pos())),
    });
  const isMid = (p) => midKeys.has(`${p.x},${p.z}`);
  for (let attempt = 0; attempt < 2 && plan.length && !until(); attempt++)
    for (const pass of midKeys.size
      ? [cells.filter(isMid), cells.filter((p) => !isMid(p))]
      : [cells])
      await Food.work(
        pass
          .filter((p) => B.isAir(B.blockAt(p.offset(0, 1, 0))))
          .map((p) => ({ pos: p })),
        async (t) => {
          if (until() || !plan.length) return false;
          if (await plant(t.pos, plan[0])) return (plan.shift(), true);
          return false;
        },
        () => until() || !plan.length,
        4.2,
        "plant",
      );
  const field = {
    at: site.at,
    water: site.water,
    cells,
    plantedAt: now(),
    composter: null,
  };
  Food.F.field = field;

  if (B.count("composter")) {
    const p = await Soil.placeNear(cells[0] || site.at, "composter");
    p && (field.composter = p);
  }

  if (
    (t.cow || t.sheep) &&
    site.water &&
    cells.length - fieldCrops().length >= 4 &&
    B.timeLeft() > 6e5
  ) {
    const tS = now();
    const seedUntil = () => !B.hasBot() || now() > tS + 3e4;
    try {
      await Food.sweep(Food.GRASS, seedUntil, {
        src: "grass",
        items: Food.SEEDS,
        center: site.at,
        radius: 28,
        legs: 4,
        findR: 28,
      });

      await fillField(
        { ...ctx, targets: { ...t, chicken: false }, keepTargets: null },
        () => !B.hasBot() || now() > tS + 5e4,
      );
    } catch {}
  }
  registerFieldCrops();
  const planted = fieldCrops().map((c) => c.name);
  B.log("ah food field", {
    at: site.at,
    water: site.water,
    cells: cells.length,
    planted,
    left: plan,
    composter: field.composter,
    fromHome: Math.round(B.hdist(site.at, home)),
    ms: now() - t0,
  });
  if (!planted.length)
    B.log("ah food field failed", {
      why: "nothing planted",
      left: plan,
      cells: cells.length,
    });
  return field;
}

function villageFarm(home, ctx, n) {
  Food = Food || require("../resources/supply");
  Food.scan(true);
  const max = Math.min(ctx.maxDist || 150, ctx.villageFieldDist || 80);
  const fl = (Food.F.farmland || []).filter(
    (p) => B.hdist(p, home) <= max && !Food.inKeepOut(p, ctx, 1),
  );
  const empty = fl.filter((p) => B.isAir(B.blockAt(p.offset(0, 1, 0))));
  if (n > 0 ? empty.length < Math.min(n, 4) : fl.length < 6) return null;
  const me = B.pos();
  const pool = n > 0 ? empty : fl;
  pool.sort((a, b) => a.distanceTo(me) - b.distanceTo(me));
  const first = pool[0];
  const cells = empty.filter((p) => p.distanceTo(first) <= 12).slice(0, n + 4);
  if (!n) cells.push(first);

  for (const p of fl)
    if (
      p.distanceTo(first) <= 12 &&
      !cells.some((c) => c.equals(p)) &&
      cells.length < 40
    )
      cells.push(p);
  return { at: first, cells };
}
async function plantVillage(vf, plan, ctx, t0, until) {
  let planted = 0;
  const empty = vf.cells.filter((p) => B.isAir(B.blockAt(p.offset(0, 1, 0))));
  await Food.work(
    empty.map((p) => ({ pos: p })),
    async (t) => {
      const seed = plan.shift();
      if (!seed) return false;
      const ok = await plant(t.pos, seed);
      ok ? planted++ : plan.unshift(seed);
      return ok;
    },
    () => until() || !plan.length,
    4.2,
    "vplant",
  );
  const field = {
    at: vf.at,
    water: true,
    village: true,
    cells: vf.cells,
    plantedAt: now(),
    composter: nearestComposter(),
  };
  Food.F.field = field;
  if (
    !field.composter &&
    ctx.composter !== false &&
    (await ensureHoe(until, true)) &&
    B.count("composter")
  ) {
    const p = await Soil.placeNear(vf.at, "composter");
    p && (field.composter = p);
  }
  B.log("ah food field", {
    at: vf.at,
    village: true,
    cells: vf.cells.length,
    planted,
    composter: field.composter,
    ms: now() - t0,
  });
  return field;
}

function adoptVillage(ctx) {
  Food = Food || require("../resources/supply");
  if (Food.F.field) return Food.F.field;
  const home = Food.F.home || B.feet();
  const vf = villageFarm(home, ctx || {}, 0);
  if (!vf) return null;
  const field = {
    at: vf.at,
    water: true,
    village: true,
    cells: vf.cells,
    plantedAt: now(),
    composter: nearestComposter(),
  };
  Food.F.field = field;
  B.log("ah food field", {
    at: vf.at,
    village: true,
    adopted: true,
    cells: vf.cells.length,
    composter: field.composter,
  });
  return field;
}
function fieldCrops() {
  Food = Food || require("../resources/supply");
  const f = Food.F.field;
  if (!f) return [];
  const out = [];
  for (const p of f.cells) {
    const b = B.blockAt(p.offset(0, 1, 0));
    if (b && Food.CROP_MAX[b.name] !== undefined)
      out.push({ pos: p.offset(0, 1, 0), name: b.name, age: Food.age(b) });
  }
  return out;
}

function registerFieldCrops() {
  Food = Food || require("../resources/supply");
  const ks = new Set(
    Food.F.crops.map((c) => `${c.pos.x},${c.pos.y},${c.pos.z}`),
  );
  for (const c of fieldCrops())
    ks.has(`${c.pos.x},${c.pos.y},${c.pos.z}`) || Food.F.crops.push(c);
}

function compostKeep(ctx) {
  const t = keepT(ctx);
  const keep = { wheat_seeds: 4, beetroot_seeds: 2 };
  if (t.pig) Object.assign(keep, { carrot: 99, potato: 99, beetroot: 99 });
  if (t.rabbit) Object.assign(keep, { carrot: 99, dandelion: 99 });

  if (t.chicken)
    Object.assign(keep, {
      wheat_seeds: t.cow || t.sheep ? 30 : 99,
      beetroot_seeds: 99,
    });
  if (t.cow || t.sheep) keep.wheat = 999;
  return keep;
}
function compostables(ctx) {
  Food = Food || require("../resources/supply");
  const keep = compostKeep(ctx);
  const out = [];
  for (const it of B.allItems()) {
    const c = COMPOST[it.name];
    if (!c) continue;
    const spare = B.count(it.name) - (keep[it.name] || 0);
    if (spare > 0 && !out.some((o) => o.name === it.name))
      out.push({ name: it.name, n: spare, c });
  }
  return out.sort((a, b) => b.c - a.c);
}
function compostValue(ctx) {
  return compostables(ctx).reduce((a, o) => a + o.n * o.c, 0);
}
function level(p) {
  const b = p && B.blockAt(p);
  if (!b || b.name !== "composter") return -1;
  try {
    return Number(b.getProperties().level) || 0;
  } catch {
    return 0;
  }
}

async function compost(ctx, until) {
  Food = Food || require("../resources/supply");
  const f = Food.F.field;
  const cp = (f && f.composter) || nearestComposter();
  if (!cp) return 0;
  if (!compostables(ctx).length && level(cp) < 8) return 0;
  if (
    B.reachOf(cp) > 4.2 &&
    !(await B.approach(cp, { reach: 4, timeoutMs: 2e4 }))
  )
    return 0;
  const before = B.count("bone_meal");
  const click = async () => {
    const b = B.blockAt(cp);
    if (!b || b.name !== "composter") return false;
    try {
      await bot().lookAt(cp.offset(0.5, 0.5, 0.5), true);
      await B.withTimeout(
        bot().activateBlock(b, B.v3(0, 1, 0), B.v3(0.5, 0.5, 0.5)),
        1500,
        "compost",
      );
    } catch {
      return false;
    }

    await B.sleep(30);
    return true;
  };
  let fed = 0;
  for (let i = 0; i < 128 && !until(); i++) {
    const lv = level(cp);
    if (lv < 0) break;
    if (lv >= 8) {
      await B.unequip();
      await click();
      await B.sleep(400);
      await Food.collect(cp, 3, 2500, false);
      continue;
    }
    if (lv === 7) {
      await B.sleep(300);
      continue;
    }
    const c = compostables(ctx)[0];
    if (!c) break;
    if (!(await B.equip(c.name))) break;
    if (!(await click())) break;
    fed++;
  }
  await Food.collect(cp, 4, 2e3, false);
  const made = B.count("bone_meal") - before;
  if (made > 0)
    ((Food.F.fieldStarved = false),
      (Food.F.boneMade = (Food.F.boneMade || 0) + made));
  (fed || made) &&
    B.log("ah food compost", {
      fed,
      made,
      bone_meal: B.count("bone_meal"),
      level: level(cp),
    });
  return made;
}
function nearestComposter() {
  Food = Food || require("../resources/supply");
  const me = B.pos();
  const cs = (Food.F.composters || []).filter(
    (p) => level(p) >= 0 && B.hdist(p, me) < 64,
  );
  cs.sort((a, b) => a.distanceTo(me) - b.distanceTo(me));
  return cs[0] || null;
}

async function boneMeal(ctx, until) {
  Food = Food || require("../resources/supply");
  if (!B.count("bone_meal")) return 0;
  const t = (ctx && ctx.targets) || {};
  const tpri = (n) =>
    (t.cow || t.sheep) && n === "wheat"
      ? 0
      : t.pig && (n === "carrots" || n === "potatoes")
        ? 1
        : t.pig && n === "beetroots"
          ? 2
          : t.rabbit && n === "carrots"
            ? 1
            : 5;

  const wr =
    Food.F.wantRank && now() - Food.F.wantRank.at < 9e4
      ? Food.F.wantRank.r
      : null;
  const MAIN = {
    wheat: "wheat",
    carrots: "carrot",
    potatoes: "potato",
    beetroots: "beetroot",
  };
  const pri0 = (n) => {
    if (wr) {
      const r = wr[MAIN[n]] || 0;
      if (r > 0) return 1 - r;
      return tpri(n) + 2;
    }
    return tpri(n);
  };

  const kt = keepT(ctx);
  const wheatGrowing =
    !!kt.sheep &&
    fieldCrops().some((c) => c.name === "wheat" && c.age < Food.CROP_MAX.wheat);
  const pri = (n) =>
    wheatGrowing && n === "beetroots"
      ? Math.max(pri0(n), pri0("wheat") + 0.5)
      : pri0(n);
  let used = 0;
  for (let i = 0; i < 64 && B.count("bone_meal") && !until(); i++) {
    const cs = fieldCrops()
      .filter((c) => c.age < Food.CROP_MAX[c.name] && pri(c.name) < 5)
      .sort((a, b) => pri(a.name) - pri(b.name) || b.age - a.age);
    if (!cs.length) break;
    const c = cs[0];
    if (
      B.reachOf(c.pos) > 4.2 &&
      !(await B.approach(c.pos, { reach: 4, timeoutMs: 15e3 }))
    ) {
      Food.markBad(c.pos);
      break;
    }
    if (!(await B.equip("bone_meal"))) break;
    const b = B.blockAt(c.pos);
    try {
      await bot().lookAt(c.pos.offset(0.5, 0.3, 0.5), true);
      await B.withTimeout(
        bot().activateBlock(b, B.v3(0, 1, 0), B.v3(0.5, 0.5, 0.5)),
        1500,
        "bonemeal",
      );
      used++;
    } catch {}
    await B.sleep(120);
  }
  used &&
    B.log("ah food bonemeal", {
      used,
      left: B.count("bone_meal"),
      crops: fieldCrops().map((c) => `${c.name}:${c.age}`),
    });
  return used;
}

async function fillField(ctx, until) {
  const f = Food.F.field;
  if (!f || f.village) return 0;

  const t = (ctx && ctx.targets) || {},
    kt = keepT(ctx);
  const spare = [];
  const crops = fieldCrops();
  const hasWheat = crops.some((c) => c.name === "wheat");

  const capped =
    !f.water && crops.length >= 6 + Math.floor((Food.F.boneMade || 0) / 3);
  if (capped) return 0;

  if (t.cow || t.sheep)
    spare.push([
      "wheat_seeds",
      kt.chicken ? chickenKeep(hasWheat ? 6 : 2) : hasWheat ? 1 : 0,
    ]);
  if (t.pig)
    spare.push(
      ["beetroot_seeds", kt.chicken ? 2 : 0],
      ["potato", (ctx && ctx.pigKeep) ?? 6],
    );
  if (t.pig && !kt.rabbit) spare.push(["carrot", (ctx && ctx.pigKeep) ?? 6]);
  if (t.rabbit) spare.push(["carrot", (ctx && ctx.rabbitKeep) ?? 6]);
  const hoe = B.count("wooden_hoe") || B.count("stone_hoe");
  const empty = f.cells.filter((p) => {
    const fl = B.blockAt(p),
      up = B.blockAt(p.offset(0, 1, 0));
    if (!fl || !up) return false;
    if (fl.name === "farmland") return B.isAir(up);
    return (
      hoe &&
      TILLABLE.test(fl.name) &&
      (B.isAir(up) || /grass|fern/.test(up.name))
    );
  });
  let n = 0;
  for (const p of empty) {
    if (until()) break;
    const s = spare.find(([it, keep]) => B.count(it) > keep);
    if (!s) break;
    if (
      B.reachOf(p) > 4.2 &&
      !(await B.approach(p, { reach: 4, timeoutMs: 12e3 }))
    )
      continue;
    if ((B.blockAt(p) || {}).name !== "farmland" && !(await till(p))) continue;
    (await plant(p, s[0])) && n++;
  }
  n &&
    B.log("ah food field filled", { planted: n, crops: fieldCrops().length });
  return n;
}

async function tendCrops(ctx, deadline, food) {
  Food = food;
  const until = () => now() > deadline - 300 || !B.hasBot();
  const f = Food.F.field;
  if (!f) return 0;
  const before = Food.snap();
  const items = [
    "wheat",
    "wheat_seeds",
    "carrot",
    "potato",
    "beetroot",
    "beetroot_seeds",
  ];

  const tc = now();

  if (!composterOk())
    await ensureComposter(
      ctx,
      () =>
        !B.hasBot() ||
        B.timeLeft() < 1.8e5 ||
        now() > Math.min(tc + 12e4, deadline + 6e4),
    );

  for (let round = 0; round < 6 && !until(); round++) {
    const made = await compost(ctx, until);
    const used = await boneMeal(ctx, until);
    registerFieldCrops();
    const ripe = fieldCrops().filter((c) => c.age >= Food.CROP_MAX[c.name]);
    if (ripe.length) {
      const want = new Set(items);
      await Food.harvestCrops(want, until, {
        center: f.at,
        radius: 16,
        src: "field",
        replant: true,
      });
    }
    const filled = await fillField(ctx, until);
    if (!made && !used && !ripe.length && !filled) break;
  }
  let got = 0;
  for (const it of items) got += B.count(it) - (before[it] || 0);
  return got;
}

module.exports = {
  getLogs,
  ensureHoe,
  ensureComposter,
  composterOk,
  startCrops,
  tendCrops,
  adoptVillage,
  pickRect,
  plantPlan,
  compost,
  boneMeal,
  compostables,
  compostValue,
  fieldCrops,
  COMPOST,
  COMPOST_BLOCKS,
};
