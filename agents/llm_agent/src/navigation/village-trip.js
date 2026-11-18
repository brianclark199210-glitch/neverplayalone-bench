"use strict";

const B = require("../runtime/connection");

const VILLAGE_BIOMES = new Set([
  "plains",
  "sunflower_plains",
  "meadow",
  "desert",
  "savanna",
  "savanna_plateau",
  "snowy_plains",
  "taiga",
  "snowy_taiga",
]);
const now = () => B.now();
const log = (m, d = {}) => B.log("ah trip " + m, d);

let AIRS = null;
function airIds() {
  if (AIRS) return AIRS;
  const reg = B.S.bot.registry;
  AIRS = new Set();
  for (const n of ["air", "cave_air", "void_air"]) {
    const b = reg.blocksByName[n];
    if (!b) continue;
    for (let s = b.minStateId; s <= b.maxStateId; s++) AIRS.add(s);
  }
  return AIRS;
}
function biomeAt(x, z) {
  const bot = B.S.bot;
  let col = null;
  try {
    col = bot.world.getColumn(x >> 4, z >> 4);
  } catch {
    col = null;
  }
  if (!col) return null;
  const lx = x & 15,
    lz = z & 15,
    minY = bot.game.minY || -64,
    top = minY + (bot.game.height || 384) - 1;
  const air = airIds();
  let y = Math.min(top, 200);
  try {
    while (y > minY && air.has(col.getBlockStateId({ x: lx, y, z: lz }))) y--;
    const b = bot.registry.biomes[col.getBiome({ x: lx, y, z: lz })];
    return b ? b.name : null;
  } catch {
    return null;
  }
}

function biomeShares(home, radius = 160) {
  const out = {};
  for (let deg = 0; deg < 360; deg += 45) {
    const a = (deg * Math.PI) / 180;
    let n = 0,
      v = 0;
    for (let r = 48; r <= radius; r += 16)
      for (const off of [-24, 0, 24]) {
        const x = Math.round(home.x + Math.sin(a) * r + Math.cos(a) * off),
          z = Math.round(home.z - Math.cos(a) * r + Math.sin(a) * off);
        const name = biomeAt(x, z);
        if (!name) continue;
        n++;
        if (VILLAGE_BIOMES.has(name)) v++;
      }
    out[deg] = { n, share: n ? v / n : 0 };
  }
  return out;
}

let WANT_PIG = false,
  WANT_WHEAT = true;
function haveHay(FOOD) {
  const F = FOOD.F;
  if (!F.village) return false;
  if (WANT_WHEAT && F.hay.length >= 3) return true;
  return (
    WANT_PIG &&
    (F.farmland || []).length >= 8 &&
    (!WANT_WHEAT || F.hay.length >= 1)
  );
}

async function run(ctx, FOOD, pen, targets, opts = {}) {
  const t0 = now();
  WANT_PIG = !!targets.pig;
  WANT_WHEAT = !!(targets.cow || targets.sheep);
  const budget = Math.min(opts.budgetMs || 2.6e5, B.timeLeft() - 5e5);
  if (budget < 1.2e5)
    return (
      log("skip", { why: "time", left_s: Math.round(B.timeLeft() / 1e3) }),
      { found: false }
    );
  const end = t0 + budget;
  const home = pen.center
    ? pen.center.clone()
    : new B.Vec3(pen.x + 1 + pen.w / 2, pen.y, pen.z + 1 + pen.d / 2);
  const F = FOOD.F;
  const scores = FOOD.directionScores(home);
  const shares = biomeShares(home);
  const ranked = scores
    .map((d) => ({
      deg: d.deg,
      land: d.score,
      water: d.water,
      n: d.n,
      bio: (shares[d.deg] || {}).share || 0,
      bn: (shares[d.deg] || {}).n || 0,
    }))
    .map((d) => ({ ...d, score: d.bio * 3 + Math.max(-3, d.land) }))
    .sort((p, q) => q.score - p.score);
  log("start", {
    budget_s: Math.round(budget / 1e3),
    home: B.feet(),
    dirs: ranked
      .slice(0, 8)
      .map((d) => `${d.deg}:${d.score.toFixed(2)}/b${d.bio.toFixed(2)}`),
  });
  FOOD.scan(true);

  B.setMovements(OUT_MOVES);
  startCrumbs(home);

  const S = B.S;
  if (process.env.AH_TRAIL_HINT !== "0") {
    S.homeHint = () => {
      const me = B.pos();
      let best = home,
        bd = me ? B.hdist(home, me) : 1e9;
      for (const c of CR.list) {
        const d = B.hdist(c, me);
        if (d < bd) ((bd = d), (best = c));
      }
      return best;
    };
    S.homeW = 0.3;
  }
  try {
    return await legs(ctx, FOOD, pen, targets, {
      t0,
      end,
      home,
      ranked,
      F,
      opts,
    });
  } finally {
    stopCrumbs();
    B.setMovements({});
    S.homeHint = null;
    S.homeW = null;
  }
}

