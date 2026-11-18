"use strict";

const B = require("../runtime/connection");
const FOOD_VERSION = "2.12";

const SEEDS = [
  "wheat_seeds",
  "beetroot_seeds",
  "melon_seeds",
  "pumpkin_seeds",
  "torchflower_seeds",
  "pitcher_pod",
];
const GROUPS = {
  wheat: ["wheat"],
  cow: ["wheat"],
  sheep: ["wheat"],
  seeds: SEEDS,
  chicken: SEEDS,
  pig: ["carrot", "potato", "beetroot"],
  pig_food: ["carrot", "potato", "beetroot"],
  rabbit: ["dandelion", "carrot", "golden_carrot"],
  rabbit_food: ["dandelion", "carrot", "golden_carrot"],
};
const CROP_MAX = { wheat: 7, carrots: 7, potatoes: 7, beetroots: 3 };
const CROP_SEED = {
  wheat: "wheat_seeds",
  carrots: "carrot",
  potatoes: "potato",
  beetroots: "beetroot_seeds",
};

const CROP_GIVES = {
  wheat: [["wheat", "wheat_seeds"], ["wheat_seeds"]],
  carrots: [["carrot"], ["carrot"]],
  potatoes: [["potato"], ["potato"]],
  beetroots: [["beetroot", "beetroot_seeds"], ["beetroot_seeds"]],
};
const GRASS = ["short_grass", "tall_grass", "fern", "large_fern"];
const FLOWERS = [
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
];
const VILLAGE_MARKS = [
  "bell",
  "hay_block",
  "farmland",
  "composter",
  "wheat",
  "carrots",
  "potatoes",
  "beetroots",
];
const PICK = new Set([
  ...SEEDS,
  "wheat",
  "carrot",
  "potato",
  "beetroot",
  "dandelion",
  "golden_carrot",
  "hay_block",
  ...FLOWERS,
]);

const F = {
  scanAt: 0,
  scanPos: null,
  hay: [],
  crops: [],
  farmland: [],
  composters: [],
  bells: [],
  villagers: [],
  village: null,
  bad: new Map(),
  src: {},
  srcMs: {},
  field: null,
  logs: 0,
};
let lastResult = null;

const now = () => B.now();
const bot = () => B.S.bot;
const key = (p) => `${p.x},${p.y},${p.z}`;
function ids(names) {
  const r = bot().registry;
  return names
    .map((n) => r.blocksByName[n] && r.blocksByName[n].id)
    .filter((x) => x !== undefined);
}

const stateSets = new Map();
function statesOf(names) {
  const k = names.join(",");
  let set = stateSets.get(k);
  if (set) return set;
  set = new Set();
  const reg = bot().registry;
  for (const n of names) {
    const b = reg.blocksByName[n];
    if (b) for (let st = b.minStateId; st <= b.maxStateId; st++) set.add(st);
  }
  stateSets.set(k, set);
  return set;
}
function find(names, radius, opts = {}) {
  const b = bot();
  const pp = opts.point || B.pos();
  const point = new B.Vec3(
    Math.floor(pp.x),
    Math.floor(pp.y),
    Math.floor(pp.z),
  );
  const dy = opts.dy ?? radius;
  const count = opts.count || 400;
  try {
    const set = statesOf(names),
      minY = b.game.minY,
      yMin = point.y - dy,
      yMax = point.y + dy,
      r2 = radius * radius,
      cr = Math.ceil(radius / 16) + 0,
      cx0 = point.x >> 4,
      cz0 = point.z >> 4,
      out = [];
    for (let cx = cx0 - cr; cx <= cx0 + cr; cx++)
      for (let cz = cz0 - cr; cz <= cz0 + cr; cz++) {
        const col = b.world.getColumn(cx, cz);
        if (!col || !col.sections) continue;
        const s0 = Math.max(0, (yMin - minY) >> 4),
          s1 = Math.min(col.sections.length - 1, (yMax - minY) >> 4);
        for (let si = s0; si <= s1; si++) {
          const sec = col.sections[si];
          const data = sec && sec.data;
          if (!data) continue;
          const pal = data.palette;
          if (pal) {
            let hit = false;
            for (const st of pal) if (set.has(st)) hit = true;
            if (!hit) continue;
          } else if (data.value !== undefined && !set.has(data.value)) continue;
          const by = si * 16 + minY;
          for (let i = 0; i < 4096; i++) {
            if (!set.has(data.get(i))) continue;
            const y = by + (i >> 8);
            if (y < yMin || y > yMax) continue;
            const x = (cx << 4) + (i & 15),
              z = (cz << 4) + ((i >> 4) & 15),
              ddx = x - point.x,
              ddz = z - point.z;
            if (ddx * ddx + ddz * ddz > r2) continue;
            out.push(new B.Vec3(x, y, z));
          }
        }
      }
    out.sort((p, q) => p.distanceTo(point) - q.distanceTo(point));
    return out.length > count ? out.slice(0, count) : out;
  } catch (e) {
    F.findErr = (F.findErr || 0) + 1;
    F.findErr <= 3 &&
      B.log("ah food find fallback", { err: String(e).slice(0, 160) });
    try {
      return b.findBlocks({
        matching: ids(names),
        maxDistance: radius,
        count,
        point,
      });
    } catch {
      return [];
    }
  }
}
function age(b) {
  try {
    return Number(b.getProperties().age) || 0;
  } catch {
    return 0;
  }
}
function isBad(p) {
  const u = F.bad.get(key(p));
  if (u && u > now()) return true;
  if (F.badAreas)
    for (const a of F.badAreas)
      if (
        a.until > now() &&
        Math.abs(p.x - a.x) <= a.r &&
        Math.abs(p.z - a.z) <= a.r
      )
        return true;
  return false;
}
function markBad(p, ms = 18e4) {
  F.bad.set(key(p), now() + ms);
}
function itemsOf(k) {
  return GROUPS[k] || [k];
}
function groupCount(k) {
  let n = 0;
  for (const it of itemsOf(k)) n += B.count(it);
  if (itemsOf(k).includes("wheat")) n += 9 * B.count("hay_block");
  return n;
}
function counts(need) {
  const out = B.inventorySummary();
  for (const k of Object.keys(need || {})) out[k] = groupCount(k);
  return out;
}
function missing(need) {
  const m = {};
  for (const [k, n] of Object.entries(need || {})) {
    const c = groupCount(k);
    if (c < n) m[k] = n - c;
  }
  return m;
}
function wantedItems(miss) {
  const s = new Set();
  for (const k of Object.keys(miss)) for (const it of itemsOf(k)) s.add(it);
  if (s.has("wheat")) s.add("hay_block");
  return s;
}
function credit(src, before, items) {
  let got = 0;
  for (const it of items) got += B.count(it) - (before[it] || 0);
  if (items.includes("wheat"))
    got += 9 * (B.count("hay_block") - (before.hay_block || 0));
  if (got > 0) F.src[src] = (F.src[src] || 0) + got;
  return got;
}
function snap() {
  return B.inventorySummary();
}
function keepOutOf(ctx) {
  if (ctx && ctx.keepOut) return ctx.keepOut;

  const pen = (ctx && ctx.pen) || F.pen;
  if (pen && pen.x !== undefined && pen.w)
    return {
      x0: pen.x,
      z0: pen.z,
      x1: pen.x + pen.w + 1,
      z1: pen.z + pen.d + 1,
    };

  if (!B.hasBot()) return null;
  if (!F.fenceBox || now() - F.fenceBox.at > 3e4) {
    let box = null;
    try {
      const fs = find(["oak_fence", "oak_fence_gate"], 64, {
        dy: 12,
        count: 400,
      });
      if (fs.length >= 12) {
        box = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
        for (const f of fs)
          ((box.x0 = Math.min(box.x0, f.x)),
            (box.z0 = Math.min(box.z0, f.z)),
            (box.x1 = Math.max(box.x1, f.x)),
            (box.z1 = Math.max(box.z1, f.z)));
      }
    } catch {}
    F.fenceBox = { at: now(), box };
  }
  return F.fenceBox.box;
}
function setPen(pen) {
  F.pen = pen;
}
function inKeepOut(p, ctx, margin = 0) {
  const k = keepOutOf(ctx);
  if (!k) return false;
  return (
    p.x >= k.x0 - margin &&
    p.x <= k.x1 + margin &&
    p.z >= k.z0 - margin &&
    p.z <= k.z1 + margin
  );
}

