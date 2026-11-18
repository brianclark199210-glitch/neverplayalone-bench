"use strict";

const B = require("../runtime/connection");
const Route = require("../navigation/routes");
const Guard = require("../enclosure/protection");
const Flags = require("../planning/options");
const Schedule = require("./schedule");
const Planner = require("./planner");
const Strategy = require("./strategy");

const C2 = !!require("../planning/options").C2_PIG_FEASIBILITY;

const FOOD = {
  cow: ["wheat"],
  sheep: ["wheat"],
  pig: ["potato", "beetroot", "carrot"],
  chicken: [
    "wheat_seeds",
    "beetroot_seeds",
    "melon_seeds",
    "pumpkin_seeds",
    "torchflower_seeds",
    "pitcher_pod",
  ],
  rabbit: ["dandelion", "carrot", "golden_carrot"],
};
const SPECIES = Object.keys(FOOD);
const META_BABY = 16;
const STATUS_LOVE = 18;
const GROW_TICKS = 24000;
const COOLDOWN_MS = 302e3;

const H = {
  hooked: false,
  recs: new Map(),
  pending: [],
  stats: {
    feeds: {},
    babyFeeds: {},
    breeds: {},
    born: {},
    lures: 0,
    lureAdults: 0,
    escapes: 0,
    grown: {},
  },
  tps: { t0: 0, age0: 0, f: 1 },
  pen: null,
  vcenter: null,
  noLure: new Map(),
};

const now = () => B.now();

function spend(sp, what, ms) {
  H.time = H.time || {};
  const t = (H.time[sp] = H.time[sp] || {});
  t[what] = (t[what] || 0) + Math.max(0, ms);
}
const bot = () => B.S.bot;
const log = (m, d = {}) => B.log("ah " + m, d);
const r1 = (x) => Math.round(x * 10) / 10;
const P = (p) => (p ? { x: r1(p.x), y: r1(p.y), z: r1(p.z) } : null);

function ageOf(e) {
  const value = e && e.metadata && e.metadata[META_BABY];
  if (typeof value === "boolean") return value ? "baby" : "adult";
  if (typeof value === "number") return value < 0 ? "baby" : "adult";
  return "unknown";
}
function isBaby(e) {
  return ageOf(e) === "baby";
}
function isKnownAdult(e) {
  return ageOf(e) === "adult";
}
function valid(e) {
  return !!(
    e &&
    e.isValid !== false &&
    bot().entities[e.id] === e &&
    e.position
  );
}

function inside(pos) {
  if (!pos) return false;
  const p = H.pen;
  if (!p)
    return (
      !!H.vcenter &&
      B.hdist(pos, H.vcenter) <= 6 &&
      Math.abs(pos.y - H.vcenter.y) < 4
    );
  return (
    pos.x >= p.x + 1 &&
    pos.x < p.x + p.w + 1 &&
    pos.z >= p.z + 1 &&
    pos.z < p.z + p.d + 1 &&
    pos.y >= p.y - 0.5 &&
    pos.y < p.y + 16
  );
}

function margin(pos) {
  const p = H.pen;
  if (!p || !inside(pos)) return p ? 0 : 9;
  return Math.min(
    pos.x - (p.x + 1),
    p.x + p.w + 1 - pos.x,
    pos.z - (p.z + 1),
    p.z + p.d + 1 - pos.z,
  );
}
function center() {
  const p = H.pen;
  if (!p) return H.vcenter || B.pos();
  return new B.Vec3(p.x + 1 + p.w / 2, p.y, p.z + 1 + p.d / 2);
}
function gateGeom(g) {
  const p = H.pen;
  let ix = 0,
    iz = 0;
  if (g.x === p.x) ix = 1;
  else if (g.x === p.x + p.w + 1) ix = -1;
  else if (g.z === p.z) iz = 1;
  else iz = -1;
  const at = (k) => new B.Vec3(g.x + ix * k, g.y, g.z + iz * k);
  return { pos: new B.Vec3(g.x, g.y, g.z), ix, iz, at };
}
function gates() {
  return ((H.pen && H.pen.gates) || []).map(gateGeom);
}
function gateBlock(G) {
  const b = B.blockAt(G.pos);
  return b && /_fence_gate$/.test(b.name) ? b : null;
}
function gateOpen(G) {
  const b = gateBlock(G);
  if (!b) return null;
  try {
    return !!b.getProperties().open;
  } catch {
    return null;
  }
}
async function setGate(G, open) {
  if (open && gateOpen(G) === false && !(await Guard.beforeGate(G.pos, H.pen)))
    return (log("gate kept shut", { at: G.pos, why: "predator" }), false);
  for (let i = 0; i < 3; i++) {
    const st = gateOpen(G);
    if (st === null) return (log("gate missing", { at: G.pos }), false);
    if (st === open) return true;
    const b = gateBlock(G);
    try {
      await B.withTimeout(bot().activateBlock(b), 2500, "gate");
    } catch (e) {
      log("gate toggle failed", { at: G.pos, err: String(e).slice(0, 80) });
    }
    for (let k = 0; k < 10 && gateOpen(G) !== open; k++) await B.sleep(80);
  }
  const ok = gateOpen(G) === open;
  ok || log("gate stuck", { at: G.pos, want: open });
  return ok;
}
async function closeAllGates() {
  for (const G of gates())
    if (gateOpen(G)) (await approachGate(G), await setGate(G, false));
}
async function approachGate(G) {
  const me = B.pos();
  const side = inside(me) ? 3 : -2;
  if (me.distanceTo(G.pos.offset(0.5, 0.5, 0.5)) < 4) return;
  const c = G.at(side);
  await B.goto(new B.goals.GoalNear(c.x, c.y, c.z, 1), { timeoutMs: 15e3 });
}

async function walkStraight(to, maxMs = 5e3) {
  const b = bot(),
    t0 = now();
  let last = B.pos().clone(),
    lastT = now();
  try {
    b.pathfinder.setGoal(null);
  } catch {}
  try {
    while (now() - t0 < maxMs) {
      const me = B.pos();
      if (B.hdist(me, to) < 0.35) break;
      await b.lookAt(new B.Vec3(to.x, me.y + 1.6, to.z), true);
      b.setControlState("forward", true);
      b.setControlState("sprint", false);

      const dx = to.x - me.x,
        dz = to.z - me.z,
        dl = Math.hypot(dx, dz) || 1;
      const ahead = B.blockAt(
        new B.Vec3(
          me.x + (dx / dl) * 0.7,
          me.y + 0.2,
          me.z + (dz / dl) * 0.7,
        ).floored(),
      );
      const above = ahead && B.blockAt(ahead.position.offset(0, 1, 0));
      const step = !!(
        ahead &&
        ahead.boundingBox === "block" &&
        !/fence|wall|gate/.test(ahead.name) &&
        above &&
        above.boundingBox === "empty"
      );
      b.setControlState(
        "jump",
        step || (to.y > me.y + 0.4 && B.hdist(me, to) < 1.3),
      );
      await B.sleep(50);
      if (me.distanceTo(last) > 0.2) ((last = me.clone()), (lastT = now()));
      else if (now() - lastT > 1500) break;
    }
  } finally {
    b.clearControlStates();
  }
  return B.hdist(B.pos(), to) < 0.6;
}

function rec(e) {
  let r = H.recs.get(e.id);
  if (!r) {
    r = {
      id: e.id,
      uuid: e.uuid,
      sp: e.name,
      seen: now(),
      baby: isBaby(e),
      ours: false,
      starter: false,
      bredAt: 0,
      noBreedUntil: 0,
      feeds: 0,
      forced: 0,
    };
    H.recs.set(e.id, r);
    if (e.uuid) (H.byUuid = H.byUuid || new Map()).set(e.uuid, r);
  }
  return r;
}
function remTicks(r) {
  const el = ((now() - r.bornAt) / 50) * H.tps.f;
  return Math.max(0, GROW_TICKS - el - r.forced);
}
function feedsNeeded(r, leftMs, marginMs = 3e4) {
  let rem = remTicks(r),
    n = 0;
  const avail = ((leftMs - marginMs) / 50) * H.tps.f;
  while (rem > avail && n < 40) {
    const s = Math.floor(Math.floor(rem / 20) * 0.1);
    if (s <= 0) break;
    ((rem -= s * 20), n++);
  }
  return rem > avail ? 99 : n;
}
function feedsForNewBaby(leftMs, marginMs = 3e4, sp) {
  if (sp === "sheep" && leftMs > 3e5) return 0;

  if (Flags.S1_LAMB_GRAZE && sp === "sheep" && penGrass() >= 60) {
    const avail = leftMs / 1e3 - 45;
    return avail <= 20
      ? 99
      : Math.max(0, Math.ceil(Math.log(avail / 200) / Math.log(0.9)));
  }
  return feedsNeeded({ bornAt: now() + 6e3, forced: 0 }, leftMs, marginMs);
}

function penGrass() {
  const p = H.pen;
  if (!p) return 0;
  if (H.grassN != null && now() - (H.grassAt || 0) < 6e4) return H.grassN;
  let n = 0;
  for (let x = p.x + 1; x <= p.x + p.w; x++)
    for (let z = p.z + 1; z <= p.z + p.d; z++) {
      const b = B.blockAt(new B.Vec3(x, p.y - 1, z));
      if (b && b.name === "grass_block") n++;
    }
  if (H.grassN == null) log("pen grass", { n, cells: p.w * p.d });
  H.grassAt = now();
  return (H.grassN = n);
}
function hook() {
  const b = bot();
  if (!b || H.hookedBot === b) return;
  const first = !H.hookedBot;
  H.hookedBot = b;
  H.hooked = true;
  H.tps.t0 = now();
  H.tps.age0 = (b.time && b.time.age) || 0;
  if (!first) log("herd rehook", { recs: H.recs.size });
  b._client.on("entity_status", (p) => {
    if (p.entityStatus !== STATUS_LOVE) return;
    const e = b.entities[p.entityId];
    if (!e || !FOOD[e.name]) return;
    const r = rec(e);
    r.loveAt = now();
  });
  const checkNew = (e) => {
    if (!e || !FOOD[e.name]) return;
    const r = rec(e);
    r.baby = isBaby(e);
    if (!r.baby || r.ours || r.starter || r.classified) return;
    r.classified = true;
    if (H.pen && H.pen.starterIds && e.uuid && H.pen.starterIds.has(e.uuid))
      return (
        (r.starter = true),
        (r.bornAt = r.bornAt || H.regAt || now()),
        (r.forced = r.forced || 0)
      );

    const pend = H.pending.find(
      (q) =>
        q.sp === e.name &&
        now() - q.at < 2e4 &&
        !q.baby &&
        e.position.distanceTo(q.pos) < 6,
    );
    if (pend) {
      pend.baby = e.id;
      r.ours = true;
      r.bornAt = now();
      r.bornInside = inside(e.position);
      r.parents = [pend.a, pend.b];
      H.stats.born[e.name] = (H.stats.born[e.name] || 0) + 1;
      log("baby born", {
        sp: e.name,
        id: e.id,
        at: P(e.position),
        inside: r.bornInside,
        after_ms: now() - pend.at,
      });
    }
  };
  b.on("entitySpawn", (e) => {
    if (!e || !FOOD[e.name]) return;

    const old = e.uuid && H.byUuid && H.byUuid.get(e.uuid);
    if (old && old.id !== e.id)
      (H.recs.delete(old.id), (old.id = e.id), H.recs.set(e.id, old));
    rec(e).spawnAt = now();
    setTimeout(() => checkNew(b.entities[e.id]), 250);
  });
  b.on("entityUpdate", (e) => {
    if (!e || !FOOD[e.name]) return;
    const r = H.recs.get(e.id);
    if (!r) return;
    const bb = isBaby(e);
    if (r.baby && !bb && r.starter)
      log("starter adult", {
        sp: r.sp,
        id: r.id,
        inside: inside(e.position),
        feeds: r.feeds || 0,
        grass: r.grass || 0,
        age_s: Math.round((now() - (r.bornAt || now())) / 1e3),
        est_rem_s: Math.round(remTicks(r) / 20),
      });
    if (r.baby && !bb && r.ours) {
      H.stats.grown[r.sp] = (H.stats.grown[r.sp] || 0) + 1;
      log("offspring adult", {
        sp: r.sp,
        id: r.id,
        inside: inside(e.position),
        age_s: Math.round((now() - r.bornAt) / 1e3),
        feeds: r.feeds,
        est_rem_s: Math.round(remTicks(r) / 20),
      });
      r.adultAt = now();
    }
    r.baby = bb;
    if (bb && !r.classified && now() - (r.spawnAt || 0) < 2e3) checkNew(e);
  });
  b.on("entityEatingGrass", (e) => {
    const r = e && H.recs.get(e.id);
    if (r && (r.ours || r.starter) && r.baby)
      ((r.forced += 1200), (r.grass = (r.grass || 0) + 1));
  });
  b.on("entityGone", (e) => {
    const r = e && H.recs.get(e.id);
    if (r && r.ours)
      (log("offspring gone", {
        sp: r.sp,
        id: r.id,
        at: P(e.position),
        baby: r.baby,
        dist: r1(e.position.distanceTo(B.pos())),
      }),
        (r.gone = now()));
  });

  const nearby = (e) =>
    Object.values(b.entities)
      .filter(
        (x) =>
          x &&
          x !== e &&
          x.position &&
          e.position &&
          x.position.distanceTo(e.position) < 6,
      )
      .map(
        (x) => `${x.name || x.type}:${r1(x.position.distanceTo(e.position))}`,
      )
      .slice(0, 8);
  b.on("entityDead", (e) => {
    const r = e && H.recs.get(e.id);
    if (!r) return;
    r.dead = now();
    if (r.ours || (H.pen && e.position && !realOut(e.position)))
      log(r.ours ? "offspring died" : "pen animal died", {
        sp: r.sp,
        id: r.id,
        at: P(e.position),
        baby: isBaby(e),
        near: nearby(e),
        block: (B.blockAt(e.position.floored()) || {}).name,
      });
  });
  b.on("entityHurt", (e) => {
    if (!e || !FOOD[e.name] || !H.pen || !e.position || realOut(e.position))
      return;
    const r = H.recs.get(e.id);
    if (!r || now() - (r.hurtLog || 0) < 5e3) return;
    r.hurtLog = now();
    log("pen animal hurt", {
      sp: e.name,
      id: e.id,
      at: P(e.position),
      near: nearby(e),
      block: (B.blockAt(e.position.floored()) || {}).name,
    });
  });
  if (first)
    setInterval(() => {
      try {
        const bb = bot(),
          age = (bb && bb.time && bb.time.age) || 0,
          dt = (now() - H.tps.t0) / 50;
        if (dt > 400 && age > H.tps.age0)
          H.tps.f = Math.max(0.6, Math.min(1, (age - H.tps.age0) / dt));
      } catch {}
    }, 5e3).unref();
}

function animals(sp) {
  const out = [];
  for (const e of Object.values(bot().entities))
    if (e && e.name === sp && e.position && e !== bot().entity) out.push(e);
  return out;
}
function ours(sp) {
  return animals(sp).filter((e) => {
    const r = H.recs.get(e.id);
    return r && r.ours;
  });
}
function breedable(e) {
  if (!isKnownAdult(e)) return false;
  const r = rec(e);
  if (r.bredAt && now() - r.bredAt < COOLDOWN_MS) return false;
  if (r.noBreedUntil > now()) return false;

  if (
    r.adultAt &&
    r.lastFeedAt &&
    r.adultAt - r.lastFeedAt < 2e3 &&
    now() - r.adultAt < ((r.feedForced || 0) / 20) * 1e3
  )
    return false;
  return true;
}

function usable(sp) {
  const t = H.targets || {};

  if (C2 && t.pig && t.rabbit && H.pigPlan) {
    if (sp === "pig" && H.pigPlan.mode === "kit") return FOOD.pig;
    if (sp === "pig" && H.pigPlan.mode === "off")
      return FOOD.pig.filter((n) => n !== "carrot");
    if (sp === "rabbit" && H.pigPlan.mode === "kit")
      return FOOD.rabbit.filter((n) => n !== "carrot");
  }

  if (
    sp === "pig" &&
    t.rabbit &&
    B.timeLeft() > 3e5 &&
    planned("rabbit") < t.rabbit &&
    (planned("rabbit") > 0 ||
      animals("rabbit").some(
        (e) =>
          !isBaby(e) &&
          !realOut(e.position) &&
          !(H.recs.get(e.id) || {}).starter,
      ))
  )
    return FOOD.pig.filter((n) => n !== "carrot");
  return FOOD[sp];
}
function foodItems(sp) {
  return usable(sp).filter((n) => B.count(n) > 0);
}

