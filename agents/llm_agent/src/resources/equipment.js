"use strict";
var v = require("../runtime/connection"),
  lt = require("../agriculture/terrain"),
  {
    S: Be,
    goals: zt,
    v3: Qe,
    log: we,
    now: ne,
    sleep: He,
    count: P,
    blockAt: J,
    isAir: mo,
  } = v,
  st = ["iron_ore", "deepslate_iron_ore"],
  he = { furnace: null, smeltStarted: 0, done: !1, failed: !1 };
function Ft(e) {
  let a = Be.bot.registry;
  return e
    .map((t) => a.blocksByName[t] && a.blocksByName[t].id)
    .filter((t) => t !== void 0);
}
function qn(e) {
  let a = [];
  try {
    a = Be.bot.findBlocks({ matching: Ft(st), maxDistance: 48, count: 120 });
  } catch {
    return [];
  }
  let t = v.pos();
  return a
    .filter((n) => !e.has(v.key(n)))
    .map((n) => {
      let o = [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 1, 0],
          [0, -1, 0],
          [0, 0, 1],
          [0, 0, -1],
        ].some(([l, u, d]) => mo(J(n.offset(l, u, d)))),
        s = Math.max(0, t.y - n.y),
        r = [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
          [0, 0, -1],
        ].some(([l, u, d]) => {
          let m = J(n.offset(l, u, d));
          return m && m.name === "lava";
        }),
        i = 0;
      for (let l = -2; l <= 2; l++)
        for (let u = -1; u <= 3; u++)
          for (let d = -2; d <= 2; d++) {
            let m = J(n.offset(l, u, d));
            m && rt.test(m.name) && i++;
          }
      return {
        p: n,
        depth: s,
        cost: v.hdist(n, t) + s * 2.2 + (o ? -6 : 0) + (r || i ? 999 : 0),
      };
    })
    .filter((n) => n.cost < 80 && n.depth <= 26 && n.p.y <= t.y + 12)
    .sort((n, o) => n.cost - o.cost);
}
var rt = /^(lava|water|bubble_column)$/,
  po =
    /^(dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|gravel|sand|red_sand|clay|mud|snow|snow_block|moss_block|dirt_path|farmland)$/,
  ho = () => {
    let e = v.feet();
    return [e, e.offset(0, 1, 0)].some((a) => {
      let t = J(a);
      return t && (t.name === "water" || t.name === "bubble_column");
    });
  },
  wo = (e) =>
    [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [0, 1, 0],
      [0, -1, 0],
    ].some(([a, t, n]) => {
      let o = J(e.offset(a, t, n));
      return !o || rt.test(o.name);
    });