function scan(force = false, radius = 0) {
  if (!B.hasBot()) return F;
  const me = B.pos();
  if (
    !force &&
    F.scanPos &&
    now() - F.scanAt < 3e4 &&
    F.scanPos.distanceTo(me) < 24
  )
    return F;
  if (!radius)
    radius = force ? 176 : F.village ? Math.min(176, F.village.dist + 40) : 112;
  const t0 = now();
  let found = [];
  try {
    found = find(VILLAGE_MARKS, radius, { dy: 48, count: 3000 });
  } catch (e) {
    B.log("ah food scan error", { err: String(e).slice(0, 160) });
  }
  const hay = [],
    crops = [],
    farmland = [],
    composters = [],
    bells = [];

  const ours = new Set(occupied().map((c) => `${c.x},${c.y},${c.z}`));
  for (const p of found) {
    if (ours.has(`${p.x},${p.y},${p.z}`)) continue;
    const b = B.blockAt(p);
    if (!b) continue;
    if (b.name === "hay_block") hay.push(p);
    else if (b.name === "farmland") farmland.push(p);
    else if (b.name === "composter") composters.push(p);
    else if (b.name === "bell") bells.push(p);
    else if (CROP_MAX[b.name] !== undefined)
      crops.push({ pos: p, name: b.name, age: age(b) });
  }
  const villagers = Object.values(bot().entities)
    .filter((e) => e && e.name === "villager" && e.position)
    .map((e) => e.position.floored());
  F.hay = hay;
  F.crops = crops;
  F.farmland = farmland;
  F.composters = composters;
  F.bells = bells;
  F.villagers = villagers;
  F.scanAt = now();
  F.scanPos = me.clone();

  const pts = [...bells, ...hay, ...farmland, ...villagers];
  let at = null;
  if (bells.length)
    at = bells.slice().sort((a, b) => a.distanceTo(me) - b.distanceTo(me))[0];
  else if (pts.length >= 3) {
    const s = pts.reduce(
      (a, p) => a.offset(p.x, p.y, p.z),
      new B.Vec3(0, 0, 0),
    );
    at = new B.Vec3(
      Math.round(s.x / pts.length),
      Math.round(s.y / pts.length),
      Math.round(s.z / pts.length),
    );
  }
  const prev = F.village;
  F.village = at
    ? {
        at,
        dist: Math.round(B.hdist(at, me)),
        hay: hay.length,
        farmland: farmland.length,
      }
    : prev;
  const near = (arr) =>
    arr.length ? Math.round(Math.min(...arr.map((p) => B.hdist(p, me)))) : null;
  const ripe = crops.filter((c) => c.age >= CROP_MAX[c.name]);
  const byCrop = {};
  for (const c of crops) {
    const o = (byCrop[c.name] = byCrop[c.name] || { n: 0, ripe: 0 });
    (o.n++, c.age >= CROP_MAX[c.name] && o.ripe++);
  }
  B.log("ah food scan", {
    ms: now() - t0,
    me: B.feet(),
    village: F.village,
    hay: hay.length,
    hayNear: near(hay),
    farmland: farmland.length,
    farmNear: near(farmland),
    crops: byCrop,
    ripeNear: near(ripe.map((c) => c.pos)),
    composters: composters.length,
    bells: bells.length,
    bellNear: near(bells),
    villagers: villagers.length,
    villagerNear: near(villagers),
  });
  return F;
}
function village() {
  return F.village;
}

function nature(radius = 32) {
  const out = {};
  for (const [k, names] of [
    ["grass", GRASS],
    ["dandelion", ["dandelion"]],
    ["flowers", FLOWERS],
    ["water", ["water"]],
    ["logs", LOGS],
    ["compost", require("../agriculture/crops").COMPOST_BLOCKS],
    ["villageish", ["hay_block", "farmland", "bell"]],
  ]) {
    try {
      const ps = find(names, radius, { dy: 24, count: 400 });
      out[k] = ps.length;
      out[k + "Near"] = ps.length
        ? Math.round(ps[0].distanceTo(B.pos()))
        : null;
    } catch {
      out[k] = -1;
    }
  }
  return out;
}

async function collect(center, radius = 6, ms = 4e3, quick = true) {
  try {
    return await B.collectItems(center, radius, PICK_ALL, ms, { quick });
  } catch {
    return 0;
  }
}
const LEAVES = [
  "oak_leaves",
  "birch_leaves",
  "spruce_leaves",
  "jungle_leaves",
  "acacia_leaves",
  "dark_oak_leaves",
  "mangrove_leaves",
  "cherry_leaves",
  "azalea_leaves",
  "pale_oak_leaves",
];
const PICK_ALL = new Set([
  ...PICK,
  "oak_log",
  "birch_log",
  "spruce_log",
  "jungle_log",
  "acacia_log",
  "dark_oak_log",
  "mangrove_log",
  "cherry_log",
  "pale_oak_log",
  "oak_sapling",
  "birch_sapling",
  "spruce_sapling",
  "bone_meal",
  "stick",
  "apple",
  "short_grass",
  "tall_grass",
  "fern",
  "large_fern",
  "vine",
  ...LEAVES,
  "sugar_cane",
  "pumpkin",
  "melon_slice",
  "pink_petals",
  "wildflowers",
  "leaf_litter",
  "firefly_bush",
  "brown_mushroom",
  "red_mushroom",
  "sweet_berries",
  "raw_iron",
  "cobblestone",
  "cobbled_deepslate",
  "crafting_table",
  "furnace",
]);

function mayDig(p, b) {
  const blk = b || B.blockAt(p);
  if (!blk) return false;
  if (blk.boundingBox !== "block") return true;
  let k = null;
  try {
    k = keepOutOf({});
  } catch {}
  const ok = !(
    k &&
    p.x >= k.x0 - 2 &&
    p.x <= k.x1 + 2 &&
    p.z >= k.z0 - 2 &&
    p.z <= k.z1 + 2
  );
  if (!ok) {
    F.digRefused = (F.digRefused || 0) + 1;
    F.digRefused <= 5 &&
      B.log("ah food dig refused", { at: p, block: blk.name, why: "pen box" });
  }
  return ok;
}
async function digAt(p) {
  const b = B.blockAt(p);
  if (!b || B.isAir(b) || !mayDig(p, b)) return false;
  return B.dig(b, { hand: true, maxMs: 3e3 });
}