function budgetLeft(sp) {
  const b = H.budget && H.budget[sp];
  return b === undefined || b === null
    ? Infinity
    : b - ((H.spent || {})[sp] || 0);
}
function foodCount(sp) {
  let n = usable(sp).reduce((a, x) => a + B.count(x), 0);
  const t = H.targets || {};
  if (sp === "cow" && t.sheep)
    n -= Math.max(0, 2 * (t.sheep - planned("sheep")));
  return Math.max(0, Math.min(n, budgetLeft(sp)));
}
function heldFood(sp) {
  const h = bot().heldItem;
  return !!h && FOOD[sp].includes(h.name);
}
async function holdFood(sp, strict, only) {
  if (strict && foodCount(sp) <= 0) return false;
  const h = bot().heldItem,
    list = only ? usable(sp).filter((n) => only.includes(n)) : usable(sp);
  if (h && list.includes(h.name)) return true;
  for (const n of list) if (B.count(n) > 0 && (await B.equip(n))) return true;
  if (only) return false;

  if (!strict)
    for (const n of FOOD[sp])
      if (B.count(n) > 0 && (await B.equip(n))) return true;

  const off = bot().inventory.slots[45];
  if (off && FOOD[sp].includes(off.name)) {
    await clearOffhand();
    for (const n of usable(sp))
      if (B.count(n) > 0 && (await B.equip(n))) return true;
  }
  return false;
}

async function holdOffhand(sp2) {
  const b = bot(),
    off = b.inventory.slots[45];
  if (off && FOOD[sp2].includes(off.name)) return true;
  for (const n of FOOD[sp2]) {
    const it = b.inventory.items().find((i) => i.name === n);
    if (!it) continue;
    try {
      await B.withTimeout(b.equip(it, "off-hand"), 3e3, "offhand");
      return true;
    } catch {}
  }
  return false;
}
async function clearOffhand() {
  const b = bot(),
    off = b.inventory.slots[45];
  if (!off || !SPECIES.some((s) => FOOD[s].includes(off.name))) return;
  try {
    await B.withTimeout(b.unequip("off-hand"), 3e3, "unoff");
  } catch {}
}
async function holdNoFood() {
  await clearOffhand();
  const h = bot().heldItem;
  if (!h) return;
  if (!SPECIES.some((s) => FOOD[s].includes(h.name))) return;
  for (const n of ["oak_fence", "oak_fence_gate", "dirt", "cobblestone"])
    if (B.count(n) > 0 && (await B.equip(n))) return;
  await B.unequip();
}

let FOODMOD;
try {
  FOODMOD = require("../resources/supply");
} catch {
  FOODMOD = null;
}

async function getFood(ctx, sp, n, untilMs) {
  const t0g = now(),
    c0 = rawFood(sp),
    tool0 = (FOODMOD && FOODMOD.F && FOODMOD.F.toolMs) || 0;
  if ((H.stopFood || {})[sp]) return foodCount(sp);

  if (C2 && sp === "pig" && pigIdle()) return foodCount(sp);
  try {
    return await getFood0(ctx, sp, n, untilMs);
  } finally {
    const ms = now() - t0g;
    spend(sp, "food", ms);

    const toolMs = Math.max(
      0,
      ((FOODMOD && FOODMOD.F && FOODMOD.F.toolMs) || 0) - tool0,
    );

    H.gath = H.gath || {};
    const g = (H.gath[sp] = H.gath[sp] || { ms: 0, got: 0 });
    g.ms += Math.max(0, ms - toolMs);
    g.got += Math.max(0, rawFood(sp) - c0);

    const keepSheep =
      (sp === "sheep" || sp === "cow") &&
      !!(FOODMOD && FOODMOD.F && FOODMOD.F.field);
    if (
      g.ms >= 1.2e5 &&
      g.got / (g.ms / 6e4) < 1 &&
      !(H.stopFood || {})[sp] &&
      !keepSheep
    ) {
      (H.stopFood = H.stopFood || {})[sp] = true;
      H.foodWait = H.foodWait || {};
      H.foodWait[sp] = Infinity;
      log("plan", {
        species: sp,
        decision: "stop gathering",
        why: "< 1 item per minute over the run",
        got: g.got,
        s: Math.round(g.ms / 1e3),
      });
    }
  }
}
function end0() {
  return now() + Math.max(0, B.timeLeft() - 6e4);
}
function rawFood(sp) {
  return FOOD[sp].reduce((a, x) => a + B.count(x), 0);
}

function readyToBreed() {
  const out = [];
  try {
    const left = B.timeLeft(),
      T = H.targets || {};
    for (const x of Object.keys(T)) {
      if (planned(x) >= T[x]) continue;
      const nb = feedsForNewBaby(left, 3e4, x);
      if (nb >= 99 || foodCount(x) < 2 + nb) continue;
      if (
        animals(x).filter(
          (e) =>
            inside(e.position) && margin(e.position) >= 1.2 && breedable(e),
        ).length >= 2
      )
        out.push(x);
    }
  } catch {}
  return out;
}
async function getFood0(ctx, sp, n, untilMs) {
  const have = foodCount(sp);
  if (have >= n) return have;
  H.foodWait = H.foodWait || {};
  if ((H.foodWait[sp] || 0) > now()) return have;
  if (!(FOODMOD && FOODMOD.gather) && sp !== "chicken" && sp !== "rabbit")
    return ((H.foodWait[sp] = now() + 6e4), have);
  const t0 = now();

  if (sp === "chicken" && H.pen && inside(B.pos()) && (H.penDry || 0) < 2) {
    const t1 = now(),
      c1 = rawFood(sp),
      stop = Math.min(untilMs, now() + 6e4);
    if (FOODMOD && FOODMOD.sweep) {
      let r = -1;
      try {
        r = await FOODMOD.sweep(
          FOODMOD.GRASS || ["short_grass", "tall_grass", "fern", "large_fern"],
          () => now() > stop || foodCount(sp) >= n,
          {
            center: center(),
            radius: 10.4,
            items: FOODMOD.SEEDS,
            src: "grass",
            legs: 14,
            collectEvery: true,
          },
        );
      } catch (e) {
        log("pen sweep error", { err: String(e).slice(0, 120) });
      }
      log("pen sweep", {
        got: rawFood(sp) - c1,
        ms: now() - t1,
        found: r !== -1,
      });

      if (rawFood(sp) - c1 < 2) H.penDry = (H.penDry || 0) + 1;
    } else
      await breakForDrops(
        ["short_grass", "tall_grass", "fern", "large_fern"],
        "wheat_seeds",
        n - have,
        Math.min(untilMs, now() + 4e4),
      );
    spend(sp, "food_pen", now() - t1);
  }
  if (foodCount(sp) >= n) return foodCount(sp);
  if (FOODMOD && FOODMOD.gather) {
    const need = {};
    need[sp] = n;

    const gctx =
      sp === "cow" || sp === "sheep"
        ? { ...ctx, targets: { [sp]: n }, keepTargets: H.targets }
        : { ...ctx, autoCrops: false };

    if (H.pen && inside(B.pos()) && (sp === "chicken" || sp === "rabbit"))
      await goOut(B.pos());
    if (H.pen && inside(B.pos())) {
      try {
        await FOODMOD.gather(gctx, need, now() + 2500);
      } catch {}
      const why0 = FOODMOD.lastResult ? FOODMOD.lastResult.reason : null;
      if (why0 === "no source" || foodCount(sp) >= n) {
        H.foodWait[sp] = now() + (foodCount(sp) > have ? 3e4 : 1.5e5);
        log("food", {
          sp,
          want: n,
          had: have,
          now: foodCount(sp),
          ms: now() - t0,
          why: why0,
          probe: true,
          counts: { [sp]: foodCount(sp) },
          source: "food.js",
        });
        return foodCount(sp);
      }
      await goOut(B.pos());
    }
    const t2 = now(),
      c2 = rawFood(sp);

    try {
      const nd = needs();
      if (nd[sp] && nd[sp].food > n) need[sp] = Math.min(nd[sp].food, n + 40);
      if (!H.soloFood)
        for (const x of Object.keys(nd))
          if (
            x !== sp &&
            x !== "rabbit" &&
            !(H.stopFood || {})[x] &&
            nd[x].food > nd[x].have
          )
            need[x] = nd[x].food;
    } catch {}
    if (process.env.AH_BREEDSTOP !== "0" && H.pen && !H.soloFood) {
      const r0 = new Set(readyToBreed());
      gctx.stopWhen = () => {
        const r = readyToBreed().filter((x) => !r0.has(x));
        if (r.length)
          log("plan", {
            decision: "stop gather: pair ready",
            sp,
            ready: r,
            food: Object.fromEntries(r.map((x) => [x, foodCount(x)])),
          });
        return r.length > 0;
      };
    }
    try {
      await FOODMOD.gather(
        gctx,
        need,
        Math.min(end0(), H.hardFood ? untilMs : Math.max(untilMs, now() + 9e4)),
      );
    } catch (e) {
      log("food gather error", { err: String(e).slice(0, 160) });
    }
    spend(sp, "food_out", now() - t2);
    log("food out", { sp, got: rawFood(sp) - c2, ms: now() - t2 });
  } else if (sp === "chicken")
    await breakForDrops(
      ["short_grass", "tall_grass", "fern", "large_fern"],
      "wheat_seeds",
      n - have,
      untilMs,
    );
  else if (sp === "rabbit")
    await breakForDrops(["dandelion"], "dandelion", n - have, untilMs);
  const got = foodCount(sp);

  const ms = now() - t0;
  const cut = !!(
    FOODMOD &&
    FOODMOD.lastResult &&
    FOODMOD.lastResult.reason === "stopWhen"
  );
  if (ms > 2e4 && !cut) {
    H.poorYield = H.poorYield || {};
    if ((got - have) / (ms / 6e4) < 1)
      H.poorYield[sp] = (H.poorYield[sp] || 0) + 1;

    const fieldWheat =
      (sp === "sheep" || sp === "cow") &&
      !!(FOODMOD && FOODMOD.F && FOODMOD.F.field) &&
      B.timeLeft() > 1.5e5;
    if (H.poorYield[sp] >= 2 && fieldWheat) {
      H.foodWait[sp] = now() + 3e4;
      log("plan", {
        species: sp,
        decision: "pause gathering",
        why: "< 1 item per 60 s twice (field kept)",
        got: got - have,
        ms,
      });
    } else if (H.poorYield[sp] >= 2) {
      H.foodWait[sp] = Infinity;
      log("plan", {
        species: sp,
        decision: "stop gathering",
        why: "< 1 item per 60 s twice",
        got: got - have,
        ms,
      });
    }
  }

  const why = FOODMOD && FOODMOD.lastResult ? FOODMOD.lastResult.reason : null;
  if (got <= have && !cut)
    H.foodWait[sp] =
      now() + (why === "no source" && sp !== "chicken" ? 1.5e5 : 3e4);
  log("food", {
    sp,
    want: n,
    had: have,
    now: got,
    ms: now() - t0,
    why,
    counts: { [sp]: got },
    source:
      FOODMOD && FOODMOD.gather
        ? "food.js"
        : sp === "chicken"
          ? "grass"
          : "dandelion",
  });
  return got;
}

async function breakForDrops(names, item, want, untilMs) {
  const b = bot(),
    ids = names
      .map((n) => b.registry.blocksByName[n] && b.registry.blocksByName[n].id)
      .filter((x) => x !== undefined),
    start = B.count(item),
    wasIn = inside(B.pos()),
    bad = new Set();
  let broken = 0;
  while (now() < untilMs && B.count(item) - start < want) {
    const blocks = b
      .findBlocks({ matching: ids, maxDistance: 24, count: 60 })
      .filter(
        (p) =>
          !bad.has(B.key(p)) &&
          (!H.pen || inside(p.offset(0.5, 0, 0.5)) === wasIn),
      );
    if (!blocks.length) break;
    const me = B.pos();
    blocks.sort((p, q) => p.distanceTo(me) - q.distanceTo(me));
    const p = blocks[0],
      blk = B.blockAt(p);
    bad.add(B.key(p));
    if (!blk) continue;
    if (B.reachOf(p) > 4.2) {
      const ok = await B.approach(p, {
        reach: 4,
        timeoutMs: 8e3,
        noEscalate: true,
      });
      if (!ok) continue;
    }
    if (await B.dig(B.blockAt(p), { hand: true, maxMs: 1500 })) broken++;
    await B.collectItems(B.pos(), 6, new Set([item]), 2500, { quick: true });
  }
  await B.collectItems(B.pos(), 8, new Set([item]), 3000, { quick: true });
  log("forage drops", { item, got: B.count(item) - start, broken, want });
}

async function feed(e, sp, why, only) {
  const t0f = now();
  try {
    return await feed0(e, sp, why, only);
  } finally {
    spend(
      sp,
      why === "starter" ? "starter" : why === "breed" ? "breed" : "feed",
      now() - t0f,
    );
  }
}
async function feed0(e, sp, why, only) {
  if (!valid(e)) return false;
  if (!(await holdFood(sp, true, only))) return false;
  const b = bot();
  for (let att = 0; att < 4 && valid(e); att++) {
    const eye = B.eye();
    if (e.position.distanceTo(eye) > 2.6) {
      await B.goto(new B.goals.GoalFollow(e, 1.2), {
        timeoutMs: 6e3,
        stuckMs: 2500,
        dynamic: true,
        until: () => valid(e) && e.position.distanceTo(B.eye()) <= 2.4,
      });
      if (!valid(e)) break;
      if (e.position.distanceTo(B.eye()) > 3.4) continue;
    }
    if (!(await holdFood(sp, true, only))) return false;
    const item = b.heldItem.name,
      before = B.count(item),
      love0 = rec(e).loveAt || 0;
    try {
      await b.activateEntity(e);
    } catch (err) {
      log("activate failed", { err: String(err).slice(0, 80) });
    }
    let used = false;
    for (let k = 0; k < 12 && !used; k++)
      (await B.sleep(60), (used = B.count(item) < before));
    if (used) {
      const r = rec(e),
        love = (r.loveAt || 0) > love0;
      H.stats.feeds[sp] = (H.stats.feeds[sp] || 0) + 1;
      H.spent = H.spent || {};
      H.spent[sp] = (H.spent[sp] || 0) + 1;
      log("feed", {
        species: sp,
        id: e.id,
        item,
        baby: isBaby(e),
        why,
        starter: !!r.starter,
        ours: !!r.ours,
        love,
      });
      return { item, love, dist: r1(e.position.distanceTo(B.eye())) };
    }
    if (!isBaby(e)) {
      log("feed refused", {
        sp,
        id: e.id,
        why,
        dist: r1(e.position.distanceTo(B.eye())),
        att,
      });
      if (att >= 1) return ((rec(e).noBreedUntil = now() + 6e4), false);
    }
  }
  return false;
}

