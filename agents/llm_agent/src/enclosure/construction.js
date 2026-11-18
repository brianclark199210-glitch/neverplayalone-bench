"use strict";

const B = require("../runtime/connection");
const { Vec3 } = require("vec3");

const VERSION = "pn-v1.50",
  W = 20,
  D = 20,
  REACH = 4.7,
  FILL_S = 0.7,
  BORROW_S = 2.2,
  WATER_S = 30,
  TOOL_S = 32,
  ROOF_S = 1.5,
  PREFER_BONUS = 150,
  GRASS_SHEEP_S = 3,
  WALK_S = 0.8,
  PREFER_S = 0.3,
  INF = 1e5;

const P = {
  site: null,
  pen: null,
  mine: new Set(),
  info: new Map(),
  waiters: [],
  hookedBot: null,
  lastCmd: 0,
  skip: new Map(),
  redo: new Map(),
  fails: new Map(),
  stats: {
    digs: 0,
    fills: 0,
    fences: 0,
    borrow: 0,
    collect: 0,
    approach: 0,
    approachFail: 0,
  },
  tm: {},
};

const AIR = 0,
  PLANT = 1,
  HAZ = 2,
  LIQ = 3,
  GROUND = 4,
  TREE = 5,
  OBST = 6,
  LAVA = 7;
const HAZ_NAMES = new Set([
  "sweet_berry_bush",
  "powder_snow",
  "cobweb",
  "fire",
  "soul_fire",
  "wither_rose",
]);
const LIQ_NAMES = new Set([
  "water",
  "bubble_column",
  "kelp",
  "kelp_plant",
  "seagrass",
  "tall_seagrass",
]);
const REPL_NAMES = new Set([
  "air",
  "cave_air",
  "void_air",
  "short_grass",
  "tall_grass",
  "fern",
  "large_fern",
  "dead_bush",
  "vine",
  "glow_lichen",
  "short_dry_grass",
  "tall_dry_grass",
  "bush",
]);
const TREE_RX =
  /(_log|_wood|_stem|_hyphae|_leaves|mushroom_block|^mushroom_stem|^bamboo|^mangrove_roots|^bee_nest)$/;
const YIELD_RX =
  /^(grass_block|dirt|coarse_dirt|podzol|mycelium|rooted_dirt|sand|red_sand|gravel|moss_block|dirt_path|farmland|[a-z_]+_log|[a-z_]+_planks)$/;

const FILL_ITEMS = [
  "dirt",
  "coarse_dirt",
  "rooted_dirt",
  "cobblestone",
  "cobbled_deepslate",
  "sand",
  "red_sand",
  "gravel",
  "stone",
  "andesite",
  "diorite",
  "granite",
  "tuff",
  "deepslate",
  "sandstone",
  "red_sandstone",
  "moss_block",
  "netherrack",
  "terracotta",
  "oak_log",
  "birch_log",
  "spruce_log",
  "jungle_log",
  "acacia_log",
  "dark_oak_log",
  "cherry_log",
  "mangrove_log",
  "pale_oak_log",
];
const FILL_SET = new Set(FILL_ITEMS);
const STONE_RX =
  /^(stone|cobblestone|deepslate|cobbled_deepslate|andesite|diorite|granite|tuff|sandstone|red_sandstone|calcite|([a-z_]+_)?terracotta)$/;

const bot = () => B.S.bot;
const v3 = (x, y, z) => new Vec3(x, y, z);
const key = (x, y, z) => `${x},${y},${z}`;
const now = () => Date.now();

function isFullShape(s) {
  return (
    !!s &&
    s.length === 1 &&
    Math.abs(s[0][0]) < 1e-6 &&
    Math.abs(s[0][1]) < 1e-6 &&
    Math.abs(s[0][2]) < 1e-6 &&
    Math.abs(s[0][3] - 1) < 1e-6 &&
    Math.abs(s[0][4] - 1) < 1e-6 &&
    Math.abs(s[0][5] - 1) < 1e-6
  );
}

function classify(b) {
  const name = b.name;
  let props = {};
  try {
    props = b.getProperties() || {};
  } catch {}
  const shapes = b.shapes || [];
  let cls;
  if (name === "air" || name === "cave_air" || name === "void_air") cls = AIR;
  else if (name === "lava") cls = LAVA;
  else if (
    LIQ_NAMES.has(name) ||
    props.waterlogged === true ||
    props.waterlogged === "true"
  )
    cls = LIQ;
  else if (HAZ_NAMES.has(name)) cls = HAZ;
  else if (!shapes.length) cls = PLANT;
  else if (TREE_RX.test(name)) cls = TREE;
  else if (isFullShape(shapes) && name !== "magma_block") cls = GROUND;
  else cls = OBST;
  let hard = b.hardness;
  if (hard == null || hard < 0) hard = 1e3;
  const needTool = !!(b.harvestTools && Object.keys(b.harvestTools).length);
  const repl =
    REPL_NAMES.has(name) || (name === "snow" && String(props.layers) === "1");
  const mat = b.material || "",
    toolKind = /pickaxe/.test(mat)
      ? "pickaxe"
      : /shovel/.test(mat)
        ? "shovel"
        : /axe/.test(mat)
          ? "axe"
          : null;

  const woodOk =
    !needTool ||
    (toolKind === "pickaxe" &&
      !/(iron|gold|diamond|emerald|redstone|lapis|copper)_ore|obsidian/.test(
        name,
      ));
  return {
    name,
    cls,
    repl,
    full: isFullShape(shapes),

    floor:
      isFullShape(shapes) &&
      !/_leaves$/.test(name) &&
      name !== "magma_block" &&
      cls !== LIQ &&
      cls !== LAVA,
    pass: !shapes.length,
    gravity:
      /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|[a-z_]+_concrete_powder)$/.test(
        name,
      ),

    dig: hard * (needTool ? 5 : 1.5) + 0.35,
    yld: !needTool && YIELD_RX.test(name) ? 1 : 0,

    digT:
      (woodOk
        ? (hard * 1.5) / (toolKind ? 2 : 1)
        : hard * (needTool ? 5 : 1.5)) + 0.35,
    yldT:
      (woodOk || !needTool) && (YIELD_RX.test(name) || STONE_RX.test(name))
        ? 1
        : 0,
    fence: /_fence$/.test(name),
    gate: /_fence_gate$/.test(name),
  };
}

const UNLOADED = { name: "?", cls: -1, dig: INF, yld: 0 };
function infoAt(x, y, z) {
  const b0 = bot();
  let sid = null;
  const p = v3(x, y, z);
  try {
    sid = b0.world.getBlockStateId(p);
  } catch {}
  if (sid === 0) {
    try {
      if (!b0.world.getColumnAt(p)) return UNLOADED;
    } catch {}
  }
  if (sid === null || sid === undefined) {
    const b = B.blockAt(p);
    return b ? classify(b) : UNLOADED;
  }
  let inf = P.info.get(sid);
  if (!inf) {
    const b = B.blockAt(p);
    if (!b) return UNLOADED;
    inf = classify(b);
    P.info.set(sid, inf);
  }
  return inf;
}

function scanRegion(c, R, yLo, yHi) {
  const n = 2 * R + 1,
    H = yHi - yLo + 1,
    cols = new Array(n * n),
    world = bot().world,
    q = { x: 0, y: 0, z: 0 };
  let unloaded = 0,
    slow = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x = c.x - R + i,
        z = c.z - R + j,
        col = new Array(H);
      let chunk = null;
      try {
        chunk = world.getColumnAt(v3(x, 0, z));
      } catch {}
      if (!chunk) {
        cols[i * n + j] = null;
        unloaded++;
        continue;
      }
      let bad = false;
      for (let k = 0; k < H; k++) {
        let inf = null;
        q.x = x & 15;
        q.y = yLo + k;
        q.z = z & 15;
        let sid;
        try {
          sid = chunk.getBlockStateId(q);
        } catch {
          sid = undefined;
        }
        if (sid !== undefined && sid !== null) inf = P.info.get(sid);
        if (!inf) ((inf = infoAt(x, yLo + k, z)), slow++);
        if (inf.cls < 0) {
          bad = true;
          break;
        }
        col[k] = inf;
      }
      cols[i * n + j] = bad ? null : col;
      bad && unloaded++;
    }
  return { cols, n, H, yLo, x0: c.x - R, z0: c.z - R, unloaded, slow };
}

const NOCOST = [INF, 0, 0, 0, INF, 0, 0];
function cellCost(col, k, perim) {
  const H = col.length;
  if (k < 6 || k + 3 >= H) return NOCOST;
  let t = 0,
    tt = 0,
    fill = 0,
    yld = 0,
    yt = 0;
  const f = col[k];
  if (f.cls === LAVA) return NOCOST;
  if (!f.floor) {
    let y = k;
    while (
      y > k - 6 &&
      !(
        col[y - 1].cls === GROUND ||
        col[y - 1].cls === OBST ||
        col[y - 1].cls === TREE
      )
    )
      y--;
    if (y <= k - 6) return NOCOST;
    for (let yy = y; yy <= k; yy++) {
      const c = col[yy];
      if (c.cls === LAVA) return NOCOST;
      if (c.cls === LIQ) ((t += WATER_S), (tt += WATER_S));
      else if (c.cls !== AIR && !c.repl)
        ((t += c.dig), (tt += c.digT), (yld += c.yld), (yt += c.yldT));
      fill++;
      t += FILL_S;
      tt += FILL_S;
    }
  }
  const top = perim ? k + 1 : k + 2;
  for (let yy = k + 1; yy <= top; yy++) {
    const c = col[yy];
    if (c.cls === LAVA) return NOCOST;
    if (c.cls === LIQ) ((t += WATER_S), (tt += WATER_S));
    else if (c.cls === GROUND || c.cls === TREE || c.cls === OBST)
      ((t += c.dig), (tt += c.digT), (yld += c.yld), (yt += c.yldT));
    else if (c.cls === HAZ) ((t += 0.4), (tt += 0.4));
    else if (perim && c.cls === PLANT && !c.repl) ((t += 0.15), (tt += 0.15));
  }
  if (!perim) {
    for (let yy = k + 3; yy <= Math.min(H - 1, k + 5); yy++) {
      const c = col[yy];
      if (c.cls !== GROUND) break;
      t += c.gravity ? c.dig : 0.5;
      tt += c.gravity ? c.digT : 0.5;
    }
  }

  return [
    t,
    fill,
    yld,
    col[k + 1].cls === LIQ ? 1 : 0,
    tt,
    yt,
    f.name === "grass_block" ? 1 : 0,
  ];
}

function prefix(n, fn) {
  const S = new Float64Array((n + 1) * (n + 1));
  for (let i = 0; i < n; i++) {
    let row = 0;
    for (let j = 0; j < n; j++) {
      row += fn(i, j);
      S[(i + 1) * (n + 1) + j + 1] = S[i * (n + 1) + j + 1] + row;
    }
  }
  return S;
}
function rect(S, n, i0, j0, i1, j1) {
  i0 = Math.max(0, i0);
  j0 = Math.max(0, j0);
  i1 = Math.min(n - 1, i1);
  j1 = Math.min(n - 1, j1);
  if (i1 < i0 || j1 < j0) return 0;
  const m = n + 1;
  return (
    S[(i1 + 1) * m + j1 + 1] -
    S[i0 * m + j1 + 1] -
    S[(i1 + 1) * m + j0] +
    S[i0 * m + j0]
  );
}

function navGrid(sc, R) {
  const n = sc.n,
    N = n * n,
    h = new Int32Array(N).fill(-9999),
    pen = new Float32Array(N),
    wetc = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const col = sc.cols[i];
    if (!col) continue;
    for (let k = col.length - 3; k >= 0; k--) {
      const c = col[k];
      if (c.cls === AIR || c.cls === PLANT || c.cls === TREE) continue;
      if (c.cls === LAVA || c.cls === HAZ) break;
      if (c.cls === LIQ) {
        h[i] = sc.yLo + k;
        pen[i] = 4;
        wetc[i] = 1;
        break;
      }
      const a = col[k + 1],
        b = col[k + 2];
      const free = (x) => x.cls === AIR || x.cls === PLANT;
      if (c.cls === GROUND || c.cls === OBST) {
        h[i] = sc.yLo + k;
        pen[i] = (free(a) ? 0 : 2.5) + (free(b) ? 0 : 1.5);
      }
      break;
    }
  }
  const d = new Float64Array(N).fill(1e9),
    wetp = new Uint8Array(N),
    par = new Int32Array(N).fill(-1),
    start = R * n + R;
  if (h[start] < -999) {
    let bi = -1,
      bd = 1e9;
    for (let di = -2; di <= 2; di++)
      for (let dj = -2; dj <= 2; dj++) {
        const q = (R + di) * n + R + dj;
        if (h[q] > -999 && Math.hypot(di, dj) < bd)
          ((bd = Math.hypot(di, dj)), (bi = q));
      }
    if (bi < 0) return { d, par, h, n, R };
    d[bi] = 0;
  } else d[start] = 0;

  const heap = [];
  const push = (dv, idx) => {
    heap.push([dv, idx]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0],
      last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1,
          r = l + 1;
        let m = c;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  for (let i = 0; i < N; i++) if (d[i] === 0) push(0, i);
  const steps = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 1.414],
    [1, -1, 1.414],
    [-1, 1, 1.414],
    [-1, -1, 1.414],
  ];
  while (heap.length) {
    const [dv, idx] = pop();
    if (dv > d[idx]) continue;
    const i = (idx / n) | 0,
      j = idx % n,
      hy = h[idx];
    for (const [di, dj, w] of steps) {
      const a = i + di,
        b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const q = a * n + b,
        hq = h[q];
      if (hq < -999) continue;
      const dh = hq - hy;

      if (dh > 1 || dh < -8 || (dh < -3 && w > 1)) continue;
      if (
        w > 1 &&
        (h[i * n + b] < hq - 1 ||
          h[a * n + j] < hq - 1 ||
          h[i * n + b] > hy + 1 ||
          h[a * n + j] > hy + 1)
      )
        continue;
      const nd =
        dv + w * (1 + pen[q]) + (dh > 0 ? 0.6 : 0) + (dh < -3 ? 4 * -dh : 0);
      if (nd < d[q])
        ((d[q] = nd),
          (par[q] = idx),
          (wetp[q] = wetp[idx] | wetc[q]),
          push(nd, q));
    }
  }
  return { d, par, h, n, R, x0: sc.x0, z0: sc.z0, wet: wetc, wetp };
}