async function work(
  targets,
  fn,
  until,
  reach = 4.2,
  label = "food",
  moveMs = 12e3,
) {
  if (!targets.length) return 0;
  return B.workSet(targets, fn, {
    reach,
    until,
    moveMs,
    maxFails: 1,
    label,
    onUnreachable: (t) => markBad(t.pos),
  });
}

async function clearGrid() {
  const b = bot();
  try {
    b.currentWindow && b.closeWindow(b.currentWindow);
  } catch {}
  try {
    await B.settleCursor();
  } catch {}
  for (let s = 1; s <= 4; s++) {
    if (!b.inventory.slots[s]) continue;
    try {
      await B.withTimeout(b.clickWindow(s, 0, 1), 2500, "grid");
    } catch {}
  }
}

async function craftN(name, times, table = null) {
  const b = bot(),
    it = b.registry.itemsByName[name];
  if (!it) return 0;
  let done = 0,
    fails = 0;
  try {
    b.pathfinder.setGoal(null);
    b.clearControlStates();
  } catch {}
  while (done < times && fails < 3) {
    if (
      b.currentWindow ||
      b.inventory.selectedItem ||
      [1, 2, 3, 4].some((x) => b.inventory.slots[x])
    )
      await clearGrid();
    await B.sleep(fails ? 600 : 200);
    let rs = b.recipesFor(it.id, null, 1, table || null);
    if (!rs.length) {
      await B.sleep(700);
      await clearGrid();
      rs = b.recipesFor(it.id, null, 1, table || null);
    }
    if (!rs.length) {
      done === 0 &&
        B.log("ah food craft: no recipe", {
          name,
          table: table
            ? {
                name: (B.blockAt(table.position) || {}).name,
                reach: +B.reachOf(table.position).toFixed(1),
              }
            : null,
          inv: B.inventorySummary(),
          cursor: b.inventory.selectedItem && b.inventory.selectedItem.name,
          window: b.currentWindow ? b.currentWindow.type : null,
        });
      break;
    }
    try {
      const before = B.count(name);
      await B.withTimeout(
        b.craft(rs[0], 1, table || null),
        8e3,
        `craft ${name}`,
      );

      await B.sleep(400);
      if (B.count(name) <= before)
        throw new Error("craft not confirmed by the server");
      done++;
    } catch (e) {
      fails++;
      B.log("ah food craft failed", {
        name,
        err: String(e).slice(0, 140),
        grid: [1, 2, 3, 4].map(
          (s) => b.inventory.slots[s] && b.inventory.slots[s].name,
        ),
        cursor: b.inventory.selectedItem && b.inventory.selectedItem.name,
      });
      await B.sleep(500);
      await clearGrid();
    }
  }
  return done;
}

async function hayToWheat() {
  const n = B.count("hay_block");
  if (!n || B.freeSlots() < 1) return 0;
  const before = B.count("wheat");
  await craftN("wheat", Math.min(n, 7 * Math.max(1, B.freeSlots() - 1)));
  const got = B.count("wheat") - before;
  got &&
    B.log("ah food hay crafted", {
      wheat: B.count("wheat"),
      hayLeft: B.count("hay_block"),
    });
  return got;
}

function waterNear(r = 8) {
  try {
    const f = B.feet();
    for (let dy = -2; dy <= 1; dy++)
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          const b = B.blockAt(f.offset(dx, dy, dz));
          if (b && b.name === "water") return true;
        }
  } catch {}
  return false;
}
function wetNow() {
  try {
    const e = B.S.bot && B.S.bot.entity;
    if (e && e.isInWater) return true;
    const f = B.feet();
    for (const dy of [0, 1]) {
      const b = B.blockAt(f.offset(0, dy, 0));
      if (b && b.name === "water") return true;
    }
  } catch {}
  return false;
}
async function travelTo(p, until, near = 16, opts = {}) {
  const d = B.hdist(p, B.pos());
  if (d <= near) return true;

  if (!opts.oneWay && F.deadline && F.deadline - now() < 2 * d * 250 + 15e3) {
    markBad(p, 3e4);
    return false;
  }
  const t0 = now();
  const from = B.feet();

  const wetFix = process.env.AH_WETTRAVEL !== "0";
  const wet0 = wetFix && wetNow();
  if (wet0) (B.setMovements({ water: true }), (B.S.swimOk = true));
  let st;
  try {
    st = await B.goto(new B.goals.GoalNear(p.x, p.y, p.z, 3), {
      timeoutMs: Math.min(9e4, 1e4 + d * 600),
      stuckMs: 6e3,
      until,
    });
  } finally {
    if (wet0) ((B.S.swimOk = false), B.setMovements({}));
  }
  let ok = B.hdist(p, B.pos()) <= near + 4,
    escalated = false;
  if (!ok && !until()) {
    escalated = true;

    const wet =
      wetFix &&
      (wet0 ||
        wetNow() ||
        (st === "noPath" && now() - t0 < 2e3) ||
        (process.env.AH_SWIMNEAR !== "0" && waterNear(8)));
    B.setMovements({
      maxDropDown: 4,
      digCost: 1.5,
      towers: true,
      hardDig: true,
      ...(wet ? { water: true } : {}),
    });
    if (wet) B.S.swimOk = true;
    try {
      st = await B.goto(new B.goals.GoalNear(p.x, p.y, p.z, 3), {
        timeoutMs: Math.min(9e4, 1.5e4 + B.hdist(p, B.pos()) * 700),
        stuckMs: 8e3,
        until,
      });
    } finally {
      B.S.swimOk = false;
      B.setMovements({});
    }
    ok = B.hdist(p, B.pos()) <= near + 4;
  }
  B.log("ah food travel", {
    to: p,
    from,
    d: Math.round(d),
    st,
    ok,
    escalated,
    ms: now() - t0,
    ...(wet0 ? { wet0 } : {}),
  });
  if (!ok) {
    F.badAreas = (F.badAreas || []).filter((a) => a.until > now());
    F.badAreas.push({ x: p.x, z: p.z, r: 10, until: now() + 15e4 });
    markBad(p, 15e4);
  }
  return ok;
}

function inArea(p) {
  return !F.home || B.hdist(p, F.home) <= (F.maxDist || 170);
}
async function takeHay(until, max = 64) {
  const me = B.pos();
  const list = F.hay
    .filter(
      (p) =>
        !isBad(p) && inArea(p) && (B.blockAt(p) || {}).name === "hay_block",
    )
    .sort((a, b) => a.distanceTo(me) - b.distanceTo(me))
    .slice(0, max);
  if (!list.length) return 0;
  const before = snap(),
    t0 = now();
  let dug = 0;

  const far = B.hdist(list[0], B.pos());
  const oneWay =
    far <= 130 && B.timeLeft() > 48e4 && now() - (F.hayOverrun || 0) > 18e4;
  if (oneWay && F.deadline && F.deadline - now() < 2 * far * 250 + 15e3)
    F.hayOverrun = now();
  if (
    !(await travelTo(list[0], () => !B.hasBot() || B.timeLeft() < 6e4, 16, {
      oneWay,
    }))
  )
    return 0;
  const hayUntil = () =>
    F.hayOverrun && now() - F.hayOverrun < 9e4 ? !B.hasBot() : until();

  const dugAt = [];
  dug += await work(
    list.slice(0, 16).map((p) => ({ pos: p })),
    async (t) => {
      const b = B.blockAt(t.pos);
      if (!b || b.name !== "hay_block") return false;

      const ok = await digAt(t.pos);
      ok ? dugAt.push(t.pos) : markBad(t.pos);
      return ok;
    },
    hayUntil,
    4.2,
    "hay",
  );
  await collect(list[0], 7, 5e3);

  try {
    const tEnd = now() + 3e4;

    const sk = B.S && B.S.itemSkip;
    if (sk && sk.size)
      for (const e of Object.values(B.S.bot.entities))
        if (
          e &&
          e.name === "item" &&
          e.position &&
          dugAt.some((p) => e.position.distanceTo(p) <= 6)
        )
          sk.delete(e.id);
    for (let pass = 0; pass < 2 && now() < tEnd; pass++)
      for (const p of dugAt) {
        if (now() > tEnd) break;
        const left = B.droppedItems
          ? B.droppedItems(p, 5, new Set(["hay_block", "wheat"]))
          : [];
        if (left && left.length)
          await collect(
            p,
            5,
            Math.min(8e3, tEnd - now()),
            pass > 0 ? false : true,
          );
      }
  } catch {}
  F.hay = F.hay.filter((p) => (B.blockAt(p) || {}).name === "hay_block");
  const got = credit("hay", before, ["wheat"]);
  B.log("ah food step", {
    src: "hay",
    dug,
    got,
    wheat: groupCount("wheat"),
    ms: now() - t0,
    left: F.hay.length,
  });
  return got;
}