async function pairUp(a, b, sp) {
  if (process.env.AH_PAIR === "0" || !valid(a) || !valid(b)) return;
  const d0 = a.position.distanceTo(b.position);
  if (d0 <= 6) return;
  const t0 = now(),
    me0 = B.pos();
  const [near, far] =
    a.position.distanceTo(me0) <= b.position.distanceTo(me0) ? [a, b] : [b, a];
  if (!(await holdFood(sp, true))) return;
  let steps = 0,
    why = "timeout";
  B.setMovements({ sprint: false, canDig: false, maxDropDown: 1 });
  try {
    if (far.position.distanceTo(B.pos()) > 4)
      await B.goto(
        new B.goals.GoalNear(
          far.position.x,
          far.position.y,
          far.position.z,
          2.5,
        ),
        { timeoutMs: 8e3, stuckMs: 2500 },
      );
    let waitT = 0;
    while (now() - t0 < 1.5e4) {
      if (!valid(a) || !valid(b)) {
        why = "invalid";
        break;
      }

      if (a.position.distanceTo(b.position) <= 5) {
        why = "ok";
        break;
      }
      if (!inside(a.position) || !inside(b.position)) {
        why = "outside";
        break;
      }
      const df = far.position.distanceTo(B.pos());
      if (df > 9) {
        why = "lost";
        break;
      }
      if (df > 4) {
        try {
          bot().pathfinder.setGoal(null);
        } catch {}
        bot().clearControlStates();
        if (!waitT) waitT = now();
        if (now() - waitT > 6e3) {
          why = "stalled";
          break;
        }
        await B.sleep(250);
        continue;
      }
      waitT = 0;
      steps++;
      const t = near.position,
        tg = now();
      await B.goto(new B.goals.GoalNear(t.x, t.y, t.z, 1.5), {
        timeoutMs: 4e3,
        stuckMs: 2e3,
        until: () =>
          !valid(far) ||
          !valid(a) ||
          !valid(b) ||
          far.position.distanceTo(B.pos()) > 5 ||
          a.position.distanceTo(b.position) <= 5,
      });
      if (now() - tg < 300) await B.sleep(400);
    }
  } finally {
    try {
      bot().pathfinder.setGoal(null);
    } catch {}
    bot().clearControlStates();
    B.setMovements({});
  }
  log("pair up", {
    sp,
    a: a.id,
    b: b.id,
    why,
    d0: r1(d0),
    d1: valid(a) && valid(b) ? r1(a.position.distanceTo(b.position)) : null,
    steps,
    ms: now() - t0,
  });
}

async function breedPair(a, b, sp) {
  const ra = rec(a),
    rb = rec(b);
  if (!inside(a.position) || !inside(b.position))
    return (log("breed skip: parent outside", { sp, a: a.id, b: b.id }), false);
  await pairUp(a, b, sp);
  if (!valid(a) || !valid(b) || !inside(a.position) || !inside(b.position))
    return (log("breed skip: parent moved", { sp, a: a.id, b: b.id }), false);
  const fa = await feed(a, sp, "breed");
  if (!fa) return false;
  ra.bredAt = now();
  if (!valid(b) || !inside(b.position))
    log("breed: partner left the pen", {
      sp,
      b: b.id,
      at: valid(b) ? P(b.position) : null,
    });
  const fb = await feed(b, sp, "breed");
  if (!fb) {
    log("breed half", { sp, a: a.id, b: b.id });
    return false;
  }
  rb.bredAt = now();
  const pend = { sp, a: a.id, b: b.id, at: now(), pos: a.position.clone() };
  H.pending.push(pend);
  H.stats.breeds[sp] = (H.stats.breeds[sp] || 0) + 1;
  B.log("ah bred", {
    species: sp,
    ids: [a.id, b.id],
    starters: [!!ra.starter, !!rb.starter],
    sp,
    a: a.id,
    b: b.id,
    in_a: inside(a.position),
    in_b: inside(b.position),
    love: [fa.love, fb.love],
    items: [fa.item, fb.item],
    dist_ab: r1(a.position.distanceTo(b.position)),
    food_left: foodCount(sp),
    left_s: Math.round(B.timeLeft() / 1e3),
  });
  return pend;
}

async function waitBabies(pends, maxMs = 9e3) {
  const t0 = now();
  while (now() - t0 < maxMs && pends.some((q) => !q.baby)) {
    for (const q of pends)
      if (!q.baby && valid(bot().entities[q.a]))
        q.pos = bot().entities[q.a].position.clone();
    await B.sleep(200);
  }
  for (const q of pends)
    q.baby || log("no baby", { sp: q.sp, a: q.a, b: q.b, ms: now() - q.at });
}

async function feedBabies(ctx, onlySp) {
  let given = 0;
  for (const sp of Object.keys(H.targets)) {
    if (onlySp && sp !== onlySp) continue;
    const left = B.timeLeft();
    const babies = ours(sp).filter((e) => isBaby(e) && !realOut(e.position));
    const needs = [];
    for (const e of babies) {
      const r = rec(e);
      if (sp === "sheep" && r.bornAt && now() - r.bornAt < 1.5e5 && left > 2.4e5)
        continue;
      const need = feedsNeeded(r, left);
      const rem_s = Math.round((r.bornAt ? remTicks(r) : GROW_TICKS) / 20);
      if (need <= 0) {
        if (now() - (r.spareLog || 0) > 6e4)
          ((r.spareLog = now()),
            log("spare food", {
              sp,
              id: e.id,
              rem_s,
              why: "grows before the deadline",
            }));
        continue;
      }
      if (need >= 99) continue;
      needs.push({ id: e.id, feeds: need, e, r, rem_s });
    }
    const missing = Math.max(0, (H.targets[sp] || 0) - planned(sp));
    const nb = feedsForNewBaby(left, 3e4, sp);
    const breeders = animals(sp).filter(
      (e) => !realOut(e.position) && breedable(e),
    ).length;
    const breedCost = missing > 0 && breeders >= 2 && nb < 99 ? 2 + nb : 0;
    const alloc = Strategy.allocate(
      needs.map((row) => ({ id: row.id, feeds: row.feeds })),
      foodCount(sp),
      breedCost,
    );
    if (alloc.reserved && now() - (H.reserveLog || 0) > 3e4)
      ((H.reserveLog = now()),
        log("reserve food", {
          sp,
          reserved: alloc.reserved,
          food: foodCount(sp),
          for: "breeding",
        }));
    const byId = new Map(needs.map((row) => [row.id, row]));
    for (const grant of alloc.grant) {
      const row = byId.get(grant.id);
      if (!row || !valid(row.e)) continue;
      if (foodCount(sp) > alloc.reserved && !inside(B.pos()) && !(await goIn()))
        return given;
      let n = 0;
      while (
        n < grant.n &&
        foodCount(sp) > alloc.reserved &&
        feedsNeeded(row.r, B.timeLeft()) > 0
      ) {
        const fed = await feed(row.e, sp, "grow");
        if (!fed) break;
        const saved = Math.floor(Math.floor(remTicks(row.r) / 20) * 0.1);
        row.r.forced += saved * 20;
        row.r.feedForced = (row.r.feedForced || 0) + saved * 20;
        row.r.lastFeedAt = now();
        row.r.feeds++;
        n++;
        given++;
        H.stats.babyFeeds[sp] = (H.stats.babyFeeds[sp] || 0) + 1;
      }
      if (n)
        log("growth", {
          sp,
          id: row.e.id,
          fed: n,
          need: grant.n,
          rem_s: Math.round(remTicks(row.r) / 20),
          natural: feedsNeeded(row.r, B.timeLeft()) <= 0,
          food_left: foodCount(sp),
        });
      else if (foodCount(sp) < grant.n && now() - (row.r.shortLog || 0) > 3e4)
        ((row.r.shortLog = now()),
          log("baby food short", {
            sp,
            id: row.e.id,
            need: grant.n,
            have: foodCount(sp),
          }));
    }
  }
  return given;
}

const LURE_D = 110;
function wildAdults(sp, maxD) {
  const c = center();
  return animals(sp).filter((e) => {
    if (isBaby(e) || (H.pen ? !realOut(e.position) : inside(e.position)))
      return false;
    const r = rec(e);

    if (r.ours || (r.starter && !Flags.R4_STARTER_RELURE)) return false;
    if ((H.noLure.get(e.id) || 0) > now()) return false;
    return B.hdist(e.position, c) <= maxD && Math.abs(e.position.y - c.y) < 28;
  });
}

function noteSightings() {
  if (now() - (H.seenAt || 0) < 2e3) return;
  H.seenAt = now();
  H.seen = H.seen || new Map();
  H.foundLog = H.foundLog || {};
  for (const sp of Object.keys(H.targets || {})) {
    const w = wildAdults(sp, 400);
    for (const e of w)
      H.seen.set(e.id, { sp, pos: e.position.clone(), t: now() });
    const f = H.foundLog[sp] || { n: 0, t: 0 };
    if (w.length && (w.length > f.n || now() - f.t > 1.2e5)) {
      const ds = w
        .map((e) => Math.round(B.hdist(e.position, center())))
        .sort((a, b) => a - b);
      H.foundLog[sp] = { n: Math.max(f.n, w.length), t: now() };
      log("found", {
        species: sp,
        n: w.length,
        dist: ds[0],
        dists: ds.slice(0, 8),
        seen_total: [...H.seen.values()].filter((v) => v.sp === sp).length,
      });
    }
  }
}
function pickGroup(sp, maxD) {
  const c = center(),
    me = B.pos(),
    cand = wildAdults(sp, maxD);
  let best = null;
  for (const e of cand) {
    const near = cand.filter((x) => x.position.distanceTo(e.position) <= 7);
    const d =
      B.hdist(e.position, me) +
      B.hdist(e.position, c) +
      Math.abs(e.position.y - c.y) * 3;
    const score = Math.min(near.length, 4) / (d + 25);
    if (!best || score > best.score)
      best = { e, near, score, d: Math.round(d) };
  }
  return best;
}

function scoutPoint(sp) {
  const c = center(),
    me = B.pos();
  H.visited = H.visited || [];
  let best = null;
  for (const [id, v] of H.seen || []) {
    if (v.sp !== sp || now() - v.t > 6e5 || (H.noLure.get(id) || 0) > now())
      continue;
    if (bot().entities[id]) continue;
    if (H.visited.some((q) => B.hdist(q, v.pos) < 12)) continue;
    const d = B.hdist(v.pos, me) + B.hdist(v.pos, c);
    if (B.hdist(v.pos, c) > 170) continue;
    if (!best || d < best.d) best = { pos: v.pos, d, why: "seen" };
  }
  if (best) return best;

  H.ringMs = H.ringMs || {};
  if ((H.ringMs[sp] || 0) > 1.2e5) return null;
  for (const r of [100, 140])
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + (r === 140 ? Math.PI / 8 : 0);
      const p = new B.Vec3(c.x + r * Math.cos(a), c.y, c.z + r * Math.sin(a));
      if (H.visited.some((q) => B.hdist(q, p) < 30)) continue;
      const d = B.hdist(p, me) + r;
      if (!best || d < best.d) best = { pos: p, d, why: "ring" + r };
    }
  return best;
}
async function forageAlong(sp, untilMs) {
  if (!FOODMOD || !FOODMOD.gather || !B.hasBot()) return;
  if (now() - (H.forageAt || 0) < 2e4) return;
  if (now() > untilMs - 3e3) return;
  const nb = feedsForNewBaby(B.timeLeft(), 3e4, sp);
  const want = nb >= 99 ? 4 : Math.min(16, Math.max(4, 2 + Math.max(0, nb)));
  if (foodCount(sp) >= want) return;
  H.forageAt = now();
  const before = foodCount(sp);
  const end = Math.min(untilMs - 1e3, now() + 8e3);
  const prevHome = FOODMOD.F && FOODMOD.F.home;
  const prevDist = FOODMOD.F && FOODMOD.F.maxDist;
  try {
    await FOODMOD.gather(
      {
        autoCrops: false,
        home: B.feet(),
        maxDist: 28,
        stopWhen: () => now() >= end,
      },
      { [sp]: want },
      end,
    );
  } catch (e) {
    log("forage failed", { sp, err: String(e).slice(0, 120) });
  } finally {
    if (FOODMOD.F) {
      FOODMOD.F.home = prevHome;
      FOODMOD.F.maxDist = prevDist;
    }
  }
  const got = foodCount(sp) - before;
  if (got > 0)
    log("forage", { sp, got, food: foodCount(sp), while: "searching" });
}

async function scout(sp, untilMs) {
  const pt = scoutPoint(sp);
  if (!pt) return false;
  const t0 = now();
  log("scout", {
    sp,
    to: P(pt.pos),
    why: pt.why,
    left_s: Math.round(B.timeLeft() / 1e3),
  });
  if (!(await goOut(pt.pos))) return false;
  await forageAlong(sp, untilMs);
  await holdFood(sp);
  B.setMovements({ sprint: true, maxDropDown: 2 });
  try {
    await B.goto(
      pt.why === "seen"
        ? new B.goals.GoalNear(pt.pos.x, pt.pos.y, pt.pos.z, 8)
        : new B.goals.GoalNearXZ(pt.pos.x, pt.pos.z, 8),
      {
        timeoutMs: Math.max(5e3, Math.min(5e4, untilMs - now())),
        stuckMs: 5e3,
        until: () => wildAdults(sp, LURE_D + 40).length > 0,
      },
    );
  } catch {}
  B.setMovements({});
  if (pt.why !== "seen")
    ((H.ringMs = H.ringMs || {}),
      (H.ringMs[sp] = (H.ringMs[sp] || 0) + (now() - t0)));
  H.visited.push(pt.pos.clone(), B.pos().clone());
  const n = wildAdults(sp, LURE_D + 40).length;
  log("scout done", { sp, found: n, ms: now() - t0, at: P(B.pos()) });
  return n > 0;
}

async function lead(sp, group, dest, maxMs) {
  const t0 = now();
  let keep = group.slice(),
    legs = 0,
    waits = 0,
    rehooks = 0,
    waitT = 0,
    snap = null,
    lastLog = 0;
  const dist = (e) => e.position.distanceTo(B.pos());

  const dc =
    Number.isInteger(dest.x) && Number.isInteger(dest.z)
      ? dest.offset(0.5, 0, 0.5)
      : dest;
  let reached = 0,
    bestD = B.hdist(B.pos(), dc),
    bestT = now();

  const rt = {
    plan: null,
    i: 0,
    replans: 0,
    fails: 0,
    edge: 0,
    len: 0,
    legFails: 0,
    min: 0,
    j: 0,
    instant: 0,
  };
  const replan = async () => {
    const r = await Route.plan(B.feet(), dest.floored ? dest.floored() : dest);
    rt.plan = r.ok ? r.path : null;
    rt.i = rt.min = 0;
    if (r.ok) ((rt.edge = r.edge), (rt.len = r.len));
    else rt.fails++;
    log("route", {
      sp,
      ok: r.ok,
      why: r.why,
      len: r.len,
      edge: r.edge,
      cost: r.cost,
      ms: r.ms,
      exp: r.exp,
      from: P(B.pos()),
      replans: rt.replans,
    });
  };
  B.setMovements({ sprint: false, canDig: false, maxDropDown: 2 });
  try {
    await replan();
    while (now() - t0 < maxMs) {
      if (!heldFood(sp) && !(await holdFood(sp)))
        return { ok: false, why: "nofood", keep, legs, waits, rehooks, rt };
      keep = keep.filter((e) => valid(e) && dist(e) <= 12);
      if (!keep.length)
        return { ok: false, why: "lost", keep, legs, waits, rehooks, rt };
      const me = B.pos();
      if (now() - lastLog > 1e4)
        ((lastLog = now()),
          log("lead", {
            sp,
            me: P(me),
            to_dest: r1(B.hdist(me, dc)),
            d: keep.map((e) => r1(dist(e))),
            dy: keep.map((e) => r1(e.position.y - me.y)),
            legs,
            waits,
            rehooks,
          }));
      if (
        (B.hdist(me, dc) < 1.3 && Math.abs(me.y - dest.y) < 1.5) ||
        reached >= 3
      )
        return { ok: true, keep, legs, waits, rehooks, rt };

      const dNow = B.hdist(me, dc);
      if (dNow < bestD - 3) ((bestD = dNow), (bestT = now()));
      else if (now() - bestT > 3e4)
        return {
          ok: false,
          why: "no progress",
          keep,
          legs,
          waits,
          rehooks,
          rt,
        };
      const far = Math.max(...keep.map(dist));
      if (far > 4.5) {
        try {
          bot().pathfinder.setGoal(null);
        } catch {}
        bot().clearControlStates();
        if (!waitT)
          ((waitT = now()), (snap = new Map(keep.map((e) => [e.id, dist(e)]))));
        waits++;
        await B.sleep(250);
        if (now() - waitT > 5e3) {
          const stalled = keep.filter(
            (e) => dist(e) > 4.5 && dist(e) > (snap.get(e.id) || 99) - 1,
          );
          if (stalled.length && stalled.length === keep.length) {
            if (++rehooks > 4)
              return {
                ok: false,
                why: "stalled",
                keep,
                legs,
                waits,
                rehooks,
                rt,
              };
            const t = stalled.reduce((a, e) => (dist(e) < dist(a) ? e : a));
            await B.goto(
              new B.goals.GoalNear(t.position.x, t.position.y, t.position.z, 2),
              { timeoutMs: 8e3, stuckMs: 2500 },
            );
            await B.sleep(1200);
          } else if (stalled.length)
            keep = keep.filter((e) => !stalled.includes(e));
          waitT = 0;
        }
        continue;
      }
      waitT = 0;
      legs++;
      let tgt = dest,
        last = true;
      if (rt.plan) {
        const n = Route.nearest(rt.plan, B.pos(), rt.i);
        n.i = Math.max(n.i, rt.min);
        if (n.d > 3.5 && rt.replans < 5) {
          rt.replans++;
          await replan();
          continue;
        }
        if (n.d > 3.5) rt.plan = null;
        else {
          rt.i = n.i;

          let j = Math.min(n.i + 4, rt.plan.length - 1);
          for (let k = n.i + 1; k < j; k++)
            if (rt.plan[k].y !== rt.plan[n.i].y) {
              j = k;
              break;
            }
          tgt = rt.plan[j];
          rt.j = j;
          last = j === rt.plan.length - 1;
        }
      }

      const tl = now();
      const r = await B.goto(
        new B.goals.GoalNear(tgt.x, tgt.y, tgt.z, last ? 1 : 0.3),
        {
          timeoutMs: last ? 2e4 : 8e3,
          stuckMs: last ? 4e3 : 3e3,
          until: () => keep.some((e) => valid(e) && dist(e) > 5.5),
        },
      );

      if (rt.plan && !last && r === "reached" && now() - tl < 250) {
        rt.min = rt.j;
        if (++rt.instant > 6)
          ((rt.plan = null),
            log("route dropped", { sp, at: P(B.pos()), r: "instant" }));
      }
      if (r === "reached" && B.hdist(B.pos(), dc) < 2.2) reached++;
      if (r === "noPath" || r === "stuck" || r === "error") {
        if (legs > 40)
          return { ok: false, why: r, keep, legs, waits, rehooks, rt };

        if (rt.plan && !last && ++rt.legFails >= 2)
          ((rt.plan = null), log("route dropped", { sp, at: P(B.pos()), r }));
        await B.sleep(300);
      } else rt.legFails = 0;
    }
    return { ok: false, why: "timeout", keep, legs, waits, rehooks, rt };
  } finally {
    B.setMovements({});
  }
}