function navPath(x, z) {
  const nav = P.nav;
  if (!nav || nav.x0 === undefined) return [];
  const n = nav.n,
    i = x - nav.x0,
    j = z - nav.z0;
  if (i < 0 || j < 0 || i >= n || j >= n) return [];
  let q = i * n + j;
  if (!(nav.d[q] < 1e8)) return [];
  const pts = [];
  for (let guard = 0; q >= 0 && guard < 4 * n; guard++) {
    pts.push(q);
    q = nav.par[q];
  }
  pts.reverse();
  const out = [];
  out.wet = pts.some((p) => nav.wet && nav.wet[p]);
  for (let k = 12; k < pts.length; k += 12) {
    const p = pts[k];
    out.push(v3(nav.x0 + ((p / n) | 0), nav.h[p] + 1, nav.z0 + (p % n)));
  }
  return out;
}

function chooseSite(opts = {}) {
  const t0 = now(),
    me = B.feet(),
    R = opts.radius || 96,
    yLo = me.y - 26,
    yHi = me.y + 44;
  const sc = scanRegion(me, R, yLo, yHi),
    n = sc.n;
  const tScan = now() - t0;

  let logsNear = 0;
  for (let i = Math.max(0, R - 40); i <= Math.min(n - 1, R + 40); i++)
    for (let j = Math.max(0, R - 40); j <= Math.min(n - 1, R + 40); j++) {
      const col = sc.cols[i * n + j];
      if (col)
        for (const c of col)
          if (c.cls === TREE && /_log$/.test(c.name)) logsNear++;
    }
  const toolOk = logsNear >= 10 && !opts.noTools;

  let softNear = 0;
  for (let i = Math.max(0, R - 40); i <= Math.min(n - 1, R + 40); i++)
    for (let j = Math.max(0, R - 40); j <= Math.min(n - 1, R + 40); j++) {
      const col = sc.cols[i * n + j];
      if (!col) continue;
      for (let k = col.length - 2; k >= 0; k--) {
        const c = col[k];
        if (c.cls === AIR || c.cls === PLANT || c.cls === TREE) continue;
        if (c.cls === GROUND && c.yld) softNear++;
        break;
      }
    }
  const borrowS = softNear > 400 ? BORROW_S : softNear > 80 ? 5 : 14;
  const nav = navGrid(sc, R);
  P.nav = nav;
  const prefer = opts.prefer || null,
    chest = opts.avoid || [],
    grassW = opts.grassW ?? 0.03;
  let lavaBest = null;
  let best = null,
    bestR = null,
    bestDry = null,
    bestG = null;
  const tops = [];
  const N2 = n * n,
    cI = new Array(N2),
    cP = new Array(N2);
  const g = (arr, idx) => (i, j) => arr[i * n + j][idx];

  const hist = new Map();
  for (let i = 0; i < nav.h.length; i++)
    if (nav.h[i] > -999) hist.set(nav.h[i], (hist.get(nav.h[i]) || 0) + 1);
  const levels = new Set();
  const tot = [...hist.values()].reduce((a, b) => a + b, 0) || 1;
  for (const [hy, c] of hist)
    if (c / tot >= 0.01) for (const d of [-1, 0, 1]) levels.add(hy + d);
  for (let d = -3; d <= 2; d++) levels.add(me.y - 1 + d);
  const Fs = [...levels]
    .filter((F) => F - yLo >= 6 && F - yLo + 3 < sc.H)
    .sort((a, b) => a - b);
  for (const F of Fs) {
    const k = F - yLo;
    for (let i = 0; i < N2; i++) {
      const col = sc.cols[i];
      cI[i] = col ? cellCost(col, k, false) : NOCOST;
      cP[i] = col ? cellCost(col, k, true) : NOCOST;
    }
    const tI = prefix(n, g(cI, 0)),
      tP = prefix(n, g(cP, 0)),
      tIt = prefix(n, g(cI, 4)),
      tPt = prefix(n, g(cP, 4)),
      fillI = prefix(n, g(cI, 1)),
      fillP = prefix(n, g(cP, 1)),
      yI = prefix(n, g(cI, 2)),
      yP = prefix(n, g(cP, 2)),
      yIt = prefix(n, g(cI, 5)),
      yPt = prefix(n, g(cP, 5)),
      lq = prefix(n, g(cP, 3)),
      gr = prefix(n, g(cI, 6)),
      rf = prefix(n, (i, j) => {
        const col = sc.cols[i * n + j];
        if (!col) return 0;

        for (let yy = k + 5; yy <= Math.min(col.length - 1, k + 16); yy++)
          if (col[yy].cls === GROUND) return 1;
        return 0;
      }),
      lv = prefix(n, (i, j) => {
        const col = sc.cols[i * n + j];
        if (!col) return 0;
        for (
          let yy = Math.max(0, k - 3);
          yy <= Math.min(col.length - 1, k + 4);
          yy++
        )
          if (col[yy].cls === LAVA) return 1;
        return 0;
      });
    for (let i0 = 0; i0 + W + 1 < n; i0++)
      for (let j0 = 0; j0 + D + 1 < n; j0++) {
        const i1 = i0 + W + 1,
          j1 = j0 + D + 1;
        const ring = (S) =>
            rect(S, n, i0, j0, i1, j1) -
            rect(S, n, i0 + 1, j0 + 1, i1 - 1, j1 - 1),
          inner = (S) => rect(S, n, i0 + 1, j0 + 1, i1 - 1, j1 - 1);

        const nearLava = rect(lv, n, i0 - 8, j0 - 8, i1 + 8, j1 + 8) > 0;
        const tin = inner(tI);
        if (tin >= INF) continue;
        const tper = ring(tP);
        if (tper >= INF) continue;
        const fills = inner(fillI) + ring(fillP);
        const yh = inner(yI) + ring(yP),
          yt = inner(yIt) + ring(yPt);
        const hand = tin + tper + Math.max(0, fills - yh) * borrowS;
        const tool =
          inner(tIt) + ring(tPt) + Math.max(0, fills - yt) * BORROW_S + TOOL_S;

        const wet =
          rect(lq, n, i0 - 1, j0 - 1, i1 + 1, j1 + 1) -
          rect(lq, n, i0, j0, i1, j1);
        const X = sc.x0 + i0,
          Z = sc.z0 + j0,
          cx = X + 1 + W / 2,
          cz = Z + 1 + D / 2;

        let dq = (i0 + 11) * n + j0 + 11,
          dist = nav.d[dq];
        if (!(dist < 1e8))
          for (const [a, b] of [
            [i0, j0],
            [i1, j0],
            [i0, j1],
            [i1, j1],
            [i0 + 11, j0],
            [i0 + 11, j1],
            [i0, j0 + 11],
            [i1, j0 + 11],
          ])
            if (nav.d[a * n + b] < dist)
              ((dist = nav.d[a * n + b]), (dq = a * n + b));
        const reach = dist < 1e8,
          dry = reach && !nav.wetp[dq];
        if (!reach)
          dist = Math.hypot(cx - (me.x + 0.5), cz - (me.z + 0.5)) * 3 + 150;
        const tools = toolOk && tool < hand;

        let cost =
          (tools ? tool : hand) +
          wet * WATER_S +
          dist * WALK_S +
          (prefer ? 0 : 0.012 * Math.max(0, dist - 40) ** 2);

        const grass = inner(gr);
        cost += (W * D - grass) * grassW;
        const roof = inner(rf);
        cost += roof * ROOF_S;
        if (prefer) {
          const dp = Math.hypot(cx - prefer.x, cz - prefer.z);
          if (opts.maxDist && dp > opts.maxDist) continue;
          cost += dp * PREFER_S + 0.02 * Math.max(0, dp - 25) ** 2;
        }
        for (const a of chest)
          if (a.x >= X && a.x <= X + W + 1 && a.z >= Z && a.z <= Z + D + 1)
            cost += 6;
        if (nearLava) {
          if (!lavaBest || cost < lavaBest.cost)
            lavaBest = { X, Z, Y: F + 1, cost: Math.round(cost) };
          continue;
        }
        const pruned = best && cost > best.cost * 1.6 + 30;
        if (
          pruned &&
          !(reach && (!bestR || cost < bestR.cost)) &&
          !(reach && !nav.wetp[dq] && (!bestDry || cost < bestDry.cost)) &&
          !(grass >= 150 && (!bestG || cost < bestG.cost))
        )
          continue;
        const cand = {
          X,
          Y: F + 1,
          Z,
          F,
          cost,
          work: tools ? tool : hand,
          hand,
          tools,
          fills,
          net: fills - (tools ? yt : yh),
          wet,
          dist: Math.round(dist),
          reach,
          dry,
          grass,
          roof,
        };
        if (!best || cost < best.cost) best = cand;
        if (reach && (!bestR || cost < bestR.cost)) bestR = cand;
        if (dry && (!bestDry || cost < bestDry.cost)) bestDry = cand;
        if (grass >= 150 && (!bestG || cost < bestG.cost)) bestG = cand;
        if (!pruned) tops.push(cand);
      }
  }
  tops.sort((a, b) => a.cost - b.cost);
  const alt = [];
  for (const c of tops) {
    if (alt.length >= 4) break;
    if (
      alt.every(
        (a) =>
          Math.abs(a.X - c.X) > 6 || Math.abs(a.Z - c.Z) > 6 || a.Y !== c.Y,
      )
    )
      alt.push(c);
  }

  if (best) {
    let soft = 0;
    const i0 = best.X - sc.x0,
      j0 = best.Z - sc.z0;
    for (let i = Math.max(0, i0 - 16); i <= Math.min(n - 1, i0 + W + 17); i++)
      for (
        let j = Math.max(0, j0 - 16);
        j <= Math.min(n - 1, j0 + D + 17);
        j++
      ) {
        if (i >= i0 && i <= i0 + W + 1 && j >= j0 && j <= j0 + D + 1) continue;
        const hy = nav.h[i * n + j],
          col = sc.cols[i * n + j];
        if (hy < best.F || !col) continue;
        const c = col[hy - sc.yLo];
        if (c && c.cls === GROUND && c.yld) soft++;
      }
    best.softAround = soft;

    let lava = 0;
    for (let i = Math.max(0, i0 - 8); i <= Math.min(n - 1, i0 + W + 9); i++)
      for (let j = Math.max(0, j0 - 8); j <= Math.min(n - 1, j0 + D + 9); j++) {
        const col = sc.cols[i * n + j];
        if (!col) continue;
        const k0 = best.F - sc.yLo;
        for (
          let yy = Math.max(0, k0 - 6);
          yy <= Math.min(col.length - 1, k0 + 6);
          yy++
        )
          if (col[yy].cls === LAVA) {
            lava++;
            break;
          }
      }
    best.lava8 = lava;
  }
  let wetSpawn = 0;
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++)
      for (let dy = -1; dy <= 1; dy++)
        if (infoAt(me.x + dx, me.y + dy, me.z + dz).cls === LIQ) wetSpawn++;
  if (!opts.quiet)
    B.log("ah pen site", {
      wetSpawn,
      ms: now() - t0,
      scan_ms: tScan,
      levels: Fs.length,
      slow: sc.slow,
      logsNear,
      softNear,
      unloaded: sc.unloaded,
      me,
      best: best && round(best),
      bestDry: bestDry && bestDry !== best ? round(bestDry) : undefined,
      bestGrass: bestG && bestG !== best ? round(bestG) : undefined,
      lavaSkipped:
        lavaBest && (!best || lavaBest.cost < best.cost) ? lavaBest : undefined,
      alt: alt.slice(1).map(round),
    });
  if (best)
    ((best.alts = alt.slice(1)), (best.nav = nav), (best.bestDry = bestDry));

  if (best && !best.reach && bestR && !best.alts.includes(bestR))
    best.alts.splice(0, 0, bestR);
  return best;
}
const round = (c) => ({
  X: c.X,
  Y: c.Y,
  Z: c.Z,
  cost: Math.round(c.cost),
  work: Math.round(c.work),
  fills: c.fills,
  net: Math.round(c.net),
  wet: c.wet,
  dist: c.dist,
  reach: c.reach,
  dry: c.dry,
  roof: c.roof,
  lava8: c.lava8,
  soft: c.softAround,
  grass: c.grass,
  tools: c.tools,
  hand: Math.round(c.hand),
});

function setSite(c, prefer) {
  const X = c.X,
    Z = c.Z,
    Y = c.Y;
  const s = { X, Y, Z, F: Y - 1, R: X + W + 1, S: Z + D + 1 };
  s.center = v3(X + 1 + W / 2, Y, Z + 1 + D / 2);
  s.gate = pickGate(s, prefer);
  s.cand = c;
  P.site = s;
  return s;
}
function isPerim(s, x, z) {
  return x === s.X || x === s.R || z === s.Z || z === s.S;
}
function inFoot(s, x, z) {
  return x >= s.X && x <= s.R && z >= s.Z && z <= s.S;
}