const OUT_MOVES = { maxDropDown: 3, towers: true, hardDig: true, digCost: 3 };

const CR = { list: [], timer: null };
function startCrumbs(home) {
  CR.list = [home.floored ? home.floored() : home];
  stopCrumbs();
  CR.timer = setInterval(() => {
    try {
      const bot = B.S.bot;
      if (!bot || !bot.entity || !bot.entity.onGround || bot.entity.isInWater)
        return;
      const p = B.pos().floored(),
        last = CR.list[CR.list.length - 1];
      if (B.hdist(p, last) >= 8 || Math.abs(p.y - last.y) >= 4) CR.list.push(p);
    } catch {}
  }, 700);
}
function stopCrumbs() {
  if (CR.timer) (clearInterval(CR.timer), (CR.timer = null));
}

async function crumbWalk(to, maxMs) {
  const list = CR.list;
  if (!list || list.length < 2) return false;
  const until0 = now() + maxMs;

  let k = 0,
    best = 1e9;
  for (let i = 0; i < list.length; i++) {
    const d = B.pos().distanceTo(list[i]);
    if (d < best) ((best = d), (k = i));
  }
  let bad = 0,
    hops = 0;

  const S = B.S,
    xe0 = S.xeN || 0,
    wet = () => process.env.AH_WETLOOP !== "0" && (S.xeN || 0) - xe0 >= 3;
  crumbWalk.wet = false;
  B.setMovements({ maxDropDown: 4, towers: true, hardDig: true, digCost: 2 });
  try {
    for (let i = k; i >= 0 && now() < until0; i--) {
      if (B.hdist(B.pos(), to) <= 20) break;
      if (wet()) {
        crumbWalk.wet = true;
        break;
      }
      const c = list[i];
      if (B.pos().distanceTo(c) < 3) continue;
      await B.goto(new B.goals.GoalNear(c.x, c.y, c.z, 2), {
        timeoutMs: Math.min(2.5e4, Math.max(3e3, until0 - now())),
        stuckMs: 6e3,
        until: wet,
      });
      hops++;
      if (wet()) continue;
      if (B.pos().distanceTo(c) > 4) {
        B.setMovements({
          maxDropDown: 6,
          towers: true,
          hardDig: true,
          digCost: 2,
          water: true,
        });
        await B.goto(new B.goals.GoalNear(c.x, c.y, c.z, 2), {
          timeoutMs: Math.min(2.5e4, Math.max(3e3, until0 - now())),
          stuckMs: 6e3,
          until: wet,
        });
        B.setMovements({
          maxDropDown: 4,
          towers: true,
          hardDig: true,
          digCost: 2,
        });
        if (B.pos().distanceTo(c) > 4) bad++;
        if (bad >= 6) break;
      }
    }
  } catch (e) {
    log("crumb error", { err: String(e).slice(0, 160) });
  } finally {
    B.setMovements({});
  }
  log("crumb walk", {
    from_i: k,
    n: list.length,
    hops,
    bad,
    wet: crumbWalk.wet,
    xe: (S.xeN || 0) - xe0,
    at: B.feet(),
    d: Math.round(B.hdist(B.pos(), to)),
  });
  return B.hdist(B.pos(), to) <= 24;
}