function standCell(c, dys = [0, 1, -1, 2, -2, 3]) {
  for (const dy of dys) {
    const f = B.blockAt(c.offset(0, dy - 1, 0)),
      a = B.blockAt(c.offset(0, dy, 0)),
      h = B.blockAt(c.offset(0, dy + 1, 0));
    if (
      f &&
      f.boundingBox === "block" &&
      !/fence|wall/.test(f.name) &&
      a &&
      a.boundingBox === "empty" &&
      !/water|lava/.test(a.name) &&
      h &&
      h.boundingBox === "empty"
    )
      return c.offset(0, dy, 0);
  }
  return null;
}
function bestGate(from) {
  let best = null;
  for (const G of gates()) {
    const o = standCell(G.at(-1), [0, 1, -1]) || G.at(-1);
    if (!o) continue;
    const d = B.hdist(G.pos, from);
    if (!best || d < best.d) best = { G, o, d };
  }
  return best;
}

const SOFT_DIG =
  /dirt|grass|sand|gravel|clay|mud|podzol|mycelium|snow|leaves|moss/;
function toolFor(b) {
  if (!b) return null;
  if (SOFT_DIG.test(b.name))
    return (
      ["stone_shovel", "wooden_shovel"].find((t) => B.count(t) > 0) || null
    );
  if (/log|wood|planks/.test(b.name))
    return ["stone_axe", "wooden_axe"].find((t) => B.count(t) > 0) || null;
  return (
    ["stone_pickaxe", "wooden_pickaxe"].find((t) => B.count(t) > 0) || null
  );
}
async function digCorridor(G) {
  if (!inside(B.pos())) return 0;
  const w = G.at(1);
  await B.goto(new B.goals.GoalNear(w.x, w.y, w.z, 0.6), { timeoutMs: 1e4 });
  if (!(await setGate(G, true))) return 0;
  let n = 0;
  for (const k of [-1, -2])
    for (const dy of [0, 1]) {
      const p = G.at(k).offset(0, dy, 0),
        b = B.blockAt(p);
      if (
        !b ||
        b.boundingBox !== "block" ||
        /fence|gate|wall|chest|bedrock/.test(b.name)
      )
        continue;
      const tool = toolFor(b);
      if (
        await B.dig(b, tool ? { tool, maxMs: 9e3 } : { hand: true, maxMs: 9e3 })
      )
        n++;
    }

  const f = B.blockAt(G.at(-1).offset(0, -1, 0));
  if (f && f.boundingBox === "empty" && B.count("dirt") > 0) {
    const below = B.blockAt(G.at(-1).offset(0, -2, 0));
    if (below && below.boundingBox === "block")
      (await B.placeOn(below, new B.Vec3(0, 1, 0), "dirt")) && n++;
  }
  await setGate(G, false);
  return n;
}
async function goOut(towards) {
  const t0x = now();
  try {
    return await goOut0(towards);
  } finally {
    spend("all", "gate", now() - t0x);
  }
}
async function goOut0(towards) {
  if (!H.pen) return true;
  if (!inside(B.pos())) return true;
  const g = bestGate(towards || B.pos());
  if (!g) return (log("no usable gate"), false);
  const G = g.G,
    w = G.at(2);
  await pullAway(G);
  await holdNoFood();
  B.setMovements({ sprint: true, maxDropDown: 2 });
  await B.goto(new B.goals.GoalNear(w.x, w.y, w.z, 0.6), { timeoutMs: 2e4 });
  B.setMovements({});
  await walkStraight(G.at(1).offset(0.5, 0, 0.5), 3e3);
  const nearGate = gateCrowd(G, 2.5);
  if (!(await setGate(G, true))) return false;

  let ok = await walkStraight(g.o.offset(0.5, 0, 0.5), 4e3);
  const o2 = standCell(G.at(-2));
  if (B.hdist(B.pos(), G.pos.offset(0.5, 0, 0.5)) < 1.2 && o2)
    ok = await walkStraight(o2.offset(0.5, 0, 0.5), 3e3);
  await waitGateClear(G, 2e3);
  await setGate(G, false);
  await Guard.afterGate(H.pen, goIn);
  const out = !inside(B.pos());
  log("left pen", {
    gate: G.pos,
    ok: out && ok,
    at: P(B.pos()),
    crowd: nearGate,
  });
  if (!out) {
    const cells = [-1, -2].map((k) => {
      const c = G.at(k);
      return [
        k,
        ...[-1, 0, 1].map((dy) => (B.blockAt(c.offset(0, dy, 0)) || {}).name),
      ];
    });
    log("leave failed", {
      gate: G.pos,
      o: g.o,
      open: gateOpen(G),
      cells,
      me: P(B.pos()),
    });

    if (!H.dugCorridor) {
      H.dugCorridor = true;
      const dug = await digCorridor(G);
      log("corridor", { gate: G.pos, dug });
      if (dug) return goOut(towards);
    }
  }
  return out;
}

function gateCrowd(G, r) {
  let n = 0;
  for (const sp of Object.keys(H.targets || {}))
    for (const e of animals(sp))
      if (
        inside(e.position) &&
        B.hdist(e.position, G.pos.offset(0.5, 0, 0.5)) <= r
      )
        n++;
  return n;
}

async function pullAway(G) {
  const n0 = gateCrowd(G, 7);
  if (!n0) return;
  const sps = Object.keys(H.targets).filter((s) =>
    FOOD[s].some((n) => B.count(n) > 0),
  );
  if (!sps.length) return;
  await holdFood(sps[0]);
  if (sps[1] && !FOOD[sps[1]].includes(bot().heldItem && bot().heldItem.name))
    await holdOffhand(sps[1]);
  const far = G.at(Math.min(14, (G.ix ? H.pen.w : H.pen.d) - 4));
  await B.goto(new B.goals.GoalNear(far.x, far.y, far.z, 1.5), {
    timeoutMs: 1.2e4,
  });
  const t0 = now();
  while (now() - t0 < 4e3 && gateCrowd(G, 7)) await B.sleep(250);
  await holdNoFood();
  log("pull away", { n0, left: gateCrowd(G, 7), ms: now() - t0 });
}
async function goIn() {
  const t0x = now();
  try {
    return await goIn0();
  } finally {
    spend("all", "gate", now() - t0x);
  }
}
async function goIn0() {
  if (!H.pen || inside(B.pos())) return true;
  const g = bestGate(B.pos());
  if (!g) return (log("no usable gate"), false);
  const G = g.G;
  await holdNoFood();

  if (B.hdist(B.pos(), g.o) > 12)
    await B.goto(new B.goals.GoalNear(g.o.x, g.o.y, g.o.z, 1.5), {
      timeoutMs: Math.max(5e3, Math.min(6e4, B.timeLeft() - 2e4)),
      stuckMs: 6e3,
    });
  await B.goto(new B.goals.GoalNear(g.o.x, g.o.y, g.o.z, 0.5), {
    timeoutMs: Math.max(3e3, Math.min(3e4, B.timeLeft() - 1.5e4)),
  });
  if (B.hdist(B.pos(), g.o.offset(0.5, 0, 0.5)) > 1.6)
    return (log("enter: gate not reached", { at: P(B.pos()), o: g.o }), false);
  const tw = now();
  while (now() - tw < 6e3 && gateCrowd(G, 2.5)) await B.sleep(250);
  if (!(await setGate(G, true))) return false;
  await walkStraight(G.at(2).offset(0.5, 0, 0.5), 5e3);
  await waitGateClear(G, 2e3);
  await setGate(G, false);
  const ok = inside(B.pos());
  log("entered pen", { gate: G.pos, ok, at: P(B.pos()) });
  return ok;
}
function animalInGate(G) {
  const c = G.pos.offset(0.5, 0, 0.5);
  for (const e of Object.values(bot().entities))
    if (
      e &&
      e !== bot().entity &&
      e.type !== "object" &&
      e.position &&
      Math.abs(e.position.x - c.x) < 0.95 &&
      Math.abs(e.position.z - c.z) < 0.95 &&
      Math.abs(e.position.y - c.y) < 1.5
    )
      if (FOOD[e.name] || e.type === "mob" || e.type === "animal") return e;
  return null;
}
async function waitGateClear(G, ms) {
  const t0 = now();
  while (now() - t0 < ms && animalInGate(G)) await B.sleep(150);
}

const rtStat = (r) =>
  r && r.rt
    ? {
        len: r.rt.len,
        edge: r.rt.edge,
        replans: r.rt.replans,
        fails: r.rt.fails,
        instant: r.rt.instant,
        on: !!r.rt.plan,
      }
    : null;
async function bringIn(sp, group, maxMs = 9e4) {
  const t0 = now();
  if (!H.pen) {
    const c = H.vcenter;
    const r = await lead(sp, group, c, maxMs);
    await B.sleep(1500);
    const inn = group.filter((e) => valid(e) && inside(e.position));
    log("lure done", {
      sp,
      ok: r.ok,
      why: r.why,
      in: inn.length,
      of: group.length,
      ms: now() - t0,
      legs: r.legs,
      waits: r.waits,
      rehooks: r.rehooks,
    });
    log("lure", {
      species: sp,
      n_follow: r.keep ? r.keep.length : 0,
      n_in: inn.length,
      ok: inn.length > 0,
      secs: Math.round((now() - t0) / 1e3),
    });
    return inn;
  }
  const g = bestGate(B.pos());
  if (!g) return (log("no usable gate"), []);
  const G = g.G;
  let r = await lead(sp, group, g.o, maxMs);
  if (
    !r.ok &&
    (!r.keep.length || r.why === "nofood" || B.hdist(B.pos(), g.o) > 4)
  ) {
    log("lure failed", {
      sp,
      why: r.why,
      ms: now() - t0,
      me: P(B.pos()),
      to_gate: r1(B.hdist(B.pos(), g.o)),
      legs: r.legs,
      waits: r.waits,
      rehooks: r.rehooks,
      route: rtStat(r),
    });
    log("lure", {
      species: sp,
      n_follow: r.keep ? r.keep.length : 0,
      n_in: 0,
      ok: false,
      secs: Math.round((now() - t0) / 1e3),
      why: r.why,
    });
    for (const e of group) H.noLure.set(e.id, now() + 1.8e5);
    return [];
  }
  const keep = r.keep;

  await B.goto(new B.goals.GoalNear(g.o.x, g.o.y, g.o.z, 0.5), {
    timeoutMs: 6e3,
  });
  await holdFood(sp);
  if (!(await setGate(G, true))) return [];
  await walkStraight(G.at(4).offset(0.5, 0, 0.5), 5e3);
  const tw = now();
  let inn = [];
  while (now() - tw < 15e3) {
    inn = keep.filter((e) => valid(e) && inside(e.position));
    const near = keep.filter(
      (e) =>
        valid(e) && !inside(e.position) && e.position.distanceTo(B.pos()) <= 10,
    );
    if (!near.length) break;
    await B.sleep(250);
  }

  await waitGateClear(G, 4e3);
  await setGate(G, false);
  await Guard.afterGate(H.pen, goIn);
  inn = keep.filter((e) => valid(e) && inside(e.position));
  const extra = animals(sp).filter(
    (e) =>
      !isBaby(e) &&
      inside(e.position) &&
      !keep.includes(e) &&
      e.position.distanceTo(B.pos()) < 8,
  );
  H.stats.lures++;
  H.stats.lureAdults += inn.length;
  log("lure done", {
    sp,
    in: inn.length,
    of: group.length,
    kept: keep.length,
    extra: extra.length,
    ms: now() - t0,
    legs: r.legs,
    waits: r.waits,
    rehooks: r.rehooks,
    why: r.why,
    gate_closed: gateOpen(G) === false,
    route: rtStat(r),
  });
  log("lure", {
    species: sp,
    n_follow: keep.length,
    n_in: inn.length,
    ok: inn.length > 0,
    secs: Math.round((now() - t0) / 1e3),
    species_in: [...new Set(inn.map((x) => x.name))],
  });
  return inn;
}