function navH(x, z) {
  const nav = P.nav;
  if (!nav || nav.x0 === undefined) return null;
  const i = x - nav.x0,
    j = z - nav.z0;
  if (i < 0 || j < 0 || i >= nav.n || j >= nav.n) return null;
  const q = i * nav.n + j;
  return { h: nav.h[q], wet: !!(nav.wet && nav.wet[q]) };
}
function pickGate(s, prefer) {
  const p = prefer || B.feet(),
    c = s.center,
    pd = Math.hypot(p.x - c.x, p.z - c.z) || 1;
  const mid = s.X + 1 + Math.floor(W / 2),
    midz = s.Z + 1 + Math.floor(D / 2);
  const sides = [
    {
      side: "north",
      n: [0, -1],
      at: (t) => [t, s.Z],
      m: mid,
      lo: s.X + 2,
      hi: s.R - 2,
    },
    {
      side: "south",
      n: [0, 1],
      at: (t) => [t, s.S],
      m: mid,
      lo: s.X + 2,
      hi: s.R - 2,
    },
    {
      side: "west",
      n: [-1, 0],
      at: (t) => [s.X, t],
      m: midz,
      lo: s.Z + 2,
      hi: s.S - 2,
    },
    {
      side: "east",
      n: [1, 0],
      at: (t) => [s.R, t],
      m: midz,
      lo: s.Z + 2,
      hi: s.S - 2,
    },
  ];
  let best = null;
  for (const sd of sides) {
    const face =
      1.5 * (1 - ((p.x - c.x) * sd.n[0] + (p.z - c.z) * sd.n[1]) / pd);
    for (const dt of [0, -3, 3, -6, 6]) {
      const t = Math.max(sd.lo, Math.min(sd.hi, sd.m + dt));
      const [gx, gz] = sd.at(t);
      let pen = 0;
      for (let d = 1; d <= 5; d++) {
        const q = navH(gx + sd.n[0] * d, gz + sd.n[1] * d);
        if (!q || q.h < -999) {
          pen += 8;
          continue;
        }
        const dh = Math.abs(q.h - s.F);
        if (q.wet) pen += 6;
        if (d <= 3) pen += dh <= 2 ? dh : 4 + dh;
        else pen += dh <= 1 ? 0 : 6 * (dh - 1);
      }
      const cost = pen + face + Math.abs(dt) * 0.1;
      if (!best || cost < best.cost) best = { cost, gx, gz, sd, pen };
    }
  }
  if (!best) return { x: mid, y: s.Y, z: s.Z, n: [0, -1], side: "north" };
  return {
    x: best.gx,
    y: s.Y,
    z: best.gz,
    n: best.sd.n,
    side: best.sd.side,
    pen: best.pen,
  };
}

function perimeter(s) {
  const out = [];
  for (let x = s.X; x <= s.R; x++) out.push([x, s.Z]);
  for (let z = s.Z + 1; z <= s.S; z++) out.push([s.R, z]);
  for (let x = s.R - 1; x >= s.X; x--) out.push([x, s.S]);
  for (let z = s.S - 1; z > s.Z; z--) out.push([s.X, z]);
  return out;
}
function inwardOf(s, x, z) {
  const ix = x === s.X ? 1 : x === s.R ? -1 : 0,
    iz = z === s.Z ? 1 : z === s.S ? -1 : 0;
  return [ix, iz];
}

function fillItem() {
  const items = B.S.bot.inventory.items();
  let best = null,
    bi = 1e9;
  for (const it of items) {
    const i = FILL_ITEMS.indexOf(it.name);
    if (i >= 0 && i < bi) ((bi = i), (best = it.name));
  }
  return best;
}
function fillCount() {
  let n = 0;
  for (const it of B.S.bot.inventory.items())
    if (FILL_SET.has(it.name)) n += it.count;
  return n;
}
function toolFor(b) {
  const m = (b && b.material) || "",
    have = (n) => B.count(n) > 0;
  const kinds = /pickaxe/.test(m)
    ? "pickaxe"
    : /shovel/.test(m)
      ? "shovel"
      : /axe/.test(m)
        ? "axe"
        : null;
  if (!kinds) return null;
  for (const t of ["stone", "wooden"])
    if (have(`${t}_${kinds}`)) return `${t}_${kinds}`;
  return null;
}