async function goHome(FOOD, home, maxMs) {
  if (B.hdist(B.pos(), home) <= 24) return true;
  const until0 = now() + maxMs;

  if (CR.list && CR.list.length >= 3) {
    stopCrumbs();
    if (await crumbWalk(home, Math.max(3e4, until0 - now()))) return true;

    for (let w = 0; w < 2 && crumbWalk.wet && now() < until0; w++) {
      log("wet loop: swim", {
        w,
        at: B.feet(),
        d: Math.round(B.hdist(B.pos(), home)),
      });
      await farDrop(home, Math.min(9e4, Math.max(3e4, until0 - now())));
      if (B.hdist(B.pos(), home) <= 24) return true;
      if (await crumbWalk(home, Math.max(3e4, until0 - now()))) return true;
    }
  }

  B.setMovements({});
  await B.goto(new B.goals.GoalNear(home.x, home.y, home.z, 6), {
    timeoutMs: Math.max(5e3, Math.min(maxMs, 9e4)),
    stuckMs: 8e3,
  });
  if (B.hdist(B.pos(), home) <= 24) return true;
  for (let i = 0; i < 3 && now() < until0 && B.hdist(B.pos(), home) > 24; i++) {
    log("home retry", {
      i,
      at: B.feet(),
      d: Math.round(B.hdist(B.pos(), home)),
    });
    if (i === 0)
      await farDrop(home, Math.min(6e4, Math.max(3e4, until0 - now())));
    else if (i === 1) {
      try {
        await FOOD.travelTo(home, () => now() > until0, 12, { oneWay: true });
      } catch (e) {
        log("home retry error", { err: String(e).slice(0, 160) });
      }
    } else await farDrop(home, Math.max(3e4, until0 - now()));
    B.setMovements({});
  }
  return B.hdist(B.pos(), home) <= 24;
}

async function farDrop(to, maxMs) {
  B.setMovements({
    maxDropDown: 10,
    towers: true,
    hardDig: true,
    digCost: 2,
    water: true,
  });

  if (process.env.AH_SWIMOK !== "0") B.S.swimOk = true;
  try {
    await B.goto(new B.goals.GoalNear(to.x, to.y, to.z, 6), {
      timeoutMs: Math.max(5e3, Math.min(maxMs, 1.2e5)),
      stuckMs: 1e4,
    });
  } catch (e) {
    log("far drop error", { err: String(e).slice(0, 160) });
  } finally {
    B.S.swimOk = false;
    B.setMovements({});
  }
  log("far drop", { at: B.feet(), d: Math.round(B.hdist(B.pos(), to)) });
}

async function knownLeg(FOOD, st) {
  const { home, F } = st;
  const v = F.village;
  if (!v || !v.at || haveHay(FOOD)) return;
  const d = B.hdist(v.at, home);
  if (d > 300 || !(v.hay >= 2 || (WANT_PIG && (v.farmland || 0) >= 8))) return;
  await approach(
    FOOD,
    st,
    v.at.clone ? v.at.clone() : new B.Vec3(v.at.x, v.at.y, v.at.z),
    () => haveHay(FOOD) && nearestHayD(FOOD) <= 60,
  );
}
function nearestHay(FOOD) {
  const F = FOOD.F,
    me = B.pos();
  let best = null;
  for (const p of F.hay || [])
    if (!best || B.hdist(p, me) < B.hdist(best, me)) best = p;
  if (!best && !WANT_WHEAT)
    for (const p of F.farmland || [])
      if (!best || B.hdist(p, me) < B.hdist(best, me)) best = p;
  return best;
}
function nearestHayD(FOOD) {
  const p = nearestHay(FOOD);
  return p ? B.hdist(p, B.pos()) : 1e9;
}

async function approach(FOOD, st, target, done) {
  const { t0, end, home } = st;
  const d = B.hdist(target, B.pos());
  const outEnd = Math.min(
    end - 3e4,
    now() + Math.max(4e4, (d / 2.5) * 1e3 + 2e4),
  );
  let lastScan = now(),
    tries = 0;
  const stop = () => {
    if (now() - lastScan > 5e3) ((lastScan = now()), FOOD.scan(true));
    return (
      B.hdist(B.pos(), target) <= 24 ||
      (done && done()) ||
      now() > outEnd ||
      B.timeLeft() < 4.5e5
    );
  };
  for (; tries < 3 && !stop(); tries++) {
    if (tries === 2) B.setMovements({ ...OUT_MOVES, water: true });
    await B.goto(new B.goals.GoalNearXZ(target.x, target.z, 12), {
      timeoutMs: Math.max(3e3, outEnd - now()),
      stuckMs: 8e3,
      until: stop,
    });
    if (tries === 2) B.setMovements(OUT_MOVES);
  }
  FOOD.scan(true);
  log("approach", {
    to: target,
    at: B.feet(),
    out: Math.round(B.hdist(B.pos(), home)),
    tries,
    hay_now: (FOOD.F.hay || []).length,
    hayD: Math.round(nearestHayD(FOOD)),
    found: haveHay(FOOD),
    ms: now() - t0,
  });
}