function lureFailed(grp, banMs) {
  H.failById = H.failById || new Map();
  for (const x of [grp.e, ...(grp.near || [])]) {
    const n = (H.failById.get(x.id) || 0) + 1;
    H.failById.set(x.id, n);
    H.noLure.set(x.id, now() + (n >= 2 ? 6e5 : banMs));
  }
}
async function lureTrip(sp, maxD, untilMs) {
  const t0l = now();
  try {
    return await lureTrip0(sp, maxD, untilMs);
  } finally {
    spend(sp, "lure", now() - t0l);
  }
}
async function lureTrip0(sp, maxD, untilMs) {
  let grp = pickGroup(sp, maxD);
  for (let k = 0; !grp && k < 3 && now() < untilMs - 3e4; k++) {
    if (!(await scout(sp, untilMs))) break;
    grp = pickGroup(sp, LURE_D + 40);
  }
  if (!grp) return null;

  const soonAdult =
    starterBabies(sp).length >= 2 &&
    starterBabies(sp).every((e) => remTicks(rec(e)) / 20 < 200);
  if (
    grp.d >= 150 &&
    soonAdult &&
    H.starterMode &&
    H.starterMode[sp] &&
    (sp === "chicken" || sp === "rabbit")
  ) {
    log("lure skip far", { sp, d: grp.d, why: "raising starters" });
    return null;
  }
  const t0 = now();
  log("lure start", {
    sp,
    target: grp.e.id,
    at: P(grp.e.position),
    group: grp.near.length,
    d: grp.d,
    left_s: Math.round(B.timeLeft() / 1e3),
  });
  if (!(await goOut(grp.e.position))) return [];

  await forageAlong(sp, untilMs);
  await holdFood(sp);

  const sp2 = Object.keys(H.targets).find(
    (x) =>
      x !== sp &&
      !FOOD[x].includes(bot().heldItem && bot().heldItem.name) &&
      H.targets[x] > planned(x) &&
      FOOD[x].some((n) => B.count(n) > 0) &&
      !(C2 && x === "pig" && pigIdle()),
  );
  const two = sp2 ? await holdOffhand(sp2) : false;
  B.setMovements({ sprint: true, maxDropDown: 2 });
  const e = grp.e;
  let st = "reached";
  for (
    let i = 0;
    i < 3 && valid(e) && e.position.distanceTo(B.pos()) > 6;
    i++
  ) {
    let best = e.position.distanceTo(B.pos()),
      bestT = now();
    st = await B.goto(
      new B.goals.GoalNear(e.position.x, e.position.y, e.position.z, 2.5),
      {
        timeoutMs: Math.min(3e4, untilMs - now()),
        stuckMs: 4e3,
        until: () => {
          if (!valid(e)) return true;
          const d = e.position.distanceTo(B.pos());
          if (d < best - 5) ((best = d), (bestT = now()));
          return d <= 3.5 || now() - bestT > 1.5e4;
        },
      },
    );
    if (
      st === "noPath" ||
      st === "timeout" ||
      (valid(e) && now() - bestT > 1.5e4)
    )
      break;
  }
  B.setMovements({});
  if (!valid(e) || e.position.distanceTo(B.pos()) > 8) {
    log("lure unreachable", {
      sp,
      id: e.id,
      st,
      me: P(B.pos()),
      at: valid(e) ? P(e.position) : null,
    });
    lureFailed(grp, 9e4);
    return [];
  }
  await holdFood(sp);

  const tn = now();
  let grpNow = [];
  while (now() - tn < 4e3) {
    grpNow = wildAdults(sp, 999).filter(
      (x) => x.position.distanceTo(B.pos()) <= 9,
    );
    if (
      grpNow.length >= Math.min(2, grp.near.length) &&
      grpNow.some((x) => x.position.distanceTo(B.pos()) < 4)
    )
      break;
    await B.sleep(250);
  }
  const all = wildAdults(sp, 999).filter(
    (x) => x.position.distanceTo(B.pos()) <= 10,
  );

  const hands = [bot().heldItem, bot().inventory.slots[45]]
    .filter(Boolean)
    .map((i) => i.name);
  for (const x of Object.keys(H.targets))
    if (x !== sp && FOOD[x].some((n) => hands.includes(n)))
      for (const e of wildAdults(x, 999))
        if (e.position.distanceTo(B.pos()) <= 10) all.push(e);
  const inn = await bringIn(
    sp,
    all,
    Math.max(2e4, Math.min(1.2e5, untilMs - now())),
  );
  if (two)
    log("lure two", { sp, sp2, in2: inn.filter((x) => x.name === sp2).length });
  if (!inn.length) lureFailed(grp, 6e4);
  log("lure trip", { sp, got: inn.length, ms: now() - t0 });
  return inn;
}

function realOut(pos) {
  const p = H.pen;
  if (!p || !pos) return false;
  return (
    pos.x < p.x + 0.5 ||
    pos.x > p.x + p.w + 1.5 ||
    pos.z < p.z + 0.5 ||
    pos.z > p.z + p.d + 1.5 ||
    pos.y < p.y - 1 ||
    pos.y > p.y + 15
  );
}
function checkInside() {
  if (!H.pen) return;
  for (const sp of Object.keys(H.targets))
    for (const e of ours(sp)) {
      const r = rec(e);
      if (realOut(e.position)) {
        if (!r.outLogged)
          ((r.outLogged = true),
            H.stats.escapes++,
            log("escape", {
              sp,
              id: e.id,
              at: P(e.position),
              baby: isBaby(e),
            }));
      } else if (!inside(e.position)) {
        H.stats.edge = (H.stats.edge || 0) + (r.edgeLogged ? 0 : 1);
        if (now() - (r.edgeLogged || 0) > 6e4)
          ((r.edgeLogged = now()),
            log("fence edge", {
              sp,
              id: e.id,
              at: P(e.position),
              baby: isBaby(e),
            }));
      }
    }
}
async function recapture(sp) {
  const out = ours(sp).filter(
    (e) => realOut(e.position) && e.position.distanceTo(B.pos()) < 48,
  );
  if (!out.length || foodCount(sp) <= 0) return 0;
  log("recapture", { sp, n: out.length });
  if (!(await goOut(out[0].position))) return 0;
  await B.goto(
    new B.goals.GoalNear(
      out[0].position.x,
      out[0].position.y,
      out[0].position.z,
      3,
    ),
    { timeoutMs: 2e4 },
  );
  await holdFood(sp);
  await B.sleep(1500);
  const inn = await bringIn(sp, out, 6e4);
  for (const e of inn) rec(e).outLogged = false;
  return inn.length;
}

const STARTER_REM_S = 240;
function starterBabies(sp) {
  return animals(sp).filter((e) => {
    const r = H.recs.get(e.id);
    return r && r.starter && isBaby(e) && !realOut(e.position);
  });
}

function starterItems(sp) {
  if (sp === "chicken") return FOOD.chicken;

  if (sp === "rabbit")
    return H.targets &&
      H.targets.pig &&
      !(C2 && H.pigPlan && H.pigPlan.mode === "off")
      ? ["dandelion"]
      : FOOD.rabbit;
  return FOOD[sp];
}

function starterFood(sp) {
  const only = starterItems(sp);

  let reserve = 2;
  const bre = animals(sp).filter(
    (e) => !realOut(e.position) && breedable(e),
  ).length;
  const near = pickGroup(sp, LURE_D);
  if (bre >= 2 || (near && near.d < 150))
    reserve += Math.min(6, feedsForNewBaby(B.timeLeft() - 6e4, 3e4, sp));
  return Math.max(
    0,
    Math.min(
      foodCount(sp),
      usable(sp)
        .filter((n) => only.includes(n))
        .reduce((a, n) => a + B.count(n), 0),
    ) - reserve,
  );
}

const C1_D = 100;
function c1Wild(sp) {
  const c = center(),
    ids = new Set(wildAdults(sp, C1_D).map((e) => e.id));

  for (const [id, v] of H.seen || []) {
    if (
      v.sp !== sp ||
      ids.has(id) ||
      bot().entities[id] ||
      now() - v.t > 1.8e5 ||
      (H.noLure.get(id) || 0) > now()
    )
      continue;
    if (B.hdist(v.pos, c) <= C1_D && Math.abs(v.pos.y - c.y) < 28) ids.add(id);
  }
  return ids.size;
}

function wildNear(pen, sp) {
  const prev = H.pen;
  try {
    hook();
    if (pen) H.pen = pen;
    return c1Wild(sp);
  } catch {
    return 0;
  } finally {
    H.pen = prev;
  }
}
function c1WildFirst(sp, left) {
  const st = (H.c1 = H.c1 || { hold: false, done: false });
  if (st.done) return false;
  const wild = c1Wild(sp);

  const inAdults = animals(sp).filter(
    (e) => !isBaby(e) && !realOut(e.position) && !rec(e).starter,
  ).length;
  const g = (H.gath || {})[sp];
  const rate = g && g.ms > 0 ? g.got / (g.ms / 6e4) : 0;
  const fails = (H.lureFails || {})[sp] || 0;
  const why =
    wild < 1 || wild + inAdults < 2
      ? "no wild pair within 100 blocks"
      : fails >= 2
        ? "lures failing"
        : g && g.ms >= 6e4 && rate >= 12
          ? "seeds >= 12 per minute"
          : null;
  const info = {
    species: sp,
    wild,
    inside_adults: inAdults,
    lure_fails: fails,
    seeds_per_min: r1(rate),
    gather_s: g ? Math.round(g.ms / 1e3) : 0,
    held_s: st.hold ? Math.round((now() - st.at) / 1e3) : 0,
    left_s: Math.round(left / 1e3),
  };
  if (why) {
    st.done = true;
    log("plan", {
      ...info,
      decision: st.hold ? "wild first released" : "no wild first",
      why,
    });
    return false;
  }
  if (!st.hold)
    ((st.hold = true),
      (st.at = now()),
      log("plan", {
        ...info,
        decision: "wild first",
        why: "wild pair within 100 blocks",
      }));
  return true;
}
function starterPlan(sp, left) {
  H.starterMode = H.starterMode || {};
  if (H.starterOff && H.starterOff[sp]) return false;
  if (sp === "rabbit" && H.rabbitOff) return false;
  if (H.starterMode[sp]) return true;
  if (sp === "sheep" || left < 5.5e5) return false;
  const st = starterBabies(sp);
  if (st.length < 2) return false;
  const need = st.reduce((a, e) => a + starterFeeds(rec(e)), 0);
  const renewable = sp === "chicken" || sp === "rabbit";
  const rich = foodCount(sp) >= need + 6;
  if (!renewable && !rich) return false;

  const nearWild = [...(H.seen || new Map()).values()].some(
    (v) => v.sp === sp && B.hdist(v.pos, center()) <= 64,
  );
  const noWild = !nearWild && now() - (H.raiseAt || now()) > 4.5e4;
  const failing = ((H.lureFails || {})[sp] || 0) >= 2;
  const others =
    animals(sp).filter(
      (e) => !isBaby(e) && !realOut(e.position) && !rec(e).starter,
    ).length >= 2;

  const extra =
    renewable &&
    ((H.targets[sp] || 0) >= 3 ||
      (sp === "chicken" &&
        (!nearWild || now() - (H.raiseAt || now()) > 4.5e4)));
  if (Flags.RS_RABBIT_STARTERS && sp === "rabbit" && !others) {
    H.starterMode[sp] = true;
    log("plan", {
      species: sp,
      decision: "raise starters",
      why: "rabbits: starters first",
      feeds_needed: need,
      food: foodCount(sp),
      target_rem_s: starterRem(sp),
      left_s: Math.round(left / 1e3),
    });
    return true;
  }
  const why =
    (noWild || failing) && !others
      ? noWild
        ? "no wild adults within 64 blocks"
        : "lures failing"
      : extra
        ? sp === "chicken"
          ? "chickens: always"
          : "extra parents (goal >= 3)"
        : null;
  if (!why) return false;
  if (Flags.C1_CHICKEN_WILD_FIRST && sp === "chicken" && c1WildFirst(sp, left))
    return false;
  H.starterMode[sp] = true;
  log("plan", {
    species: sp,
    decision: "raise starters",
    why,
    feeds_needed: need,
    food: foodCount(sp),
    target_rem_s: starterRem(sp),
    left_s: Math.round(left / 1e3),
  });
  return true;
}

function starterRem(sp) {
  const g = (H.gath || {})[sp];
  if (
    (sp === "chicken" || sp === "rabbit") &&
    g &&
    g.ms > 2e4 &&
    g.got / (g.ms / 6e4) >= 15
  )
    return 60;

  const e = (H.early || {})[sp];
  if (
    sp === "chicken" &&
    !(g && g.ms > 2e4) &&
    e &&
    e.ms > 2e4 &&
    e.got >= 10 &&
    e.got / (e.ms / 6e4) >= 15
  )
    return 60;
  return STARTER_REM_S;
}
function starterFeeds(r) {
  let rem = remTicks(r),
    n = 0;
  const target = starterRem(r.sp) * 20;
  while (rem > target && n < 50)
    ((rem -= Math.floor(Math.floor(rem / 20) * 0.1) * 20), n++);
  return n;
}

function parentCandidates(sp) {
  const st = starterBabies(sp);
  if (H.lateRaise && H.lateRaise[sp]) return st;
  const renewable = sp === "chicken" || sp === "rabbit";
  if (!renewable || (H.targets[sp] || 0) < 3) return st;
  const adults = animals(sp).filter(
    (e) => !isBaby(e) && !realOut(e.position),
  ).length;
  const short = Math.min(2 * H.targets[sp], 6) - adults - st.length;
  if (short <= 0) return st;
  const kids = ours(sp)
    .filter((e) => isBaby(e) && !realOut(e.position))
    .sort((a, b) => (rec(a).bornAt || 0) - (rec(b).bornAt || 0))
    .slice(0, short);
  return st.concat(kids);
}

function lateRaiseOk(sp) {
  if (sp !== "chicken" || process.env.AH_LATE_RAISE === "0") return false;
  const left = B.timeLeft();
  H.lateRaise = H.lateRaise || {};
  if (H.lateRaise[sp]) return left > 3e5;
  const st = starterBabies(sp);
  if (left <= 4e5 || st.length < 2) return false;
  const sNeed = st.reduce((a, e) => a + starterFeeds(rec(e)), 0);
  const nb = feedsForNewBaby(left - starterRem(sp) * 1e3 - 1e4, 3e4, sp);
  const cost = sNeed + 2 + nb;
  if (nb >= 99 || cost > 60) return false;
  H.lateRaise[sp] = true;
  log("plan", {
    species: sp,
    decision: "late starters",
    cost,
    starter_feeds: sNeed,
    chick_feeds: nb,
    food: foodCount(sp),
    left_s: Math.round(left / 1e3),
  });
  return true;
}
async function raiseStarters(ctx, sp) {
  const st = parentCandidates(sp);
  if (
    st.length < 1 ||
    (starterBabies(sp).length < 2 && st.length === starterBabies(sp).length)
  )
    return 0;
  const need = st.reduce((a, e) => a + starterFeeds(rec(e)), 0);
  if (!need) return 0;

  const remMax = Math.max(...st.map((e) => remTicks(rec(e)) / 20));
  if (B.timeLeft() < 6e5 && remMax > 400 && !lateRaiseOk(sp)) {
    H.starterMode[sp] = false;
    H.starterOff = H.starterOff || {};
    H.starterOff[sp] = true;
    log("plan", {
      species: sp,
      decision: "stop raising starters",
      rem_s: Math.round(remMax),
      left_s: Math.round(B.timeLeft() / 1e3),
    });
    return 0;
  }

  if (starterFood(sp) < 1) {
    const nearLure =
      sp === "rabbit" && Flags.RS_RABBIT_STARTERS
        ? null
        : pickGroup(sp, LURE_D);
    if (nearLure && nearLure.d < 150 && !((H.lureBackoff || {})[sp] > now()))
      return 0;
    await getFood(
      ctx,
      sp,
      need + 6,
      now() + (sp === "rabbit" && Flags.RS_RABBIT_STARTERS ? 1.2e5 : 1e5),
    );
  }
  if (starterFood(sp) < 1) return 0;
  if (!inside(B.pos()) && !(await goIn())) return 0;
  let given = 0;

  for (let k = 0; k < 60 && starterFood(sp) > 0; k++) {
    const cand = parentCandidates(sp).filter((e) => starterFeeds(rec(e)) > 0);
    if (!cand.length) break;
    cand.sort((a, b) => remTicks(rec(b)) - remTicks(rec(a)));
    const e = cand[0],
      r = rec(e);
    if (starterFood(sp) <= 0) break;
    const f = await feed(e, sp, "starter", starterItems(sp));
    if (!f) break;
    const sx = Math.floor(Math.floor(remTicks(r) / 20) * 0.1) * 20;
    r.forced += sx;
    r.feedForced = (r.feedForced || 0) + sx;
    r.lastFeedAt = now();
    r.feeds = (r.feeds || 0) + 1;
    given++;
  }
  log("starters fed", {
    sp,
    given,
    rem_s: parentCandidates(sp).map((e) => Math.round(remTicks(rec(e)) / 20)),
    kids: parentCandidates(sp).filter((e) => rec(e).ours).length,
    food_left: foodCount(sp),
    left_s: Math.round(B.timeLeft() / 1e3),
  });
  return given;
}

