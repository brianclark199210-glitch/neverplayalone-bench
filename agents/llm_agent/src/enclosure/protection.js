const B = require("../runtime/connection");

const bot = () => B.S.bot;
const now = () => B.now();
const log = (m, d = {}) => B.log("ah guard " + m, d);
const r1 = (x) => Math.round(x * 10) / 10;
const P = (p) => (p ? { x: r1(p.x), y: r1(p.y), z: r1(p.z) } : null);

const PREY = {
  wolf: ["sheep", "rabbit"],
  fox: ["chicken", "rabbit"],
  cat: ["rabbit", "chicken"],
  ocelot: ["chicken"],
};

const WEAPONS = [
  [/_sword$/, 650],
  [/_axe$/, 1300],
  [/_pickaxe$/, 850],
  [/_shovel$/, 1000],
];
const G = {
  stats: { fights: 0, kills: {}, hits: 0, gateWaits: 0, prereg: 0 },
  hitWolfAt: 0,
  tried: new Map(),
  tickAt: 0,
};

function targets() {
  try {
    return require("../husbandry/animals").H.targets || {};
  } catch {
    return {};
  }
}
function valid(e) {
  return !!(
    e &&
    e.isValid !== false &&
    bot().entities[e.id] === e &&
    e.position
  );
}

function insideBox(pos, p) {
  return (
    pos.x >= p.x + 1 &&
    pos.x < p.x + p.w + 1 &&
    pos.z >= p.z + 1 &&
    pos.z < p.z + p.d + 1 &&
    pos.y > p.y - 2 &&
    pos.y < p.y + 6
  );
}

function fenceDist(pos, p) {
  const dx = Math.max(p.x + 1 - pos.x, 0, pos.x - (p.x + p.w + 1)),
    dz = Math.max(p.z + 1 - pos.z, 0, pos.z - (p.z + p.d + 1));
  return Math.hypot(dx, dz);
}
function isPredator(e) {
  const prey = e && PREY[e.name];
  if (!prey) return false;
  const T = targets();
  return prey.some((s) => T[s]);
}
function predators(at, r, dy = 6) {
  const out = [];
  for (const e of Object.values(bot().entities || {}))
    if (
      isPredator(e) &&
      Math.hypot(e.position.x - at.x, e.position.z - at.z) <= r &&
      Math.abs(e.position.y - at.y) <= dy
    )
      out.push(e);
  return out;
}
function weapon(noSword) {
  for (const [rx, cd] of WEAPONS) {
    if (noSword && rx.source === "_sword$") continue;
    const it = bot()
      .inventory.items()
      .find((i) => rx.test(i.name));
    if (it) return { name: it.name, cd };
  }
  return null;
}

function bystanders(e) {
  const me = bot().entity;
  return Object.values(bot().entities || {}).filter(
    (a) =>
      a !== e &&
      a !== me &&
      a.position &&
      a.type !== "object" &&
      a.name !== "item" &&
      a.name !== "experience_orb" &&
      Math.hypot(a.position.x - e.position.x, a.position.z - e.position.z) <=
        2.5 &&
      Math.abs(a.position.y - e.position.y) <= 2,
  );
}
const eyeDist = (e) =>
  e.position.offset(0, (e.height || 0.6) / 2, 0).distanceTo(B.eye());
function canFight(e) {
  const h = bot().health ?? 20;
  return h >= 5 && (e.name !== "wolf" || h >= 8);
}

async function approach(e, p) {
  const me = B.pos();
  if (p && insideBox(me, p) && !insideBox(e.position, p)) {
    const cx = Math.min(
        Math.max(Math.floor(e.position.x), p.x + 2),
        p.x + p.w - 1,
      ),
      cz = Math.min(Math.max(Math.floor(e.position.z), p.z + 2), p.z + p.d - 1);
    await B.goto(new B.goals.GoalNear(cx, p.y, cz, 0.6), {
      timeoutMs: 6e3,
      stuckMs: 2500,
      until: () => !valid(e),
    });

    const waitMs = e.name === "wolf" && now() - G.hitWolfAt < 4e4 ? 6e3 : 1.5e3;
    for (const t0 = now(); now() - t0 < waitMs && valid(e) && eyeDist(e) > 3.0;)
      await B.sleep(200);
  } else {
    if (p && !insideBox(me, p) && insideBox(e.position, p)) return false;

    await B.goto(new B.goals.GoalFollow(e, 1.4), {
      timeoutMs: 5e3,
      stuckMs: 2500,
      dynamic: true,
      until: () => !valid(e) || eyeDist(e) <= 2.6,
    });
  }
  return valid(e) && eyeDist(e) <= 3.1;
}