function ownCell(p) {
  const f = F.field;

  return (
    !!f &&
    !f.village &&
    f.cells.some((c) => c.x === p.x && c.z === p.z && c.y + 1 === p.y)
  );
}
function cropTargets(want, center = null, radius = 160) {
  const me = B.pos();
  const c0 = center || me;
  return F.crops
    .filter((c) => {
      if (isBad(c.pos) || B.hdist(c.pos, c0) > radius || !inArea(c.pos))
        return false;
      const b = B.blockAt(c.pos);
      if (!b || b.name !== c.name) return false;
      c.age = age(b);
      const ripe = c.age >= CROP_MAX[c.name];

      if (
        !ripe &&
        ownCell(c.pos) &&
        !(F.fieldStarved && (c.name === "carrots" || c.name === "potatoes"))
      )
        return false;
      const gives = CROP_GIVES[c.name][ripe ? 0 : 1];

      return (
        gives.some((g) => want.has(g)) &&
        (ripe ||
          c.name === "carrots" ||
          c.name === "potatoes" ||
          want.has(gives[0]))
      );
    })
    .map((c) => {
      const ripe = c.age >= CROP_MAX[c.name];
      return { pos: c.pos, name: c.name, ripe, v: ripe ? 2.7 : 1 };
    })
    .sort((a, b) => a.pos.distanceTo(me) / a.v - b.pos.distanceTo(me) / b.v);
}

async function harvestCrops(want, until, opts = {}) {
  let ts = cropTargets(want, opts.center, opts.radius);
  if (!ts.length) return 0;
  const before = snap(),
    t0 = now();
  if (B.hdist(ts[0].pos, B.pos()) > 16) {
    if (!(await travelTo(ts[0].pos, until))) return 0;
    ts = cropTargets(want, opts.center, opts.radius);
    if (!ts.length) return 0;
  }
  const me0 = B.pos();
  const batch = ts
    .filter((t) => B.hdist(t.pos, me0) <= 24)
    .slice(0, opts.max || 24);
  if (!batch.length) batch.push(ts[0]);
  const own = batch.filter((t) => ownCell(t.pos)).length;
  opts = {
    ...opts,
    src: opts.src || (own * 2 >= batch.length ? "field" : "village"),
  };
  let n = 0,
    replanted = 0;
  const farmlandOf = (p) => B.blockAt(p.offset(0, -1, 0));
  n = await work(
    batch,
    async (t) => {
      const b = B.blockAt(t.pos);
      if (!b || b.name !== t.name) return false;
      const ok = await digAt(t.pos);
      if (!ok) return (markBad(t.pos), false);

      if (t.ripe || ownCell(t.pos)) {
        await B.sleep(250);
        try {
          await B.collectItems(t.pos, 4, PICK_ALL, 3e3, { quick: false });
        } catch {}
      }

      const seed = CROP_SEED[t.name];
      const fl = farmlandOf(t.pos);
      const cheap = seed === "wheat_seeds" || seed === "beetroot_seeds";

      const unripeV =
        !t.ripe && !ownCell(t.pos) && process.env.AH_UNRIPE_REPLANT !== "1";
      if (
        opts.replant !== false &&
        (t.ripe || cheap) &&
        !unripeV &&
        (ownCell(t.pos) || F.replantVillage !== false) &&
        fl &&
        fl.name === "farmland" &&
        B.count(seed) > (opts.keep?.[seed] ?? 0)
      ) {
        await B.sleep(60);
        if (await B.placeOn(fl, B.v3(0, 1, 0), seed, { waitMs: 800 }))
          replanted++;
      }
      return true;
    },
    until,
    4.2,
    "crops",
  );
  await collect(batch[0].pos, 8, 4e3, false);

  if (process.env.AH_CROP_SWEEP !== "0" && batch.length > 4 && !until()) {
    let cx = 0,
      cy = 0,
      cz = 0;
    for (const t of batch) ((cx += t.pos.x), (cy += t.pos.y), (cz += t.pos.z));
    const cc = B.v3(
      Math.floor(cx / batch.length),
      Math.floor(cy / batch.length),
      Math.floor(cz / batch.length),
    );
    await collect(cc, 13, 5e3, false);
  }
  const items = [
    "wheat",
    "wheat_seeds",
    "carrot",
    "potato",
    "beetroot",
    "beetroot_seeds",
  ];
  const got = credit(opts.src || "crops", before, items);
  F.lastCropSrc = opts.src || "crops";
  B.log("ah food step", {
    src: opts.src || "crops",
    broken: n,
    replanted,
    got,
    inv: pick(items),
    ms: now() - t0,
  });
  return got;
}
function pick(items) {
  const o = {};
  for (const it of items) o[it] = B.count(it);
  return o;
}

const INSTA = new Set(FLOWERS);
const INSTA_ALL = new Set([...FLOWERS, ...GRASS]);
function burstDig(nameSet, must) {
  const b = bot();
  if (!b || !b._client) return [];
  const eye = B.eye();
  let ps = [];
  try {
    ps = find([...nameSet], 6, { dy: 5, count: 64 });
  } catch {}
  if (must && !ps.some((p) => p.equals(must))) ps.unshift(must);
  const sent = [];
  for (const p of ps) {
    if (sent.length >= 24) break;
    if (isBad(p)) continue;
    const blk = B.blockAt(p);
    if (!blk || !nameSet.has(blk.name) || !mayDig(p, blk)) continue;
    if (eye.distanceTo(p.offset(0.5, 0.5, 0.5)) > 4.4) continue;
    try {
      b._client.write("block_dig", { status: 0, location: p, face: 1 });
      sent.push(p);
    } catch {}
  }
  if (sent.length)
    try {
      b.swingArm();
    } catch {}
  return sent;
}