async function legs(ctx, FOOD, pen, targets, st) {
  const { t0, end, home, ranked, F, opts } = st;
  await knownLeg(FOOD, st);
  let leg = 0;

  const far = opts.far || 220;
  for (const d of ranked.slice(0, opts.noExplore ? 0 : 2)) {
    if (haveHay(FOOD)) break;
    const left = end - now();

    if (left < (leg ? 1.2e5 : 5e4)) break;
    leg++;

    const share = leg === 1 ? left * 0.6 : left;
    const outEnd = now() + share / 2;
    const a = (d.deg * Math.PI) / 180,
      tx = Math.round(home.x + Math.sin(a) * far),
      tz = Math.round(home.z - Math.cos(a) * far);
    let lastScan = now();
    const p0 = B.pos().clone();

    if (leg > 1) startCrumbs(home);
    const stop = () => {
      if (now() - lastScan > 6e3) ((lastScan = now()), FOOD.scan(true));
      return haveHay(FOOD) || now() > outEnd || B.timeLeft() < 4.5e5;
    };

    for (
      let a = 0;
      a < 3 && !stop() && B.hdist(B.pos(), new B.Vec3(tx, 0, tz)) > 12;
      a++
    ) {
      if (a === 2) B.setMovements({ ...OUT_MOVES, water: true });
      await B.goto(new B.goals.GoalNearXZ(tx, tz, 8), {
        timeoutMs: Math.max(3e3, outEnd - now()),
        stuckMs: 8e3,
        until: stop,
      });
      if (a === 2) B.setMovements(OUT_MOVES);
    }
    FOOD.scan(true);
    log("leg", {
      leg,
      deg: d.deg,
      at: B.feet(),
      out: Math.round(B.hdist(B.pos(), home)),
      walked: Math.round(B.hdist(B.pos(), p0)),
      found: haveHay(FOOD),
      village: F.village,
      ms: now() - t0,
    });
    if (haveHay(FOOD)) break;
    if (leg === 1 && !(await goHome(FOOD, home, Math.max(3e4, end - now()))))
      break;
  }
  let wheat0 = B.count("wheat") + 9 * B.count("hay_block");
  if (haveHay(FOOD) && nearestHayD(FOOD) > 60) {
    const h = nearestHay(FOOD);
    if (h) await approach(FOOD, st, h.clone(), () => nearestHayD(FOOD) <= 24);
  }

  stopCrumbs();
  if (haveHay(FOOD)) {
    const vd = Math.round(B.hdist(F.village.at, home));

    const oldMax = F.maxDist,
      oldHome = F.home;
    F.maxDist = vd + 60;
    F.home = home.clone();
    const want = WANT_WHEAT
      ? Math.min(160, (targets.cow || 0) * 22 + (targets.sheep || 0) * 6 + 24)
      : 0;
    try {
      const need = want ? { wheat: want } : {};
      if (targets.pig) need.pig = 8 * targets.pig + 8;

      await FOOD.gather(
        {
          ...ctx,
          home,
          maxDist: vd + 60,
          ...(process.env.AH_TRIPSHEARS === "1" ? {} : { autoShears: false }),
        },
        need,
        now() +
          Math.min(
            1.5e5,
            Math.max(4e4, B.timeLeft() - 4.8e5 - (vd / 2.6) * 1e3),
          ),
      );
    } catch (e) {
      log("gather error", { err: String(e).slice(0, 200) });
    }
    F.maxDist = oldMax;
    F.home = oldHome;
  }
  const got = B.count("wheat") + 9 * B.count("hay_block") - wheat0;
  await goHome(FOOD, home, Math.max(3e4, Math.min(2e5, B.timeLeft() - 1e5)));
  log("end", {
    found: haveHay(FOOD) || got > 0,
    got,
    wheat: B.count("wheat"),
    hay: B.count("hay_block"),
    back: Math.round(B.hdist(B.pos(), home)),
    ms: now() - t0,
    left_s: Math.round(B.timeLeft() / 1e3),
  });
  return { found: got > 0, wheat: got, ms: now() - t0 };
}

module.exports = { run, biomeShares, biomeAt, farDrop, crumbWalk };