const LOG_RX =
  /^(oak|birch|spruce|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log$/;
function logCount() {
  let n = 0;
  for (const it of B.S.bot.inventory.items())
    if (LOG_RX.test(it.name)) n += it.count;
  return n;
}
function plankCount() {
  let n = 0;
  for (const it of B.S.bot.inventory.items())
    if (/_planks$/.test(it.name)) n += it.count;
  return n;
}
function findLogs(s, max = 40) {
  const reg = B.S.bot.registry,
    ids = Object.values(reg.blocksByName)
      .filter((b) => LOG_RX.test(b.name))
      .map((b) => b.id);
  let ps = [];
  try {
    ps = B.S.bot.findBlocks({ matching: ids, maxDistance: 64, count: 200 });
  } catch {}
  const me = B.pos();

  const score = (p) => {
    const inside = s && inFoot(s, p.x, p.z) && p.y <= s.Y + 1;
    const ground =
      infoAt(p.x, p.y - 1, p.z).cls === GROUND ||
      infoAt(p.x, p.y - 2, p.z).cls === GROUND;
    return p.distanceTo(me) - (inside ? 20 : 0) + (ground ? 0 : 15);
  };

  const low = (p) => {
    for (let d = 1; d <= 3; d++) {
      const c = infoAt(p.x, p.y - d, p.z);
      if (c.cls === GROUND) return true;
      if (c.cls !== TREE) return false;
    }
    return false;
  };

  return ps
    .filter(
      (p) => (!s || (p.y <= s.Y + 6 && B.hdist(p, s.center) <= 36)) && low(p),
    )
    .sort((a, b) => score(a) - score(b))
    .slice(0, max);
}

async function precut(stop, maxLogs = 6) {
  const t0 = now(),
    home = B.pos().clone(),
    bad = new Set(),
    names = new Set(
      Object.keys(B.S.bot.registry.itemsByName).filter((n) => LOG_RX.test(n)),
    );
  let cut = 0,
    tries = 0;
  try {
    while (cut < maxLogs && !stop() && tries < 10 && now() - t0 < 4e4) {
      tries++;
      const ls = findLogs(null, 30).filter(
        (p) =>
          !bad.has(`${p.x},${p.y},${p.z}`) &&
          B.hdist(p, home) <= 12 &&
          Math.abs(p.y - home.y) <= 5,
      );
      if (!ls.length) break;
      const tgt = ls[0];
      if (B.reachOf(tgt) > REACH)
        await B.approach(tgt, {
          reach: 3.8,
          noEscalate: true,
          timeoutMs: 6e3,
          until: stop,
        });
      if (stop()) break;
      if (B.reachOf(tgt) > REACH) {
        bad.add(`${tgt.x},${tgt.y},${tgt.z}`);
        continue;
      }
      const inReach = findLogs(null, 60)
        .filter((p) => B.reachOf(p) <= REACH)
        .sort((a, b) => b.y - a.y);
      for (const p of inReach) {
        if (cut >= maxLogs || stop()) break;
        const b = B.blockAt(p);
        if (b && LOG_RX.test(b.name) && (await B.dig(b, {}))) cut++;
      }
      await B.sleep(250);
      await B.collectItems(B.pos(), 8, names, 5e3, { quick: true });
    }
  } catch (e) {
    B.log("ah precut error", { err: String(e).slice(0, 120) });
  }
  B.log("ah precut", {
    cut,
    logs: logCount(),
    tries,
    ms: now() - t0,
    moved: Math.round(B.hdist(B.pos(), home)),
  });
  return cut;
}
async function placeTable(s) {
  if (B.count("crafting_table") < 1) return null;
  const me = B.feet();
  const spots = [];
  for (let dx = -3; dx <= 3; dx++)
    for (let dz = -3; dz <= 3; dz++)
      for (const dy of [0, -1, 1]) {
        const x = me.x + dx,
          y = me.y + dy,
          z = me.z + dz;
        if (!dx && !dz) continue;
        const g0 = infoAt(x, y - 1, z),
          c = infoAt(x, y, z),
          u = infoAt(x, y + 1, z);
        if (
          g0.cls !== GROUND ||
          !(c.cls === AIR || c.repl) ||
          !(u.cls === AIR || u.cls === PLANT)
        )
          continue;
        if (B.occupies(v3(x, y, z))) continue;
        const inside = s && inFoot(s, x, z);
        spots.push({
          p: v3(x, y, z),
          c: Math.hypot(dx, dz) + (inside ? 10 : 0),
        });
        break;
      }
  spots.sort((a, b) => a.c - b.c);
  for (const sp of spots.slice(0, 6)) {
    const ref = B.blockAt(sp.p.offset(0, -1, 0));
    if (
      await B.placeOn(ref, v3(0, 1, 0), "crafting_table", {
        expectName: "crafting_table",
      })
    )
      return sp.p;
  }
  return null;
}
async function ensureTools(s, until, opts = {}) {
  const want = (
    opts.only || [
      "wooden_pickaxe",
      "wooden_shovel",
      "wooden_axe",
      "wooden_shovel",
      "wooden_pickaxe",
    ]
  ).filter(
    (n, i, a) => B.count(n) < a.slice(0, i + 1).filter((m) => m === n).length,
  );
  if (!want.length) return true;
  const S = require("../agriculture/terrain");
  const t0 = now(),
    maxMs = opts.maxMs || 9e4,
    needLogs = Math.ceil((want.length * 3 + 4 + 4) / 4) + (opts.only ? 0 : 1);
  let cut = 0;
  for (
    let round = 0;
    round < 12 &&
    logCount() + plankCount() / 4 < needLogs &&
    !until() &&
    now() - t0 < maxMs;
    round++
  ) {
    const ls = findLogs(s);
    if (!ls.length) break;
    const tgt = ls[0];

    if (round >= 3 && logCount() + plankCount() / 4 < 1) break;
    if (B.reachOf(tgt) > REACH)
      await B.approach(tgt, { reach: 3.8, timeoutMs: 1.5e4 });

    const inReach = findLogs(s, 60)
      .filter((p) => B.reachOf(p) <= REACH)
      .sort((a, b) => b.y - a.y);
    if (!inReach.length) continue;
    for (const p of inReach) {
      if (cut >= needLogs + 1) break;
      const b = B.blockAt(p);
      if (
        b &&
        LOG_RX.test(b.name) &&
        (await B.dig(b, B.count("wooden_axe") ? { tool: "wooden_axe" } : {}))
      )
        cut++;
    }
    await B.sleep(300);

    await B.collectItems(
      B.pos(),
      9,
      new Set(
        Object.keys(B.S.bot.registry.itemsByName).filter((n) => LOG_RX.test(n)),
      ),
      9e3,
    );
  }

  for (const it of B.S.bot.inventory.items().slice()) {
    if (!LOG_RX.test(it.name) || plankCount() >= needLogs * 4) continue;
    const pl = it.name.replace(/_log$/, "_planks");
    await S.craftOne(
      pl,
      Math.min(it.count, Math.ceil((needLogs * 4 - plankCount()) / 4)),
    );
  }
  await B.sleep(350);
  const tableHere =
    P.table &&
    B.blockAt(P.table) &&
    B.blockAt(P.table).name === "crafting_table";
  if (plankCount() < (tableHere ? 5 : 9)) {
    B.log("ah pen tools: not enough wood", {
      planks: plankCount(),
      logs: logCount(),
      cut,
      s: Math.round((now() - t0) / 1e3),
    });
    return false;
  }
  let tp = tableHere ? P.table : null;
  if (tp && B.reachOf(tp) > REACH)
    await B.approach(tp, { reach: 3.5, timeoutMs: 2e4 });
  if (!tp || B.reachOf(tp) > REACH) {
    if (B.count("crafting_table") < 1) await S.craftOne("crafting_table", 1);
    tp = await placeTable(s);
  }
  const tb = tp && B.blockAt(tp);
  if (!tb) {
    B.log("ah pen tools: no table", { at: B.feet() });
    return false;
  }
  P.table = tp;
  const made = [];

  await B.sleep(400);
  for (const n of want) {
    const needP = n === "wooden_shovel" ? 1 : 3;
    let res = "no-wood";

    for (let tryN = 0; tryN < 3; tryN++) {
      if (B.count("stick") < 2 && plankCount() >= needP + 2)
        (await S.craftOne("stick", 1), await B.sleep(tryN ? 700 : 400));
      if (plankCount() < needP || B.count("stick") < 2) break;
      const before = B.count(n);
      await S.craftOne(n, 1, tb);
      await B.sleep(tryN ? 1000 : 700);
      res = B.count(n) > before ? "ok" : "fail";
      if (res === "ok") break;
      try {
        B.S.bot.currentWindow && B.S.bot.closeWindow(B.S.bot.currentWindow);
      } catch {}
      await B.sleep(600);
      B.log("ah pen craft fail", {
        n,
        tryN,
        dist: Math.round(B.reachOf(tp) * 10) / 10,
        tbl: (B.blockAt(tp) || {}).name,
        planks: plankCount(),
        sticks: B.count("stick"),
      });
    }
    made.push(`${n}:${res}`);
  }

  if (!opts.only && B.count("wooden_pickaxe") > 0) {
    try {
      await earlyStoneTools(s, tb, made);
    } catch (e) {
      made.push(`stone:error:${String(e).slice(0, 60)}`);
    }
  }

  if (s && inFoot(s, tp.x, tp.z))
    await B.dig(
      B.blockAt(tp),
      B.count("wooden_axe") ? { tool: "wooden_axe" } : {},
    );
  B.log("ah pen tools", {
    s: Math.round((now() - t0) / 1e3),
    cut,
    made,
    pickaxe: B.count("wooden_pickaxe"),
    shovel: B.count("wooden_shovel"),
    axe: B.count("wooden_axe"),
    planks: plankCount(),
    sticks: B.count("stick"),
    table: tp,
  });
  if (B.count("wooden_pickaxe") > 0) P.hadPick = true;
  if (B.count("wooden_shovel") + B.count("stone_shovel") > 0)
    P.hadShovel = true;
  return B.count("wooden_pickaxe") > 0;
}

async function stoneUpgrade(s, ops) {
  if ((P.stoneTry || 0) >= 2 || !P.table) return;
  const tb0 = B.blockAt(P.table);
  if (!tb0 || tb0.name !== "crafting_table" || B.hdist(B.pos(), P.table) > 28)
    return;
  const cob = () =>
    B.count("cobblestone") +
    B.count("cobbled_deepslate") +
    B.count("blackstone");
  let nSh = 0,
    nPk = 0;
  for (const o of ops) {
    if (o.k !== "dig") continue;
    const b = B.blockAt(v3(o.x, o.y, o.z)),
      m = (b && b.material) || "";
    if (/shovel/.test(m)) nSh++;
    else if (/pickaxe/.test(m)) nPk++;
  }
  const want = [];
  if (B.count("stone_shovel") < 1 && nSh >= 40) want.push("stone_shovel");
  if (B.count("stone_pickaxe") < 1 && nPk >= 15) want.push("stone_pickaxe");
  const needCob = want.reduce((a, n) => a + (n === "stone_shovel" ? 1 : 3), 0);
  if (!want.length || cob() < (want.includes("stone_shovel") ? 1 : 3)) return;
  P.stoneTry = (P.stoneTry || 0) + 1;
  const S = require("../agriculture/terrain"),
    t0 = now(),
    made = [];
  try {
    const sticksNeed = want.length * 2;
    if (B.count("stick") < sticksNeed) {
      if (plankCount() < 2) {
        const lg = B.S.bot.inventory.items().find((it) => LOG_RX.test(it.name));
        if (lg) await S.craftOne(lg.name.replace(/_log$/, "_planks"), 1);
      }
      if (plankCount() >= 2) await S.craftOne("stick", sticksNeed > 4 ? 2 : 1);
    }
    if (B.reachOf(P.table) > REACH)
      await B.approach(P.table, { reach: 3.5, timeoutMs: 2e4 });
    const tb = B.blockAt(P.table);
    for (const n of want) {
      if (
        cob() < (n === "stone_shovel" ? 1 : 3) ||
        B.count("stick") < 2 ||
        !tb ||
        B.reachOf(P.table) > REACH
      ) {
        made.push(`${n}:no-mat`);
        continue;
      }
      const before = B.count(n);
      await S.craftOne(n, 1, tb);
      for (let w = 0; w < 6 && B.count(n) <= before; w++) await B.sleep(100);
      made.push(`${n}:${B.count(n) > before ? "ok" : "fail"}`);
    }
  } catch (e) {
    made.push(`error:${String(e).slice(0, 80)}`);
  }
  B.log("ah pen stone tools", {
    made,
    cob: cob(),
    shovelDigs: nSh,
    pickDigs: nPk,
    needCob,
    ms: now() - t0,
  });
}
async function earlyStoneTools(s, tb, made) {
  const S = require("../agriculture/terrain"),
    reg = B.S.bot.registry;
  const cob = () =>
    B.count("cobblestone") +
    B.count("cobbled_deepslate") +
    B.count("blackstone");
  const ids = ["stone", "cobblestone", "deepslate", "cobbled_deepslate"]
    .map((n) => reg.blocksByName[n] && reg.blocksByName[n].id)
    .filter((x) => x !== undefined);
  const me = B.feet();
  let ps = [];
  try {
    ps = B.S.bot.findBlocks({ matching: ids, maxDistance: 24, count: 200 });
  } catch {}

  ps = ps.filter((p) => {
    if (s && inFoot(s, p.x, p.z) && p.y <= s.F) return false;
    if (p.x === me.x && p.z === me.z) return false;
    return [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ].some(([a, b, c]) => {
      const q = infoAt(p.x + a, p.y + b, p.z + c);
      return q.cls === AIR || q.cls === PLANT;
    });
  });
  ps.sort((a, b) => B.reachOf(a) - B.reachOf(b));
  if (ps.length < 4) {
    made.push("stone:none-near");
    return;
  }
  const tS = now();
  for (const p of ps.slice(0, 10)) {
    if (cob() >= 4 || now() - tS > 3e4) break;
    if (B.reachOf(p) > REACH)
      await B.approach(p, { reach: 3.6, noEscalate: true, timeoutMs: 1e4 });
    if (B.reachOf(p) > REACH) continue;
    const b = B.blockAt(p);
    if (b && !B.isAir(b)) await B.dig(b, { tool: "wooden_pickaxe" });
    await B.collectItems(
      B.pos(),
      5,
      new Set(["cobblestone", "cobbled_deepslate"]),
      2500,
      { quick: true },
    );
  }
  if (cob() < 1) {
    made.push("stone:no-cobble");
    return;
  }
  if (B.count("stick") < 4 && plankCount() >= 2) await S.craftOne("stick", 1);
  if (B.reachOf(tb.position) > REACH)
    await B.approach(tb.position, { reach: 3.5, timeoutMs: 2e4 });
  for (const n of ["stone_shovel", "stone_pickaxe"]) {
    if (cob() < (n === "stone_shovel" ? 1 : 3) || B.count("stick") < 2) {
      made.push(`${n}:no-mat`);
      continue;
    }
    const before = B.count(n);
    await S.craftOne(n, 1, B.blockAt(tb.position));
    for (let w = 0; w < 6 && B.count(n) <= before; w++) await B.sleep(100);
    made.push(`${n}:${B.count(n) > before ? "ok" : "fail"}`);
  }
}
function needsPick(b) {
  return (
    !!b &&
    /pickaxe/.test(b.material || "") &&
    !!(b.harvestTools && Object.keys(b.harvestTools).length)
  );
}

function columnOps(s, x, z, out, extraLanding) {
  const F = s.F,
    perim = !extraLanding && isPerim(s, x, z);
  const f = infoAt(x, F, z);
  if (f.cls < 0) return;
  if (!f.floor) {
    let y = F;
    for (; y > F - 6; y--) {
      const below = infoAt(x, y - 1, z);
      if (below.cls === GROUND || below.cls === OBST || below.cls === TREE)
        break;
    }
    const c = infoAt(x, y, z);
    if (c.cls === AIR || c.repl || c.cls === LIQ || c.cls === LAVA)
      out.push({ k: "fill", x, y, z });
    else out.push({ k: "dig", x, y, z, why: "floor" });
  }
  if (perim) {
    if (s.gate && x === s.gate.x && z === s.gate.z) {
      const h = infoAt(x, F + 2, z);
      if (!(h.cls === AIR || h.cls === PLANT))
        out.push({
          k: h.cls === LIQ ? "fill" : "dig",
          x,
          y: F + 2,
          z,
          why: "gate head room",
          plug: h.cls === LIQ,
        });
    }
    const c = infoAt(x, F + 1, z);
    if (c.fence || c.gate) {
      if (!P.mine.has(key(x, F + 1, z)))
        out.push({ k: "dig", x, y: F + 1, z, why: "foreign fence" });
    } else if (c.cls === LIQ)
      out.push({ k: "fill", x, y: F + 1, z, plug: true });
    else if (c.cls !== AIR && !c.repl)
      out.push({ k: "dig", x, y: F + 1, z, why: "fence spot" });
    return;
  }
  for (let y = F + 2; y >= F + 1; y--) {
    const c = infoAt(x, y, z);
    if (c.cls === AIR || c.cls === PLANT) continue;
    if (c.cls === LIQ) out.push({ k: "fill", x, y, z, plug: true });
    else out.push({ k: "dig", x, y, z, why: "space" });
    break;
  }
}
function landingCells(s) {
  const g = s.gate;
  return [1, 2, 3].map((d) => [g.x + g.n[0] * d, g.z + g.n[1] * d]);
}
function allOps(s) {
  const out = [];
  for (let x = s.X; x <= s.R; x++)
    for (let z = s.Z; z <= s.S; z++) columnOps(s, x, z, out, false);
  for (const [x, z] of landingCells(s)) columnOps(s, x, z, out, true);
  return out;
}
function botCols() {
  const p = B.pos(),
    out = [];
  for (const dx of [-0.3, 0.3])
    for (const dz of [-0.3, 0.3])
      out.push(`${Math.floor(p.x + dx)},${Math.floor(p.z + dz)}`);
  return new Set(out);
}
function conflict(op) {
  const p = v3(op.x, op.y, op.z);
  if (op.k === "fill") return B.occupies(p);

  const me = B.pos();
  return (
    botCols().has(`${op.x},${op.z}`) &&
    op.y < me.y &&
    op.y >= Math.floor(me.y) - 1
  );
}

async function doOp(op) {
  const p = v3(op.x, op.y, op.z);
  if (op.k === "dig") {
    const b = B.blockAt(p);
    if (!b || B.isAir(b)) return true;
    if (
      (b.name === "oak_fence" || b.name === "oak_fence_gate") &&
      P.mine.has(key(op.x, op.y, op.z))
    )
      return true;
    const tool = toolFor(b);

    let exp = 0;
    const ok = await B.dig(b, tool ? { tool } : {});
    try {
      exp = B.S.bot.digTime(b);
    } catch {}
    P.tm.digExp = (P.tm.digExp || 0) + exp;
    if (!B.S.bot.entity.onGround) P.tm.digAir = (P.tm.digAir || 0) + 1;
    ok && P.stats.digs++;
    if (!ok) {
      P.stats.digMiss = (P.stats.digMiss || 0) + 1;
      if (P.stats.digMiss <= 12)
        B.log("ah pen dig miss", {
          name: b.name,
          at: p,
          me: B.pos().floored(),
          reach: +B.reachOf(p).toFixed(2),
          tool,
        });
    }
    if (ok && /_fence|_fence_gate/.test(b.name))
      P.mine.delete(key(op.x, op.y, op.z));
    return ok;
  }
  const item = fillItem();
  if (!item) return false;
  const ref = B.blockAt(p.offset(0, -1, 0));
  if (!ref || B.isAir(ref) || ref.name === "water") {
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nb = B.blockAt(p.offset(dx, 0, dz));
      if (nb && nb.boundingBox === "block" && !/water|lava/.test(nb.name)) {
        const ok = await B.placeOn(nb, v3(-dx, 0, -dz), item);
        ok && P.stats.fills++;
        return ok;
      }
    }
    return false;
  }
  let ok = await B.placeOn(ref, v3(0, 1, 0), item);
  if (
    !ok &&
    !(B.S.bot.heldItem && B.S.bot.heldItem.name === item) &&
    B.count(item) > 0
  ) {
    await B.sleep(250);
    await B.equip(item);
    ok = await B.placeOn(ref, v3(0, 1, 0), item);
    P.stats.reEquip = (P.stats.reEquip || 0) + 1;
  }
  ok && P.stats.fills++;
  if (!ok) {
    const after = B.blockAt(p);
    P.stats.fillMiss = (P.stats.fillMiss || 0) + 1;
    if (P.stats.fillMiss <= 12)
      B.log("ah pen fill miss", {
        item,
        at: p,
        ref: ref.name,
        now: after && after.name,
        me: B.pos().floored(),
        reach: +B.reachOf(p).toFixed(2),
        held: B.S.bot.heldItem && B.S.bot.heldItem.name,
      });
  }
  return ok;
}

function borrowTargets(s, max, wide = false) {
  const out = [],
    lc = landingCells(s),
    mf = B.feet();

  const M = wide === 2 ? 40 : wide ? 16 : 8,
    yTop = s.F + (wide === 2 ? 14 : wide ? 9 : 4),
    yBot = wide === 2 ? s.F - 4 : s.F;
  for (let x = s.X - M; x <= s.R + M; x++)
    for (let z = s.Z - M; z <= s.S + M; z++) {
      if (x >= s.X - 1 && x <= s.R + 1 && z >= s.Z - 1 && z <= s.S + 1)
        continue;
      if (lc.some(([a, b]) => Math.abs(a - x) <= 1 && Math.abs(b - z) <= 1))
        continue;

      if (Math.abs(x - mf.x) <= 1 && Math.abs(z - mf.z) <= 1) continue;
      for (let y = yTop; y >= yBot; y--) {
        const c = infoAt(x, y, z);
        if (c.cls === AIR || c.cls === PLANT) continue;
        if (
          c.cls === GROUND &&
          (c.yld || (c.yldT && B.count("wooden_pickaxe") > 0))
        ) {
          const up = infoAt(x, y + 1, z);
          if (up.cls === AIR || up.cls === PLANT) out.push(v3(x, y, z));
        }
        break;
      }
    }
  const me = B.pos();

  out.sort(
    (a, b) =>
      a.distanceTo(me) -
      (a.y > s.F ? 3 : 0) -
      (b.distanceTo(me) - (b.y > s.F ? 3 : 0)),
  );
  return out.slice(0, max);
}