async function mow(names, until, opts = {}) {
  let me = B.pos();
  let ps = [];
  for (const r of opts.wide
    ? [16, 32, 48, 80, 128]
    : [16, 32, 48, opts.far === false ? 48 : 80]) {
    try {
      const ko = keepOutOf({}),
        outside = !ko || !inKeepOut(B.feet(), {}, 0);

      ps = find(names, r, {
        point: opts.center || me,
        dy: opts.wide ? 40 : 8,
        count: 300,
      }).filter((p) => !isBad(p) && !(outside && ko && inKeepOut(p, {}, 1)));
    } catch {
      ps = [];
    }

    if (
      (opts.wide ? ps.filter((q) => q.y - me.y <= 6).length : ps.length) >= 12
    )
      break;
  }
  if (!ps.length) return -1;

  ps.sort((a, b) => a.distanceTo(me) - b.distanceTo(me));
  if (B.hdist(ps[0], me) > 24) {
    let goal = ps[0];
    if (opts.wide && ps.length > 1) {
      const low = ps.filter((q) => q.y - me.y <= 6);
      const pool = low.length >= 6 || (F.climbFails || 0) >= 2 ? low : ps;
      const cand = (pool.length ? pool : ps).slice(0, 300);

      const cost = (p) =>
        B.hdist(p, me) +
        4 * Math.max(0, p.y - me.y) +
        1.5 * Math.max(0, me.y - p.y) -
        4 * Math.min(12, cand.filter((q) => q.distanceTo(p) <= 6).length);
      goal = cand.reduce((a, b) => (cost(b) < cost(a) ? b : a), cand[0]);
      goal !== ps[0] &&
        B.log("ah food patch", {
          to: goal,
          d: Math.round(B.hdist(goal, me)),
          dy: goal.y - Math.floor(me.y),
          n: ps.length,
        });
    }
    if (!(await travelTo(goal, until, 6))) {
      if (opts.wide)
        for (const q of ps) if (q.distanceTo(goal) <= 20) markBad(q, 3.6e5);
      if (opts.wide && goal.y - me.y > 6 && !until())
        F.climbFails = (F.climbFails || 0) + 1;
      return 0;
    }
    me = B.pos();
    ps.sort((a, b) => a.distanceTo(me) - b.distanceTo(me));
  }
  const batch = ps.slice(0, opts.max || 20).map((p) => ({ pos: p }));
  const before = snap(),
    t0 = now();
  const nameSet = new Set(names);
  const burst =
    opts.burst ??
    (process.env.AH_BURST !== "0" && names.every((x) => INSTA.has(x)));
  const n = await work(
    batch,
    async (t) => {
      const b = B.blockAt(t.pos);
      if (!b || !nameSet.has(b.name)) return false;
      if (burst && (F.burstFail || 0) < 3) {
        const sent = burstDig(nameSet, t.pos);
        if (sent.length) {
          let gone = [];
          for (let k = 0; k < 8; k++) {
            await B.sleep(80);
            gone = sent.filter((q) => {
              const x = B.blockAt(q);
              return !x || !nameSet.has(x.name);
            });
            if (gone.length === sent.length) break;
          }
          const bs = (F.burstStat = F.burstStat || { n: 0, sent: 0, gone: 0 });
          (bs.n++, (bs.sent += sent.length), (bs.gone += gone.length));
          if (bs.n <= 3 || bs.n % 10 === 0)
            B.log("ah food burst", {
              sent: sent.length,
              gone: gone.length,
              ...bs,
            });
          for (const q of sent) if (!gone.includes(q)) markBad(q, 3e4);
          if (gone.length) {
            F.burstFail = 0;
            await B.sleep(350);
            await collect(B.pos(), 6, 2500);
            return gone.some((q) => q.equals(t.pos));
          }
          F.burstFail = (F.burstFail || 0) + 1;
        }
      }

      let p = t.pos;
      const below = B.blockAt(p.offset(0, -1, 0));
      if (
        below &&
        below.name === b.name &&
        (b.name === "tall_grass" || b.name === "large_fern")
      )
        p = p.offset(0, -1, 0);
      const pb = B.blockAt(p);
      if (!pb || !mayDig(p, pb)) return (markBad(t.pos, 6e4), false);
      const ok =
        opts.tool && B.count(opts.tool)
          ? await B.dig(pb, { tool: opts.tool, maxMs: 2e3 })
          : await digAt(p);
      ok || markBad(t.pos, 6e4);
      return ok;
    },
    until,
    opts.reach || 3.6,
    opts.src || "mow",
  );
  await collect(B.pos(), 7, 3e3);
  const got = credit(opts.src || "mow", before, opts.items || SEEDS);
  F.mowStat = F.mowStat || {};
  const st = (F.mowStat[opts.src || "mow"] = F.mowStat[opts.src || "mow"] || {
    broken: 0,
    got: 0,
    ms: 0,
  });
  st.broken += n;
  st.got += got;
  st.ms += now() - t0;
  return got;
}

async function sweep(names, until, opts = {}) {
  const b = bot(),
    nameSet = new Set(names),
    idList = ids(names),
    t0 = now(),
    before = snap(),
    tool = opts.tool && B.count(opts.tool) ? opts.tool : null;
  let broken = 0,
    digging = false;
  const center = opts.center || null;

  const ko = keepOutOf({}),
    outside = !ko || !inKeepOut(B.feet(), {}, 0);
  const ok = (p) =>
    !isBad(p) &&
    (!center || B.hdist(p, center) <= (opts.radius || 32)) &&
    !(outside && ko && inKeepOut(p, {}, 1));

  const insta =
    process.env.AH_BURST !== "0" &&
    names.every((x) => INSTA_ALL.has(x)) &&
    !(F.burstFail >= 3);
  const digNear = async (r) => {
    if (digging) return;
    digging = true;
    try {
      if (insta) {
        let ps = [];
        try {
          ps = find(names, Math.ceil(r) + 1, { dy: 3, count: 64 });
        } catch {}
        let n = 0;
        for (const p of ps) {
          if (n >= 24 || until() || !B.hasBot()) break;
          if (!ok(p) || B.reachOf(p) > Math.min(r, 4.4)) continue;
          const blk = B.blockAt(p);
          if (!blk || !nameSet.has(blk.name) || !mayDig(blk.position, blk))
            continue;
          try {
            b._client.write("block_dig", {
              status: 0,
              location: blk.position,
              face: 1,
            });
            n++;
            broken++;
          } catch {}
        }
        if (n) {
          try {
            b.swingArm();
          } catch {}
          await B.sleep(120);
        }
        return;
      }
      let ps = [];
      try {
        ps = find(names, Math.ceil(r) + 1, { dy: 3, count: 24 });
      } catch {}
      for (const p of ps) {
        if (until() || !B.hasBot()) break;
        if (!ok(p) || B.reachOf(p) > r) continue;
        let blk = B.blockAt(p);
        if (!blk || !nameSet.has(blk.name)) continue;
        const below = B.blockAt(p.offset(0, -1, 0));
        if (below && below.name === blk.name) blk = below;
        if (!mayDig(blk.position, blk)) continue;
        try {
          await B.withTimeout(b.dig(blk, "ignore"), 1500, "sweep dig");
          broken++;
        } catch {
          markBad(p, 6e4);
        }
      }
    } finally {
      digging = false;
    }
  };
  tool ? await B.equip(tool) : await B.unequip();
  let legs = 0,
    found = false;
  for (; legs < (opts.legs || 6) && !until(); legs++) {
    const me = B.pos();
    let ps = [];
    try {
      ps = find(names, opts.findR || 24, {
        point: center || me,
        dy: center ? 8 : 4,
        count: 200,
      }).filter((p) => ok(p));
    } catch {}
    if (!ps.length) break;
    found = true;
    await digNear(4.2);
    const far = ps.filter((p) => p.distanceTo(me) > 4).slice(0, 60);
    if (!far.length) break;

    const dens = (p) => far.filter((q) => q.distanceTo(p) <= 3).length;
    far.sort(
      (p, q) =>
        p.distanceTo(me) - 0.6 * dens(p) - (q.distanceTo(me) - 0.6 * dens(q)),
    );
    const g = far[0];
    let walking = true;
    const walk = B.goto(new B.goals.GoalNear(g.x, g.y, g.z, 1), {
      timeoutMs: 9e3,
      stuckMs: 2500,
      until,
    }).finally(() => (walking = false));

    while (walking && !until()) {
      await digNear(opts.walkR || 3.2);
      await B.sleep(120);
    }
    const st = await walk;
    st !== "reached" && markBad(g, 6e4);
    await digNear(opts.stopR || 4.2);
    if (opts.collectEvery || legs % 2 === 1) await collect(B.pos(), 6, 2500);
  }
  await collect(B.pos(), 7, 3500);
  const src = opts.src || "sweep";
  const got = credit(src, before, opts.items || SEEDS);
  F.mowStat = F.mowStat || {};
  const st = (F.mowStat[src] = F.mowStat[src] || { broken: 0, got: 0, ms: 0 });
  st.broken += broken;
  st.got += got;
  st.ms += now() - t0;
  return found ? got : -1;
}