async function kill(e, p, maxMs = 2e4) {
  if (!valid(e) || !canFight(e)) return false;
  const t0 = now(),
    sp = e.name,
    id = e.id,
    from = P(e.position);
  let hits = 0,
    misses = 0,
    last = e.position.clone();
  G.stats.fights++;
  let w = weapon();
  if (w) await B.equip(w.name);
  B.setMovements({ sprint: true, canDig: false, maxDropDown: 2 });
  try {
    while (now() - t0 < maxMs && valid(e) && B.hasBot()) {
      if (!canFight(e)) break;

      if (sp === "wolf" && p && insideBox(B.pos(), p) === false) break;
      if (eyeDist(e) > 3.0) {
        if (!(await approach(e, p))) {
          if (++misses >= 3) break;
          await B.sleep(400);
          continue;
        }
      }
      last = e.position.clone();

      const held = bot().heldItem;
      if (held && /_sword$/.test(held.name) && bystanders(e).length) {
        w = weapon(true);
        G.stats.swordSwaps = (G.stats.swordSwaps || 0) + 1;
        if (w) await B.equip(w.name);
        else
          try {
            await B.withTimeout(bot().unequip("hand"), 2e3, "unequip");
          } catch {}
        if (bot().heldItem && /_sword$/.test(bot().heldItem.name)) break;
        continue;
      }
      try {
        await bot().lookAt(
          e.position.offset(0, (e.height || 0.6) * 0.6, 0),
          true,
        );
      } catch {}
      try {
        bot().attack(e);
      } catch {}
      hits++;
      G.stats.hits++;
      if (sp === "wolf") G.hitWolfAt = now();
      await B.sleep(w ? w.cd : 550);
    }
  } finally {
    B.setMovements({});
  }
  const gone = !valid(e);
  if (gone) G.stats.kills[sp] = (G.stats.kills[sp] || 0) + 1;
  log(gone ? "kill" : "fight end", {
    sp,
    id,
    hits,
    ms: now() - t0,
    from,
    at: P(last),
    weapon: w ? w.name : "hand",
    health: bot().health,
    me: P(B.pos()),
  });
  return gone;
}

async function clearPen(p, enter) {
  const t0 = now();
  for (let k = 0; k < 4 && now() - t0 < 4.5e4; k++) {
    const inn = predators(
      { x: p.x + 1 + p.w / 2, z: p.z + 1 + p.d / 2, y: p.y },
      p.w + p.d,
      6,
    ).filter((e) => insideBox(e.position, p));
    if (!inn.length)
      return k > 0 ? (log("pen cleared", { ms: now() - t0 }), true) : true;
    G.stats.prereg++;
    log("predator in pen", {
      before: "register",
      n: inn.length,
      sp: inn.map((e) => e.name),
      at: inn.map((e) => P(e.position)),
    });
    if (!insideBox(B.pos(), p) && !(await enter())) return false;
    inn.sort(
      (a, b) => a.position.distanceTo(B.pos()) - b.position.distanceTo(B.pos()),
    );
    await kill(inn[0], p, 2e4);
  }
  return false;
}

