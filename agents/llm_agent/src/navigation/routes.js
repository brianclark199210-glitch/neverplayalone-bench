const B = require("../runtime/connection");

const bot = () => B.S.bot;

const PASS = 0,
  FLOOR = 1,
  WALL = 2,
  WATER = 3,
  HAZ = 4,
  UNK = 5;
const HAZ_RX =
  /^(lava|fire|soul_fire|cactus|sweet_berry_bush|powder_snow|magma_block|campfire|soul_campfire|cobweb|wither_rose|pointed_dripstone)$/;
const WATER_RX =
  /^(water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/;

const kindBySid = new Map();
function classify(b) {
  const name = b.name;
  if (HAZ_RX.test(name)) return HAZ;
  let props = {};
  try {
    props = b.getProperties() || {};
  } catch {}
  if (
    WATER_RX.test(name) ||
    props.waterlogged === true ||
    props.waterlogged === "true"
  )
    return WATER;
  const shapes = b.shapes || [];
  if (!shapes.length) return PASS;
  const top = Math.max(...shapes.map((s) => s[4]));
  if (top <= 0.2) return PASS;
  if (/(_fence|_wall|_fence_gate|^iron_bars|_pane)$/.test(name)) return WALL;
  return top >= 0.5 ? FLOOR : WALL;
}
function kindAt(x, y, z) {
  const w = bot().world,
    p = B.v3(x, y, z);
  let sid;
  try {
    sid = w.getBlockStateId(p);
  } catch {
    sid = undefined;
  }
  if (sid === 0) {
    try {
      if (!w.getColumnAt(p)) return UNK;
    } catch {}
    return PASS;
  }
  if (sid === undefined || sid === null) return UNK;
  let k = kindBySid.get(sid);
  if (k === undefined) {
    const b = B.blockAt(p);
    if (!b) return UNK;
    k = classify(b);
    kindBySid.set(sid, k);
  }
  return k;
}

async function plan(from, to, opts = {}) {
  const t0 = Date.now(),
    M = opts.margin || 24,
    maxExp = opts.maxExp || 40000,
    maxMs = opts.maxMs || 1500;
  const x0 = Math.min(from.x, to.x) - M,
    z0 = Math.min(from.z, to.z) - M,
    y0 = Math.min(from.y, to.y) - 16,
    NX = Math.abs(from.x - to.x) + 2 * M + 1,
    NZ = Math.abs(from.z - to.z) + 2 * M + 1,
    NY = Math.abs(from.y - to.y) + 33;
  if (NX * NZ * NY > 4e6) return { ok: false, why: "too far" };
  const kinds = new Int8Array(NX * NY * NZ).fill(-1);
  const idx = (x, y, z) => ((x - x0) * NZ + (z - z0)) * NY + (y - y0);
  const inBox = (x, y, z) =>
    x >= x0 && x < x0 + NX && z >= z0 && z < z0 + NZ && y >= y0 && y < y0 + NY;
  const kind = (x, y, z) => {
    if (!inBox(x, y, z)) return UNK;
    const i = idx(x, y, z);
    let k = kinds[i];
    if (k < 0) kinds[i] = k = kindAt(x, y, z);
    return k;
  };
  const pass = (x, y, z) => kind(x, y, z) === PASS;
  const stand = (x, y, z) =>
    kind(x, y - 1, z) === FLOOR && pass(x, y, z) && pass(x, y + 1, z);

  const riskMemo = new Map();
  const risk = (x, y, z) => {
    const i = idx(x, y, z);
    let r = riskMemo.get(i);
    if (r !== undefined) return r;
    r = 0;
    let edge = 0;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const cx = x + dx,
        cz = z + dz;
      if (!pass(cx, y, cz)) {
        if (kind(cx, y, cz) === HAZ || kind(cx, y + 1, cz) === HAZ) r += 6;
        continue;
      }
      if (
        stand(cx, y, cz) ||
        stand(cx, y + 1, cz) ||
        stand(cx, y - 1, cz) ||
        stand(cx, y - 2, cz)
      ) {
        if (kind(cx, y - 1, cz) === HAZ) r += 6;
        continue;
      }
      let k = PASS;
      for (let d = 1; d <= 4 && k === PASS; d++) k = kind(cx, y - d, cz);
      if (k === WATER) r += 1.5;
      else if (k === HAZ) r += 8;
      else ((r += 6), edge++);
    }

    if (edge >= 2) r += 25;
    if (kind(x, y - 1, z) === FLOOR) {
      try {
        const b = B.blockAt(B.v3(x, y - 1, z));
        if (b && b.name === "farmland") r += 2;
      } catch {}
    }
    riskMemo.set(i, r);
    if (edge) edgeCells.add(i);
    return r;
  };
  const edgeCells = new Set();

  let s = null;
  for (const dy of [0, 1, -1, 2, -2])
    if (!s && stand(from.x, from.y + dy, from.z))
      s = { x: from.x, y: from.y + dy, z: from.z };
  if (!s)
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      for (const dy of [0, 1, -1])
        if (!s && stand(from.x + dx, from.y + dy, from.z + dz))
          s = { x: from.x + dx, y: from.y + dy, z: from.z + dz };
  if (!s) return { ok: false, why: "no start", ms: Date.now() - t0 };
  const isGoal = (x, y, z) =>
    Math.abs(x - to.x) + Math.abs(z - to.z) <= 1 && Math.abs(y - to.y) <= 1;
  const h = (x, z) => Math.hypot(x - to.x, z - to.z);

  const heap = [];
  const push = (f, i) => {
    heap.push([f, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0],
      last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1,
          r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  const decode = (i) => {
    const y = (i % NY) + y0,
      r = Math.floor(i / NY),
      z = (r % NZ) + z0,
      x = Math.floor(r / NZ) + x0;
    return { x, y, z };
  };
  const g = new Map(),
    parent = new Map(),
    closed = new Set();
  const si = idx(s.x, s.y, s.z);
  g.set(si, 0);
  push(h(s.x, s.z), si);
  let exp = 0,
    end = -1;
  const DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  while (heap.length) {
    const [, ci] = pop();
    if (closed.has(ci)) continue;
    closed.add(ci);
    const c = decode(ci);
    if (isGoal(c.x, c.y, c.z)) {
      end = ci;
      break;
    }
    if (++exp > maxExp) break;
    if (exp % 2500 === 0) {
      if (Date.now() - t0 > maxMs) break;
      await new Promise((r) => setImmediate(r));
    }
    const gc = g.get(ci);
    for (const [dx, dz] of DIRS) {
      const nx = c.x + dx,
        nz = c.z + dz;
      let ny = null,
        step = 0;
      if (dx && dz) {
        if (
          stand(nx, c.y, nz) &&
          stand(c.x + dx, c.y, c.z) &&
          stand(c.x, c.y, c.z + dz)
        )
          ny = c.y;
      } else if (stand(nx, c.y, nz)) ny = c.y;
      else if (stand(nx, c.y + 1, nz) && pass(c.x, c.y + 2, c.z))
        ((ny = c.y + 1), (step = 0.6));
      else if (stand(nx, c.y - 1, nz) && pass(nx, c.y + 1, nz))
        ((ny = c.y - 1), (step = 0.4));
      else if (
        stand(nx, c.y - 2, nz) &&
        pass(nx, c.y, nz) &&
        pass(nx, c.y + 1, nz)
      )
        ((ny = c.y - 2), (step = 0.9));
      if (ny === null) continue;
      const ni = idx(nx, ny, nz);
      if (closed.has(ni)) continue;
      const ng = gc + (dx && dz ? 1.414 : 1) + step + risk(nx, ny, nz);
      if (ng < (g.get(ni) ?? Infinity)) {
        g.set(ni, ng);
        parent.set(ni, ci);
        push(ng + h(nx, nz), ni);
      }
    }
  }
  const ms = Date.now() - t0;
  if (end < 0)
    return {
      ok: false,
      why:
        exp > maxExp ? "budget" : Date.now() - t0 > maxMs ? "time" : "no route",
      ms,
      exp,
    };
  const path = [];
  let edge = 0;
  for (let i = end; i !== undefined; i = parent.get(i)) {
    const c = decode(i);
    path.push(B.v3(c.x, c.y, c.z));
    if (edgeCells.has(i)) edge++;
  }
  path.reverse();
  return {
    ok: true,
    path,
    len: path.length,
    edge,
    cost: Math.round(g.get(end)),
    ms,
    exp,
  };
}

function nearest(path, pos, from = 0) {
  let best = from,
    bd = Infinity;
  for (let i = Math.max(0, from - 2); i < path.length; i++) {
    const c = path[i],
      d =
        Math.hypot(c.x + 0.5 - pos.x, c.z + 0.5 - pos.z) +
        Math.abs(c.y - pos.y) * 0.5;
    if (d < bd) ((bd = d), (best = i));
  }
  return { i: best, d: bd };
}

module.exports = { plan, nearest };