async function gatherNear(target, maxMs, until) {
  const t0 = now();
  const dy0 = B.S.itemDy;
  B.S.itemDy = 1.3;
  B.setMovements({ maxDropDown: 1 });
  let dug = 0,
    rounds = 0;
  try {
    while (fillCount() < target && now() - t0 < maxMs && !until()) {
      rounds++;
      const me = B.feet(),
        ts = [];

      const wide = rounds > 1 && P.gatherWide,
        Rg = wide ? 40 : 12;
      for (let dx = -Rg; dx <= Rg; dx++)
        for (let dz = -Rg; dz <= Rg; dz++) {
          if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) continue;
          if (P.site && inFoot(P.site, me.x + dx, me.z + dz)) continue;
          for (
            let y = me.y + (wide ? 6 : 3);
            y >= me.y - (wide ? 12 : 2);
            y--
          ) {
            const c = infoAt(me.x + dx, y, me.z + dz);
            if (c.cls === AIR || c.cls === PLANT) continue;
            if (c.cls === GROUND && c.yld) {
              const up = infoAt(me.x + dx, y + 1, me.z + dz);
              if (up.cls === AIR || up.cls === PLANT)
                ts.push(v3(me.x + dx, y, me.z + dz));
            }
            break;
          }
        }
      if (!ts.length) {
        if (P.gatherWide) break;
        P.gatherWide = true;
        continue;
      }
      ts.sort((a, b) => B.reachOf(a) - B.reachOf(b));
      if (B.reachOf(ts[0]) > REACH) {
        if (wide) B.setMovements({});
        await B.approach(ts[0], {
          reach: 3.6,
          noEscalate: !wide,
          timeoutMs: wide ? 3e4 : 1.5e4,
        });
        if (wide) B.setMovements({ maxDropDown: 1 });
      }
      let here = 0;
      for (const t of ts.slice(0, 16)) {
        if (B.reachOf(t) > REACH) continue;
        const b = B.blockAt(t);
        if (
          b &&
          !B.isAir(b) &&
          (await B.dig(b, toolFor(b) ? { tool: toolFor(b) } : {}))
        )
          (dug++, here++);
      }
      await B.sleep(200);
      await B.collectItems(B.pos(), 7, FILL_SET, 8e3, { quick: true });
      if (!here && rounds > 3) break;
    }
  } finally {
    B.S.itemDy = dy0;
    B.setMovements({});
  }
  B.log("ah pen gather", {
    target,
    have: fillCount(),
    dug,
    rounds,
    s: Math.round((now() - t0) / 1e3),
  });
}
async function getMaterial(s, need) {
  const dy0 = B.S.itemDy;
  B.S.itemDy = 1.3;
  B.setMovements({ maxDropDown: 1 });
  try {
    return await getMaterial2(s, need);
  } finally {
    B.S.itemDy = dy0;
    B.setMovements({});
  }
}
async function getMaterial2(s, need) {
  const f = B.feet();

  if (f.y < s.Y - 1 && inFoot(s, f.x, f.z)) await climbOut(s);
  if (f.y < s.Y - 1 && !inFoot(s, f.x, f.z) && fillCount() < 1) {
    const [lx, lz] = landingCells(s)[1];
    B.setMovements({ maxDropDown: 1, hardDig: true, towers: true, digCost: 2 });
    const r = await B.goto(new B.goals.GoalNear(lx, s.Y, lz, 2), {
      timeoutMs: 2.5e4,
      stuckMs: 6e3,
    });
    B.setMovements({ maxDropDown: 1 });
    B.log("ah pen out of pit", { from: f, to: B.feet(), r });
  }

  const got = await B.collectItems(B.pos(), 12, FILL_SET, 9000, {
    quick: true,
  });
  P.stats.collect += got || 0;
  if (fillCount() > 0) return true;

  let ts = borrowTargets(s, Math.min(12, Math.max(3, need)));
  if (!ts.length) ts = borrowTargets(s, Math.min(12, Math.max(3, need)), true);
  if (!ts.length && B.count("wooden_pickaxe") < 1 && !P.toolTry) {
    P.toolTry = true;
    await ensureTools(s, () => B.timeLeft() < 3e4, { maxMs: 6e4 });
    ts = borrowTargets(s, Math.min(12, Math.max(3, need)), true);
  }
  if (!ts.length) {
    ts = borrowTargets(s, 16, 2);
    if (ts.length)
      B.log("ah pen far borrow", {
        at: ts[0],
        d: Math.round(ts[0].distanceTo(B.pos())),
        need,
      });
  }
  if (!ts.length) {
    B.log("ah pen no borrow", { at: B.feet() });
    return false;
  }
  let dug = 0;
  for (const t of ts) {
    if (B.reachOf(t) > REACH) {
      if (dug) break;
      await B.approach(t, { reach: 3.6, noEscalate: true });
      if (B.reachOf(t) > REACH) continue;
    }
    const b = B.blockAt(t);
    if (
      b &&
      !B.isAir(b) &&
      (await B.dig(b, toolFor(b) ? { tool: toolFor(b) } : {}))
    )
      (dug++, P.stats.borrow++);
  }
  await B.sleep(250);
  await B.collectItems(B.pos(), 8, FILL_SET, 8000, { quick: true });
  return fillCount() > 0;
}

async function level(s, until, maxMs = 0) {
  const t0 = now();
  if (!atSite(s, 40) && !(await walkTo(s, until))) {
    B.log("ah pen level: site out of reach", { at: B.feet() });
    return false;
  }
  let rounds = 0,
    lastLog = 0,
    idle = 0,
    noMat = 0;
  for (;;) {
    if (until() || (maxMs && now() - t0 > maxMs)) {
      B.log("ah pen level timeout", {
        s: Math.round((now() - t0) / 1e3),
        left: allOps(s).length,
      });
      return false;
    }
    rounds++;

    const ops = allOps(s).filter(
      (o) => (P.skip.get(key(o.x, o.y, o.z)) || 0) < now() + 12e4,
    );
    if (!ops.length) break;
    const t = now();
    if (t - lastLog > 15e3)
      ((lastLog = t),
        B.log("ah pen level", {
          left: ops.length,
          digs: ops.filter((o) => o.k === "dig").length,
          fills: ops.filter((o) => o.k === "fill").length,
          have: fillCount(),
          s: Math.round((t - t0) / 1e3),
          sample: ops
            .slice(0, 4)
            .map((o) => [
              o.k,
              o.x,
              o.y,
              o.z,
              infoAt(o.x, o.y, o.z).name,
              infoAt(o.x, o.y - 1, o.z).name,
            ]),
          me: B.pos().floored(),
        }));
    const have = fillItem() !== null;
    const ok = ops.filter(
      (o) =>
        (P.skip.get(key(o.x, o.y, o.z)) || 0) < t && (o.k === "dig" || have),
    );
    const free = ok.filter((o) => !conflict(o));
    const near = free.filter((o) => B.reachOf(v3(o.x, o.y, o.z)) <= REACH);
    if (near.length) {
      near.sort((a, b) =>
        a.k !== b.k
          ? a.k === "dig"
            ? -1
            : 1
          : a.k === "dig"
            ? b.y - a.y || dist(a) - dist(b)
            : a.y - b.y || dist(a) - dist(b),
      );
      const op = near[0];
      if (
        op.k === "dig" &&
        P.hadShovel &&
        B.count("wooden_shovel") + B.count("stone_shovel") < 1 &&
        (P.shovelRetool || 0) < 3
      ) {
        const b = B.blockAt(v3(op.x, op.y, op.z));
        const left = ops.filter((o) => o.k === "dig").length;
        if (b && /shovel/.test(b.material || "") && left >= 25) {
          P.shovelRetool = (P.shovelRetool || 0) + 1;
          B.log("ah pen retool shovel", { n: P.shovelRetool, left });
          await ensureTools(s, until, { only: ["wooden_shovel"], maxMs: 3e4 });
        }
      }
      if (
        op.k === "dig" &&
        B.count("wooden_pickaxe") + B.count("stone_pickaxe") < 1 &&
        (P.retool || 0) < 2
      ) {
        const b = B.blockAt(v3(op.x, op.y, op.z));

        if (
          needsPick(b) &&
          (P.hadPick ||
            ops.filter(
              (o) => o.k === "dig" && needsPick(B.blockAt(v3(o.x, o.y, o.z))),
            ).length >= 3)
        ) {
          P.retool = (P.retool || 0) + 1;
          B.log("ah pen retool", { n: P.retool, block: b.name });
          await ensureTools(s, until, { only: ["wooden_pickaxe"], maxMs: 6e4 });
        }
      }
      const tOp = now();
      let kind = op.k;
      if (op.k === "dig") {
        const bb = B.blockAt(v3(op.x, op.y, op.z)),
          m = (bb && bb.material) || "";
        kind = /pickaxe/.test(m)
          ? "digPick"
          : /shovel/.test(m)
            ? "digShovel"
            : /axe/.test(m)
              ? "digAxe"
              : "digHand";
      }
      const done = await doOp(op);
      P.tm[op.k] = (P.tm[op.k] || 0) + (now() - tOp);
      P.tm[op.k + "N"] = (P.tm[op.k + "N"] || 0) + 1;
      if (kind !== op.k)
        ((P.tm[kind] = (P.tm[kind] || 0) + (now() - tOp)),
          (P.tm[kind + "N"] = (P.tm[kind + "N"] || 0) + 1));
      if (!done) markFail(op);

      if (done && op.k === "dig" && P.tm.digN % 25 === 0)
        await stoneUpgrade(s, ops);
      else {
        const k = `${op.k}:${key(op.x, op.y, op.z)}`,
          n = (P.redo.get(k) || 0) + 1;
        P.redo.set(k, n);
        if (n >= 3) {
          const b = B.blockAt(v3(op.x, op.y, op.z));
          B.log("ah pen op again", {
            op,
            n,
            now: b && b.name,
            me: B.pos().floored(),
          });
        }

        if (op.plug && n === 2) await drainAround(s, op);
        if ((P.flood || 0) >= 2) {
          B.log("ah pen site flooded", { X: s.X, Z: s.Z, left: ops.length });
          return "flooded";
        }
        if (n >= (op.k === "dig" ? 8 : 4))
          P.skip.set(key(op.x, op.y, op.z), now() + 6e5);
      }
      continue;
    }
    if (!ok.length) {
      const fills = ops.filter((o) => o.k === "fill").length;
      if (fills && !have) {
        const tMat = now();
        const gotMat = await getMaterial(s, fills);
        P.tm.material = (P.tm.material || 0) + (now() - tMat);
        if (!gotMat) {
          noMat++;
          if (noMat <= 3 || noMat % 10 === 0)
            B.log("ah pen out of material", { fills, at: B.feet(), n: noMat });
          await B.sleep(Math.min(3e3, 400 * noMat));
          if (noMat >= 12) return false;
        } else noMat = 0;
        continue;
      }

      idle += 300;
      if (idle > 25e3) {
        B.log("ah pen level stalled", {
          left: ops.length,
          ops: ops.slice(0, 8),
        });
        return false;
      }
      await B.sleep(300);
      continue;
    }
    if (!free.length) {
      const o = ok[0];
      if (!(await climbOut(s))) await B.stepOff(v3(o.x, o.y + 1, o.z));
      continue;
    }

    free.sort((a, b) => dist(a) - dist(b));
    const tgt = free[0];
    P.stats.approach++;
    const tAp = now();
    const r = await B.approach(v3(tgt.x, tgt.y, tgt.z), {
      reach: 3.6,
      timeoutMs: 2e4,
    });
    P.tm.approach = (P.tm.approach || 0) + (now() - tAp);
    if (!r || B.reachOf(v3(tgt.x, tgt.y, tgt.z)) > REACH) {
      (P.stats.approachFail++, markFail(tgt));

      if (P.stats.approachFail % 2 === 0) await climbOut(s);
    }
  }
  B.log("ah pen leveled", {
    s: Math.round((now() - t0) / 1e3),
    rounds,
    ...P.stats,
    have: fillCount(),
    tm: Object.fromEntries(
      Object.entries(P.tm).map(([k, v]) => [
        k,
        /N$/.test(k) ? v : Math.round(v / 100) / 10,
      ]),
    ),
  });
  return true;
}