function outlook() {
  const me = B.hasBot() ? B.pos() : null;
  const crops = {};
  for (const c of F.crops) {
    const o = (crops[c.name] = crops[c.name] || { n: 0, ripe: 0 });
    (o.n++, c.age >= CROP_MAX[c.name] && o.ripe++);
  }
  let field = null;
  if (F.field)
    field = {
      at: F.field.at,
      cells: F.field.cells.length,
      composter: F.field.composter,
      crops: require("../agriculture/crops")
        .fieldCrops()
        .map((c) => `${c.name}:${c.age}`),
    };
  return {
    village: F.village,
    hay: F.hay.length,
    hayWheat: 9 * F.hay.length,
    crops,
    field,
    bone_meal: B.count("bone_meal"),
    scanAge: me ? Math.round((now() - F.scanAt) / 1e3) : null,
    src: F.src,
  };
}

function occupied() {
  const out = [];
  const f = F.field;
  if (f && !f.village)
    for (const c of f.cells) out.push({ x: c.x, y: c.y, z: c.z });
  if (f && f.composter && !f.village)
    out.push({ x: f.composter.x, y: f.composter.y, z: f.composter.z });
  for (const p of F.placed || []) out.push(p);
  return out;
}

function surfaceAt(x, z, y0) {
  for (let y = y0 + 40; y > y0 - 40; y--) {
    const b = B.blockAt(new B.Vec3(x, y, z));
    if (!b) return null;
    if (
      B.isAir(b) ||
      /leaves|_log$/.test(b.name) ||
      (b.boundingBox === "empty" && !/water|lava/.test(b.name))
    )
      continue;
    return { y, name: b.name };
  }
  return null;
}

function directionScores(home) {
  const out = [];
  for (let deg = 0; deg < 360; deg += 45) {
    const a = (deg * Math.PI) / 180;
    let n = 0,
      water = 0,
      land = 0;
    const hs = [];
    for (const r of [64, 96, 128, 160])
      for (const off of [-16, 0, 16]) {
        const x = Math.round(home.x + Math.sin(a) * r + Math.cos(a) * off),
          z = Math.round(home.z - Math.cos(a) * r + Math.sin(a) * off);
        const top = surfaceAt(x, z, home.y);
        if (!top) continue;
        n++;
        if (/water|ice|kelp|seagrass/.test(top.name)) water++;
        else {
          hs.push(top.y);
          /grass_block|sand|dirt|podzol|snow|coarse_dirt|mud/.test(top.name) &&
            land++;
        }
      }
    const mean = hs.length ? hs.reduce((p, q) => p + q, 0) / hs.length : 0;
    const sd =
      hs.length > 1
        ? Math.sqrt(
            hs.reduce((p, q) => p + (q - mean) * (q - mean), 0) / hs.length,
          )
        : 20;
    out.push({
      deg,
      n,
      score: n ? (2 * land) / n - (2.5 * water) / n - sd / 8 : -9,
      water,
      sd: +sd.toFixed(1),
    });
  }
  return out.sort((p, q) => q.score - p.score);
}

async function explore(ctx, ms = 15e4, opts = {}) {
  const t0 = now(),
    end = now() + ms,
    home =
      (ctx && ctx.home && new B.Vec3(ctx.home.x, ctx.home.y, ctx.home.z)) ||
      B.feet();

  const good = () =>
    F.village &&
    (F.hay.length > 0 || (opts.hay === false && F.village.farmland >= 8));
  scan(true);
  if (good())
    return (
      B.log("ah food explore", {
        found: true,
        at_start: true,
        village: F.village,
      }),
      F.village
    );
  F.explored = F.explored || [];
  const scores = directionScores(home);
  const dirs = scores.filter((d) => !F.explored.includes(d.deg));
  const legs = Math.max(1, opts.legs || 1);
  let tFind = null,
    walked = 0;
  for (const d of dirs.slice(0, legs)) {
    const left = end - now();
    if (left < 2e4) break;
    F.explored.push(d.deg);
    const share = left / Math.max(1, legs - dirs.indexOf(d)),
      outEnd = now() + share / 2,
      a = (d.deg * Math.PI) / 180,
      far = opts.far || 400,
      tx = Math.round(home.x + Math.sin(a) * far),
      tz = Math.round(home.z - Math.cos(a) * far);
    let lastScan = now();
    const p0 = B.pos().clone();
    await B.goto(new B.goals.GoalNearXZ(tx, tz, 8), {
      timeoutMs: Math.max(3e3, outEnd - now()),
      stuckMs: 8e3,
      until: () => {
        if (now() - lastScan > 8e3) ((lastScan = now()), scan(true));
        if (good() && tFind === null) tFind = now() - t0;
        return good() || now() > outEnd;
      },
    });
    scan(true);
    if (good() && tFind === null) tFind = now() - t0;
    walked += B.hdist(B.pos(), p0);
    B.log("ah food explore leg", {
      deg: d.deg,
      score: +d.score.toFixed(2),
      at: B.feet(),
      dist: Math.round(B.hdist(B.pos(), home)),
      found: good(),
      village: F.village,
      ms: now() - t0,
    });
    if (good()) break;

    if (opts.back !== false && B.hdist(B.pos(), home) > 16)
      await B.goto(new B.goals.GoalNear(home.x, home.y, home.z, 4), {
        timeoutMs: Math.max(
          5e3,
          Math.min(end - now() + 15e3, B.timeLeft() - 2e4),
        ),
        stuckMs: 8e3,
      });
  }
  B.log("ah food explore", {
    found: good(),
    t_find_ms: tFind,
    village: F.village,
    dist_home: F.village ? Math.round(B.hdist(F.village.at, home)) : null,
    walked: Math.round(walked),
    at: B.feet(),
    ms: now() - t0,
    scores: scores.slice(0, 4).map((d) => `${d.deg}:${d.score.toFixed(2)}`),
  });
  return good() ? F.village : null;
}

function normDeadline(d) {
  if (!d) return now() + Math.max(0, B.timeLeft() - 5e3);
  return d < 1e12 ? now() + d : d;
}