async function earlyStarters(ctx, pen, targets, sp, ms) {
  hook();
  if (!pen || pen.registered === false) return 0;
  const t0 = now();
  H.pen = pen;
  H.pen.starterIds = new Set(
    ((pen && pen.starters) || []).map((s) => s && s.uuid).filter(Boolean),
  );
  H.targets = H.targets || targets;
  H.regAt = H.regAt || now();
  const classify = () => {
    for (const e of animals(sp))
      if (
        isBaby(e) &&
        (H.pen.starterIds.has(e.uuid) ||
          (inside(e.position) && now() - H.regAt < 4e4))
      ) {
        const r = rec(e);
        if (r.ours) continue;
        ((r.starter = true),
          (r.classified = true),
          (r.bornAt = r.bornAt || H.regAt),
          (r.forced = r.forced || 0));
      }
    return starterBabies(sp);
  };

  let st = classify();
  for (let i = 0; i < 15 && st.length < 2; i++)
    (await B.sleep(1e3), (st = classify()));
  log("early starters", {
    sp,
    starters: st.length,
    ids: pen.starters ? pen.starters.length : 0,
    food: foodCount(sp),
    rem_s: st.map((e) => Math.round(remTicks(rec(e)) / 20)),
    left_s: Math.round(B.timeLeft() / 1e3),
  });
  if (st.length < 2 || B.timeLeft() < 6e5) return 0;
  H.starterMode = H.starterMode || {};
  H.starterMode[sp] = true;
  const items = starterItems(sp);
  const avail = () => items.reduce((a, n) => a + B.count(n), 0);
  const need = () =>
    starterBabies(sp).reduce((a, e) => a + starterFeeds(rec(e)), 0);
  let given = 0;
  for (
    let round = 0;
    round < 3 && need() > 0 && now() - t0 < ms && B.timeLeft() > 5.5e5;
    round++
  ) {
    if (avail() < Math.min(need(), 8) + 2) {
      const n0 = avail(),
        tg = now();

      H.soloFood = true;
      try {
        await getFood(ctx, sp, need() + 4, Math.min(t0 + ms, now() + 1.2e5));
      } finally {
        H.soloFood = false;
      }
      if (avail() <= n0 && avail() < 3) break;

      var slow = now() - tg > 4e4 && (avail() - n0) / ((now() - tg) / 6e4) < 8;
    }
    if (!inside(B.pos()) && !(await goIn())) break;
    let g = 0;
    for (let k = 0; k < 60 && avail() > 2; k++) {
      const cand = starterBabies(sp).filter((e) => starterFeeds(rec(e)) > 0);
      if (!cand.length) break;
      cand.sort((a, b) => remTicks(rec(b)) - remTicks(rec(a)));
      const e = cand[0],
        r = rec(e);
      const f = await feed(e, sp, "starter", items);
      if (!f) break;
      const sx = Math.floor(Math.floor(remTicks(r) / 20) * 0.1) * 20;
      r.forced += sx;
      r.feedForced = (r.feedForced || 0) + sx;
      r.lastFeedAt = now();
      r.feeds = (r.feeds || 0) + 1;
      g++;
    }
    given += g;
    log("starters fed", {
      sp,
      given: g,
      early: true,
      rem_s: starterBabies(sp).map((e) => Math.round(remTicks(rec(e)) / 20)),
      food_left: avail(),
      left_s: Math.round(B.timeLeft() / 1e3),
    });
    if (!g && round > 0) break;
    if (typeof slow !== "undefined" && slow) {
      log("early starters slow food", { sp, ms: now() - t0 });
      break;
    }
  }
  log("early starters end", {
    sp,
    given,
    ms: now() - t0,
    rem_s: starterBabies(sp).map((e) => Math.round(remTicks(rec(e)) / 20)),
    food_left: foodCount(sp),
    left_s: Math.round(B.timeLeft() / 1e3),
  });
  try {
    if (inside(B.pos())) await goOut(B.pos());
  } catch {}
  return given;
}

async function starterBreed(ctx, sp, maxMs) {
  hook();
  const t0 = now(),
    until = t0 + maxMs;
  const st = animals(sp).filter((e) => rec(e).starter && !realOut(e.position));
  if (st.length < 2)
    return (
      log("starter breed skip", { sp, why: "starters", n: st.length }),
      0
    );

  const ra = rec(st[0]),
    rb = rec(st[1]);
  const ent = (r) => {
    const e = bot().entities[r.id];
    return e && e.position && e.isValid !== false ? e : null;
  };
  const remS = () =>
    Math.max(...[ra, rb].map((r) => (r.baby ? remTicks(r) / 20 : 0)));
  const grown = () => !ra.baby && !rb.baby;
  if (remS() * 1e3 > maxMs - 2e4)
    return (
      log("starter breed skip", {
        sp,
        why: "far from adult",
        rem_s: Math.round(remS()),
      }),
      0
    );
  let rounds = 0;

  let zeroAt = 0;
  const off = () => {
    if (grown() || remS() > 0) return false;
    if (!zeroAt) zeroAt = now();
    return now() - zeroAt > 3e4;
  };
  while (!grown() && now() < until - 2e4 && rounds < 6 && !off()) {
    rounds++;
    const left = Math.max(
      2e4,
      Math.min(remS() * 1e3 + 3e3, zeroAt ? 3.2e4 - (now() - zeroAt) : 1e9),
    );
    const n0 = foodCount(sp);
    H.soloFood = true;
    H.hardFood = process.env.AH_HARDFOOD !== "0";
    try {
      await getFood(ctx, sp, n0 + 40, Math.min(until - 2e4, now() + left));
    } catch (e) {
      log("starter breed food error", { err: String(e).slice(0, 120) });
    } finally {
      H.soloFood = false;
      H.hardFood = false;
    }
    if (!grown() && foodCount(sp) <= n0)
      await B.sleep(Math.min(5e3, Math.max(1e3, remS() * 1e3)));
  }
  for (let i = 0; i < 20 && !grown() && now() < until - 1.2e4 && !off(); i++)
    await B.sleep(1e3);
  if (!grown())
    return (
      log("starter breed skip", {
        sp,
        why: zeroAt ? "estimate off" : "not adult",
        rem_s: Math.round(remS()),
        ms: now() - t0,
      }),
      0
    );
  if (foodCount(sp) < 2)
    return (
      log("starter breed skip", { sp, why: "food", food: foodCount(sp) }),
      0
    );
  if (!inside(B.pos()) && !(await goIn()))
    return (log("starter breed skip", { sp, why: "goIn" }), 0);
  let a = ent(ra),
    b = ent(rb);
  for (let i = 0; i < 10 && (!a || !b); i++)
    (await B.sleep(300), (a = ent(ra)), (b = ent(rb)));
  if (!a || !b || realOut(a.position) || realOut(b.position))
    return (log("starter breed skip", { sp, why: "lost", a: !!a, b: !!b }), 0);
  if (!breedable(a) || !breedable(b))
    return (
      log("starter breed skip", { sp, why: "cooldown", ms: now() - t0 }),
      0
    );
  const p = await breedPair(a, b, sp);
  if (p) await waitBabies([p]);
  let fed = 0;
  if (p && p.baby) fed = await feedBabies(ctx, sp);
  log("starter breed", {
    sp,
    ok: !!(p && p.baby),
    fed,
    food_left: foodCount(sp),
    ms: now() - t0,
    left_s: Math.round(B.timeLeft() / 1e3),
  });
  try {
    if (inside(B.pos())) await goOut(B.pos());
  } catch {}
  return p && p.baby ? 1 : 0;
}

const FINAL_MS = 18e4;
function dueBabies(withinMs) {
  const out = [];
  for (const sp of Object.keys(H.targets || {}))
    for (const e of ours(sp)) {
      if (!isBaby(e)) continue;
      const r = rec(e),
        ms = ((remTicks(r) / H.tps.f) * 50) | 0;

      const late =
        r.bornAt && now() - r.bornAt - ((GROW_TICKS - r.forced) * 50) / H.tps.f;
      if (ms < withinMs && late < 6e4 && feedsNeeded(r, B.timeLeft()) === 0)
        out.push({ e, sp, ms });
    }
  return out;
}
async function gatherAtCenter(why) {
  if (!H.pen) return false;
  if (!inside(B.pos()) && !(await goIn())) return false;

  const sps = Object.keys(H.targets).filter(
    (sp) =>
      FOOD[sp].some((n) => B.count(n) > 0) &&
      (sp !== "sheep" || /final|maturing|call sheep|threat/.test(why)),
  );
  if (!sps.length) {
    const c = center();
    await B.goto(new B.goals.GoalNear(c.x, c.y, c.z, 1), { timeoutMs: 1e4 });
    await B.sleep(2e3);
    return true;
  }

  const stake = (sp) =>
    ours(sp).length * 10 + animals(sp).filter((e) => inside(e.position)).length;
  sps.sort((a, b) => stake(b) - stake(a));
  await holdFood(sps[0]);
  if (sps[1] && !FOOD[sps[1]].includes(bot().heldItem && bot().heldItem.name))
    await holdOffhand(sps[1]);
  const c = center();
  if (now() - (H.loopAt || 0) > 3e4 && B.timeLeft() > 4e4) {
    H.loopAt = now();
    for (const [dx, dz] of [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
    ]) {
      await B.goto(new B.goals.GoalNear(c.x + dx, c.y, c.z + dz, 1), {
        timeoutMs: 6e3,
        stuckMs: 2500,
      });
      await B.sleep(600);
    }
  }
  await B.goto(new B.goals.GoalNear(c.x, c.y, c.z, 1), { timeoutMs: 8e3 });
  const t0 = now();
  while (now() - t0 < 5e3) await B.sleep(250);
  if (now() - (H.gatherLog || 0) > 2e4) {
    H.gatherLog = now();
    const edge = [];
    for (const sp of Object.keys(H.targets))
      for (const e of animals(sp))
        if (inside(e.position) || margin(e.position) === 0)
          if (margin(e.position) < 0.6 && B.hdist(e.position, c) < 16)
            edge.push(sp);
    log("gather", {
      why,
      sps,
      edge: edge.length,
      out: Object.keys(H.targets).map(
        (sp) => ours(sp).filter((e) => !inside(e.position)).length,
      ),
      left_s: Math.round(B.timeLeft() / 1e3),
    });
  }
  return true;
}

const PIG_LURE_MS = 6e4;
const PIG_NEAR = 100;

function pigFeedsAt(inMs) {
  return feedsNeeded(
    { bornAt: now(), forced: 0 },
    B.timeLeft() + 6e3 - inMs,
    0,
  );
}

function pigReserved() {
  let n = 0;
  for (const e of ours("pig")) {
    if (!isBaby(e) || realOut(e.position)) continue;
    const k = feedsNeeded(rec(e), B.timeLeft());
    if (k < 99) n += k;
  }
  return n;
}

function pigVillageCrops(c) {
  const F = FOODMOD && FOODMOD.F;
  if (!F || !Array.isArray(F.crops)) return 0;
  const own = new Set(
    F.field && !F.field.village
      ? (F.field.cells || []).map((p) => `${p.x},${p.y + 1},${p.z}`)
      : [],
  );
  let n = 0;
  for (const x of F.crops) {
    if (
      !x ||
      !x.pos ||
      own.has(`${x.pos.x},${x.pos.y},${x.pos.z}`) ||
      B.hdist(x.pos, c) > 160
    )
      continue;
    if (
      x.name === "carrots" ||
      x.name === "potatoes" ||
      (x.name === "beetroots" && x.age >= 3)
    )
      n++;
  }
  return n;
}

function pigsNear(c) {
  const ids = new Set();
  for (const [id, v] of H.seen || [])
    if (v.sp === "pig" && now() - v.t < 6e5 && B.hdist(v.pos, c) <= PIG_NEAR)
      ids.add(id);
  for (const e of animals("pig"))
    if (!isBaby(e) && B.hdist(e.position, c) <= PIG_NEAR) ids.add(e.id);
  return ids.size;
}

function pigsClose(c, r) {
  const ids = new Set();
  for (const [id, v] of H.seen || [])
    if (v.sp === "pig" && now() - v.t < 9e4 && B.hdist(v.pos, c) <= r)
      ids.add(id);
  for (const e of animals("pig"))
    if (!isBaby(e) && B.hdist(e.position, c) <= r) ids.add(e.id);
  return ids.size;
}
function pigMode() {
  return H.pigPlan ? H.pigPlan.mode : null;
}

function pigIdle() {
  const m = pigMode();
  return m === "off" || m === "wait";
}

function pigEval(pen, why) {
  try {
    return pigEval0(pen, why);
  } catch (e) {
    if (!H.pigErrLogged)
      ((H.pigErrLogged = true),
        log("plan error", {
          species: "pig",
          err: String((e && e.stack) || e).slice(0, 300),
        }));
    return H.pigPlan || null;
  }
}
function pigEval0(pen, why) {
  if (!C2 || !(H.targets || {}).pig) return null;
  const p0 = H.pigPlan;
  if (p0 && p0.mode === "village") return p0;
  const c = pen
    ? new B.Vec3(pen.x + 1 + pen.w / 2, pen.y, pen.z + 1 + pen.d / 2)
    : center();
  const vill = pigVillageCrops(c);
  const reserved = pigReserved();
  const kit =
    B.count("carrot") + B.count("potato") + B.count("beetroot") - reserved;
  const near = pigsNear(c);
  const inPen = H.pen
    ? animals("pig").filter((e) => inside(e.position) && breedable(e)).length
    : 0;
  const lureMs = inPen >= 2 ? 0 : PIG_LURE_MS;
  const n = pigFeedsAt(lureMs);
  const need = n >= 99 ? null : Math.max(4, 2 + n);
  const mode =
    vill >= 4
      ? "village"
      : need !== null && kit >= need
        ? near >= 2 || inPen >= 2
          ? "kit"
          : "wait"
        : "off";
  if (!p0 || p0.mode !== mode) {
    const decision = {
      village: "pigs: village crops",
      kit: "pigs first: kit piglet",
      wait: "no pig work: < 2 pigs within 100 blocks",
      off: "no pig work: piglet not growable",
    }[mode];
    log("plan", {
      species: "pig",
      decision,
      mode,
      why,
      prev: p0 ? p0.mode : null,
      kit_food: kit,
      food_needed: need,
      feeds_at_birth: n >= 99 ? null : n,
      reserved,
      pigs_near: near,
      in_pen: inPen,
      lure_s: lureMs / 1e3,
      village_crops: vill,
      bred: H.stats.breeds.pig || 0,
      left_s: Math.round(B.timeLeft() / 1e3),
    });
  }
  H.pigPlan = { mode, at: now(), kit, need, near, inPen, vill };
  return H.pigPlan;
}
function pigPlan(pen) {
  return pigEval(pen, "registered");
}

function babyGrowth(sp) {
  let babies = 0,
    feeds = 0,
    sum = 0;
  for (const e of ours(sp)) {
    if (!isBaby(e)) continue;
    babies++;
    const r = rec(e);
    const rem = r.bornAt ? remTicks(r) : GROW_TICKS;
    const safe = Number.isFinite(rem) ? rem : GROW_TICKS;
    sum += Math.max(0, Math.min(1, 1 - safe / GROW_TICKS));
    const need = r.bornAt ? feedsNeeded(r, B.timeLeft()) : 0;
    if (need < 99) feeds += need;
  }
  return {
    growth_percent: babies ? Math.round((sum / babies) * 100) : 0,
    growth_feeds: feeds,
  };
}

function publishCounts() {
  if (!B.hasBot() || !H.targets || !Object.keys(H.targets).length) return;
  if (now() - (H.countsAt || 0) < 2e3) return;
  H.countsAt = now();
  let snap = {};
  try {
    snap = census();
  } catch {
    return;
  }
  let plan = {};
  try {
    plan = foodPlan(H.targets);
  } catch {}
  const species = {};
  for (const sp of Object.keys(H.targets)) {
    const row = snap[sp] || {};
    const food = plan[sp] || {};
    const growth = babyGrowth(sp);
    const got = stock(H.targets).species[sp] || {};
    species[sp] = {
      goal: H.targets[sp] | 0,
      adults: row.oursAdult || 0,
      babies: row.oursBaby || 0,
      wild: row.wild || 0,
      stock_adults: got.adults || 0,
      stock_need: food.adults || 0,
      food: food.have != null ? food.have : row.food || 0,
      food_need: food.need || 0,
      food_items: food.items || FOOD[sp] || [],
      growth_percent: growth.growth_percent,
      growth_feeds: growth.growth_feeds,
    };
  }
  B.emit("counts", { species });
}