async function drainAround(s, o) {
  const k0 = `${o.x >> 2},${o.z >> 2}`;
  if ((P.drained || (P.drained = new Set())).has(k0)) return;
  P.drained.add(k0);

  const seen = new Set(),
    q = [
      [o.x, o.y, o.z],
      [o.x + 1, o.y, o.z],
      [o.x - 1, o.y, o.z],
      [o.x, o.y, o.z + 1],
      [o.x, o.y, o.z - 1],
      [o.x, o.y + 1, o.z],
    ],
    srcs = [],
    flows = [];
  let wet = 0;
  while (q.length && seen.size < 400) {
    const [x, y, z] = q.shift(),
      kk = key(x, y, z);
    if (seen.has(kk)) continue;
    seen.add(kk);
    if (
      Math.abs(x - o.x) > 12 ||
      Math.abs(z - o.z) > 12 ||
      y < s.F ||
      y > s.F + 6
    )
      continue;
    const b = B.blockAt(v3(x, y, z));
    if (!b || (b.name !== "water" && b.name !== "bubble_column")) continue;
    wet++;
    const lv = Number((b.getProperties() || {}).level || 0);
    if (lv === 0) srcs.push(v3(x, y, z));
    else if (!inFoot(s, x, z)) flows.push(v3(x, y, z));
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [0, 1, 0],
      [0, -1, 0],
    ])
      q.push([x + dx, y + dy, z + dz]);
  }
  let filled = 0;

  const todo = srcs.length
    ? srcs
    : flows.sort(
        (a, b) =>
          a.distanceTo(v3(o.x, o.y, o.z)) - b.distanceTo(v3(o.x, o.y, o.z)),
      );
  for (const p of todo.slice(0, 40)) {
    if (!fillItem()) await getMaterial(s, srcs.length);
    const item = fillItem();
    if (!item) break;
    if (B.reachOf(p) > REACH)
      await B.approach(p, { reach: 3.6, timeoutMs: 1.5e4, noEscalate: true });
    if (B.reachOf(p) > REACH) continue;
    const below = B.blockAt(p.offset(0, -1, 0));
    let ok = false;
    if (below && below.boundingBox === "block")
      ok = await B.placeOn(below, v3(0, 1, 0), item);
    else
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nb = B.blockAt(p.offset(dx, 0, dz));
        if (nb && nb.boundingBox === "block") {
          ok = await B.placeOn(nb, v3(-dx, 0, -dz), item);
          break;
        }
      }
    ok && filled++;
  }
  B.log("ah pen drain", {
    at: v3(o.x, o.y, o.z),
    water: wet,
    sources: srcs.length,
    flows: flows.length,
    filled,
  });

  if (!srcs.length && wet > 40) P.flood = (P.flood || 0) + 1;
}
async function climbOut(s) {
  const f = B.feet();
  if (f.y >= s.Y || B.hdist(B.pos(), s.center) > 30) return false;
  if (fillCount() < 1) {
    const cols = [];
    for (let x = s.X; x <= s.R; x++)
      for (let z = s.Z; z <= s.S; z++) cols.push(`${x},${z}`);
    for (const [x, z] of landingCells(s)) cols.push(`${x},${z}`);
    for (const k of cols) B.protectedCols.delete(k);
    const [lx, lz] = landingCells(s)[1];
    let r = null;
    try {
      B.setMovements({
        maxDropDown: 2,
        hardDig: true,
        towers: true,
        digCost: 2,
      });
      r = await B.goto(new B.goals.GoalNear(lx, s.Y, lz, 2), {
        timeoutMs: 2.5e4,
        stuckMs: 6e3,
      });
    } finally {
      B.setMovements({});
      for (const k of cols) B.protectedCols.add(k);
    }
    B.log("ah pen dig out", { from: f, to: B.feet(), r });
    return B.feet().y >= s.Y;
  }
  let ok = false;
  try {
    ok = await require("../resources/equipment").pillarUp(s.Y, now() + 15e3);
  } catch (e) {
    B.log("ah pen climb error", { err: String(e).slice(0, 160) });
  }
  B.log("ah pen climb", { from: f, to: B.feet(), ok });
  return ok;
}
function dist(o) {
  const p = B.pos();
  return Math.hypot(o.x + 0.5 - p.x, o.y + 0.5 - p.y, o.z + 0.5 - p.z);
}
function markFail(op) {
  const k = key(op.x, op.y, op.z),
    n = (P.fails.get(k) || 0) + 1;
  P.fails.set(k, n);
  if (n >= 2) P.skip.set(k, now() + Math.min(6e4, 8e3 * n));
}

function fenceOk(s, x, z) {
  const c = infoAt(x, s.Y, z);
  return (c.fence || c.gate) && P.mine.has(key(x, s.Y, z));
}
async function placeFence(s, x, z, item) {
  const p = v3(x, s.Y, z);
  let b = B.blockAt(p);
  if (
    b &&
    (/_fence$|_fence_gate$/.test(b.name) ||
      (!B.isAir(b) &&
        !REPL_NAMES.has(b.name) &&
        !(
          b.name === "snow" && String((b.getProperties() || {}).layers) === "1"
        )))
  ) {
    if (P.mine.has(key(x, s.Y, z))) return true;
    await B.dig(b, {});
    b = B.blockAt(p);
    if (b && !B.isAir(b) && !REPL_NAMES.has(b.name) && b.name !== "snow")
      return false;
  }
  const ref = B.blockAt(v3(x, s.F, z));
  if (!ref || ref.boundingBox !== "block") return false;
  let ok = await B.placeOn(ref, v3(0, 1, 0), item, { expectName: item });
  if (!ok) {
    const c = B.blockAt(p);
    if (c && !B.isAir(c) && c.name !== item) await B.dig(c, {});
    ok = await B.placeOn(ref, v3(0, 1, 0), item, { expectName: item });
  }
  const now_ = B.blockAt(p);
  if (now_ && now_.name === item) {
    P.mine.add(key(x, s.Y, z));
    P.stats.fences++;
    return true;
  }
  return false;
}
function standFor(s, x, z, along) {
  const [ix, iz] = inwardOf(s, x, z);
  let sx = x + ix * 2,
    sz = z + iz * 2;
  if (along) {
    if (z === s.Z && x < s.R) sx += along;
    else if (x === s.R && z < s.S) sz += along;
    else if (z === s.S && x > s.X) sx -= along;
    else if (x === s.X) sz -= along;
  }
  sx = Math.max(s.X + 2, Math.min(s.R - 2, sx));
  sz = Math.max(s.Z + 2, Math.min(s.S - 2, sz));
  return [sx, sz];
}
async function fences(s, until) {
  const t0 = now(),
    loop = perimeter(s),
    g = s.gate;
  const isGate = (x, z) => x === g.x && z === g.z;

  const me = B.pos();
  let start = 0,
    bd = 1e9;
  loop.forEach(([x, z], i) => {
    const d = Math.hypot(x - me.x, z - me.z);
    d < bd && ((bd = d), (start = i));
  });
  const order = loop.slice(start).concat(loop.slice(0, start));
  let moves = 0,
    badMoves = 0;
  for (let guard = 0; guard < 400; guard++) {
    if (until()) return false;
    if (now() - t0 > 9e4) {
      B.log("ah pen fences: time cap", { placed: P.stats.fences });
      return false;
    }
    const all = order.filter(([x, z]) => !isGate(x, z) && !fenceOk(s, x, z));
    if (!all.length) break;

    const pending = all.filter(([x, z]) => infoAt(x, s.F, z).floor);
    if (!pending.length) {
      B.log("ah pen fences: floor not ready", { left: all.length });
      return false;
    }
    if (B.count("oak_fence") < 1) {
      B.log("ah pen out of fences", { left: pending.length });
      return false;
    }
    const t = now();
    const near = pending.filter(
      ([x, z]) =>
        (P.skip.get(key(x, s.Y, z)) || 0) < t &&
        B.reachOf(v3(x, s.F, z)) <= REACH &&
        !B.occupies(v3(x, s.Y, z)),
    );
    if (near.length) {
      for (const [x, z] of near) {
        if (B.reachOf(v3(x, s.F, z)) > REACH) continue;
        const ok = await placeFence(s, x, z, "oak_fence");
        if (!ok) markFail({ x, y: s.Y, z });
      }
      continue;
    }
    const nxt = pending.find(([x, z]) => (P.skip.get(key(x, s.Y, z)) || 0) < t);
    if (!nxt) {
      await B.sleep(500);
      continue;
    }
    const [sx, sz] = standFor(s, nxt[0], nxt[1], 4);
    moves++;
    const r = await B.goto(new B.goals.GoalNear(sx, s.Y, sz, 1), {
      timeoutMs: 15e3,
      stuckMs: 4e3,
    });
    if (r === "noPath" || r === "stuck" || r === "timeout") {
      if (++badMoves >= 4) {
        B.log("ah pen fences: unreachable", {
          r,
          at: B.feet(),
          placed: P.stats.fences,
        });
        return false;
      }
    } else badMoves = 0;
    if (B.reachOf(v3(nxt[0], s.F, nxt[1])) > REACH) {
      const r2 = await B.approach(v3(nxt[0], s.F, nxt[1]), {
        reach: 3.8,
        timeoutMs: 15e3,
      });
      if (!r2)
        (markFail({ x: nxt[0], y: s.Y, z: nxt[1] }),
          B.log("ah pen fence unreachable", { at: nxt, r }));
    }
  }
  B.log("ah pen fences", {
    s: Math.round((now() - t0) / 1e3),
    moves,
    placed: P.stats.fences,
  });
  return true;
}
function gateState(s) {
  const g = s.gate,
    b = B.blockAt(v3(g.x, g.y, g.z));
  if (!b || !/_fence_gate$/.test(b.name)) return null;
  const pr = b.getProperties() || {};
  const open = pr.open === true || pr.open === "true";
  const ew = pr.facing === "east" || pr.facing === "west";
  const sideEW = g.side === "east" || g.side === "west";
  return {
    open,
    facing: pr.facing,
    oriented: ew === sideEW,
    mine: P.mine.has(key(g.x, g.y, g.z)),
  };
}
async function placeGate(s, until) {
  const g = s.gate;
  for (let a = 0; a < 4 && !until(); a++) {
    let st = gateState(s);
    if (st && st.mine && st.oriented) {
      if (st.open) await closeGate();
      st = gateState(s);
      if (st && !st.open) return true;
      continue;
    }
    if (st) {
      await B.dig(B.blockAt(v3(g.x, g.y, g.z)), {});
      P.mine.delete(key(g.x, g.y, g.z));
    }

    const sx = g.x - g.n[0] * 2,
      sz = g.z - g.n[1] * 2;
    await B.goto(new B.goals.GoalBlock(sx, s.Y, sz), {
      timeoutMs: 15e3,
      stuckMs: 4e3,
    });
    const ref = B.blockAt(v3(g.x, s.F, g.z));
    const ok = await B.placeOn(ref, v3(0, 1, 0), "oak_fence_gate", {
      expectName: "oak_fence_gate",
    });
    const b = B.blockAt(v3(g.x, g.y, g.z));
    if (b && b.name === "oak_fence_gate") P.mine.add(key(g.x, g.y, g.z));
    B.log("ah pen gate", { ok, at: B.feet(), state: gateState(s) });
  }
  const st = gateState(s);
  return !!(st && st.mine && st.oriented && !st.open);
}

function validateLocal(s) {
  const issues = [];
  const add = (code, x, y, z) => issues.push({ code, x, y, z });
  for (let x = s.X; x <= s.R; x++)
    for (let z = s.Z; z <= s.S; z++) {
      const f = B.blockAt(v3(x, s.F, z));
      if (!f) {
        add("unloaded", x, s.F, z);
        continue;
      }
      if (!isFullShape(f.shapes)) add("floor_not_full_solid", x, s.F, z);
      const edge = isPerim(s, x, z);
      if (!edge) {
        for (let y = s.Y; y <= s.Y + 1; y++) {
          const c = infoAt(x, y, z);
          if (!(c.cls === AIR || c.cls === PLANT))
            add("interior_obstructed", x, y, z);
        }
        continue;
      }
      const b = B.blockAt(v3(x, s.Y, z));
      const fence = b && /_fence$/.test(b.name),
        gate = b && /_fence_gate$/.test(b.name);
      if (!fence && !gate) {
        add("missing_fence", x, s.Y, z);
        continue;
      }
      if (!P.mine.has(key(x, s.Y, z))) add("fence_not_agent_built", x, s.Y, z);
      const corner = (x === s.X || x === s.R) && (z === s.Z || z === s.S);
      const pr = b.getProperties() || {};
      const T = (v) => v === true || v === "true";
      if (gate) {
        if (corner) add("gate_at_corner", x, s.Y, z);
        if (T(pr.open)) add("gate_open", x, s.Y, z);
        const ew = pr.facing === "east" || pr.facing === "west";
        if (!corner && ew !== (x === s.X || x === s.R))
          add("gate_wrong_orientation", x, s.Y, z);
      } else {
        if (T(pr.waterlogged)) add("waterlogged_fence", x, s.Y, z);
        const need = [];
        if (x > s.X && (z === s.Z || z === s.S)) need.push("west");
        if (x < s.R && (z === s.Z || z === s.S)) need.push("east");
        if (z > s.Z && (x === s.X || x === s.R)) need.push("north");
        if (z < s.S && (x === s.X || x === s.R)) need.push("south");
        for (const f2 of need)
          if (!T(pr[f2])) add("fence_disconnected", x, s.Y, z);
      }
    }
  return issues;
}

function hook() {
  const b0 = bot();
  if (!b0 || P.hookedBot === b0) return;
  P.hookedBot = b0;
  b0.on("messagestr", (msg) => {
    if (typeof msg !== "string" || !msg.startsWith("NPA_FARM ")) return;
    let r = null;
    try {
      r = JSON.parse(msg.slice(9));
    } catch {
      r = { status: "error", error: "unparsed", raw: msg.slice(0, 300) };
    }
    P.last = r;
    const w = P.waiters.splice(0);
    for (const f of w) f(r);
  });
}
async function farmCmd(args, timeoutMs = 4e3) {
  hook();
  const wait = 1150 - (now() - P.lastCmd);
  if (wait > 0) await B.sleep(wait);
  P.lastCmd = now();
  const p = new Promise((res) => {
    const t = setTimeout(() => res(null), timeoutMs);
    P.waiters.push((r) => (clearTimeout(t), res(r)));
  });
  try {
    bot().chat(`/npafarm ${args}`);
  } catch (e) {
    return { status: "error", error: String(e) };
  }
  return p;
}