async function gather(ctx, need, deadlineMs) {
  startStatus();
  const deadline = Math.min(
    normDeadline(deadlineMs),
    now() + B.timeLeft() - 2e3,
  );
  const t0 = now();

  let swAt = 0,
    swHit = false;
  const stopNow = () => {
    if (swHit) return true;
    if (!ctx || typeof ctx.stopWhen !== "function" || now() - swAt < 2e3)
      return false;
    swAt = now();
    try {
      swHit = !!ctx.stopWhen();
    } catch {}
    return swHit;
  };
  const until = () => now() > deadline - 300 || !B.hasBot() || stopNow();
  if (ctx && ctx.home) F.home = new B.Vec3(ctx.home.x, ctx.home.y, ctx.home.z);
  else if (!F.home && B.hasBot()) F.home = B.feet();
  if (ctx && ctx.maxDist) F.maxDist = ctx.maxDist;
  F.deadline = deadline;
  B.log("ah food gather", { need, ms: deadline - now(), have: counts(need) });
  let idle = 0,
    reason = "met",
    rounds = 0,
    lastAct = null;
  const tried = {};
  while (!until()) {
    rounds++;
    const miss = missing(need);
    if (!Object.keys(miss).length) break;
    const want = wantedItems(miss);

    if (
      !F.field &&
      (F.fieldTries || 0) < 4 &&
      now() >= (F.fieldNextTry || 0) &&
      ctx &&
      ctx.autoCrops !== false &&
      ["wheat", "carrot", "potato", "beetroot"].some((x) => want.has(x)) &&
      B.timeLeft() > (F.fieldTries || 0 ? 48e4 : 24e4) &&
      deadline - now() > 2e4
    ) {
      await startCrops({
        ...ctx,
        cropsMaxMs: Math.min(15e4, Math.max(6e4, deadline - now() - 1e4)),
      });
    }

    const r = {};
    for (const [k, m] of Object.entries(miss))
      for (const it of itemsOf(k))
        r[it] = Math.max(r[it] || 0, m / Math.max(1, need[k]));
    F.wantRank = { at: now(), r };
    scan();
    let got = -1,
      act = null;
    if (!F.field && F.farmland.length >= 6)
      require("../agriculture/crops").adoptVillage(ctx);

    const cands = [];
    if (want.has("wheat") && F.hay.some((p) => !isBad(p) && inArea(p)))
      cands.push({ act: "hay", fast: true, serves: ["wheat"] });
    const ct = cropTargets(want);
    if (ct.length) cands.push({ act: "crops", fast: true, serves: [...want] });
    if (want.has("dandelion") && (tried.dandelion || 0) < 3)
      cands.push({ act: "dandelion", serves: ["dandelion"] });

    const reseed =
      want.has("wheat") &&
      F.field &&
      !F.field.village &&
      B.count("wheat_seeds") < 1 &&
      !require("../agriculture/crops")
        .fieldCrops()
        .some((c) => c.name === "wheat");
    const seedOnly = Object.keys(miss).every((k) =>
      itemsOf(k).every((it) => SEEDS.includes(it)),
    );
    const grassHeld = (F.srcMs.grass || 0) > 6e4 && !seedOnly;
    if (
      (SEEDS.some((x) => want.has(x)) || reseed) &&
      (tried.grass || 0) < 4 &&
      !grassHeld
    )
      cands.push({
        act: "grass",
        serves: reseed ? [...SEEDS, "wheat"] : SEEDS,
      });
    if (F.field && fieldUseful(want) && (tried.field || 0) < 4)
      cands.push({
        act: "tend",
        serves: ["wheat", "carrot", "potato", "beetroot"],
      });
    if (!cands.length) {
      reason = "no source";
      break;
    }
    const short = (c) => {
      let best = 0;
      for (const [k, m] of Object.entries(miss))
        if (itemsOf(k).some((it) => c.serves.includes(it)))
          best = Math.max(best, m / Math.max(1, need[k]));
      return best + (c.fast ? 10 : 0) - (c.act === lastAct ? 0.05 : 0);
    };
    cands.sort((a, b) => short(b) - short(a));
    act = cands[0].act;
    const ta = now();
    if (act === "hay") got = await takeHay(until);
    else if (act === "crops") got = await harvestCrops(want, until, {});
    else if (act === "dandelion") {
      got = await mow(["dandelion"], until, {
        src: "dandelion",
        items: ["dandelion"],
        max: 16,
        wide: true,
      });
      if (got <= 0) tried.dandelion = (tried.dandelion || 0) + 1;
    } else if (act === "grass") {
      got = await sweep(GRASS, until, { src: "grass", items: SEEDS });
      if (got < 0)
        got = await mow(GRASS, until, { src: "grass", items: SEEDS, max: 24 });
      if (got < 0) tried.grass = (tried.grass || 0) + 1;
    } else if (act === "tend") {
      if (
        want.has("wheat") &&
        !F.shearsTried &&
        ctx &&
        ctx.autoShears !== false &&
        B.timeLeft() > 54e4 &&
        require("../agriculture/crops").composterOk() &&
        (F.srcMs.tend || 0) > 6e4
      ) {
        const adv = shearsAdvised();
        if (adv.advised) {
          F.shearsTried = true;
          B.log("ah food shears start", {
            ...adv,
            left_s: Math.round(B.timeLeft() / 1e3),
          });
          const tS = now();
          await getShears(ctx, 2.4e5);

          F.toolMs = (F.toolMs || 0) + (now() - tS);
        }
      }

      got = await tendCrops(ctx, Math.min(deadline, now() + 3e4));
      const fl = require("../agriculture/crops");
      if (got <= 0 && !B.count("bone_meal") && !fl.composterOk()) {
        tried.field = (tried.field || 0) + 2;
        F.fieldStarved = true;
        B.log("ah food no composter", {
          field: !!F.field,
          planks: B.count("oak_planks"),
          next_try_s: Math.round(((F.composterNextTry || 0) - now()) / 1e3),
        });
      } else if (got <= 0 && !B.count("bone_meal")) {
        const mown = await mowCompost(until);
        if (mown < 0) tried.field = (tried.field || 0) + 1;
        if ((tried.field || 0) >= 2 && !B.count("bone_meal"))
          F.fieldStarved = true;
        else if (mown > 0) got = 0.5;
      }
    }
    F.srcMs[act] = (F.srcMs[act] || 0) + (now() - ta);

    B.log("ah food", {
      source:
        act === "crops"
          ? F.lastCropSrc || "crops"
          : act === "tend"
            ? "field"
            : act,
      got: Math.max(0, Math.round(got)),
      counts: foodCounts(),
      ms: now() - ta,
    });
    lastAct = act;
    if (got <= 0) idle++;
    else idle = 0;
    if (idle >= 8) {
      reason = "idle";
      break;
    }
    B.freeSlots() < 3 && (await B.dropJunk(6));
  }
  if (until() && Object.keys(missing(need)).length)
    reason = swHit ? "stopWhen" : "deadline";
  await hayToWheat();
  await safeSpot();
  const out = counts(need);
  lastResult = { reason, need, got: out, ms: now() - t0, rounds, src: F.src };
  let composter = "no field";
  try {
    if (F.field)
      composter = F.field.composter
        ? "field"
        : require("../agriculture/crops").composterOk()
          ? "village"
          : "none";
  } catch {}
  B.log("ah food gather end", {
    v: FOOD_VERSION,
    reason,
    composter,
    have: pickNeed(need),
    ms: now() - t0,
    rounds,
    src: F.src,
    srcMs: F.srcMs,
    mow: F.mowStat,
  });
  return out;
}