function yo(e, a, t) {
  for (let n = t + 10; n > t - 30; n--) {
    let o = J(Qe(e, n, a));
    if (!o) return null;
    if (o.boundingBox === "block" && !/leaves|_log|_wood/.test(o.name))
      return n;
    if (rt.test(o.name)) return null;
  }
  return null;
}
function Fn(e, a) {
  let t = [];
  for (let [n, o] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    let s = e.x + n,
      r = e.z + o,
      i = !1;
    for (let p = -1; p <= 1 && !i; p++)
      for (let h = -1; h <= 1 && !i; h++)
        i = v.protectedCols.has(`${s + p},${r + h}`);
    if (i) continue;
    let l = yo(s, r, Math.max(a.y, e.y));
    if (l === null || l < e.y || l - e.y > 22) continue;
    let u = !0;
    for (let p = e.y - 1; p <= l && u; p++) {
      for (let [b, _] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        let k = J(Qe(s + b, p, r + _));
        (!k || rt.test(k.name)) && (u = !1);
      }
      let h = J(Qe(s, p, r));
      p < l && h && h.boundingBox !== "block" && (u = !1);
    }
    let d = J(Qe(s, e.y - 1, r));
    if (!u || !d || d.boundingBox !== "block") continue;
    let m = v.feet();
    t.push({
      col: Qe(s, l, r),
      depth: l - e.y,
      cost:
        v.hdist({ x: s, z: r }, a) +
        (l - e.y) * 0.7 +
        2 * Math.abs(l + 1 - m.y),
    });
  }
  return (t.sort((n, o) => n.cost - o.cost), t[0] || null);
}
async function Ca(e, a) {
  for (; v.feet().y > e && ne() < a;) {
    if ((await v.tick(), ho())) return !1;
    let t = v.feet(),
      n = J(t.offset(0, -1, 0));
    if (!n || rt.test(n.name) || wo(t.offset(0, -1, 0))) return !1;
    let o = J(t.offset(0, -2, 0));
    if (
      !o ||
      o.boundingBox !== "block" ||
      (await v.nudge(t.offset(0.5, 0, 0.5), 1200, 0.12, !0),
      !mo(n) &&
        !(await v.dig(
          n,
          po.test(n.name)
            ? { hand: !0, maxMs: 4e3 }
            : { tool: "stone_pickaxe", maxMs: 6e3 },
        )))
    )
      return !1;
    let s = v.pos().y;
    for (let r = 0; r < 16 && v.pos().y > s - 0.9; r++) await He(50);
    v.pos().y > s - 0.9 && (await v.nudge(t.offset(0.5, 0, 0.5), 800, 0.08));
    for (let r = 0; r < 10 && v.pos().y > s - 0.9; r++) await He(50);
    if (v.pos().y > s - 0.9) return !1;
  }
  return v.feet().y <= e;
}
async function ta(e, a, t = null) {
  let n = Be.bot,
    o = 0;
  for (; v.feet().y < e && ne() < a && o < 8 && !(t && t());) {
    if ((await v.tick(), ho())) {
      let m = v.pos().y;
      (n.setControlState("jump", !0),
        await He(600),
        n.setControlState("jump", !1),
        v.pos().y <= m + 0.2 && o++);
      continue;
    }
    for (let m = 0; m < 20 && !n.entity.onGround; m++) await He(50);
    let s = v.feet();
    for (let m of [2, 3]) {
      let p = J(s.offset(0, m, 0));
      p &&
        p.boundingBox === "block" &&
        (await v.dig(
          p,
          po.test(p.name)
            ? { hand: !0, maxMs: 4e3 }
            : { tool: "stone_pickaxe", maxMs: 6e3 },
        ));
    }
    let r = J(s);
    r &&
      r.name === "powder_snow" &&
      (await v.dig(r, { hand: !0, maxMs: 2500 }));
    let i = he.furnace || P("furnace") ? 0 : 8,
      u =
        v
          .allItems()
          .map((m) => m.name)
          .find((m) =>
            /^(andesite|diorite|granite|tuff|calcite|deepslate|netherrack|gravel|sand|red_sand|sandstone|red_sandstone|smooth_sandstone|terracotta|[a-z_]+_terracotta)$/.test(
              m,
            ),
          ) ||
        (P("cobblestone") > i
          ? "cobblestone"
          : P("cobbled_deepslate") > i
            ? "cobbled_deepslate"
            : null) ||
        ["dirt", "cobblestone", "cobbled_deepslate"].find((m) => P(m) > 0);
    if (!u || !(await v.equip(u))) return !1;
    try {
      await n.look(n.entity.yaw, -Math.PI / 2, !0);
    } catch {}
    let d = v.pos().y;
    n.setControlState("jump", !0);
    for (let m = 0; m < 16 && v.pos().y < d + 1.05; m++) await He(25);
    try {
      await v.withTimeout(
        n.placeBlock(J(s.offset(0, -1, 0)), Qe(0, 1, 0)),
        1500,
        "pillar",
      );
    } catch {}
    n.setControlState("jump", !1);
    for (let m = 0; m < 12 && !n.entity.onGround; m++) await He(50);
    if (v.feet().y <= s.y) {
      o++;
      let m = J(s),
        p = J(s.offset(0, -1, 0));
      (o === 3 &&
        we("pillar trouble", {
          at: s,
          here: m && m.name,
          under: p && p.name,
          item: u,
          held: n.heldItem && n.heldItem.name,
        }),
        await v.nudge(s.offset(0.5, 0, 0.5), 600, 0.15, !0));
    } else o = 0;
  }
  try {
    n.clearControlStates();
  } catch {}
  return v.feet().y >= e;
}
async function bo(e, a) {
  let t = /^(stone|cobblestone|deepslate|cobbled_deepslate)$/,
    n = (o) =>
      [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 0, 1],
        [0, 0, -1],
        [0, 1, 0],
        [0, -1, 0],
      ].some(([s, r, i]) => {
        let l = J(o.offset(s, r, i));
        return !l || rt.test(l.name);
      });
  for (let o = 0; o < 7 && ye() < e && ne() < a; o++) {
    let s = v.feet();
    for (let [r, i] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      for (let l of [0, 1]) {
        if (ye() >= e) break;
        let u = s.offset(r, l, i),
          d = J(u);
        d &&
          t.test(d.name) &&
          !n(u) &&
          (await v.dig(d, { tool: "stone_pickaxe", maxMs: 6e3 }));
      }
    if (
      (await He(250),
      await v.collectItems(
        v.pos(),
        2.5,
        new Set(["cobblestone", "cobbled_deepslate"]),
        2e3,
      ),
      ye() < e && !(await Ca(s.y - 1, a)))
    )
      break;
  }
  return ye() >= e;
}
async function ko(e, a) {
  let t = v.feet(),
    n = (i, l, u) => {
      for (let d = 1; d <= 10; d++) {
        let m = J(Qe(i, u - d, l));
        if (!m || m.boundingBox !== "block" || rt.test(m.name)) return !1;
      }
      return !0;
    },
    o = null;
  for (let i = 0; i <= 8 && !o; i++)
    for (let l = -i; l <= i && !o; l++)
      for (let u = -i; u <= i && !o; u++) {
        if (Math.max(Math.abs(l), Math.abs(u)) !== i) continue;
        let d = t.x + l,
          m = t.z + u,
          p = yo(d, m, t.y);
        p === null ||
          Math.abs(p + 1 - t.y) > 1 ||
          v.protectedCols.has(`${d},${m}`) ||
          (n(d, m, p + 1) && (o = Qe(d, p + 1, m)));
      }
  if (
    !o ||
    ((o.x === t.x && o.z === t.z) ||
      (await v.goto(new zt.GoalBlock(o.x, o.y, o.z), {
        timeoutMs: 1e4,
        stuckMs: 3e3,
      })),
    v.protectedCols.has(`${v.feet().x},${v.feet().z}`))
  )
    return !1;
  let s = v.feet().y;
  for (
    let i = 0;
    i < 18 && ye() < e && ne() < a && (await Ca(v.feet().y - 1, a));
    i++
  )
    await v.collectItems(
      v.pos(),
      2,
      new Set(["cobblestone", "cobbled_deepslate"]),
      800,
    );
  ye() < e && (await bo(e, Math.min(a, ne() + 15e3)));
  let r = await ta(s, ne() + 4e4);
  return (we("stone shaft", { cobble: ye(), up: r, at: v.feet() }), ye() >= e);
}
var nt = () => P("raw_iron") + P("iron_ingot");
async function Wn(e, a, t = 2, n = !1, o = 0) {
  let s = new Set(),
    r = ne();
  for (
    let i = 0;
    i < 4 &&
    ne() < a - 3e4 &&
    !(nt() >= t || (nt() >= 2 && ne() - r > 95e3 + o));
    i++
  ) {
    let l = [];
    try {
      l = Be.bot.findBlocks({
        matching: Ft(st),
        maxDistance: n ? 56 : 40,
        count: 240,
        point: e,
      });
    } catch {}
    let u = l
      .filter((W) => !s.has(v.key(W)) && v.hdist(W, e) < (n ? 44 : 32))
      .map((W) => ({ ore: W, plan: Fn(W, e) }))
      .filter((W) => W.plan)
      .sort((W, ie) => W.plan.cost - ie.plan.cost);
    if (!u.length) return nt() >= 2;
    let { ore: d, plan: m } = u[0];
    if (
      nt() >= 2 &&
      (m.depth > 24 ||
        ne() - r > 8e4 + (nt() >= 6 && t <= 6 ? Math.min(o, 2e4) : o))
    )
      break;
    for (let W of l)
      Math.abs(W.x - d.x) <= 2 && Math.abs(W.z - d.z) <= 2 && s.add(v.key(W));
    let p = ne(),
      h = Math.abs(m.col.y + 1 - v.feet().y) > 2;
    h &&
      v.setMovements({ maxDropDown: 4, digCost: 1.5, towers: !0, hardDig: !0 });
    let b = await v.goto(new zt.GoalBlock(m.col.x, m.col.y + 1, m.col.z), {
      timeoutMs: Math.min(25e3, 9e3 + v.hdist(m.col, v.pos()) * 600),
      stuckMs: 6e3,
    });
    h && v.setMovements({});
    let _ = v.feet();
    if (_.x !== m.col.x || _.z !== m.col.z) {
      we("shaft: no access", { ore: d, col: m.col, st: b, at: _ });
      continue;
    }
    let k = await Ca(d.y, a - 25e3);
    if (!k) {
      let W = J(v.feet().offset(0, -1, 0));
      we("shaft: stopped", { at: v.feet(), below: W && W.name, target: d.y });
    }
    let y = v.feet(),
      N = (W) =>
        Math.abs(W.x - y.x) <= 1 &&
        Math.abs(W.z - y.z) <= 1 &&
        W.y - y.y >= 0 &&
        W.y - y.y <= 2,
      g = 0;
    for (let W of Oa().filter(N)) {
      let ie = J(W);
      ie &&
        st.includes(ie.name) &&
        !wo(W) &&
        (await v.dig(ie, { tool: "stone_pickaxe", maxMs: 6e3 })) &&
        g++;
    }
    (await He(300),
      await v.collectItems(
        v.pos(),
        3,
        new Set(["raw_iron", "cobblestone", "cobbled_deepslate"]),
        2500,
      ));
    let S =
      k && v.feet().x === y.x && v.feet().z === y.z
        ? await En(y, he.veinTarget || 6, Math.min(a - 3e4, ne() + 45e3))
        : 0;
    we("vein", { close: g, tunnelled: S, raw_iron: P("raw_iron") });
    let C = Math.max(0, m.col.y + 1 - v.feet().y),
      q = 8 + Math.max(0, C + 2 - P("dirt"));
    k && ye() < q && (await bo(q, ne() + 45e3));
    let L = await ta(m.col.y + 1, Math.max(a, ne() + 3e4));
    if (
      (we("shaft", {
        ore: d,
        depth: m.depth,
        down: k,
        up: L,
        raw_iron: P("raw_iron"),
        s: Math.round((ne() - p) / 1e3),
        at: v.feet(),
      }),
      !L)
    )
      return nt() >= 2;
  }
  return nt() >= 2;
}
async function En(e, a, t) {
  let n = P("raw_iron"),
    o = new Set(),
    s = (r, i) => {
      for (let l = Math.min(r.x, i.x) - 1; l <= Math.max(r.x, i.x) + 1; l++)
        for (let u = Math.min(r.y, i.y) - 1; u <= Math.max(r.y, i.y) + 2; u++)
          for (
            let d = Math.min(r.z, i.z) - 1;
            d <= Math.max(r.z, i.z) + 1;
            d++
          ) {
            let m = J(Qe(l, u, d));
            if (!m || rt.test(m.name)) return !1;
          }
      return !0;
    };
  v.setMovements({ maxDropDown: 2, digCost: 1, hardDig: !0 });
  try {
    for (; nt() < a && ne() < t && v.hasBot();) {
      await v.tick();
      let r = [];
      try {
        r = Be.bot.findBlocks({
          matching: Ft(st),
          maxDistance: 7,
          count: 32,
          point: e,
        });
      } catch {}
      let i = v.feet(),
        l = r
          .filter(
            (p) =>
              !o.has(v.key(p)) &&
              Math.abs(p.y - e.y) <= 2 &&
              Math.max(Math.abs(p.x - e.x), Math.abs(p.z - e.z)) <= 4 &&
              s(e, p),
          )
          .sort((p, h) => p.distanceTo(i) - h.distanceTo(i));
      if (!l.length) break;
      let u = l[0];
      if (
        (o.add(v.key(u)),
        v.reachOf(u) > 4.4 &&
          (await v.goto(new v.GoalReach(u, 3.5), {
            timeoutMs: 6e3,
            stuckMs: 3e3,
          }),
          v.reachOf(u) > 4.4))
      )
        continue;
      let d = J(u);
      if (
        !d ||
        !st.includes(d.name) ||
        !(await v.dig(d, { tool: "stone_pickaxe", maxMs: 6e3 }))
      )
        continue;
      await He(200);
      let m = P("raw_iron");
      await v.goto(new zt.GoalBlock(u.x, u.y, u.z), {
        timeoutMs: 7e3,
        stuckMs: 3e3,
        until: () => P("raw_iron") > m,
      });
      for (let p = 0; p < 6 && P("raw_iron") === m; p++) await He(100);
    }
    if (
      v.hasBot() &&
      !(v.feet().x === e.x && v.feet().z === e.z && v.feet().y === e.y)
    ) {
      let r = await v.goto(new zt.GoalBlock(e.x, e.y, e.z), {
        timeoutMs: 12e3,
        stuckMs: 4e3,
      });
      r !== "reached" &&
        we("vein: not back at the shaft", { st: r, at: v.feet(), base: e });
    }
  } finally {
    v.setMovements({});
  }
  return P("raw_iron") - n;
}
function Oa() {
  let e = [];
  try {
    e = Be.bot.findBlocks({ matching: Ft(st), maxDistance: 6, count: 12 });
  } catch {}
  return e.filter((a) => v.reachOf(a) <= 4.4);
}
async function Gn(e) {
  let a = new Set(),
    t = () => P("raw_iron") + P("iron_ingot") >= 2;
  for (; !t() && ne() < e;) {
    if ((await v.tick(), !Oa().length)) {
      let s = qn(a);
      if (!s.length) return !1;
      let r = s[0].p;
      (a.add(v.key(r)),
        v.setMovements({
          maxDropDown: 4,
          digCost: 1.5,
          towers: !0,
          hardDig: !0,
        }));
      let i = await v.goto(new v.GoalReach(r, 3.6), {
        timeoutMs: Math.min(5e4, e - ne()),
        stuckMs: 8e3,
      });
      if (
        (we("iron approach", {
          target: r,
          st: i,
          at: v.feet(),
          cost: Math.round(s[0].cost),
        }),
        v.reachOf(r) > 4.4)
      )
        continue;
    }
    let n = [];
    for (let s of Oa()) {
      if (t() || ne() > e) break;
      a.add(v.key(s));
      let r = J(s);
      if (!r || !st.includes(r.name)) continue;
      let i = ne(),
        l = await v.dig(r, { tool: "stone_pickaxe", maxMs: 6e3 });
      (!l &&
        J(s) &&
        st.includes(J(s).name) &&
        (l = await v.dig(J(s), { tool: "stone_pickaxe", maxMs: 9e3 })),
        n.push({
          q: s,
          ok: l,
          ms: ne() - i,
          held: Be.bot.heldItem && Be.bot.heldItem.name,
          left: J(s) && J(s).name,
          reach: +v.reachOf(s).toFixed(2),
        }));
    }
    await He(250);
    let o = await v.collectItems(v.pos(), 6, new Set(["raw_iron"]), 6e3);
    we("iron dig", { dug: n, got: o, raw_iron: P("raw_iron"), at: v.feet() });
  }
  return t();
}
var ye = () => Math.max(P("cobblestone"), P("cobbled_deepslate"));
async function go(e, a) {
  let t = Ft(["stone", "cobblestone", "deepslate", "cobbled_deepslate"]),
    n = new Set();
  for (; ye() < e && ne() < a;) {
    await v.tick();
    let o = [];
    try {
      o = Be.bot.findBlocks({ matching: t, maxDistance: 5, count: 40 });
    } catch {}
    let s = v.feet(),
      r =
        P("cobbled_deepslate") > P("cobblestone")
          ? /deepslate/
          : /^(stone|cobblestone)$/;
    if (
      ((o = o.filter(
        (i) =>
          !n.has(v.key(i)) &&
          !(i.x === s.x && i.z === s.z && i.y < s.y) &&
          v.reachOf(i) <= 4.4,
      )),
      o.sort(
        (i, l) => (r.test(J(l).name) ? 1 : 0) - (r.test(J(i).name) ? 1 : 0),
      ),
      !o.length)
    )
      return ye() >= e;
    for (let i of o) {
      if (ye() >= e || ne() > a) break;
      (n.add(v.key(i)), await v.dig(J(i), { tool: "stone_pickaxe" }));
    }
    await v.collectItems(
      v.pos(),
      5,
      new Set(["cobblestone", "cobbled_deepslate"]),
      4e3,
    );
  }
  return ye() >= e;
}
async function Hn(e, a) {
  return ye() >= e
    ? !0
    : (await go(e, Math.min(a, ne() + 15e3)),
      ye() < e && (await ko(e, a)),
      we("stone for the furnace", { cobble: ye(), ok: ye() >= e }),
      ye() >= e);
}
function ea() {
  let e = v.feet();
  return (
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].filter(([a, t]) => {
      let n = J(e.offset(a, 0, t)),
        o = J(e.offset(a, 1, t));
      return n && n.boundingBox === "block" && o && o.boundingBox === "block";
    }).length >= 3
  );
}
async function Ln(e, a, t = 4, n = !1, o = 0) {
  let s = ne() + a,
    r = ne(),
    i = !1;
  try {
    ((i = await Wn(e, s - 2e4, t, n, o)),
      i || (i = await Gn(s - 2e4)),
      i &&
        ye() < 8 &&
        v.feet().y >= e.y - 2 &&
        (await ko(8, Math.max(s - 1e4, ne() + 45e3))),
      i &&
        ye() < 8 &&
        (await go(8, Math.max(ne() + 15e3, Math.min(s - 15e3, ne() + 25e3)))));
  } catch (l) {
    we("shears material error", { err: String(l).slice(0, 200) });
  }
  if (
    v.hasBot() &&
    v.feet().y < e.y - 2 &&
    ea() &&
    (await ta(e.y + 1, ne() + 4e4, () => !ea()), v.feet().y < e.y - 2 && ea())
  ) {
    let l = Be.bot.pathfinder,
      u = l.thinkTimeout;
    ((l.thinkTimeout = 1e4),
      v.setMovements({
        maxDropDown: 4,
        digCost: 1.5,
        towers: !0,
        hardDig: !0,
      }));
    let d = await v.goto(new zt.GoalY(e.y + 1), {
      timeoutMs: 6e4,
      stuckMs: 12e3,
    });
    (v.setMovements({}),
      (l.thinkTimeout = u),
      we("shears: climb out", { st: d, at: v.feet() }));
  }
  for (let l = 0; l < 3; l++) {
    v.setMovements({ maxDropDown: 4, digCost: 1.5, towers: !0, hardDig: !0 });
    let u = await v.goto(new zt.GoalNear(e.x, e.y + 1, e.z, 3), {
      timeoutMs: Math.max(3e4, s - ne() + 2e4),
      stuckMs: 1e4,
    });
    if ((v.setMovements({}), u === "reached" || v.hdist(v.pos(), e) < 5)) break;
    we("shears: way home", { st: u, at: v.feet() });
  }
  return (
    we("shears materials", {
      ok: i,
      raw_iron: P("raw_iron"),
      cobble: ye(),
      s: Math.round((ne() - r) / 1e3),
      at: v.feet(),
    }),
    i
  );
}
async function Rn(e) {
  if (P("raw_iron") < 1) return !1;
  let a =
    he.furnace && J(he.furnace) && /furnace/.test(J(he.furnace).name)
      ? he.furnace
      : null;
  if (a) v.reachOf(a) > 4.2 && (await v.approach(a, { range: 2 }));
  else {
    let o = await xo(e);
    if (!o)
      return (
        we("smelt: no crafting table", {
          planks: P("birch_planks"),
          logs: P("birch_log"),
          tables: P("crafting_table"),
          at: v.feet(),
        }),
        !1
      );
    if (!P("furnace") && !(await lt.craftOne("furnace", 1, J(o))))
      return (
        we("smelt: furnace craft failed", {
          cobble: P("cobblestone"),
          deep: P("cobbled_deepslate"),
        }),
        !1
      );
    if (((a = await lt.placeNear(e, "furnace")), !a))
      return (we("smelt: nowhere to place the furnace", { at: v.feet() }), !1);
  }
  ((he.furnace = a), v.protectColumn(a.x, a.z));
  let t = Math.min(8, P("raw_iron")),
    n = Math.ceil(t / 1.5);
  for (let o = 0; o < 3 && P("birch_planks") < n && P("birch_log"); o++)
    await lt.craftOne("birch_planks", 1);

  if (P("birch_planks") < n && !P("birch_log")) {
    const maxOf = (re) =>
      v
        .allItems()
        .filter((l) => re.test(l.name) && l.name !== "jungle_log")
        .map((l) => l.name)
        .reduce((a, nm) => (P(nm) > (a ? P(a) : 0) ? nm : a), null);
    for (let o = 0; o < 2; o++) {
      const pl = maxOf(/_planks$/);
      if (pl && P(pl) >= n) break;
      const lg = maxOf(/_log$/);
      if (!lg) break;
      try {
        await lt.craftOne(lg.replace(/_log$/, "_planks"), 1);
      } catch {}
    }
    const pl = maxOf(/_planks$/);
    if (pl && P(pl) < n && P(pl) >= 2)
      ((t = Math.min(t, Math.floor(P(pl) * 1.5))), (n = P(pl)));
    we("smelt fuel", { fuel: pl, have: pl ? P(pl) : 0, n, t });
  }
  try {
    let o = await v.withTimeout(Be.bot.openFurnace(J(a)), 6e3, "open furnace"),
      s = Be.bot.registry,
      r =
        P("birch_planks") >= n
          ? "birch_planks"
          : P("birch_log")
            ? "birch_log"
            : null;
    if (!r) {
      let i = v
        .allItems()
        .filter(
          (l) =>
            /_(planks|log)$/.test(l.name) &&
            l.name !== "jungle_log" &&
            P(l.name) >= n,
        );
      i.length && (r = i[0].name);
    }
    return r
      ? (await v.withTimeout(
          o.putFuel(s.itemsByName[r].id, null, Math.min(n, P(r))),
          4e3,
          "fuel",
        ),
        await v.withTimeout(
          o.putInput(s.itemsByName.raw_iron.id, null, t),
          4e3,
          "input",
        ),
        (he.smeltN = t),
        o.close(),
        (he.smeltStarted = ne()),
        we("smelting", { at: a }),
        !0)
      : (o.close(),
        we("smelt: no fuel", { planks: n, inv: v.inventorySummary() }),
        !1);
  } catch (o) {
    return (we("smelt start failed", { err: String(o).slice(0, 200) }), !1);
  }
}
async function xo(e) {
  let a = Be.bot.registry,
    t = Be.bot.findBlock({
      matching: a.blocksByName.crafting_table.id,
      maxDistance: 24,
    });
  if (t)
    return (
      v.reachOf(t.position) > 4.2 &&
        (await v.approach(t.position, { range: 2 })),
      t.position
    );
  P("crafting_table") ||
    (P("birch_planks") < 4 &&
      P("birch_log") &&
      (await lt.craftOne("birch_planks", 1)),
    await lt.craftOne("crafting_table", 1));
  let n = await lt.placeNear(e, "crafting_table");
  return (n && v.protectColumn(n.x, n.z), n);
}
async function Un() {
  if (P("shears")) return !0;
  for (let e = 0; e < 4 && P("iron_ingot") < 2 && he.furnace; e++) {
    (e && (await He(6e3)),
      v.reachOf(he.furnace) > 4.2 &&
        (await v.approach(he.furnace, { range: 2 })));
    try {
      let a = await v.withTimeout(
        Be.bot.openFurnace(J(he.furnace)),
        6e3,
        "open furnace",
      );
      (a.outputItem() &&
        (await v.withTimeout(a.takeOutput(), 4e3, "take output")),
        a.close());
    } catch (a) {
      we("furnace take failed", { err: String(a).slice(0, 160) });
    }
  }
  return (
    P("iron_ingot") >= 2 &&
      (await lt.craftOne("shears", Math.floor(P("iron_ingot") / 2), null),
      (he.taken = (he.taken || 0) + 2 * P("shears")),
      we("shears", {
        ok: P("shears") > 0,
        pairs: P("shears"),
        smelting: he.smeltN || 0,
      })),
    P("shears") > 0
  );
}
function Pn() {
  return (
    !!he.furnace &&
    (he.smeltN || 0) - (he.taken || 0) >= 2 &&
    !!J(he.furnace) &&
    /furnace/.test(J(he.furnace).name)
  );
}
module.exports = {
  walled: ea,
  gatherMaterials: Ln,
  startSmelt: Rn,
  finishShears: Un,
  ingotsPending: Pn,
  ensureTable: xo,
  pillarUp: ta,
  ensureStone: Hn,
  cobble: ye,
  H: he,
};