async function buildPen(ctx = {}, opts = {}) {
  const savedPen = P.pen;
  const savedSite = P.site;
  try {
    return await buildPen2(ctx, opts);
  } catch (e) {
    const err = String((e && e.stack) || e).slice(0, 400);
    B.log("ah pen failed", {
      issues: [{ code: "exception" }],
      codes: ["exception"],
      err,
    });
    try {
      B.setMovements({});
    } catch {}
    return null;
  } finally {
    if (opts.hold) {
      P.pen = savedPen;
      P.site = savedSite;
    }
  }
}
async function buildPen2(ctx = {}, opts = {}) {
  const t0 = now(),
    until = () => (opts.deadline ? now() > opts.deadline : B.timeLeft() < 3e4);
  hook();
  B.protect(["oak_fence", "oak_fence_gate"]);
  for (let i = 0; i < 20 && !B.hasBot(); i++) await B.sleep(250);
  const me = B.feet();
  const chest = [v3(me.x + 2, me.y, me.z), v3(me.x + 3, me.y, me.z)];
  const targets = (ctx && ctx.targets) || {};
  const grassW = opts.grassW ?? ("sheep" in targets ? GRASS_SHEEP_S : 0.03);
  if (B.count("oak_fence") < 84 || B.count("oak_fence_gate") < 1)
    B.log("ah pen low fences", {
      fences: B.count("oak_fence"),
      gates: B.count("oak_fence_gate"),
    });

  const pf = opts.prefer || null;
  const radius =
    opts.radius ||
    (pf
      ? Math.min(150, Math.max(96, Math.ceil(B.hdist(B.pos(), pf) + 50)))
      : 96);
  const base = { avoid: chest, grassW, radius };
  const pick = async (so) => {
    let st = null;
    for (let a = 0; a < 3 && !st; a++) {
      st = chooseSite(so);
      if (!st || st.cost >= INF / 10) {
        st = null;

        if (so.maxDist) {
          if (a >= 1) break;
          so.maxDist *= 2;
        } else await B.sleep(1000);
      }
    }
    return st;
  };
  let home = await pick({ ...base });
  if (home && home.cost > 350 && !opts.radius && radius < 150) {
    await B.sleep(50);
    const far = chooseSite({ ...base, radius: 150 });
    B.log("ah pen far scan", {
      near: Math.round(home.cost),
      far: far && Math.round(far.cost),
      took: !!far && far.cost < home.cost * 0.75,
    });
    if (far && far.cost < home.cost * 0.75) home = far;
  }
  let site = home;
  if (pf) {
    const near = await pick({
      ...base,
      prefer: pf,
      maxDist: opts.maxDist || 40,
    });
    const ok = !!near && (!home || near.cost <= home.cost + PREFER_BONUS);
    if (ok) site = near;
    B.log("ah pen choice", {
      prefer: pf.floored ? pf.floored() : pf,
      near: near && round(near),
      home: home && round(home),
      took: ok ? "prefer" : "home",
    });
  }
  if (site && site.nav) P.nav = site.nav;
  if (!site) {
    B.log("ah pen failed", {
      s: Math.round((now() - t0) / 1e3),
      issues: [{ code: "no_site" }],
      codes: ["no_site"],
    });
    return null;
  }

  let gatherS = 0;
  if (
    (site.net || 0) > 30 &&
    (site.softAround || 0) < site.net * 1.5 &&
    fillCount() < site.net
  ) {
    const tg = now();
    await gatherNear(Math.min(site.net + 8, 160), 1.5e5, until);
    gatherS = Math.round((now() - tg) / 1e3);
  }

  let dryFb = site.bestDry || (home && home.bestDry) || null;
  if (
    dryFb &&
    dryFb !== site &&
    (((dryFb.net || 0) > 120 && dryFb.cost > Math.max(600, 2 * site.cost)) ||
      (dryFb.roof || 0) > 100)
  ) {
    B.log("ah pen dry fallback dropped", {
      dry: round(dryFb),
      site: round(site),
    });
    dryFb = null;
  }
  const cands = [site, ...(site.alts || []).slice(0, 1)];
  if (dryFb && !cands.includes(dryFb)) cands.push(dryFb);
  else if (!dryFb && site.dry === false) cands.splice(1, 0, site);
  let s = null;
  const walkT0 = now();
  for (const c of cands) {
    if (now() - walkT0 > 2.2e5) break;
    s = setSite(c, opts.prefer);
    if (await walkTo(s, until, c === dryFb ? 1.2e5 : 8e4)) break;
    B.log("ah pen site unreachable", {
      X: s.X,
      Y: s.Y,
      Z: s.Z,
      at: B.feet(),
      dryFallback: c === dryFb,
    });
    s = null;
  }
  if (!s) s = setSite(dryFb || site, opts.prefer);
  site = s.cand;
  const ph = { site_walk: Math.round((now() - t0) / 1e3), gather: gatherS };

  for (let x = s.X; x <= s.R; x++)
    for (let z = s.Z; z <= s.S; z++) B.protectColumn(x, z);
  for (const [x, z] of landingCells(s)) B.protectColumn(x, z);
  let tph = now();
  if (site.tools) await ensureTools(s, until);
  ph.tools = Math.round((now() - tph) / 1e3);
  B.log("ah pen plan", {
    v: VERSION,
    tools: site.tools,
    X: s.X,
    Y: s.Y,
    Z: s.Z,
    gate: s.gate,
    center: s.center,
  });
  let reg = null,
    regAttempt = 0;
  for (let attempt = 1; attempt <= 4 && !until(); attempt++) {
    if (attempt > 1) (P.skip.clear(), P.redo.clear(), P.fails.clear());
    if (
      !atSite(s, 40) &&
      !(await walkTo(s, until, 6e4)) &&
      dryFb &&
      s.cand !== dryFb
    ) {
      B.log("ah pen switch to dry fallback", {
        from: { X: s.X, Z: s.Z },
        to: { X: dryFb.X, Z: dryFb.Z },
        at: B.feet(),
      });
      s = setSite(dryFb, opts.prefer);
      site = dryFb;
      for (let x = s.X; x <= s.R; x++)
        for (let z = s.Z; z <= s.S; z++) B.protectColumn(x, z);
      for (const [x, z] of landingCells(s)) B.protectColumn(x, z);
      (P.skip.clear(), P.redo.clear(), P.fails.clear());
      await walkTo(s, until, 1.2e5);
    }
    tph = now();
    const lr = await level(s, until, attempt === 1 ? 4.5 * 6e4 : 9e4);
    if (lr === "flooded") {
      const alt = [...(site.alts || []), dryFb].find(
        (c) =>
          c &&
          c.wet === 0 &&
          (Math.abs(c.X - s.X) > 24 || Math.abs(c.Z - s.Z) > 24) &&
          !(P.floodedSites || []).includes(`${c.X},${c.Z}`),
      );
      (P.floodedSites || (P.floodedSites = [])).push(`${s.X},${s.Z}`);
      P.flood = 0;
      if (alt) {
        B.log("ah pen switch site (flooded)", {
          from: { X: s.X, Z: s.Z },
          to: { X: alt.X, Z: alt.Z },
        });
        s = setSite(alt, opts.prefer);
        site = alt;
        for (let x = s.X; x <= s.R; x++)
          for (let z = s.Z; z <= s.S; z++) B.protectColumn(x, z);
        for (const [x, z] of landingCells(s)) B.protectColumn(x, z);
        (P.skip.clear(), P.redo.clear(), P.fails.clear());
        await walkTo(s, until, 1.2e5);
        attempt = 0;
        continue;
      }
    }
    ph.level = (ph.level || 0) + Math.round((now() - tph) / 1e3);
    tph = now();
    if (B.feet().y < s.Y) await climbOut(s);
    await fences(s, until);
    if (B.feet().y < s.Y) await climbOut(s);
    await placeGate(s, until);
    ph.fences = (ph.fences || 0) + Math.round((now() - tph) / 1e3);

    await B.sleep(400);
    let issues = validateLocal(s);

    const hard = issues.filter((i) => i.code !== "fence_disconnected");
    if (issues.length)
      B.log("ah pen local issues", {
        attempt,
        n: issues.length,
        issues: issues.slice(0, 12),
      });
    if (hard.length && attempt < 3) continue;

    try {
      await require("./protection").clearPen(
        { x: s.X, y: s.Y, z: s.Z, w: s.R - s.X - 1, d: s.S - s.Z - 1 },
        () => enterPen(),
      );
    } catch (e) {
      B.log("ah guard error", { at: "clearPen", err: String(e).slice(0, 160) });
    }
    if (opts.hold) {
      const hold = {
        x: s.X,
        y: s.Y,
        z: s.Z,
        w: W,
        d: D,
        gates: [{ x: s.gate.x, y: s.gate.y, z: s.gate.z }],
        gate: s.gate,
        center: s.center,
        registered: false,
        hold: true,
      };
      B.log("ah hold pen", {
        x: hold.x,
        y: hold.y,
        z: hold.z,
        w: hold.w,
        d: hold.d,
      });
      return hold;
    }
    const r = await farmCmd(`register ${s.X} ${s.Y} ${s.Z} ${W} ${D}`);
    if (r && r.valid) {
      reg = r;
      regAttempt = attempt;
      break;
    }
    const codes = r && r.issues ? r.issues.map((i) => i.code) : [];
    B.log("ah pen register failed", {
      attempt,
      error: r && r.error,
      issue_count: r && r.issue_count,
      issues: r && r.issues ? r.issues.slice(0, 16) : null,
      codes: [...new Set(codes)],
    });
    if (r && r.issues)
      for (const i of r.issues) {
        if (i.code === "fence_not_agent_built")
          P.mine.delete(key(i.x, i.y, i.z));
      }
    if (r && /128 blocks/.test(String(r.error || "")))
      await B.goto(new B.goals.GoalNear(s.center.x, s.Y, s.center.z, 8), {
        timeoutMs: 3e4,
      });
  }
  if (!reg) {
    const iss = validateLocal(s);
    B.log("ah pen failed", {
      s: Math.round((now() - t0) / 1e3),
      issues: iss.slice(0, 10),
      n: iss.length,
      codes: [...new Set(iss.map((i) => i.code))],
    });
    return null;
  }

  for (let x = s.X; x <= s.R; x++)
    for (let z = s.Z; z <= s.S; z++) B.protectColumn(x, z);
  P.pen = {
    x: s.X,
    y: s.Y,
    z: s.Z,
    w: W,
    d: D,
    gates: [{ x: s.gate.x, y: s.gate.y, z: s.gate.z }],
    gate: s.gate,
    center: s.center,
    registered: true,
    starters: reg.starters || [],
  };
  B.log("ah registered", {
    x: s.X,
    y: s.Y,
    z: s.Z,
    w: W,
    d: D,
    attempts: regAttempt,
    grass: site.grass,
    phases: ph,
    tm: Object.fromEntries(
      Object.entries(P.tm).map(([k, v]) => [
        k,
        /N$/.test(k) ? v : Math.round(v / 100) / 10,
      ]),
    ),
    gate: s.gate,
    build_s: Math.round((now() - t0) / 1e3),
    starters: (reg.starters || []).length,
    stats: P.stats,
  });
  return P.pen;
}

function nearWater() {
  const f = B.feet();
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++)
      for (const dy of [-1, 0]) {
        const b = B.blockAt(f.offset(dx, dy, dz));
        if (b && b.name === "water") return true;
      }
  return false;
}

async function manualSwim(t, maxMs) {
  const bot = B.S.bot,
    t0 = now(),
    start = B.pos().clone();
  let wasWet = false,
    under = 0;
  B.S.waterBusy = true;
  try {
    while (now() - t0 < maxMs && B.hasBot()) {
      const p = B.pos();
      if (Math.hypot(t.x + 0.5 - p.x, t.z + 0.5 - p.z) < 2.5) break;
      const feetB = B.blockAt(p.floored()),
        headB = B.blockAt(p.offset(0, 1.62, 0).floored());
      const wet = !!feetB && feetB.name === "water";
      wasWet = wasWet || wet;
      under = headB && headB.name === "water" ? under + 200 : 0;
      if (under > 6e3) break;
      if (wasWet && !wet && bot.entity.onGround && now() - t0 > 2e3) break;
      await bot.lookAt(new Vec3(t.x + 0.5, p.y + 1.2, t.z + 0.5), true);
      bot.setControlState("sprint", false);
      bot.setControlState("forward", true);
      bot.setControlState("jump", true);
      await B.sleep(200);
    }
  } finally {
    try {
      bot.clearControlStates();
    } catch {}
    B.S.waterBusy = !!P.swimHold;
  }
  B.log("ah pen swim", {
    to: t,
    from: start.floored(),
    at: B.feet(),
    ms: now() - t0,
  });
}

const atSite = (s, r = 16) =>
  B.hdist(B.pos(), s.center) <= r && Math.abs(B.pos().y - s.Y) <= 8;
async function walkTo(s, until, maxMs = 1.2e5) {
  const c = s.center,
    d = B.hdist(B.pos(), c),
    w0 = now(),
    over = () => until() || now() - w0 > maxMs;
  if (atSite(s, 14)) return true;

  const wps = navPath(Math.floor(c.x), Math.floor(c.z));
  let legs = 0,
    bad = 0,
    swims = 0;
  const deep = s.Y - B.pos().y > 6;
  if (wps.wet || deep)
    B.setMovements({
      water: !!wps.wet,
      ...(deep ? { hardDig: true, towers: true, digCost: 2 } : {}),
    });

  let swimGuard = null;
  if (wps.wet) {
    B.S.waterBusy = true;
    P.swimHold = true;
    let under = 0;
    swimGuard = setInterval(() => {
      try {
        const hb = B.blockAt(B.pos().offset(0, 1.62, 0).floored());
        under = hb && hb.name === "water" ? under + 250 : 0;
        if (under > 6e3) B.S.waterBusy = false;
      } catch {}
    }, 250);
  }
  try {
    for (const w of wps) {
      if (over() || bad >= 3) break;
      if (B.hdist(B.pos(), w) < 4) continue;
      await B.goto(new B.goals.GoalNear(w.x, w.y, w.z, 2), {
        timeoutMs: 2e4,
        stuckMs: 6e3,
      });
      legs++;
      if (B.hdist(B.pos(), w) > 5 && wps.wet && nearWater()) {
        await manualSwim(w, 4.5e4);
        swims++;
      }
      if (B.hdist(B.pos(), w) > 5) bad++;
    }

    if (wps.wet && !atSite(s) && nearWater() && !over()) {
      await manualSwim(
        { x: Math.floor(c.x), z: Math.floor(c.z) },
        Math.min(6e4, Math.max(5e3, maxMs - (now() - w0))),
      );
      swims++;
    }
  } finally {
    P.swimHold = false;
    if (swimGuard) (clearInterval(swimGuard), (B.S.waterBusy = false));
  }
  if (wps.wet || deep) B.setMovements({});
  for (let a = 0; a < 3 && !over(); a++) {
    if (atSite(s)) break;

    if (a >= 1)
      B.setMovements({
        maxDropDown: a >= 2 ? 10 : 6,
        digCost: 2,
        towers: true,
        hardDig: true,
        water: a >= 2,
      });
    await B.goto(new B.goals.GoalNear(c.x, s.Y, c.z, 4), {
      timeoutMs: Math.max(
        5e3,
        Math.min(2e4 + B.hdist(B.pos(), c) * 900, maxMs - (now() - w0)),
      ),
      stuckMs: 8e3,
    });
    if (a >= 1) B.setMovements({});
  }
  const ok = atSite(s);
  B.log("ah pen walk", {
    ok,
    legs,
    wps: wps.length,
    bad,
    swims,
    wet: !!wps.wet,
    at: B.feet(),
    d0: Math.round(d),
  });
  return ok;
}