async function tick(o) {
  const p = o.p;
  if (!p || G.busy || now() - G.tickAt < 1000) return false;
  G.tickAt = now();
  const c = { x: p.x + 1 + p.w / 2, z: p.z + 1 + p.d / 2, y: p.y };
  const near = predators(c, Math.max(p.w, p.d) / 2 + 10, 6);
  if (!near.length) return false;
  const T = targets(),
    me = B.pos(),
    meIn = insideBox(me, p);

  const inn = near.filter((e) => insideBox(e.position, p));
  if (inn.length) {
    const e = inn.sort(
      (a, b) => a.position.distanceTo(me) - b.position.distanceTo(me),
    )[0];
    if (!tryOk(e)) return false;
    log("predator in pen", {
      sp: e.name,
      id: e.id,
      at: P(e.position),
      me_in: meIn,
    });
    if (!meIn && !(await o.goIn())) return true;
    const ok = await kill(e, p, 2.5e4);
    tried(e, ok);
    return true;
  }

  for (const e of near) {
    if (fenceDist(e.position, p) > 2.5 || !tryOk(e)) continue;
    const prey = Object.values(bot().entities || {}).filter(
      (a) =>
        a.position &&
        PREY[e.name].includes(a.name) &&
        T[a.name] &&
        insideBox(a.position, p) &&
        a.position.distanceTo(e.position) <= 3.5,
    );
    const angry = e.name === "wolf" && now() - G.hitWolfAt < 4e4;
    if (!prey.length && !angry) continue;

    if (!meIn && (e.name === "wolf" || B.hdist(me, e.position) > 24)) {
      if (B.hdist(me, c) >= 40) continue;
      if (!(await o.goIn()) || !insideBox(B.pos(), p))
        return (tried(e, false), true);
    }
    if (!canFight(e)) {
      tried(e, false);
      if (o.gather) await o.gather();
      return true;
    }
    log("predator at fence", {
      sp: e.name,
      id: e.id,
      at: P(e.position),
      prey: prey.length,
      angry,
      me_in: insideBox(B.pos(), p),
    });
    const ok = await kill(e, p, 1.5e4);
    tried(e, ok);

    if (!ok && valid(e) && o.gather) await o.gather();
    return true;
  }
  return false;
}

function tryOk(e) {
  const t = G.tried.get(e.id);
  return !t || t.n < 3 || now() - t.at > 1.2e5;
}
function tried(e, ok) {
  if (ok) return G.tried.delete(e.id);
  const t = G.tried.get(e.id) || { n: 0, at: 0 };
  G.tried.set(e.id, { n: now() - t.at > 1.2e5 ? 1 : t.n + 1, at: now() });
}

const nearGate = (gp, p) =>
  predators(gp, 10, 4).filter(
    (e) =>
      (!p || !insideBox(e.position, p)) &&
      (e.name === "wolf" ||
        Math.hypot(e.position.x - gp.x, e.position.z - gp.z) <= 7),
  );
async function beforeGate(gp, p) {
  const t0 = now();
  let waited = false;
  while (now() - t0 < 3e4 && B.hasBot()) {
    const near = nearGate(gp, p);
    if (!near.length) break;
    const meIn = p ? insideBox(B.pos(), p) : false;
    const small = near.find(
      (e) => e.name !== "wolf" && canFight(e) && tryOk(e),
    );
    const wolf = near.find((e) => e.name === "wolf" && canFight(e) && tryOk(e));
    if (small) {
      log("predator at gate", {
        sp: small.name,
        at: P(small.position),
        me_in: meIn,
      });
      tried(small, await kill(small, p, 8e3));
      continue;
    }

    const onUs =
      !meIn &&
      near.find((e) => e.name === "wolf" && eyeDist(e) <= 2.8 && canFight(e));
    if (onUs) {
      log("predator on us", {
        sp: "wolf",
        at: P(onUs.position),
        health: bot().health,
      });
      tried(onUs, await kill(onUs, null, 8e3));
      continue;
    }
    if (wolf && meIn && p && !insideBox(wolf.position, p)) {
      log("predator at gate", {
        sp: "wolf",
        at: P(wolf.position),
        me_in: meIn,
      });
      tried(wolf, await kill(wolf, p, 8e3));
      continue;
    }
    if (!waited)
      ((waited = true),
        G.stats.gateWaits++,
        log("gate wait", { sp: near.map((e) => e.name), me_in: meIn }));
    await B.sleep(500);
  }
  const left = nearGate(gp, p);
  if (waited || left.length)
    log("gate wait done", {
      ms: now() - t0,
      left: left.length,
      open: !left.length,
    });
  return !left.length;
}

async function afterGate(p, goIn) {
  if (!p || G.busy) return;
  const c = { x: p.x + 1 + p.w / 2, z: p.z + 1 + p.d / 2, y: p.y };
  const inn = predators(c, p.w + p.d, 6).filter((e) =>
    insideBox(e.position, p),
  );
  if (!inn.length) return;
  G.busy = true;
  try {
    log("predator slipped in", {
      sp: inn.map((e) => e.name),
      me_in: insideBox(B.pos(), p),
    });
    if (!insideBox(B.pos(), p) && !(await goIn())) return;
    for (const e of inn)
      if (valid(e) && insideBox(e.position, p))
        tried(e, await kill(e, p, 2.5e4));
  } finally {
    G.busy = false;
  }
}

module.exports = {
  clearPen,
  tick,
  beforeGate,
  afterGate,
  kill,
  predators,
  insideBox,
  G,
  PREY,
};