function census() {
  const o = {};
  for (const sp of Object.keys(H.targets)) {
    const all = animals(sp);
    o[sp] = {
      inAdult: all.filter((e) => inside(e.position) && !isBaby(e)).length,
      breedable: all.filter((e) => inside(e.position) && breedable(e)).length,
      oursBaby: ours(sp).filter((e) => isBaby(e)).length,
      oursAdult: ours(sp).filter((e) => !isBaby(e)).length,
      oursOut: ours(sp).filter((e) => realOut(e.position)).length,
      oursEdge: ours(sp).filter(
        (e) => !inside(e.position) && !realOut(e.position),
      ).length,
      wild: wildAdults(sp, 96).length,
      food: foodCount(sp),
    };
  }
  return o;
}

function secured(sp) {
  let n = 0;
  for (const e of ours(sp)) {
    if (realOut(e.position)) continue;
    const r = rec(e);
    if (!isBaby(e) || feedsNeeded(r, B.timeLeft()) === 0) n++;
  }
  return n;
}
function planned(sp) {
  let n = 0;
  for (const r of H.recs.values()) {
    if (!r.ours || r.sp !== sp || r.dead) continue;
    const e = bot().entities[r.id];
    if (e && e.position && realOut(e.position)) continue;

    const graze =
      Flags.S1_LAMB_GRAZE &&
      sp === "sheep" &&
      penGrass() >= 60 &&
      B.timeLeft() / 1e3 - 45 + (now() - r.bornAt) / 1e3 >= 200;
    if (r.baby && r.bornAt && feedsNeeded(r, B.timeLeft()) >= 99 && !graze)
      continue;
    n++;
  }
  return (
    n +
    H.pending.filter((q) => q.sp === sp && !q.baby && now() - q.at < 15e3)
      .length
  );
}

function watch(targets) {
  H.targets = H.targets || targets;
  hook();
  if (H.watchT) return;
  H.watchT = setInterval(() => {
    try {
      if (!B.hasBot()) return;
      noteSightings();
      publishCounts();
    } catch {}
  }, 2e3);
  H.watchT.unref && H.watchT.unref();
}

function breedWaiting() {
  const left = B.timeLeft();
  for (const sp of Object.keys(H.targets || {})) {
    if (!H.pen || H.targets[sp] - planned(sp) <= 0) continue;

    if (((H.z1Calls || {})[sp] || 0) >= 3) continue;
    const nb = feedsForNewBaby(left, 3e4, sp);

    if (nb >= 99 || foodCount(sp) < (breedNow(sp, left) ? 2 : 2 + nb)) continue;
    if (
      animals(sp).filter((e) => !realOut(e.position) && breedable(e)).length >=
      2
    )
      return sp;
  }
  return null;
}

async function finalBreed(ctx) {
  const left = B.timeLeft();
  H.f3Done = H.f3Done || {};
  for (const sp of Object.keys(H.targets || {})) {
    if (H.f3Done[sp] || H.targets[sp] - planned(sp) <= 0) continue;
    const nb = feedsForNewBaby(left, 3e4, sp);
    if (nb >= 99) continue;
    let owed = 0;
    for (const e of ours(sp))
      if (isBaby(e)) {
        const f = feedsNeeded(rec(e), left);
        if (f < 99) owed += f;
      }
    if (foodCount(sp) < 2 + nb + owed) continue;
    const bre = animals(sp).filter(
      (e) => inside(e.position) && margin(e.position) >= 1.2 && breedable(e),
    );
    if (bre.length < 2) continue;
    H.f3Done[sp] = true;
    log("plan", {
      species: sp,
      decision: "final breed",
      food: foodCount(sp),
      nb,
      owed,
      left_s: Math.round(left / 1e3),
    });
    if (!inside(B.pos()) && !(await goIn())) return false;
    const a = bre.shift();
    bre.sort(
      (x, y) =>
        x.position.distanceTo(a.position) - y.position.distanceTo(a.position),
    );
    const p = await breedPair(a, bre[0], sp);
    if (p) {
      await waitBabies([p]);
      await feedBabies(ctx, sp);
    }
    return true;
  }
  return false;
}

function breedNow(sp, left) {
  if (
    !Flags.B2_BREED_NOW ||
    (sp !== "chicken" && sp !== "sheep") ||
    left < FINAL_MS
  )
    return false;
  return !ours(sp).some(
    (e) =>
      isBaby(e) &&
      feedsNeeded(rec(e), left) > 0 &&
      feedsNeeded(rec(e), left) < 99,
  );
}
function needs(targets, leftMs) {
  targets = targets || H.targets || {};
  const left = leftMs || B.timeLeft(),
    out = {};
  for (const sp of Object.keys(targets)) {
    const missing = Math.max(0, targets[sp] - planned(sp));
    const nb = feedsForNewBaby(left - 6e4, 3e4, sp);
    let n = missing * (2 + (nb >= 99 ? 0 : nb));
    for (const r of H.recs.values())
      if (r.ours && r.sp === sp && !r.dead && r.baby)
        n += Math.min(20, feedsNeeded(r, left) % 99);
    if (H.starterMode && H.starterMode[sp])
      n += parentCandidates(sp).reduce((a, e) => a + starterFeeds(rec(e)), 0);
    if ((H.stopFood || {})[sp] || (C2 && sp === "pig" && pigIdle()))
      n = Math.min(n, foodCount(sp));
    out[sp] = { food: n, have: foodCount(sp), missing };
  }
  return out;
}

function preferSite(targets) {
  H.targets = H.targets || targets;
  let sx = 0,
    sz = 0,
    sy = 0,
    n = 0;
  const me = B.pos();
  for (const sp of Object.keys(targets))
    for (const e of animals(sp)) {
      if (isBaby(e) || B.hdist(e.position, me) > 72) continue;
      const w = foodCount(sp) > 0 ? 2 : 1;
      ((sx += e.position.x * w),
        (sy += e.position.y * w),
        (sz += e.position.z * w),
        (n += w));
    }
  const p = n ? new B.Vec3(sx / n, sy / n, sz / n) : null;
  log("prefer site", { at: P(p), n });
  return p;
}

function strategyRow(sp, goal) {
  const left = B.timeLeft();
  return {
    species: sp,
    goal: goal | 0,
    done: planned(sp),
    adults: animals(sp).filter((e) => isKnownAdult(e) && !realOut(e.position))
      .length,
    breedable: animals(sp).filter((e) => !realOut(e.position) && breedable(e))
      .length,
    food: foodCount(sp),
    leftMs: left,
    tps: (H.tps && H.tps.f) || 1,
    newBabyFeeds: feedsForNewBaby(left, 3e4, sp),
    babies: ours(sp)
      .filter((e) => isBaby(e) && !realOut(e.position))
      .map((e) => {
        const r = rec(e);
        return { id: e.id, remTicks: r.bornAt ? remTicks(r) : GROW_TICKS };
      }),
  };
}