function evalSite(pos, opts = {}) {
  if (!B.hasBot()) return null;
  const nav0 = P.nav;
  const c = chooseSite({
    prefer: pos,
    maxDist: opts.maxDist ?? 40,
    grassW: opts.sheep ? GRASS_SHEEP_S : 0.03,
    radius: opts.radius || 96,
    quiet: true,
  });
  P.nav = nav0;
  return c ? round(c) : null;
}

function inPen(pos) {
  const s = P.site;
  if (!s || !pos) return false;
  return (
    pos.x >= s.X + 1 &&
    pos.x < s.R &&
    pos.z >= s.Z + 1 &&
    pos.z < s.S &&
    pos.y >= s.Y - 0.5 &&
    pos.y < s.Y + 16
  );
}

async function toggleGate(wantOpen) {
  const s = P.site;
  if (!s) return false;
  const g = s.gate,
    gp = v3(g.x, g.y, g.z);
  for (let a = 0; a < 4; a++) {
    const st = gateState(s);
    if (!st) return false;
    if (st.open === wantOpen) return true;
    if (B.reachOf(gp) > REACH)
      await B.approach(gp, { reach: 3.5, timeoutMs: 15e3 });

    try {
      B.S.bot.setControlState("sneak", false);
    } catch {}
    const b = B.blockAt(gp);

    const side =
      Math.sign(
        (B.pos().x - (g.x + 0.5)) * g.n[0] + (B.pos().z - (g.z + 0.5)) * g.n[1],
      ) || 1;
    const face =
      a % 2 === 0 ? v3(0, 1, 0) : v3(g.n[0] * side, 0, g.n[1] * side);
    const got = await B.useOn(b, face, {
      expectAt: gp,
      expect: (nb) => {
        const pr = (nb && nb.getProperties && nb.getProperties()) || {};
        return (pr.open === true || pr.open === "true") === wantOpen;
      },
      waitMs: 2500,
    });
    if (!got) {
      P.stats.gateMiss = (P.stats.gateMiss || 0) + 1;
      if (P.stats.gateMiss <= 6)
        B.log("ah pen gate toggle miss", {
          want: wantOpen,
          held: B.S.bot.heldItem && B.S.bot.heldItem.name,
          reach: +B.reachOf(gp).toFixed(2),
          me: B.pos(),
          state: gateState(s),
        });
      await B.sleep(400);
    }
  }
  const st = gateState(s);
  return !!st && st.open === wantOpen;
}
const openGate = () => toggleGate(true);
const closeGate = () => toggleGate(false);

async function passGate(fromSide) {
  const s = P.site,
    g = s.gate;
  const fx = g.x + g.n[0] * fromSide,
    fz = g.z + g.n[1] * fromSide;
  const tx = g.x - g.n[0] * fromSide * 2,
    tz = g.z - g.n[1] * fromSide * 2;
  const far = B.hdist(B.pos(), { x: fx + 0.5, z: fz + 0.5 });
  if (far > 24)
    await B.goto(new B.goals.GoalNear(fx, s.Y, fz, 3), {
      timeoutMs: 2e4 + far * 700,
      stuckMs: 6e3,
    });
  await B.goto(new B.goals.GoalBlock(fx, s.Y, fz), {
    timeoutMs: 2e4,
    stuckMs: 4e3,
  });
  if (Math.hypot(B.pos().x - (fx + 0.5), B.pos().z - (fz + 0.5)) > 1.2) {
    await B.goto(new B.goals.GoalNear(fx, s.Y, fz, 1), {
      timeoutMs: 1e4,
      stuckMs: 3e3,
    });
  }

  if (fromSide < 0)
    for (
      let w = 0;
      w < 16 &&
      animalNear(
        v3(g.x + 0.5 - g.n[0] * 0.8, s.Y, g.z + 0.5 - g.n[1] * 0.8),
        1.8,
      );
      w++
    )
      await B.sleep(250);
  let clear = true;
  try {
    clear = await require("./protection").beforeGate(v3(g.x, s.Y, g.z), {
      x: s.X,
      y: s.Y,
      z: s.Z,
      w: s.R - s.X - 1,
      d: s.S - s.Z - 1,
    });
  } catch {}
  if (clear === false)
    return (B.log("ah pen gate kept shut", { why: "predator" }), false);
  if (!(await openGate())) return false;
  await B.nudge(v3(g.x + 0.5, s.Y, g.z + 0.5), 1500, 0.3);
  await B.nudge(v3(tx + 0.5, s.Y, tz + 0.5), 1500, 0.35);
  if (fromSide > 0 ? !inPen(B.pos()) : inPen(B.pos())) {
    let dug = 0;
    for (const d of [0, -1, 1, -2, 2]) {
      for (const dy of [1, 0]) {
        if (d === 0 && dy === 0) continue;
        const p = v3(g.x + g.n[0] * d, s.Y + dy, g.z + g.n[1] * d),
          b = B.blockAt(p);
        if (
          b &&
          b.boundingBox === "block" &&
          !/_fence|_fence_gate/.test(b.name) &&
          B.reachOf(p) <= REACH
        ) {
          if (await B.dig(b, toolFor(b) ? { tool: toolFor(b) } : {})) dug++;
        }
      }
    }
    P.stats.gateBlocked = (P.stats.gateBlocked || 0) + 1;
    B.log("ah pen gate blocked", {
      from: fromSide,
      dug,
      at: B.pos(),
      gate: gateState(s),
    });
    if (gateState(s) && !gateState(s).open) await openGate();
    await B.nudge(v3(g.x + 0.5, s.Y, g.z + 0.5), 1500, 0.3);
    await B.nudge(v3(tx + 0.5, s.Y, tz + 0.5), 1500, 0.35);
  }
  const ok = fromSide > 0 ? inPen(B.pos()) : !inPen(B.pos()) && !onGateCell();

  for (let a = 0; a < 3; a++) {
    if (onGateCell()) await B.nudge(v3(tx + 0.5, s.Y, tz + 0.5), 800, 0.35);
    if (await closeGate()) break;
  }
  return ok;
}
function animalNear(p, r) {
  const ents = B.S.bot.entities || {};
  for (const id in ents) {
    const e = ents[id];
    if (
      !e ||
      e === B.S.bot.entity ||
      !e.position ||
      e.type === "player" ||
      e.name === "item"
    )
      continue;
    if (
      !/^(cow|sheep|pig|chicken|rabbit|horse|donkey|goat|llama|mooshroom)$/.test(
        e.name || "",
      )
    )
      continue;
    if (
      Math.hypot(e.position.x - p.x, e.position.z - p.z) < r &&
      Math.abs(e.position.y - p.y) < 2
    )
      return true;
  }
  return false;
}
function onGateCell() {
  const g = P.site.gate,
    p = B.pos();
  return (
    Math.abs(p.x - (g.x + 0.5)) < 0.85 && Math.abs(p.z - (g.z + 0.5)) < 0.85
  );
}
async function enterPen() {
  if (!P.site) return false;
  if (inPen(B.pos())) return true;
  const t0 = now();
  let ok = false;
  for (let a = 0; a < 3 && !ok; a++) ok = await passGate(+1);
  B.log("ah pen enter", { ok, ms: now() - t0, gate: gateState(P.site) });
  return ok;
}
async function leavePen() {
  if (!P.site) return false;
  if (!inPen(B.pos())) return true;
  const t0 = now();
  let ok = false;
  for (let a = 0; a < 3 && !ok; a++) ok = await passGate(-1);
  B.log("ah pen leave", { ok, ms: now() - t0, gate: gateState(P.site) });
  return ok;
}

async function checkPen() {
  if (!P.site) return { valid: false, issues: [{ code: "no_site" }] };
  const r = await farmCmd("status");
  const local = validateLocal(P.site);
  const out = {
    valid: !!(r && r.valid),
    issue_count: r ? r.issue_count : null,
    issues: (r && r.issues) || [],
    local: local.slice(0, 16),
    error: r && r.error,
  };
  B.log("ah pen status", {
    valid: out.valid,
    issue_count: out.issue_count,
    local: local.length,
    codes: [...new Set(out.issues.map((i) => i.code))],
  });
  return out;
}

async function fixCells(s, issues, until) {
  const cells = issues.filter(
    (i) =>
      i.code === "floor_not_full_solid" || i.code === "interior_obstructed",
  );
  let fixed = 0;
  for (let round = 0; round < 3 && !until(); round++) {
    const ops = [];
    for (const i of cells) {
      const o = [];
      columnOps(s, i.x, i.z, o, false);
      ops.push(...o);
    }
    if (!ops.length) break;
    ops.sort(
      (a, b) => B.reachOf(v3(a.x, a.y, a.z)) - B.reachOf(v3(b.x, b.y, b.z)),
    );
    for (const op of ops) {
      if (until()) break;
      const p = v3(op.x, op.y, op.z);
      if (op.k === "fill" && !fillItem()) {
        await getMaterial(s, 2);
        if (!fillItem()) break;
      }
      if (B.reachOf(p) > REACH) {
        const inside =
          !isPerim(s, op.x, op.z) &&
          Math.min(op.x - s.X, s.R - op.x, op.z - s.Z, s.S - op.z) > 3;
        if (inside && !inPen(B.pos())) await enterPen();
        await B.approach(p, { reach: 3.8, timeoutMs: 1.5e4, noEscalate: true });
      }
      if (B.reachOf(p) <= REACH && (await doOp(op))) fixed++;
    }
  }
  return fixed;
}
async function repairPen(opts = {}) {
  const s = P.site;
  if (!s) return false;
  const until = () =>
    opts.deadline ? now() > opts.deadline : B.timeLeft() < 1.5e3;
  let issues = validateLocal(s);
  if (!issues.length) return true;
  B.log("ah pen repair", {
    n: issues.length,
    codes: [...new Set(issues.map((i) => i.code))],
  });
  if (
    issues.some(
      (i) =>
        i.code === "floor_not_full_solid" || i.code === "interior_obstructed",
    )
  ) {
    const t0 = now(),
      fixed = await fixCells(s, issues, until);
    issues = validateLocal(s);
    B.log("ah pen repair cells", {
      fixed,
      ms: now() - t0,
      left: issues.length,
    });
    if (!issues.length) return true;
  }
  const interior = issues.some(
    (i) =>
      i.code === "interior_obstructed" ||
      (i.code === "floor_not_full_solid" && !isPerim(s, i.x, i.z)),
  );

  const wasIn = inPen(B.pos());
  if (interior && !wasIn) await enterPen();
  if (interior) await level(s, until);
  for (const i of issues)
    if (i.code === "fence_not_agent_built") P.mine.delete(key(i.x, i.y, i.z));
  if (issues.some((i) => /fence|floor/.test(i.code))) {
    if (!inPen(B.pos())) {
      for (const [x, z] of perimeter(s)) {
        if (until()) break;
        if (x === s.gate.x && z === s.gate.z) continue;
        if (fenceOk(s, x, z)) continue;
        await B.approach(v3(x, s.F, z), { reach: 3.8, timeoutMs: 15e3 });
        await placeFence(s, x, z, "oak_fence");
      }
    } else await fences(s, until);
  }
  const gateGone = issues.some(
    (i) => i.x === s.gate.x && i.z === s.gate.z && /fence/.test(i.code),
  );
  if (gateGone || issues.some((i) => /gate/.test(i.code)))
    await placeGate(s, until);
  if (!wasIn && inPen(B.pos())) await leavePen();
  issues = validateLocal(s);
  B.log("ah pen repaired", {
    left: issues.length,
    codes: [...new Set(issues.map((i) => i.code))],
  });
  return !issues.length;
}

function gateInfo() {
  const s = P.site;
  if (!s) return null;
  const g = s.gate,
    at = (d) => v3(g.x + g.n[0] * d, g.y, g.z + g.n[1] * d);
  return {
    gate: v3(g.x, g.y, g.z),
    n: g.n,
    side: g.side,
    outside: [at(1), at(2)],
    inside: [at(-1), at(-2)],
    state: gateState(s),
  };
}

module.exports = {
  evalSite,
  gateInfo,
  buildPen,
  inPen,
  enterPen,
  leavePen,
  checkPen,
  repairPen,
  openGate,
  closeGate,
  validateLocal: () => (P.site ? validateLocal(P.site) : null),
  chooseSite,
  precut,
  P,
};