async function mowCompost(until) {
  const fl = require("../agriculture/crops");
  const items = Object.keys(fl.COMPOST);
  const center = F.field ? F.field.at : null;
  if (B.count("shears")) {
    let r = await sweep(GRASS, until, {
      src: "compost",
      items,
      center,
      radius: 56,
      findR: 48,
      tool: "shears",
      legs: 5,
      walkR: 2.4,
      stopR: 3.4,
      collectEvery: true,
    });
    if (r < 0)
      r = await mow([...LEAVES, "vine"], until, {
        src: "compost",
        items,
        max: 24,
        center,
        tool: "shears",
      });
    if (r >= 0) return r;
  }

  const near = find(fl.COMPOST_BLOCKS, 48, {
    point: center || B.pos(),
    dy: 8,
    count: 60,
  }).filter((p) => !isBad(p));
  if (near.length >= 4) {
    const r = await mow(fl.COMPOST_BLOCKS, until, {
      src: "compost",
      items,
      max: 28,
      center,
      far: false,
    });
    if (r > 0) return r;
  }
  const r = await sweep([...fl.COMPOST_BLOCKS, ...GRASS], until, {
    src: "compost",
    items,
    center,
    radius: 56,
    findR: 48,
    legs: 5,
    tool: B.count("shears") ? "shears" : null,
    walkR: 2.6,
    stopR: 3.6,
    collectEvery: true,
  });
  if (r >= 0) return r;

  return mow([...fl.COMPOST_BLOCKS, ...GRASS], until, {
    src: "compost",
    items,
    max: 28,
    center,
    tool: B.count("shears") ? "shears" : null,
  });
}

function fieldUseful(want) {
  if (!F.field) return false;
  const fl = require("../agriculture/crops");
  if (
    fl.fieldCrops().some((c) => CROP_GIVES[c.name][0].some((g) => want.has(g)))
  )
    return true;

  return (
    !F.field.village &&
    ((want.has("wheat") && B.count("wheat_seeds") > 0) ||
      (want.has("beetroot") && B.count("beetroot_seeds") > 0))
  );
}
const FOOD_ITEMS = [
  "wheat",
  "wheat_seeds",
  "beetroot_seeds",
  "carrot",
  "potato",
  "beetroot",
  "dandelion",
  "hay_block",
  "bone_meal",
];
function foodCounts() {
  const o = {};
  for (const it of FOOD_ITEMS) {
    const n = B.count(it);
    if (n) o[it] = n;
  }
  return o;
}

let statusTimer = null;
function startStatus() {
  if (statusTimer || process.env.AH_FOOD_STATUS === "0") return;
  statusTimer = setInterval(() => {
    try {
      if (!B.hasBot()) return;
      let field = null;
      if (F.field) {
        const fc = require("../agriculture/crops").fieldCrops();
        field = {
          crops: fc.length,
          ripe: fc.filter((c) => c.age >= CROP_MAX[c.name]).length,
          ages: fc.map((c) => c.name[0] + c.age).join(" "),
          water: !!F.field.water,
          composter: !!F.field.composter,
          dist: Math.round(B.hdist(F.field.at, B.pos())),
        };
      }
      B.log("ah food status", {
        v: FOOD_VERSION,
        counts: foodCounts(),
        field,
        tries: F.fieldTries || 0,
        src: F.src,
        srcMs: F.srcMs,
      });
    } catch {}
  }, 3e4);
  statusTimer.unref && statusTimer.unref();
}
function pickNeed(need) {
  const o = {};
  for (const k of Object.keys(need || {})) o[k] = groupCount(k);
  return o;
}
function near(p, r) {
  return p && B.hasBot() && B.hdist(p, B.pos()) <= r;
}

async function safeSpot() {
  try {
    const f = B.blockAt(B.feet());
    if (f && /water/.test(f.name)) await B.escape(2);
  } catch {}
}

const LOGS = [
  "oak_log",
  "birch_log",
  "spruce_log",
  "jungle_log",
  "acacia_log",
  "dark_oak_log",
  "mangrove_log",
  "cherry_log",
  "pale_oak_log",
];

function shearsAdvised() {
  if (!B.hasBot() || B.count("shears")) return { advised: false };
  const c = F.field ? F.field.at : B.pos();
  const compost = find(require("../agriculture/crops").COMPOST_BLOCKS, 48, {
    point: c,
    dy: 8,
    count: 200,
  }).length;
  const grass = find(GRASS, 48, { point: c, dy: 8, count: 400 }).length;
  const leaves = find(LEAVES, 32, { point: c, dy: 8, count: 400 }).length;
  return {
    advised: compost < 60 && grass + leaves >= 150,
    compost,
    grass,
    leaves,
  };
}
async function getShears(ctx, ms) {
  try {
    return await require("./metal").getShears(ctx, module.exports, ms);
  } catch (e) {
    B.log("ah food shears error", {
      err: String((e && e.stack) || e).slice(0, 400),
    });
    return false;
  }
}
async function startCrops(ctx) {
  startStatus();
  B.log("ah food startCrops", {
    v: FOOD_VERSION,
    tries: (F.fieldTries || 0) + 1,
    at: B.hasBot() ? B.feet() : null,
    maxMs: ctx && ctx.cropsMaxMs,
  });
  F.fieldTries = (F.fieldTries || 0) + 1;
  F.fieldNextTry = now() + 9e4;
  let f = null;
  try {
    f = await require("../agriculture/crops").startCrops(
      ctx || {},
      module.exports,
    );
  } catch (e) {
    B.log("ah food startCrops error", {
      err: String((e && e.stack) || e).slice(0, 400),
    });
  }
  if (!f)
    B.log("ah food startCrops null", {
      tries: F.fieldTries,
      why: F.fieldFail && F.fieldFail.why,
      retry_s: 90,
    });
  return f;
}
async function tendCrops(ctx, deadlineMs) {
  startStatus();

  const t = (ctx && (ctx.cropTargets || ctx.targets)) || {};
  if (
    !F.field &&
    ctx &&
    ctx.autoCrops !== false &&
    (t.sheep || t.cow) &&
    (F.fieldTries || 0) < 4 &&
    now() >= (F.fieldNextTry || 0) &&
    B.timeLeft() > 48e4
  )
    await startCrops({ ...ctx, targets: t, cropsMaxMs: 9e4 });
  try {
    return await require("../agriculture/crops").tendCrops(
      ctx,
      normDeadline(deadlineMs || 3e4),
      module.exports,
    );
  } catch (e) {
    B.log("ah food tendCrops error", {
      err: String((e && e.stack) || e).slice(0, 400),
    });
    return 0;
  }
}

module.exports = {
  VERSION: FOOD_VERSION,
  gather,
  getShears,
  shearsAdvised,
  startCrops,
  tendCrops,
  scan,
  village,
  explore,
  directionScores,
  outlook,
  occupied,
  setPen,
  keepOutOf,
  travelTo,
  mowCompost,
  sweep,
  LEAVES,
  nature,
  F,
  GROUPS,
  SEEDS,
  GRASS,
  FLOWERS,
  LOGS,
  CROP_MAX,
  CROP_SEED,
  groupCount,
  counts,
  missing,
  harvestCrops,
  takeHay,
  hayToWheat,
  mow,
  collect,
  craftN,
  digAt,
  work,
  ids,
  find,
  mayDig,
  age,
  isBad,
  markBad,
  inKeepOut,
  credit,
  snap,
  get lastResult() {
    return lastResult;
  },
};