async function raise(ctx, pen, targets, deadlineMs) {
  hook();
  H.pen = pen && pen.registered !== false ? pen : null;
  if (H.pen)
    H.pen.starterIds = new Set(
      ((pen && pen.starters) || []).map((s) => s && s.uuid).filter(Boolean),
    );
  if (!H.pen) H.vcenter = B.pos().clone();
  H.targets = targets;
  B.protect(["oak_fence", "oak_fence_gate", "chest"]);
  H.budget = ctx && ctx.budget ? ctx.budget : null;
  const end = () => Math.min(deadlineMs || Infinity, now() + B.timeLeft());

  const stopRaise = () =>
    !!(ctx && typeof ctx.raiseStop === "function" && ctx.raiseStop());

  const reentry = !!H.raiseAt;
  H.reentries = (H.reentries || 0) + (reentry ? 1 : 0);
  if (!reentry) {
    H.regAt = H.regAt || now();
    H.raiseAt = now();
    for (const sp of Object.keys(targets))
      for (const e of animals(sp))
        if (
          isBaby(e) &&
          H.pen &&
          (H.pen.starterIds.has(e.uuid) || B.hdist(e.position, center()) < 4)
        ) {
          const r = rec(e);
          if (r.ours) continue;
          ((r.starter = true),
            (r.classified = true),
            (r.bornAt = H.regAt),
            (r.forced = r.forced || 0));
        }
  }
  log("herd start", {
    reentry,
    targets,
    pen: H.pen
      ? {
          x: H.pen.x,
          y: H.pen.y,
          z: H.pen.z,
          w: H.pen.w,
          d: H.pen.d,
          gates: (H.pen.gates || []).length,
        }
      : null,
    vcenter: H.vcenter && P(H.vcenter),
    census: census(),
    left_s: Math.round(B.timeLeft() / 1e3),
    food_mod: !!FOODMOD,
  });
  {
    const left0 = B.timeLeft(),
      alloc = {};
    for (const sp of Object.keys(targets)) {
      const nb = feedsForNewBaby(left0 - 1.2e5, 3e4, sp);
      const per = 2 + (nb >= 99 ? 30 : nb);
      alloc[sp] = {
        goal: targets[sp],
        food: foodCount(sp),
        per_offspring: per,
        affordable: Math.floor(foodCount(sp) / per),
        budget: H.budget ? H.budget[sp] : null,
      };
    }
    log("plan", {
      targets,
      decision: reentry ? "reentry" : "start",
      reentry,
      alloc,
      wheat_priority: targets.cow && targets.sheep ? "sheep" : null,
      food_mod: !!FOODMOD,
      left_s: Math.round(left0 / 1e3),
    });
  }
  if (C2) ((H.pigEvalAt = now()), pigEval(null, reentry ? "reentry" : "raise"));
  let lastCensus = 0,
    idle = 0;
  const failLure = (H.lureBackoff = H.lureBackoff || {});

  for (
    let crash = 0;
    crash < 30 && now() < end() - 8e3 && !stopRaise();
    crash++
  ) {
    try {
      while (now() < end() - 8e3 && !stopRaise()) {
        await B.sleep(50);
        if (!B.hasBot()) {
          await B.sleep(1e3);
          continue;
        }
        hook();
        H.pending = H.pending.filter((q) => now() - q.at < 6e4);
        noteSightings();
        checkInside();

        if (C2 && now() - (H.pigEvalAt || 0) > 5e3)
          ((H.pigEvalAt = now()), pigEval(null, "loop"));

        if (
          H.pen &&
          (await Guard.tick({
            p: H.pen,
            goIn,
            gather: () => gatherAtCenter("threat"),
          }))
        )
          continue;
        if (now() - lastCensus > 3e4)
          ((lastCensus = now()),
            log("herd census", {
              c: census(),
              left_s: Math.round(B.timeLeft() / 1e3),
              tps: r1(H.tps.f * 20),
            }));

        if (H.pen && B.hdist(B.pos(), center()) > 36) {
          const t0 = now(),
            g = bestGate(B.pos());

          if (g)
            await B.goto(new B.goals.GoalNear(g.o.x, g.o.y, g.o.z, 2), {
              timeoutMs: Math.max(3e3, Math.min(6e4, end() - 8e3 - now())),
              stuckMs: 6e3,
            });
          log("back at pen", {
            ms: now() - t0,
            d: r1(B.hdist(B.pos(), center())),
          });
          if (B.hdist(B.pos(), center()) > 36) {
            H.backFails = (H.backFails || 0) + 1;
            if (H.backFails % 6 === 0) {
              log("back at pen far drop", { n: H.backFails, at: P(B.pos()) });
              try {
                const T = require("../navigation/village-trip"),
                  to = g ? g.o : center();
                if (
                  !(H.backFails % 12 === 0
                    ? false
                    : await T.crumbWalk(to, Math.min(9e4, end() - 8e3 - now())))
                )
                  await T.farDrop(to, Math.min(9e4, end() - 8e3 - now()));
              } catch {}
            } else if (H.backFails % 3 === 0 && FOODMOD && FOODMOD.travelTo) {
              log("back at pen escalate", { n: H.backFails, at: P(B.pos()) });
              try {
                await FOODMOD.travelTo(
                  g ? g.o : center(),
                  () => now() > end() - 8e3,
                  12,
                  { oneWay: true },
                );
              } catch {}
            } else await B.sleep(2e3);
          } else H.backFails = 0;
          continue;
        }

        const sch = applySchedule(targets);
        if (await feedBabies(ctx)) continue;
        if (sch.phase === "prepare" && B.timeLeft() > 3 * 60 * 1000) {
          await prepareHerd(ctx, targets, sch);
          continue;
        }
        if (sch.phase === "finish" || B.timeLeft() <= 3 * 60 * 1000) {
          if (!H.finishNoted) {
            H.finishNoted = true;
            log("finish window", {
              left_s: Math.round(B.timeLeft() / 1e3),
              missing: sch.missing,
              secured: Object.fromEntries(
                Object.keys(targets).map((s) => [s, secured(s)]),
              ),
            });
          }
          if (await feedBabies(ctx)) continue;
          if (
            Flags.F3_FINAL_BREED &&
            H.pen &&
            B.timeLeft() > 9e4 &&
            (await finalBreed(ctx))
          )
            continue;
          await gatherAtCenter("finish");
          continue;
        }
        if (sch.phase === "check" && now() - (H.checkLog || 0) > 2e4) {
          H.checkLog = now();
          const snap = census();
          log("schedule check", {
            adults: Object.fromEntries(
              Object.keys(targets).map((sp) => [
                sp,
                (snap[sp] && snap[sp].oursAdult) || 0,
              ]),
            ),
            goals: targets,
            left_s: Math.round(B.timeLeft() / 1e3),
          });
        }
        if (sch.phase !== "breed") {
          await gatherAtCenter(sch.phase);
          continue;
        }

        if (
          C2 &&
          ctx &&
          typeof ctx.startDeferredCrops === "function" &&
          ((H.stats.breeds.pig || 0) > 0 ||
            pigMode() !== "kit" ||
            B.secs() > 330)
        ) {
          const start = ctx.startDeferredCrops;
          ctx.startDeferredCrops = null;
          log("plan", {
            species: "pig",
            decision: "start deferred field",
            bred: H.stats.breeds.pig || 0,
            mode: pigMode(),
            left_s: Math.round(B.timeLeft() / 1e3),
          });
          await start();
          continue;
        }

        if (
          Flags.F3_FINAL_BREED &&
          H.pen &&
          B.timeLeft() < FINAL_MS &&
          B.timeLeft() > 9e4 &&
          (await finalBreed(ctx))
        )
          continue;

        if (H.pen && (B.timeLeft() < FINAL_MS || dueBabies(2.5e4).length)) {
          await gatherAtCenter(B.timeLeft() < FINAL_MS ? "final" : "maturing");
          continue;
        }
        let acted = false;
        const left = B.timeLeft();

        const pigKit = C2 && pigMode() === "kit";
        const outlook = {};
        for (const sp of Object.keys(targets))
          outlook[sp] = Strategy.planSpecies(strategyRow(sp, targets[sp]));
        if (now() - (H.priorityLog || 0) > 2e4) {
          H.priorityLog = now();
          const ranked = Object.keys(targets).sort(
            (a, b) => outlook[b].chance - outlook[a].chance,
          );
          log("priority", {
            left_s: Math.round(B.timeLeft() / 1e3),
            order: ranked.map((sp) => ({
              sp,
              action: outlook[sp].action,
              chance: +outlook[sp].chance.toFixed(2),
              reason: outlook[sp].reason,
              natural: outlook[sp].natural,
              accelerate: outlook[sp].accelerate,
              food: foodCount(sp),
            })),
          });
        }
        const order = Object.keys(targets).sort((a, b) => {
          if (pigKit && a === "pig") return -1;
          if (pigKit && b === "pig") return 1;
          return outlook[b].chance - outlook[a].chance;
        });
        for (const sp of order) {
          if (pigKit && sp !== "pig" && acted) break;

          const pOff = C2 && sp === "pig" && pigIdle();
          const pKit = pigKit && sp === "pig";

          if (sp === "rabbit" && planned("rabbit") === 0) {
            const tr = (H.time || {}).rabbit || {};
            const spent = (tr.lure || 0) + (tr.food || 0) + (tr.starter || 0);

            const ready =
              animals("rabbit").filter(
                (e) => !realOut(e.position) && breedable(e),
              ).length >= 2 && foodCount("rabbit") >= 2;
            if (spent > (Flags.RS_RABBIT_STARTERS ? 4.5e5 : 1.8e5)) {
              if (!H.rabbitOff)
                ((H.rabbitOff = true),
                  ((H.stopFood = H.stopFood || {}).rabbit = true),
                  log("plan", {
                    species: "rabbit",
                    decision: "stop rabbit work",
                    spent_s: Math.round(spent / 1e3),
                  }));
              if (!ready) continue;
            }
          }
          const goal = targets[sp],
            have = planned(sp),
            need = goal - have;

          if (
            need <= 0 &&
            process.env.AH_OWED_FOOD !== "0" &&
            H.pen &&
            (sp === "chicken" || sp === "rabbit") &&
            left > 9e4 &&
            !(H.stopFood || {})[sp] &&
            ((H.owedNext || {})[sp] || 0) < now()
          ) {
            let owed = 0;
            for (const e of ours(sp))
              if (isBaby(e) && !realOut(e.position)) {
                const f = feedsNeeded(rec(e), left);
                if (f > 0 && f < 99) owed += f;
              }
            if (owed > foodCount(sp)) {
              const before = foodCount(sp);
              log("plan", {
                decision: "owed food",
                sp,
                owed,
                food: before,
                left_s: Math.round(left / 1e3),
              });
              await getFood(
                ctx,
                sp,
                Math.min(owed + 2, 40),
                Math.min(end() - 6e4, now() + 9e4),
              );
              const got = foodCount(sp) - before;
              (H.owedNext = H.owedNext || {})[sp] = now() + (got > 0 ? 0 : 6e4);
              log("plan", {
                decision: "owed food end",
                sp,
                got,
                food: foodCount(sp),
              });
              if (got > 0) await feedBabies(ctx, sp);
              acted = true;
              continue;
            }
          }
          if (need <= 0) continue;

          const row = strategyRow(sp, goal);
          let decision = Planner.decide({
            ...row,
            babyRows: row.babies,
            babies: row.babies.length,
            knownAdults: row.adults,
            unknown: animals(sp).filter(
              (e) => ageOf(e) === "unknown" && !realOut(e.position),
            ).length,
          });
          if (now() - ((H.planAt || {})[sp] || 0) > 2e4) {
            H.planAt = H.planAt || {};
            H.planAt[sp] = now();
            log("plan", {
              species: sp,
              decision: decision.type,
              reason: decision.reason,
              priority: decision.priority,
              chance: decision.chance,
              natural: decision.plan && decision.plan.natural,
              accelerate: decision.plan && decision.plan.accelerate,
              breed_cost: decision.plan && decision.plan.breedCost,
              left_s: Math.round(left / 1e3),
            });
          }
          if (decision.type === "done" || decision.type === "hold") continue;
          if (decision.type === "feed_baby") {
            const fedNow = await feedBabies(ctx, sp);
            if (fedNow) acted = true;
            const cost = (decision.plan && decision.plan.breedCost) || 0;
            const short = (decision.plan && decision.plan.stillShort) || 0;
            if (cost >= 2 && short > 0 && foodCount(sp) >= cost)
              decision = {
                ...decision,
                type: "breed",
                reason: "growth food spent; breed with the reserve",
              };
            else continue;
          }

          const nb = feedsForNewBaby(left, 3e4, sp);
          const per = 2 + (nb >= 99 ? 99 : nb);
          if (nb >= 99 && decision.type !== "blocked") continue;
          let bre = animals(sp).filter(
            (e) =>
              inside(e.position) && margin(e.position) >= 1.2 && breedable(e),
          );

          const breAll = animals(sp).filter(
            (e) => !realOut(e.position) && breedable(e),
          );
          if (
            H.pen &&
            bre.length < 2 &&
            breAll.length >= 2 &&
            foodCount(sp) >= 2 &&
            now() - (H.callAt || 0) > 1.5e4 &&
            !pOff
          ) {
            H.callAt = now();
            await gatherAtCenter("call " + sp);
            acted = true;
            if (!Flags.Z1_BREED_FIRST) continue;

            for (let w = 0; w < 12; w++) {
              bre = animals(sp).filter(
                (e) =>
                  inside(e.position) &&
                  margin(e.position) >= 1.2 &&
                  breedable(e),
              );
              if (bre.length >= 2) break;
              await B.sleep(500);
            }
            log("call result", {
              sp,
              bre: bre.length,
              all: breAll.length,
              food: foodCount(sp),
            });
            H.z1Calls = H.z1Calls || {};
            if (bre.length < 2) {
              H.z1Calls[sp] = (H.z1Calls[sp] || 0) + 1;
              continue;
            }
            H.z1Calls[sp] = 0;
          }
          if (bre.length >= 2 && decision.type === "breed") {
            let pairs = Math.min(need, Math.floor(bre.length / 2));
            let food = foodCount(sp);

            const resv = C2 && sp === "pig" ? pigReserved() : 0;

            const now2 = breedNow(sp, left) && food >= 2;

            if (food - resv < per && !pKit && !pOff && !now2)
              food = await getFood(
                ctx,
                sp,
                per * pairs + resv,
                Math.min(end() - 6e4, now() + 1.2e5),
              );
            food -= resv;

            const idleFood = !ours(sp).some(
              (e) =>
                isBaby(e) &&
                feedsNeeded(rec(e), left) > 0 &&
                feedsNeeded(rec(e), left) < 99,
            );
            const mayGetMore =
              idleFood ||
              (sp !== "cow" &&
                ((FOODMOD && !((H.foodWait || {})[sp] > now())) ||
                  sp === "chicken"));

            pairs = Math.min(
              pairs,
              Math.floor(food / per) ||
                (food >= 2 && left > 5e5 && mayGetMore && !pOff ? 1 : 0),
            );
            if (now2 && pairs < 1) pairs = 1;

            if (now2 && food < per)
              log("plan", {
                species: sp,
                decision: "breed now",
                food,
                per,
                left_s: Math.round(left / 1e3),
              });
            if (pairs > 0 && !inside(B.pos())) await goIn();
            if (pairs > 0) {
              const pends = [];
              const pool = bre.slice();
              for (let k = 0; k < pairs && pool.length >= 2; k++) {
                const a = pool.shift();
                pool.sort(
                  (x, y) =>
                    x.position.distanceTo(a.position) -
                    y.position.distanceTo(a.position),
                );
                const b = pool.shift();
                const p = await breedPair(a, b, sp);
                if (p) pends.push(p);
              }
              if (pends.length) {
                await waitBabies(pends);
                await feedBabies(ctx, sp);
              }
              acted = true;
              continue;
            }
          }

          if (Flags.B2_BREED_NOW) {
            const bw = breedWaiting();
            if (bw && bw !== sp) {
              if (now() - (H.b2Log || 0) > 3e4)
                ((H.b2Log = now()),
                  log("plan", {
                    decision: "breed first b2",
                    skip: sp,
                    waiting: bw,
                  }));
              continue;
            }
          }

          if (H.pen && bre.length < 2 && !pOff && starterPlan(sp, left)) {
            if (await raiseStarters(ctx, sp)) {
              acted = true;
              continue;
            }

            if (
              starterBabies(sp).length >= 2 &&
              starterFood(sp) >= 10 &&
              starterBabies(sp).some((e) => starterFeeds(rec(e)) > 0)
            )
              continue;
          }

          const want = bre.length >= 2 ? 0 : 2 * need - bre.length;
          const nbLate = feedsForNewBaby(left - 9e4, 3e4, sp);
          const foodHope = FOODMOD && !((H.foodWait || {})[sp] > now()) ? 4 : 0;
          const lateOk =
            nbLate < 99 &&
            (left > 6e5 || foodCount(sp) + foodHope >= 2 + nbLate);

          const soon = H.pen && dueBabies(1.2e5).length > 0;

          if (Flags.Z1_BREED_FIRST && breedWaiting()) {
            if (now() - (H.z1Log || 0) > 3e4)
              ((H.z1Log = now()),
                log("plan", {
                  decision: "breed first",
                  skip: sp,
                  waiting: breedWaiting(),
                }));
            continue;
          }
          if (
            want > 0 &&
            left > 1.6e5 &&
            lateOk &&
            !soon &&
            (failLure[sp] || 0) < now() &&
            !(sp === "rabbit" && H.rabbitOff) &&
            !pOff
          ) {
            if (foodCount(sp) < 1)
              await getFood(
                ctx,
                sp,
                Math.min(4, per),
                Math.min(end() - 6e4, now() + 9e4),
              );
            if (foodCount(sp) < 1) continue;

            if (
              process.env.AH_BREEDSTOP !== "0" &&
              !pOff &&
              !pKit &&
              readyToBreed().includes(sp) &&
              ((H.bsSkip = H.bsSkip || {})[sp] || 0) < 3
            ) {
              H.bsSkip[sp] = (H.bsSkip[sp] || 0) + 1;
              log("plan", {
                decision: "breed before lure",
                sp,
                food: foodCount(sp),
                n: H.bsSkip[sp],
              });
              acted = true;
              continue;
            }
            const inn = await lureTrip(
              sp,
              LURE_D,
              Math.min(end() - 6e4, now() + 1.8e5),
            );

            H.lureFails = H.lureFails || {};
            if (inn === null || !inn.length) {
              const k = (H.lureFails[sp] = (H.lureFails[sp] || 0) + 1);
              failLure[sp] = now() + Math.min(1.2e5, 2e4 * k);
              if (inn === null) continue;
            } else H.lureFails[sp] = 0;
            acted = true;
            continue;
          }

          if (foodCount(sp) < per && left > 1.2e5 && !pOff && !pKit) {
            const before = foodCount(sp);
            await getFood(ctx, sp, per, Math.min(end() - 6e4, now() + 6e4));
            if (foodCount(sp) > before) acted = true;
          }
        }
        for (const sp of Object.keys(targets))
          if (ours(sp).some((e) => realOut(e.position)))
            (await recapture(sp)) && (acted = true);
        if (!acted) {
          idle++;
          if (idle % 20 === 1)
            log("herd idle", {
              c: census(),
              left_s: Math.round(B.timeLeft() / 1e3),
            });
          if (!H.pen && idle > 60) break;

          const fenceTrouble =
            H.pen &&
            (dueBabies(6e4).length > 0 ||
              Object.keys(targets).some(
                (sp) =>
                  ours(sp).some(
                    (e) => !inside(e.position) && !realOut(e.position),
                  ) ||
                  animals(sp).filter(
                    (e) =>
                      !isBaby(e) &&
                      breedable(e) &&
                      !realOut(e.position) &&
                      margin(e.position) < 1.2,
                  ).length >= 2,
              ));

          if (
            typeof ctx.onIdle === "function" &&
            B.timeLeft() > FINAL_MS + 3e4 &&
            !fenceTrouble
          ) {
            try {
              await ctx.onIdle(Math.min(3e4, B.timeLeft() - 5e4));
            } catch (e) {
              log("onIdle error", { err: String(e).slice(0, 160) });
            }
          } else if (
            H.pen &&
            !inside(B.pos()) &&
            !fenceTrouble &&
            !dueBabies(1.2e5).length
          )
            (await holdNoFood(), await B.sleep(1.5e3));
          else if (H.pen) await gatherAtCenter("idle");
          else await B.sleep(1e3);
        } else idle = 0;
      }
      break;
    } catch (e) {
      log("herd error", {
        err: String((e && e.stack) || e).slice(0, 400),
        crash,
      });
      try {
        bot().clearControlStates();
        await closeAllGates();
      } catch {}
      await B.sleep(1e3);
    }
  }
  try {
    await closeAllGates();
  } catch (e) {
    log("herd error", { err: String(e).slice(0, 200), at: "closeAllGates" });
  }
  const timeS = {};
  for (const [sp, t] of Object.entries(H.time || {}))
    timeS[sp] = Object.fromEntries(
      Object.entries(t).map(([k, v]) => [k, Math.round(v / 1e3)]),
    );
  const summary = {
    stats: H.stats,
    time_s: timeS,
    census: census(),
    secured: Object.fromEntries(
      Object.keys(targets).map((s) => [s, secured(s)]),
    ),
    left_s: Math.round(B.timeLeft() / 1e3),
  };
  log("herd end", summary);
  return summary;
}

function itemCount(name) {
  let n = 0;
  try {
    n = B.count(name);
  } catch {}
  if (name === "wheat")
    try {
      n += 9 * B.count("hay_block");
    } catch {}
  return n;
}

function stock(targets) {
  const req = Schedule.requirements(targets || H.targets || {});
  const species = {};
  for (const [sp, row] of Object.entries(req.species)) {
    let adults = 0;
    try {
      adults = animals(sp).filter((e) => !isBaby(e)).length;
    } catch {}
    species[sp] = { adults, food: itemCount(row.food_item) };
  }
  return {
    species,
    pens: (H.pens && H.pens.length) || (H.pen ? 1 : 0),
  };
}

function applySchedule(targets) {
  const req = Schedule.requirements(targets);
  const decision = Schedule.decide(req, stock(targets), {
    leftMs: B.timeLeft(),
    breedAt: H.breedAt == null ? null : H.breedAt,
    now: now(),
  });
  if (decision.phase !== "prepare" && H.breedAt == null) H.breedAt = now();
  if (decision.phase !== H.phase) {
    H.phase = decision.phase;
    log("schedule", {
      phase: decision.phase,
      ready: decision.ready,
      force: decision.force,
      missing: decision.missing,
      left_s: Math.round(B.timeLeft() / 1e3),
    });
  }
  return decision;
}

async function prepareHerd(ctx, targets, decision) {
  const req = Schedule.requirements(targets);
  const st = stock(targets);
  if (B.timeLeft() <= 3 * 60 * 1000) {
    log("schedule finish", {
      missing: decision.missing,
      left_s: Math.round(B.timeLeft() / 1e3),
    });
    return;
  }
  const hungry = Object.keys(req.species).find(
    (sp) => st.species[sp].food < req.species[sp].food,
  );
  const short = Object.keys(req.species).find(
    (sp) => st.species[sp].adults < req.species[sp].adults,
  );
  if (short) {
    if (hungry && FOODMOD && FOODMOD.gather && B.timeLeft() > 3 * 60 * 1000) {
      const row = req.species[hungry];
      log("schedule carry food", {
        species: hungry,
        item: row.food_item,
        have: st.species[hungry].food,
        need: row.food,
        while: "searching",
      });
      await FOODMOD.gather(
        { ...ctx, autoCrops: false },
        { [hungry]: Math.min(row.food, 8) },
        now() + Math.min(12e3, B.timeLeft() - 3 * 60 * 1000),
      );
    }
    log("schedule gather", {
      species: short,
      adults: st.species[short].adults,
      need: req.species[short].adults,
      missing: decision.missing,
    });
    await lureTrip(short, 160, now() + Math.min(4.5e4, B.timeLeft() - 3e4));
    return;
  }
  if (hungry && FOODMOD && FOODMOD.gather) {
    const row = req.species[hungry];
    log("schedule carry food", {
      species: hungry,
      item: row.food_item,
      have: st.species[hungry].food,
      need: row.food,
      breed: row.breed,
      growth: row.growth,
    });
    await FOODMOD.gather(
      { ...ctx, autoCrops: false },
      { [hungry]: row.food },
      now() + Math.min(6e4, B.timeLeft() - 3 * 60 * 1000),
    );
    return;
  }
  log("schedule waiting", { missing: decision.missing });
  await B.sleep(1000);
}

function foodPlan(targets) {
  const live = B.hasBot();
  const req = Schedule.requirements(targets);
  const out = {};
  for (const [sp, row] of Object.entries(req.species)) {
    if (!FOOD[sp]) continue;
    let have = 0;
    if (live) have = itemCount(row.food_item);
    out[sp] = {
      goal: row.goal,
      pairs: row.pairs,
      adults: row.adults,
      items: [row.food_item],
      breed: row.breed,
      growth: row.growth,
      growth_each: row.growth_each,
      per_offspring: 2 + (row.growth_each || 0),
      need: row.food,
      have,
      missing: Math.max(0, row.food - have),
    };
  }
  out.pens = req.pens;
  return out;
}

module.exports = {
  wildNear,
  earlyStarters,
  starterBreed,
  raise,
  watch,
  preferSite,
  needs,
  foodPlan,
  stock,
  lureTrip,
  FOOD,
  isBaby,
  inside,
  census,
  feed,
  breedPair,
  feedsNeeded,
  getFood,
  H,
  setGate,
  gateGeom,
  closeAllGates,
  goOut,
  breedWaiting,
  pigPlan,
  pigMode,
  pigsClose,
};
