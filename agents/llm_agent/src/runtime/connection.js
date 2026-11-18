"use strict";
var dn = require("mineflayer"),
  {
    pathfinder: pn,
    Movements: hn,
    goals: Ke,
  } = require("mineflayer-pathfinder"),
  { Vec3: Ut } = require("vec3"),
  kt = {
    HOST: process.env.NPABENCH_HOST || "127.0.0.1",
    PORT: parseInt(process.env.NPABENCH_PORT || "25565", 10),
    USERNAME: process.env.NPABENCH_AGENT_USERNAME || "npabench_agent",
    PROMPT: process.env.NPABENCH_AGENT_PROMPT || "",
    TIMEOUT_SEC: Math.min(
      20 * 60,
      parseInt(process.env.NPABENCH_TIMEOUT_SECONDS || "1200", 10) || 20 * 60,
    ),
  },
  ga = Date.now(),
  Pa = Date.now();
setInterval(() => {
  let e = Date.now(),
    a = e - Pa - 1e3;
  ((Pa = e), a > 1500 && Yt("info", { msg: "event loop lag", lag_ms: a }));
}, 1e3).unref();
var z = {
    bot: null,
    readyEmitted: !1,
    readyAt: 0,
    finished: !1,
    reconnects: 0,
    deadline: ga + kt.TIMEOUT_SEC * 1e3 - 6e3,
    onSpawn: [],
  },
  ee = () => Date.now(),
  Va = () => +((ee() - ga) / 1e3).toFixed(1),
  wn = () => z.deadline - ee(),
  ze = (e) => new Promise((a) => setTimeout(a, e)),
  xa = () => new Promise((e) => setImmediate(e));
function noteError(msg, extra) {
  try {
    if (!noteError.log) noteError.log = require("../../error_log").createErrorLog();
    noteError.log.write(String(msg), extra || {});
  } catch {}
}
function Yt(e, a = {}) {
  try {
    process.stdout.write(
      JSON.stringify({ kind: e, data: a }) +
        `
`,
    );
  } catch {}
  if (e === "error") noteError((a && a.msg) || "error", a);
}
var be = (e, a = {}) => {
  Yt("info", { msg: e, t: Va(), ...a });
  if (/fail|error|crash|unreachable|rejected|incomplete/i.test(String(e))) noteError(e, a);
};
function Ge(e, a, t = "op") {
  let n,
    o = new Promise((s, r) => {
      n = setTimeout(() => r(new Error(`${t} timed out`)), a);
    });
  return (
    e.catch(() => {}),
    Promise.race([e, o]).finally(() => clearTimeout(n))
  );
}
var X = () => !!(z.bot && z.bot.entity && z.bot.entity.position),
  yn = () => z.bot.entity.position,
  pe = () => z.bot.entity.position.floored(),
  gt = (e, a, t) => new Ut(e, a, t),
  bn = (e) => `${e.x},${e.y},${e.z}`,
  xt = (e, a) => Math.hypot(e.x - a.x, e.z - a.z);
function Vt() {
  if (!z.bot || !z.bot.inventory) return [];
  let e = z.bot.inventory.items().slice(),
    a = z.bot.inventory.slots[45];
  a && e.push(a);
  let t = z.bot.inventory.selectedItem;
  return (t && e.push(t), e);
}
var ba = !1;
async function Ja() {
  let e = z.bot;
  if (ba || !e || !e.inventory || !e.inventory.selectedItem || e.currentWindow)
    return !1;
  ba = !0;
  try {
    let a = e.inventory.selectedItem.name,
      t = e.inventory.firstEmptyInventorySlot();
    return t == null
      ? !1
      : (await Ge(e.clickWindow(t, 0, 0), 2500, "cursor"),
        be("cursor item put back", {
          name: a,
          slot: t,
          ok: !e.inventory.selectedItem,
        }),
        !e.inventory.selectedItem);
  } catch {
    return !1;
  } finally {
    ba = !1;
  }
}
function kn(e) {
  let a = 0;
  for (let t of Vt()) t.name === e && (a += t.count);
  return a;
}
function gn(e) {
  return Vt().find((a) => a.name === e) || null;
}
function xn() {
  let e = {};
  for (let a of Vt()) e[a.name] = (e[a.name] || 0) + a.count;
  return e;
}
var bt = null;
async function Jt(e) {
  let a = z.bot;
  if (
    (bt && (await Promise.race([bt, ze(5e3)]), (bt = null)),
    a.inventory.selectedItem && !a.currentWindow && (await Ja()),
    a.heldItem && a.heldItem.name === e)
  )
    return !0;
  let t = a.inventory.items().find((o) => o.name === e);
  if (!t) return !1;
  let n = a.equip(t, "hand").then(
    () => !0,
    () => !1,
  );
  bt = n;
  try {
    let o = await Ge(n, 3e3, "equip");
    return (bt === n && (bt = null), o);
  } catch {
    return !1;
  }
}
async function Xa() {
  let e = z.bot;
  if (!e.heldItem) return;
  let a = [36, 37, 38, 39, 40, 41, 42, 43, 44].find(
    (t) => !e.inventory.slots[t],
  );
  try {
    if (a !== void 0) {
      e.setQuickBarSlot(a - 36);
      return;
    }
    if (Pt() > 0) {
      await Ge(e.unequip("hand"), 2e3, "unequip");
      return;
    }
  } catch {
    return;
  }
  for (let t of ["stone_axe", "stone_pickaxe", "stone_hoe", "shears"])
    if (await Jt(t)) return;
}
function Pt() {
  if (!z.bot || !z.bot.inventory) return 36;
  let e = 0;
  for (let a = 9; a <= 44; a++) z.bot.inventory.slots[a] || e++;
  return e;
}
async function _n(e) {
  for (let a of z.bot.inventory.items())
    if (!e.has(a.name))
      try {
        await Ge(z.bot.tossStack(a), 2e3, "toss");
      } catch {}
}

var xx4W = [];
function xx4Settle(v) {
  let w = xx4W;
  xx4W = [];
  for (let f of w)
    try {
      f(v);
    } catch {}
}
function Za() {
  return new Promise((e) => {
    xx4W.push(e);

    let a = !1,
      sid = (z.xx4Sid = (z.xx4Sid || 0) + 1),
      t = null,
      lt = null,
      cur = () => z.xx4Sid === sid && !!t && z.bot === t;
    try {
      let p = z.bot;
      if (p && !p.xx4Ended) {
        be("xx4 quit previous session", {
          sid,
          spawned: !!p.entity,
          reconnects: z.reconnects,
        });
        try {
          typeof p.quit == "function" ? p.quit() : p.end("xx4 replaced");
        } catch {}
      }
    } catch {}
    try {
      t = dn.createBot({
        host: kt.HOST,
        port: kt.PORT,
        username: kt.USERNAME,
        auth: "offline",
        checkTimeoutInterval: 6e4,
      });
      (t.loadPlugin(pn),
        (() => {
          try {
            require("./crafting-sync")(t, be);
          } catch (e) {
            be("ah clickfix failed", { err: String(e).slice(0, 120) });
          }
        })(),
        (z.bot = t),
        t.once("spawn", () => {
          if (!cur()) {
            be("xx4 spawn of replaced session ignored", {
              sid,
              live: z.xx4Sid,
            });
            return;
          }
          z.spawnedAt = ee();
          try {
            t.physics && (t.physics.playerHalfWidth = 0.3125);
          } catch {}

          let o = [],
            xi1 = null,
            xi2 = null;
          (t.on("forcedMove", () => {
            if (!cur()) return;

            let i = ee();
            if (
              (o.push(i),
              (o = o.filter((l) => l > i - 1500)),
              o.length >= 8 && i - (z.lastUnstick || 0) > 3e3)
            ) {
              ((z.lastUnstick = i), (z.corrections = (z.corrections || 0) + 1));
              let l = null;
              try {
                let u = pe(),
                  d = (m, p, h) => {
                    let b = ae(u.offset(m, p, h));
                    return b ? b.name : "?";
                  };
                l = {
                  in: d(0, 0, 0),
                  under: d(0, -1, 0),
                  head: d(0, 1, 0),
                  sides: [
                    d(1, 0, 0),
                    d(-1, 0, 0),
                    d(0, 0, 1),
                    d(0, 0, -1),
                  ].join(","),
                  y: +t.entity.position.y.toFixed(2),
                  step: z.step || null,
                };
              } catch {}
              be("server corrections", {
                n: z.corrections,
                pos: X() ? pe() : null,
                around: l,
              });
              try {
                t.pathfinder.stop();
              } catch {}
              try {
                t.clearControlStates();
              } catch {}

              z.xeBusy || _a().catch(() => {});
            }
          }),
            Ye(it),
            (xi1 = setInterval(() => {
              if (!cur()) return void clearInterval(xi1);
              if (!X() || z.finished) return;
              let i = ae(t.entity.position.floored()),
                iw = !!i && i.name === "water",
                xo = !0;

              try {
                iw = iw || xeWet(i);
              } catch {
                xo = !1;
              }
              if (iw) {
                if (z.swimOk && z.wetSince) {
                  let wp = t.entity.position;
                  if (!z.wetP) z.wetP = wp.clone();
                  else if (Math.hypot(wp.x - z.wetP.x, wp.z - z.wetP.z) >= 2.5)
                    ((z.wetSince = ee()), (z.wetP = wp.clone()));
                }
                if (
                  (z.wetSince ||
                    ((z.wetSince = ee()), (z.wetP = t.entity.position.clone())),
                  ee() - z.wetSince > 5e3 && !z.waterBusy && !z.xeBusy)
                ) {
                  let xs = !1;
                  if (xo)
                    try {
                      (xeStart("wet"), (xs = !0));
                    } catch {
                      xs = !1;
                    }
                  xs ||
                    ((z.waterBusy = !0),
                    (z.escapingWater = !0),
                    Qa().finally(() => {
                      ((z.escapingWater = !1),
                        (z.waterBusy = !1),
                        (z.wetSince = 0));
                    }));
                }
              } else ((z.wetSince = 0), (z.wetP = null));
              let l = ae(t.entity.position.offset(0, 1.62, 0).floored());
              if (!(
                !!l &&
                (l.name === "water" ||
                  l.name === "bubble_column" ||
                  /kelp|seagrass/.test(l.name))
              )) {
                z.xeAirT = 0;
                if (z.drowning) {
                  z.drowning = !1;
                  try {
                    z.xeBusy || t.setControlState("jump", !1);
                  } catch {}
                  be("drowning: surfaced", { pos: pe() });
                }
                return;
              }

              try {
                if (z.drowning && (t.oxygenLevel ?? 0) >= 20) {
                  if ((z.xeAirT || (z.xeAirT = ee()), ee() - z.xeAirT > 3e3)) {
                    ((z.drowning = !1), (z.xeAirT = 0));
                    try {
                      z.xeBusy || t.setControlState("jump", !1);
                    } catch {}
                    be("drowning: cleared (breathing)", {
                      pos: pe(),
                      head: l.name,
                    });
                    return;
                  }
                } else z.xeAirT = 0;
              } catch {}
              if (!z.drowning && (t.oxygenLevel ?? 20) > 12) return;
              z.drowning ||
                ((z.drowning = !0),
                (z.xeDrownAt = ee()),
                be("drowning: swimming up", {
                  pos: pe(),
                  oxygen: t.oxygenLevel,
                }));

              try {
                if (z.xeBusy) return;
                if (
                  ee() - (z.xeDrownAt || ee()) > 3e3 &&
                  !z.waterBusy &&
                  xeStart("drowning")
                )
                  return;
              } catch {}
              try {
                t.pathfinder.setGoal(null);
              } catch {}
              t.setControlState("jump", !0);
              let d = ae(t.entity.position.offset(0, 2.3, 0).floored()),
                m =
                  d &&
                  [
                    [1, 0, 0],
                    [-1, 0, 0],
                    [0, 0, 1],
                    [0, 0, -1],
                    [0, 1, 0],
                  ].some(([p, h, b]) => {
                    let _ = ae(d.position.offset(p, h, b));
                    return _ && (_.name === "water" || _.name === "lava");
                  });
              d &&
                d.boundingBox === "block" &&
                !m &&
                !jt.has(d.name) &&
                !_t.has(`${d.position.x},${d.position.z}`) &&
                !t.targetDigBlock &&
                t.dig(d, !0).catch(() => {});
            }, 400)));
          let s = ee(),
            r = null;
          ((xi2 = setInterval(() => {
            if (!cur()) return void clearInterval(xi2);
            if (!X() || z.finished) return;
            let i = t.entity.position;
            if (!r || i.distanceTo(r) > 1) {
              ((r = i.clone()), (s = ee()), (z.frozenLevel = 0));
              return;
            }
            (t.pathfinder.isMoving() || z.wantMove) &&
              !/^compost:feed/.test(z.step || "") &&
              ee() - s > 25e3 &&
              ((s = ee()),
              (z.frozenLevel = (z.frozenLevel || 0) + 1),
              be("frozen", {
                level: z.frozenLevel,
                pos: pe(),
                at: ae(i.floored()) && ae(i.floored()).name,
              }),
              Xt(z.frozenLevel).catch(() => {}));
          }, 2e3)),
            z.readyEmitted
              ? be("reconnected", { reconnects: z.reconnects, sid })
              : ((z.readyEmitted = !0),
                (z.readyAt = ee()),
                Yt("ready", { prompt: kt.PROMPT })));
          for (let i of z.onSpawn)
            try {
              i(t);
            } catch {}

          ((a = !0), clearTimeout(lt), xx4Settle(t));
        }));
      let n = 20;
      (t.on("health", () => {
        if (!cur()) return;
        (t.health < n - 1.5 &&
          be("hurt", {
            from: +n.toFixed(1),
            to: +t.health.toFixed(1),
            pos: X() ? pe() : null,
            oxygen: t.oxygenLevel,
          }),
          (n = t.health));
      }),
        t.on("death", () => {
          if (!cur()) return;

          ((z.xeDeaths = (z.xeDeaths || 0) + 1),
            (z.w4DeathAt = ee()),
            be("died", { pos: X() ? pe() : null }),
            setTimeout(() => {
              try {
                cur() && t.respawn();
              } catch {}
            }, 500));
        }),
        t.on("kicked", (o) =>
          cur()
            ? be("kicked", { reason: String(JSON.stringify(o)).slice(0, 300) })
            : be("xx4 replaced session kicked", {
                sid,
                reason: String(JSON.stringify(o)).slice(0, 300),
              }),
        ),
        t.on("error", (o) =>
          cur()
            ? be("bot error", { err: String(o).slice(0, 300) })
            : be("xx4 replaced session error", {
                sid,
                err: String(o).slice(0, 300),
              }),
        ),
        t.on("end", (o) => {
          be("disconnected", { reason: String(o) });
          let live = !1;
          try {
            ((t.xx4Ended = !0), (live = cur()));
          } catch {
            live = z.bot === t;
          }

          if (!live) {
            be("xx4 no reconnect: replaced session ended", {
              sid,
              live: z.xx4Sid,
            });
            return;
          }
          clearTimeout(lt);
          if (z.finished || z.reconnects >= 30) {
            be("xx4 no reconnect", {
              sid,
              finished: !!z.finished,
              reconnects: z.reconnects,
              spawned: a,
            });

            a || ((a = !0), xx4Settle(null));
            return;
          }
          z.reconnects++;
          be("xx4 reconnect scheduled", {
            sid,
            reconnects: z.reconnects,
            before_spawn: !a,
            waiters: xx4W.length,
          });
          setTimeout(() => {
            if (z.xx4Sid !== sid) {
              be("xx4 reconnect dropped: newer session", {
                sid,
                live: z.xx4Sid,
              });
              return;
            }
            Za().catch(() => {});
          }, 2e3);
        }),
        (lt = setTimeout(() => {
          if (a) return;
          if (!cur()) {
            be("xx4 login timeout of replaced session ignored", {
              sid,
              live: z.xx4Sid,
            });
            return;
          }
          ((a = !0),
            be("xx4 login timeout", {
              sid,
              after_s: 240,
              waiters: xx4W.length,
            }),
            xx4Settle(null));
        }, 24e4)));
    } catch (o) {
      be("xx4 connect error", {
        sid,
        err: String((o && o.stack) || o).slice(0, 300),
      });
      a || ((a = !0), clearTimeout(lt), z.xx4Sid === sid && xx4Settle(null));
    }
  });
}

var W4S = { n: 0, busy: !1, at: 0 };
async function Qa() {
  let e = z.bot,
    a = pe(),
    t = a.y;
  for (; t < a.y + 12;) {
    let p = ae(gt(a.x, t + 1, a.z));
    if (!p || !/water|kelp|seagrass|bubble_column/.test(p.name)) break;
    t++;
  }
  let n = Math.min(a.y, t) - 1,
    o = t + 2,
    s = null;
  try {
    s = typeof z.homeHint == "function" ? z.homeHint() : z.homeHint || null;
  } catch {}
  let r = (p) => {
      let h = ae(p.offset(0, -1, 0));
      return (
        h &&
        h.boundingBox === "block" &&
        !/water|lava/.test(h.name) &&
        ka.has((ae(p) || {}).name) &&
        ka.has((ae(p.offset(0, 1, 0)) || {}).name)
      );
    },
    i = null;
  for (let p = 1; p <= 16 && !(i && i.d <= p); p++)
    for (let h = -p; h <= p; h++)
      for (let b = -p; b <= p; b++)
        if (Math.max(Math.abs(h), Math.abs(b)) === p)
          for (let _ = n; _ <= o; _++) {
            let k = gt(a.x + h, _, a.z + b);
            if (!r(k)) continue;
            let y =
              Math.hypot(h, b) +
              (_ > t + 1 ? 3 : 0) +
              (s ? 0.05 * xt(k, s) : 0);
            (!i || y < i.d) && (i = { p: k, d: y });
          }
  if (
    ((z.waterEscapes = (z.waterEscapes || 0) + 1),
    be("in water: climbing out", {
      at: a,
      to: i && i.p,
      top: t,
      n: z.waterEscapes,
    }),
    z.waterEscapes % 3 === 0 && (i || s))
  ) {
    let p = it;
    (Ye({ ...p, water: !0, towers: !0, hardDig: !0, digCost: 1.5 }),
      (z.escapingWater = !1));
    let h = i
      ? new Ke.GoalNear(i.p.x, i.p.y, i.p.z, 1)
      : new Ke.GoalNear(s.x, s.y + 1, s.z, 3);

    z.xeQaGoto = !0;
    try {
      await Ae(h, { timeoutMs: 2e4, stuckMs: 6e3 });
    } finally {
      z.xeQaGoto = !1;
    }
    return ((z.escapingWater = !0), Ye(p), !0);
  }
  try {
    e.pathfinder.setGoal(null);
  } catch {}
  let l = i
    ? i.p.offset(0.5, 1.2, 0.5)
    : s
      ? gt(s.x + 0.5, t + 1.5, s.z + 0.5)
      : null;
  if (!l)
    return (
      e.setControlState("jump", !0),
      await ze(1500),
      e.clearControlStates(),
      !1
    );
  let u = ee() + (i ? Math.min(2e4, 3e3 + i.d * 900) : 8e3),
    d = 1 / 0,
    m = ee(),
    dd = z.xeDeaths || 0;
  try {
    for (; ee() < u && X();) {
      if ((z.xeDeaths || 0) !== dd) break;
      let p = ae(e.entity.position.floored()),
        h = xt(e.entity.position, l);
      if (
        (i && h < 0.6 && !(p && p.name === "water")) ||
        (!i && !(p && p.name === "water"))
      )
        break;
      if (h < d - 0.3) ((d = h), (m = ee()));
      else if (ee() - m > 3e3) break;
      (await e.lookAt(l, !0),
        e.setControlState("forward", !0),
        e.setControlState("sprint", !0),
        e.setControlState("jump", !0),
        await ze(100));
    }
  } catch {
  } finally {
    try {
      e.clearControlStates();
    } catch {}
  }
  return !0;
}

var xeWetRe = /^(water|kelp|kelp_plant|seagrass|tall_seagrass|bubble_column)$/,
  xeNoDig =
    /^(bedrock|obsidian|crying_obsidian|barrier|reinforced_deepslate|spawner|composter|barrel|chest|furnace|crafting_table|farmland|melon|pumpkin|carved_pumpkin|cactus|jungle_log|soul_sand|podzol|moss_block|cauldron|[a-z_]+_stem|[a-z_]+_bed)$/,
  xeBadFloor =
    /^(composter|cauldron|campfire|soul_campfire|magma_block|cactus|powder_snow|[a-z_]+_leaves)$/,
  xeD4 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
function xeWet(b) {
  return !!b && xeWetRe.test(b.name);
}
function xeOpen(b) {
  return (
    !!b &&
    b.boundingBox === "empty" &&
    !xeWetRe.test(b.name) &&
    !/lava|fire|cobweb|sweet_berry_bush|powder_snow/.test(b.name)
  );
}
function xeSolid(b) {
  return !!b && b.boundingBox === "block" && !xeWetRe.test(b.name);
}
function xeWetHere() {
  if (!X()) return !1;
  let p = z.bot.entity.position;
  return xeWet(ae(p.floored())) || xeWet(ae(p.offset(0, 1.62, 0).floored()));
}
function xeHome() {
  try {
    return typeof z.homeHint == "function" ? z.homeHint() : z.homeHint || null;
  } catch {
    return null;
  }
}

function xePlan(bad) {
  let st = pe(),
    home = xeHome(),
    pass = (p) => {
      let b = ae(p);
      return xeWet(b) || xeOpen(b);
    },
    stand = (p) => {
      let f = ae(p.offset(0, -1, 0));
      if (!xeSolid(f) || xeBadFloor.test(f.name)) return -1;
      if (!xeOpen(ae(p)) || !xeOpen(ae(p.offset(0, 1, 0)))) return -1;
      if ((z.noStep && z.noStep.has(`${p.x},${p.z}`)) || bad.has(bn(p)))
        return -1;
      return f.name === "farmland" ? 3 : 0;
    },
    prev = new Map([[bn(st), null]]),
    dep = new Map([[bn(st), 0]]),
    q = [st],
    best = null;
  const box = z.homeW ? 18 : 10;
  for (let qi = 0; qi < q.length && qi < (z.homeW ? 8e3 : 3e3); qi++) {
    let c = q[qi],
      d = dep.get(bn(c));
    if (best && d + 1 >= best.cost) break;
    let cw = qi === 0 || xeWet(ae(c));
    for (let [dx, dz] of xeD4)
      for (let dy of [0, 1]) {
        let s = c.offset(dx, dy, dz),
          pen = stand(s);
        if (pen < 0 || (dy === 1 && !(cw && pass(c.offset(0, 2, 0))))) continue;
        let cost =
          d + 1 + dy * 0.5 + pen + (home ? (z.homeW || 0.02) * xt(s, home) : 0);
        (!best || cost < best.cost) && (best = { cost, exit: s, at: c });
      }
    if (!cw) continue;
    for (let n of [
      c.offset(1, 0, 0),
      c.offset(-1, 0, 0),
      c.offset(0, 0, 1),
      c.offset(0, 0, -1),
      c.offset(0, 1, 0),
      c.offset(0, -1, 0),
    ]) {
      let k = bn(n);
      if (
        prev.has(k) ||
        Math.abs(n.x - st.x) > box ||
        Math.abs(n.z - st.z) > box ||
        n.y < st.y - 6 ||
        n.y > st.y + 12
      )
        continue;
      if (!xeWet(ae(n)) || (n.y >= c.y && !pass(n.offset(0, 1, 0)))) continue;
      (prev.set(k, c), dep.set(k, d + 1), q.push(n));
    }
  }
  if (!best) return null;
  let path = [];
  for (let c = best.at; c; c = prev.get(bn(c))) path.unshift(c);
  return { path, exit: best.exit, cost: +best.cost.toFixed(2) };
}

async function xeGo(pl, until) {
  let b = z.bot,
    pts = pl.path.slice(1).concat([pl.exit]);
  try {
    for (let k = 0; k < pts.length; k++) {
      let g = pts[k],
        fr = k ? pts[k - 1] : pl.path[0],
        last = k === pts.length - 1,
        bm = 1 / 0,
        bt = ee();
      for (;;) {
        if (!X() || ee() > until || (z.xeAbort && z.xeAbort())) return !1;
        let p = b.entity.position,
          dxz = Math.hypot(g.x + 0.5 - p.x, g.z + 0.5 - p.z);
        if (last) {
          if (b.entity.onGround && p.y > g.y - 0.45 && !xeWetHere()) return !0;
        } else if (
          g.y > fr.y
            ? p.y >= g.y - 0.15
            : g.y < fr.y
              ? p.y < g.y + 0.5
              : dxz < 0.35
        )
          break;
        let mm = dxz + Math.abs(g.y - p.y);
        if (mm < bm - 0.08) ((bm = mm), (bt = ee()));
        else if (ee() - bt > 3e3) return !1;
        (await b.lookAt(new Ut(g.x + 0.5, p.y + 1.6, g.z + 0.5), !0),
          b.setControlState("sprint", !1),
          b.setControlState("forward", dxz > 0.2),
          b.setControlState("jump", !(g.y < fr.y)),
          await ze(50));
      }
    }
  } finally {
    try {
      b.clearControlStates();
    } catch {}
  }
  return X() && !xeWetHere();
}

async function xeDigOut(until, tried) {
  let b = z.bot,
    p = pe(),
    y = p.y,
    home = xeHome();
  for (; y < p.y + 12 && xeWet(ae(gt(p.x, y + 1, p.z)));) y++;
  let cap = ae(gt(p.x, y + 1, p.z)),
    can = (k) =>
      !!k && k.diggable !== !1 && !xeNoDig.test(k.name) && !jt.has(k.name),
    dig = (k) =>
      oo(
        k,
        /stone|ore$|deepslate|andesite|diorite|granite|tuff|calcite|basalt|terracotta|cobble|brick/.test(
          k.name,
        )
          ? { tool: "stone_pickaxe", maxMs: 9e3 }
          : { hand: !0, maxMs: 9e3 },
      ),
    floor = xeSolid(ae(p.offset(0, -1, 0))),
    rise = async (ty, ms) => {
      b.setControlState("jump", !0);
      for (
        let e = ee() + ms;
        ee() < e &&
        ee() < until &&
        X() &&
        !(z.xeAbort && z.xeAbort()) &&
        b.entity.position.y < ty;
      )
        await ze(50);
    };
  if (xeSolid(cap)) {
    if (!can(cap) || tried.has(bn(cap.position))) return !1;
    tried.add(bn(cap.position));
    floor && cap.position.y - p.y <= 2
      ? b.setControlState("jump", !1)
      : await rise(cap.position.y - 2.1, 5e3);
    return je(cap.position) <= 4.5 && (await dig(cap)) ? "ceiling" : !1;
  }
  let wetNb = (q) =>
      [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 0, 1],
        [0, 0, -1],
        [0, 1, 0],
      ].some(([a, h, c]) => {
        let r = q.offset(a, h, c);
        return !(r.x === p.x && r.z === p.z) && xeWet(ae(r));
      }),
    best = null;
  for (let [dx, dz] of xeD4) {
    let fl = ae(gt(p.x + dx, y, p.z + dz)),
      s1 = ae(gt(p.x + dx, y + 1, p.z + dz)),
      s2 = ae(gt(p.x + dx, y + 2, p.z + dz));
    if (
      !xeSolid(fl) ||
      xeBadFloor.test(fl.name) ||
      fl.name === "farmland" ||
      !s1 ||
      !s2
    )
      continue;
    if (
      xeWet(s1) ||
      xeWet(s2) ||
      (xeOpen(s1) && xeOpen(s2)) ||
      tried.has(bn(s1.position))
    )
      continue;
    if (
      !(xeOpen(s1) || can(s1)) ||
      !(xeOpen(s2) || can(s2)) ||
      wetNb(s1.position) ||
      wetNb(s2.position)
    )
      continue;
    let sc =
      (_t.has(`${p.x + dx},${p.z + dz}`) ? 4 : 0) +
      (xeOpen(s1) ? 0 : 1) +
      (xeOpen(s2) ? 0 : 1) +
      (home
        ? (z.homeW ? 2.5 * z.homeW : 0.05) *
          Math.hypot(p.x + dx - home.x, p.z + dz - home.z)
        : 0);
    (!best || sc < best.sc) && (best = { s1, s2, sc });
  }
  if (!best) return !1;
  tried.add(bn(best.s1.position));
  y === p.y && floor ? b.setControlState("jump", !1) : await rise(y - 0.3, 4e3);
  for (let k of [best.s2, best.s1]) {
    let kb = ae(k.position);
    if (xeSolid(kb) && !(je(kb.position) <= 4.8 && (await dig(kb)))) return !1;
  }
  return "step";
}
async function xeEscape(why = "wet", o = {}) {
  if (!X() || z.xeBusy || z.finished) return !1;
  let b = z.bot,
    t0 = ee(),
    until = t0 + (o.maxMs || 25e3),
    dd = z.xeDeaths || 0,
    from = pe(),
    esc = !!z.escapingWater,
    how = [],
    bad = new Set(o.bad || []),
    tried = new Set(),
    fails = new Map(),
    ok = !1;
  ((z.xeBusy = !0), (z.escapingWater = !0), (z.xeTrapAt = t0));
  z.xeAbort = () =>
    (z.xeDeaths || 0) !== dd || !!z.finished || !!(z.bot && z.bot.health <= 0);
  try {
    try {
      b.pathfinder.setGoal(null);
    } catch {}
    for (let k = 0; k < 8 && ee() < until && X() && !z.xeAbort(); k++) {
      if (!xeWetHere()) {
        ok = !0;
        break;
      }
      let pl = xePlan(bad);
      if (pl) {
        how.push(`swim${pl.path.length}`);
        if (
          await xeGo(pl, Math.min(until, ee() + 6e3 + pl.path.length * 1500))
        ) {
          ok = !0;
          break;
        }
        let ek = bn(pl.exit),
          nf = (fails.get(ek) || 0) + 1;
        (fails.set(ek, nf), nf >= 2 && bad.add(ek));
        continue;
      }
      let r = await xeDigOut(until, tried);
      if ((how.push(r || "none"), !r)) break;
    }
    ok = ok || (X() && !z.xeAbort() && !xeWetHere());
  } catch (err) {
    be("water escape error", {
      err: String((err && err.stack) || err).slice(0, 300),
    });
  } finally {
    try {
      b.clearControlStates();
    } catch {}
    ((z.xeBusy = !1),
      (z.escapingWater = esc),
      (z.xeNext = ee() + 2e3),
      (z.xeN = (z.xeN || 0) + 1),
      ok && (z.xeOk = (z.xeOk || 0) + 1),
      (z.xeMs = (z.xeMs || 0) + (ee() - t0)));

    try {
      (z.xr2Hist = (z.xr2Hist || []).filter((r) => ee() - r.t < 6e4)).push({
        t: ee(),
        p: from,
      });
    } catch {}

    try {
      (z.w4Hist = (z.w4Hist || []).filter((r) => ee() - r.t < 9e4)).push({
        t: ee(),
        p: from,
        at: X() ? pe() : null,
        ok: ok || (X() && !xeWetHere()),
      });
    } catch {}
  }
  return (
    be("water escape", {
      why,
      from,
      at: X() ? pe() : null,
      ok,
      how: how.join(","),
      ms: ee() - t0,
      n: z.xeN,
      died: (z.xeDeaths || 0) !== dd,
    }),
    ok
  );
}

function xeStart(why) {
  if (z.waterBusy || z.xeBusy || z.finished || ee() < (z.xeNext || 0))
    return !1;

  let near = !1;
  try {
    near = xr2Loop();
  } catch {
    near = !1;
  }

  let w4c = null;
  if (!near)
    try {
      w4c = w4Loop();
    } catch {
      w4c = null;
    }
  ((z.waterBusy = !0), (z.escapingWater = !0));
  (async () => {
    let dd = z.xeDeaths || 0,
      ok = !1;
    if (w4c) {
      try {
        ok = await w4Break(why, w4c);
      } catch {
        ok = !1;
      }
      !ok &&
        X() &&
        !z.finished &&
        (z.xeDeaths || 0) === dd &&
        xeWetHere() &&
        (ok = await xeEscape(why));
    } else if (near) {
      try {
        ok = await xr2Strong(why, near);
      } catch {
        ok = !1;
      }

      !ok &&
        X() &&
        !z.finished &&
        (z.xeDeaths || 0) === dd &&
        xeWetHere() &&
        (ok = await xeEscape(why));
    } else ok = await xeEscape(why);
    !ok &&
      X() &&
      !z.finished &&
      (z.xeDeaths || 0) === dd &&
      xeWetHere() &&
      (await Qa());
  })()
    .catch(() => {})
    .finally(() => {
      ((z.escapingWater = !1), (z.waterBusy = !1), (z.wetSince = 0));
    });
  return !0;
}
((z.xeEscape = xeEscape), (z.xeWetHere = xeWetHere));

var W4L = { n: 0, at: 0, ok: 0, plugs: 0 };
function w4Loop() {
  if (!X() || z.finished) return null;
  let p = pe(),
    now = ee();
  if (W4L.n >= 8 || now - W4L.at < 8e3) return null;
  let cl = (z.w4Hist || []).filter(
    (r) =>
      now - r.t < 9e4 &&
      !!r.p &&
      Math.abs(r.p.x - p.x) <= 2 &&
      Math.abs(r.p.z - p.z) <= 2 &&
      Math.abs(r.p.y - p.y) <= 2,
  );
  return cl.length >= 2 ? cl : null;
}
function w4Kept(q) {
  try {
    if (_t.has(`${q.x},${q.z}`)) return !0;
    return typeof z.w4Keep == "function" && !!z.w4Keep(q);
  } catch {
    return !0;
  }
}

async function w4Plug(cells, until) {
  let st = { n: 0, done: 0, tried: 0, kept: 0, far: 0 },
    seen = new Set(),
    list = [];
  for (let c0 of cells)
    for (let dy of [-1, 0, 1]) {
      let q = gt(c0.x, c0.y + dy, c0.z),
        k = bn(q);
      if (seen.has(k)) continue;
      seen.add(k);
      let blk = ae(q);
      if (!blk || blk.name !== "water") continue;
      if (w4Kept(q)) {
        st.kept++;
        continue;
      }
      list.push(q);
    }
  st.n = list.length;
  list.sort((a, c) => a.y - c.y || je(a) - je(c));
  for (let q of list.slice(0, 6)) {
    if (ee() > until || !X() || z.finished || (z.xeAbort && z.xeAbort())) break;
    let blk = ae(q);
    if (!blk || blk.name !== "water") continue;
    if (je(q) > 4.5 || De(q)) {
      st.far++;
      continue;
    }
    let item = xr2Block();
    if (!item) break;
    let ref = null,
      face = null,
      below = ae(q.offset(0, -1, 0));
    if (xeSolid(below)) ((ref = below), (face = gt(0, 1, 0)));
    else
      for (let [dx, dz] of xeD4) {
        let nb = ae(q.offset(dx, 0, dz));
        if (xeSolid(nb)) {
          ((ref = nb), (face = gt(-dx, 0, -dz)));
          break;
        }
      }
    if (!ref) continue;
    st.tried++;
    let r = !1;
    try {
      r = await Sn(ref, face, item, { expectName: item });
    } catch {
      r = !1;
    }
    r && st.done++;
  }
  return st;
}
async function w4Break(why, cl) {
  if (!X() || z.xeBusy || z.finished) return !1;
  let t0 = ee(),
    from = pe(),
    dd = z.xeDeaths || 0,
    bad = new Set(),
    banned = [];
  (W4L.n++, (W4L.at = t0));
  for (let r of cl)
    if (r.at) {
      let k = bn(r.at);
      bad.has(k) || (bad.add(k), banned.push(`${r.at.x},${r.at.y},${r.at.z}`));

      if (z.homeW && r.at.offset)
        for (let dx = -4; dx <= 4; dx++)
          for (let dz = -4; dz <= 4; dz++)
            for (let dy = -1; dy <= 1; dy++)
              bad.add(bn(r.at.offset(dx, dy, dz)));
    }
  let ok = await xeEscape(why, { bad }),
    alt = ok;

  !ok &&
    X() &&
    !z.finished &&
    (z.xeDeaths || 0) === dd &&
    xeWetHere() &&
    (ok = await xeEscape(why));
  let pl = null;
  if (ok && X() && !z.finished && (z.xeDeaths || 0) === dd)
    try {
      ((z.xeBusy = !0), (z.escapingWater = !0));
      pl = await w4Plug(cl.map((r) => r.p).concat([from]), ee() + 12e3);
      W4L.plugs += pl.done;
    } catch (err) {
      pl = { err: String((err && err.message) || err).slice(0, 120) };
    } finally {
      try {
        z.bot.clearControlStates();
      } catch {}
      z.xeBusy = !1;
    }
  ok && W4L.ok++;
  be("w4 loop", {
    why,
    from,
    n: W4L.n,
    near: cl.length,
    banned,
    alt,
    ok,
    at: X() ? pe() : null,
    plug: pl,
    ms: ee() - t0,
  });
  return ok;
}

var xr2FallRe =
    /^(gravel|sand|red_sand|suspicious_sand|suspicious_gravel|[a-z_]+_concrete_powder|anvil|chipped_anvil|damaged_anvil|pointed_dripstone)$/,
  xr2FluidRe =
    /^(water|lava|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/,
  xr2D6 = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, 1, 0],
    [0, -1, 0],
  ];
function xr2S() {
  return (
    z.xr2 ||
    (z.xr2 = {
      n: 0,
      ok: 0,
      at: 0,
      ms: 0,
      steps: 0,
      dy: 0,
      nowater: 0,
      nwLog: 0,
    })
  );
}

function xr2Hook() {
  try {
    return (
      typeof z.xrUntil == "function" &&
      !z.xeQaGoto &&
      !z.xr2Busy &&
      !z.xeBusy &&
      !!z.xrUntil()
    );
  } catch {
    return !1;
  }
}

function xr2Loop() {
  if (!X()) return !1;
  let p = pe(),
    now = ee(),
    home = xeHome(),
    S = xr2S();
  if (S.n >= 4 || now - S.at < 2e4) return !1;
  if (home && p.y >= home.y - 6 && xt(p, home) <= 24) return !1;
  let near = (z.xr2Hist || []).filter(
    (r) =>
      now - r.t < 6e4 &&
      Math.abs(r.p.x - p.x) <= 4 &&
      Math.abs(r.p.z - p.z) <= 4 &&
      Math.abs(r.p.y - p.y) <= 4,
  ).length;
  return near >= 2 ? near : !1;
}
function xr2Covered() {
  let p = pe();
  for (let u = 2; u <= 24; u++) {
    let b = ae(p.offset(0, u, 0));
    if (!b) return !1;
    if (b.boundingBox === "block" && !/leaves/.test(b.name)) return !0;
  }
  return !1;
}
function xr2CanDig(k) {
  return (
    !!k &&
    k.diggable !== !1 &&
    !xeWet(k) &&
    !/lava|fire/.test(k.name) &&
    !xeNoDig.test(k.name) &&
    !jt.has(k.name) &&
    !_t.has(`${k.position.x},${k.position.z}`)
  );
}
function xr2NearFluid(q) {
  return xr2D6.some(([a, h, c]) => {
    let r = ae(q.offset(a, h, c));
    return !r || xr2FluidRe.test(r.name);
  });
}
function xr2FallAbove(q) {
  let r = ae(q.offset(0, 1, 0));
  return !!r && xr2FallRe.test(r.name);
}
async function xr2Dig(k) {
  let pk = [
    "netherite_pickaxe",
    "diamond_pickaxe",
    "iron_pickaxe",
    "stone_pickaxe",
    "golden_pickaxe",
    "wooden_pickaxe",
  ].find((n) => kn(n) > 0);
  return oo(k, pk ? { tool: pk, maxMs: 9e3 } : { hand: !0, maxMs: 9e3 });
}
function xr2Block() {
  return (
    [
      "andesite",
      "diorite",
      "granite",
      "tuff",
      "calcite",
      "netherrack",
      "cobbled_deepslate",
      "dirt",
      "coarse_dirt",
      "cobblestone",
    ].find((n) => kn(n) > 0) || null
  );
}

function xr2Dirs(home, last) {
  let p = pe(),
    dx = home ? home.x - p.x : 0,
    dz = home ? home.z - p.z : 0,
    d = xeD4
      .slice()
      .sort((a, c) => c[0] * dx + c[1] * dz - (a[0] * dx + a[1] * dz));
  return last && last[0] * dx + last[1] * dz >= 0
    ? [last, ...d.filter((v) => v[0] !== last[0] || v[1] !== last[1])]
    : d;
}

async function xr2Move(g, until) {
  let b = z.bot,
    t1 = Math.min(until + 2e3, ee() + 3e3),
    at = () => {
      let p = b.entity.position;
      return (
        Math.floor(p.y + 0.05) >= g.y &&
        Math.hypot(p.x - g.x - 0.5, p.z - g.z - 0.5) < 0.45
      );
    };
  try {
    for (; ee() < t1 && X() && !(z.xeAbort && z.xeAbort());) {
      let p = b.entity.position;
      if (at() && b.entity.onGround) return !0;
      let dxz = Math.hypot(g.x + 0.5 - p.x, g.z + 0.5 - p.z);
      (await b.lookAt(new Ut(g.x + 0.5, p.y + 1.6, g.z + 0.5), !0),
        b.setControlState("sprint", !1),
        b.setControlState("forward", dxz > 0.2),
        b.setControlState("jump", Math.floor(p.y + 0.05) < g.y),
        await ze(50));
    }
  } finally {
    try {
      b.clearControlStates();
    } catch {}
  }
  for (let i = 0; i < 10 && X() && !b.entity.onGround; i++) await ze(50);
  return X() && at();
}

async function xr2Pillar(until, pick = xr2Block) {
  let b = z.bot,
    p = pe(),
    H = p.offset(0, 2, 0),
    fl = ae(p.offset(0, -1, 0)),
    h = ae(H);
  if (!xeSolid(fl) || xeBadFloor.test(fl.name) || !h || ee() > until) return !1;
  if (!xeOpen(h) && !xeWet(h)) {
    if (
      !xr2CanDig(h) ||
      xr2NearFluid(H) ||
      xr2FallAbove(H) ||
      !(await xr2Dig(h))
    )
      return !1;
    await ze(150);
    h = ae(H);
    if (!h || !(xeOpen(h) || xeWet(h))) return !1;
  }
  let blk = pick();
  if (!blk || !(await Jt(blk))) return !1;
  let wet = xeWetHere(),
    y0 = b.entity.position.y;
  try {
    await b.look(b.entity.yaw, -Math.PI / 2, !0);
  } catch {}
  try {
    b.setControlState("jump", !0);
    for (let i = 0; i < (wet ? 60 : 16) && b.entity.position.y < y0 + 1.05; i++)
      await ze(25);
    try {
      await Ge(
        b.placeBlock(ae(p.offset(0, -1, 0)), gt(0, 1, 0)),
        1500,
        "xr2 pillar",
      );
    } catch {}
  } finally {
    try {
      b.setControlState("jump", !1);
    } catch {}
  }
  for (let i = 0; i < 12 && X() && !b.entity.onGround; i++) await ze(50);
  return X() && pe().y > p.y;
}

async function xr2Unwet(until, tried, exits) {
  let b = z.bot,
    p = pe(),
    eyeWet = () => xeWet(ae(b.entity.position.offset(0, 1.62, 0).floored())),
    y = p.y;
  for (; y < p.y + 12 && xeWet(ae(gt(p.x, y + 1, p.z)));) y++;
  if (eyeWet() && y > p.y && xeOpen(ae(gt(p.x, y + 1, p.z)))) {
    let t1 = Math.min(until, ee() + 1e4);
    try {
      b.setControlState("jump", !0);
      for (; ee() < t1 && X() && !z.xeAbort() && eyeWet();) await ze(50);
    } finally {
      try {
        b.setControlState("jump", !1);
      } catch {}
    }
    if (!xeWetHere()) return "up";
  }
  let pl = xePlan(exits);
  if (pl) {
    if (await xeGo(pl, Math.min(until, ee() + 6e3 + pl.path.length * 1500)))
      return "swim";
    exits.add(bn(pl.exit));
  }
  if (!X() || !xeWetHere()) return "swim";
  if (await xr2Pillar(until)) return "place";
  return (await xeDigOut(until, tried)) || !1;
}

async function xr2Step(dirs, bad, until) {
  let p = pe(),
    H = p.offset(0, 2, 0),
    hb = ae(H);
  if (
    !hb ||
    !(xeOpen(hb) || (xr2CanDig(hb) && !xr2NearFluid(H) && !xr2FallAbove(H)))
  )
    return null;
  for (let [dx, dz] of dirs) {
    let key = `${bn(p)}:${dx},${dz}`;
    if (bad.has(key)) continue;
    let N0 = p.offset(dx, 0, dz),
      N1 = p.offset(dx, 1, dz),
      N2 = p.offset(dx, 2, dz),
      fl = ae(N0),
      good =
        xeSolid(fl) &&
        !xeBadFloor.test(fl.name) &&
        fl.name !== "farmland" &&
        !_t.has(`${N0.x},${N0.z}`);
    for (let q of [N1, N2])
      if (good) {
        let k = ae(q);
        good = !!k && (xeOpen(k) || (xr2CanDig(k) && !xr2NearFluid(q)));
      }
    if (!good) {
      bad.add(key);
      continue;
    }
    let ok = !0;
    for (let q of [H, N2, N1]) {
      for (let i = 0; ok && i < 4; i++) {
        let k = ae(q);
        if (!k || xeOpen(k)) break;
        if (
          ee() > until ||
          z.xeAbort() ||
          !xr2CanDig(k) ||
          xr2NearFluid(q) ||
          !(await xr2Dig(k))
        )
          ok = !1;
        else await ze(120);
      }
      if (!ok || !xeOpen(ae(q))) {
        ok = !1;
        break;
      }
    }
    if (ok && (await xr2Move(N1, until))) return [dx, dz];
    bad.add(key);
  }
  return null;
}
async function xr2Strong(why, near) {
  if (!X() || z.xeBusy || z.finished) return !1;
  let b = z.bot,
    S = xr2S(),
    t0 = ee(),
    until = t0 + 6e4,
    ext = !1,
    dd = z.xeDeaths || 0,
    from = pe(),
    home = xeHome(),
    goalY = home ? home.y + 1 : from.y + 40,
    cnt = {},
    end = "loop",
    bad = new Set(),
    exits = new Set(),
    tried = new Set(),
    last = null,
    wet = 0,
    ok = !1,
    add = (k) => (cnt[k] = (cnt[k] || 0) + 1);
  (S.n++, (S.at = t0), (z.xeBusy = !0), (z.xr2Busy = !0), (z.xeTrapAt = t0));
  try {
    z.xeAbort = () =>
      (z.xeDeaths || 0) !== dd ||
      !!z.finished ||
      !!(z.bot && z.bot.health <= 0);
    be("xr2 escape mode", {
      why,
      at: from,
      near,
      home: home ? { x: home.x, y: home.y, z: home.z } : null,
      goalY,
      n: S.n,
      oxygen: b.oxygenLevel,
    });
    try {
      b.pathfinder.setGoal(null);
    } catch {}
    for (let k = 0; k < 150 && X() && !z.xeAbort(); k++) {
      if (ee() > until) {
        if (!ext && pe().y - from.y >= 8) ((ext = !0), (until += 3e4));
        else {
          end = "time";
          break;
        }
      }
      let p = pe();
      if (xeWetHere()) {
        if (wet++ >= 5) {
          end = "wet";
          break;
        }
        let r = await xr2Unwet(until, tried, exits);
        if (!r) {
          end = "stuck";
          break;
        }
        add(r);
        continue;
      }
      if (p.y >= goalY - 2) {
        ((ok = !0), (end = "top"));
        break;
      }
      if (p.y >= goalY - 8 && !xr2Covered()) {
        ((ok = !0), (end = "sky"));
        break;
      }
      for (let i = 0; i < 20 && X() && !b.entity.onGround; i++) await ze(50);
      let d = await xr2Step(xr2Dirs(home, last), bad, until);
      if (d) {
        (add("stairs"), (last = d));
        continue;
      }
      if (await xr2Pillar(until)) {
        add("pillar");
        continue;
      }
      end = "blocked";
      break;
    }
  } catch (err) {
    end = "error";
    be("xr2 escape mode error", {
      err: String((err && err.stack) || err).slice(0, 300),
    });
  } finally {
    try {
      b.clearControlStates();
    } catch {}
    ((z.xeBusy = !1),
      (z.xr2Busy = !1),
      (z.xeNext = ee() + 2e3),
      (S.ms += ee() - t0));
  }
  let at = X() ? pe() : null,
    dy = at ? at.y - from.y : 0,
    died = (z.xeDeaths || 0) !== dd,
    res = !!at && !died && !xeWetHere() && (ok || dy >= 3);
  (res && S.ok++,
    (S.steps += (cnt.stairs || 0) + (cnt.pillar || 0)),
    (S.dy += Math.max(0, dy)));
  z.xr2Hist = [];
  z.xr2NoWater = { at: from, until: ee() + 12e4 };
  be("xr2 escape mode done", {
    ok: res,
    end,
    how: cnt,
    dy,
    from,
    at,
    ms: ee() - t0,
    n: S.n,
    died,
  });
  return res;
}

function w4PillarBlock() {
  return (
    [
      "cobblestone",
      "andesite",
      "diorite",
      "granite",
      "tuff",
      "calcite",
      "cobbled_deepslate",
      "netherrack",
    ].find((n) => kn(n) > 0) || (kn("dirt") > 24 ? "dirt" : null)
  );
}

async function w4Climb(goalY, toward, maxMs = 18e4, minGain = 8) {
  if (!X() || z.xeBusy || z.finished) return { end: "busy" };
  let b = z.bot,
    t0 = ee(),
    until = t0 + maxMs,
    from = pe(),
    dd = z.xeDeaths || 0,
    bad = new Set(),
    tried = new Set(),
    exits = new Set(),
    cnt = { stairs: 0, pillar: 0, unwet: 0 },
    last = null,
    end = "loop",
    ab0 = z.xeAbort;
  ((z.xeBusy = !0), (z.xr2Busy = !0));
  z.xeAbort = () =>
    (z.xeDeaths || 0) !== dd || !!z.finished || !!(z.bot && z.bot.health <= 0);
  try {
    try {
      b.pathfinder.setGoal(null);
    } catch {}
    for (let k = 0; k < 400 && X() && !z.xeAbort(); k++) {
      let p = pe();
      if (ee() > until) {
        end = "time";
        break;
      }
      if (ee() - t0 > 6e4 && p.y - from.y < minGain) {
        end = "slow";
        break;
      }
      if (p.y >= goalY - 2 && !xr2Covered()) {
        end = "top";
        break;
      }
      if (xeWetHere()) {
        if (cnt.unwet++ >= 5) {
          end = "wet";
          break;
        }
        let r = await xr2Unwet(until, tried, exits);
        if (!r) {
          end = "stuck";
          break;
        }
        continue;
      }
      for (let i = 0; i < 20 && X() && !b.entity.onGround; i++) await ze(50);
      let d = await xr2Step(xr2Dirs(toward, last), bad, until);
      if (d) {
        (cnt.stairs++, (last = d));
        continue;
      }

      if (cnt.pillar < 4 && (await xr2Pillar(until, w4PillarBlock))) {
        cnt.pillar++;
        continue;
      }
      end = "blocked";
      break;
    }
  } catch (err) {
    ((end = "error"),
      be("w4 climb error", {
        err: String((err && err.stack) || err).slice(0, 300),
      }));
  } finally {
    try {
      b.clearControlStates();
    } catch {}
    ((z.xeBusy = !1),
      (z.xr2Busy = !1),
      (z.xeNext = ee() + 2e3),
      (z.xeAbort = ab0));
  }
  return {
    end,
    ...cnt,
    from,
    at: X() ? pe() : null,
    ms: ee() - t0,
    died: (z.xeDeaths || 0) !== dd,
  };
}
async function Xt(e) {
  let a = z.bot;
  if (!(!X() || z.unsticking)) {
    z.unsticking = !0;
    try {
      try {
        a.pathfinder.setGoal(null);
      } catch {}
      let t = a.entity.position.floored(),
        n = ae(t);
      if (
        (n &&
          n.boundingBox === "block" &&
          (a.setControlState("jump", !0),
          a.setControlState("forward", !0),
          await ze(700)),
        e >= 2)
      )
        for (let [i, l] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ])
          for (let u of [0, 1]) {
            let d = ae(t.offset(i, u, l));
            if (
              d &&
              d.boundingBox === "block" &&
              !/ice$/.test(d.name) &&
              !jt.has(d.name) &&
              !_t.has(`${d.position.x},${d.position.z}`)
            )
              try {
                await Ge(a.dig(d, !0), 2500, "escape dig");
              } catch {}
          }
      let o = Math.random() * Math.PI * 2,
        s = !1;
      for (let i = 0; i < 8; i++) {
        let l = o + (i * Math.PI) / 4,
          u = t.offset(
            Math.round(-Math.sin(l) * 1.5),
            0,
            Math.round(-Math.cos(l) * 1.5),
          ),
          d = [1, 2, 3].findIndex((p) => {
            let h = ae(u.offset(0, -p, 0));
            return h && h.boundingBox === "block";
          }),
          m = [0, -1].some((p) => {
            let h = ae(u.offset(0, p, 0));
            return h && (h.name === "water" || h.name === "lava");
          });
        if (d !== -1 && d <= 1 && !m) {
          ((o = l), (s = !0));
          break;
        }
      }
      (await a.look(o, 0, !0), s && a.setControlState("forward", !0));
      let r = ae(t.offset(0, -1, 0));
      ((e >= 2 || !(r && r.name === "farmland")) &&
        a.setControlState("jump", !0),
        await ze(900));
    } catch {
    } finally {
      try {
        a.clearControlStates();
      } catch {}
      z.unsticking = !1;
    }
  }
}
async function _a() {
  let e = z.bot;
  if (!(!X() || z.unsticking)) {
    z.unsticking = !0;
    try {
      let a = e.entity.position,
        t = a.floored();
      ((z.avoid = (z.avoid || []).filter((r) => r.until > ee())),
        z.avoid.push({ x: t.x, y: t.y, z: t.z, until: ee() + 4e4 }));
      for (let [r, i] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ])
        for (let l of [0, 1]) {
          let u = ae(t.offset(r, l, i));
          if (!(!u || !/^bamboo/.test(u.name))) {
            try {
              await Ge(e.dig(u, !0), 3500, "unstick bamboo");
            } catch {}
            break;
          }
        }
      let n = ae(a.offset(0, 1.6, 0));
      if (
        n &&
        n.boundingBox === "block" &&
        !/ice$/.test(n.name) &&
        !jt.has(n.name)
      )
        try {
          await Ge(e.dig(n, !0), 3e3, "unstick dig");
        } catch {}
      let o = 0,
        s = 0;
      for (let [r, i] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        for (let l of [0, 1]) {
          let u = ae(t.offset(r, l, i));
          u && u.boundingBox === "block" && ((o -= r), (s -= i));
        }
      (!o && !s && (o = 1),
        await e.look(Math.atan2(-o, -s), 0, !0),
        e.setControlState("forward", !0),
        await ze(500),
        e.clearControlStates(),
        await ze(300));
    } catch {
    } finally {
      try {
        e.clearControlStates();
      } catch {}
      z.unsticking = !1;
    }
  }
}
var jt = new Set(),
  _t = new Set(),
  it = {};
function Mn(e) {
  for (let a of e) jt.add(a);
  Ye(it);
}
function zn(e, a, t = 0) {
  for (let n = -t; n <= t; n++)
    for (let o = -t; o <= t; o++) _t.add(`${e + n},${a + o}`);
}
function Ye(e = {}) {
  try {
    let w2 = z.xr2NoWater;
    if (
      e &&
      e.water &&
      w2 &&
      ee() < w2.until &&
      X() &&
      !xeWetHere() &&
      xt(pe(), w2.at) <= 24 &&
      Math.abs(pe().y - w2.at.y) <= 16
    ) {
      e = { ...e, water: !1 };
      let S = xr2S();
      S.nowater++;
      ee() - (S.nwLog || 0) > 3e4 &&
        ((S.nwLog = ee()),
        be("xr2 no water", { at: pe(), trap: w2.at, n: S.nowater }));
    }
  } catch {}
  it = e;
  let a = z.bot;
  if (!a || !a.registry) return null;
  let t = new hn(a),
    n = a.registry;
  ((t.canDig = e.canDig ?? !0),
    (t.digCost = e.digCost ?? 4),
    (t.maxDropDown = e.maxDropDown ?? 6),
    (t.exclusionAreasBreak = [
      (s) =>
        s && s.position && _t.has(`${s.position.x},${s.position.z}`)
          ? 1 / 0
          : 0,
    ]),
    (t.exclusionAreasStep = [
      (s) => {
        if (!s || !s.position) return 0;
        if (z.avoid && z.avoid.length) {
          let i = ee();
          for (let l of z.avoid)
            if (
              l.until > i &&
              Math.abs(l.x - s.position.x) <= 1 &&
              Math.abs(l.z - s.position.z) <= 1 &&
              Math.abs(l.y - s.position.y) <= 1
            )
              return 40;
        }
        if (z.noStep && z.noStep.has(`${s.position.x},${s.position.z}`))
          return 300;
        if (
          /^(melon_stem|pumpkin_stem|attached_melon_stem|attached_pumpkin_stem)$/.test(
            s.name,
          )
        )
          return 25;
        if (/^(wheat|carrots|potatoes|beetroots)$/.test(s.name)) return 3;
        if (s.name === "cave_vines" || s.name === "cave_vines_plant")
          return 100;
        if (s.name === "powder_snow") return 3;
        let r = a.blockAt(s.position.offset(0, -1, 0));
        if (!r) return 0;
        if (r.name === "composter" || r.name === "cauldron") return 1e3;
        if (r.name.endsWith("_leaves")) return 12;
        if (r.name === "melon" || r.name === "pumpkin") return 40;
        if (r.name !== "farmland") return 0;
        for (let [i, l] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          let u = a.blockAt(r.position.offset(i, 1, l));
          if (!u || u.boundingBox !== "block") continue;
          let d = a.blockAt(r.position.offset(i, 2, l));
          if (!d || d.boundingBox !== "block") return 12;
        }
        return 3;
      },
    ]));
  let o = e.towers ?? !!z.towersDefault;
  ((t.exclusionAreasPlace = [
    (s) =>
      !o || (s && s.position && _t.has(`${s.position.x},${s.position.z}`))
        ? 1 / 0
        : 0,
  ]),
    (t.allowParkour = !1),
    (t.allowSprinting = e.sprint ?? !0),
    (t.allow1by1towers = !!o),
    (t.scafoldingBlocks = o
      ? ["dirt", "cobblestone"]
          .map((s) => n.itemsByName[s] && n.itemsByName[s].id)
          .filter((s) => s !== void 0)
      : []),
    (t.liquidCost = e.water ? 3 : 40),
    (t.canOpenDoors = !1));
  for (let s of [
    "cactus",
    "sweet_berry_bush",
    "magma_block",
    "campfire",
    "fire",
    "lava",
    "water",
    "composter",
    "cauldron",
    "crafting_table",
    "barrel",
    "jungle_log",
    "bamboo",
    "bamboo_sapling",
  ]) {
    if (e.water && s === "water") continue;
    let r = n.blocksByName[s];
    r && t.blocksToAvoid.add(r.id);
  }

  try {
    if (!e.water)
      for (let s of [
        "kelp",
        "kelp_plant",
        "seagrass",
        "tall_seagrass",
        "bubble_column",
      ]) {
        let r = n.blocksByName[s];
        r && t.blocksToAvoid.add(r.id);
      }
  } catch {}
  for (let s of jt) {
    let r = n.blocksByName[s];
    r && t.blocksCantBreak.add(r.id);
  }
  for (let s of [
    "snow_block",
    "powder_snow",
    "ice",
    "packed_ice",
    "blue_ice",
    "frosted_ice",
  ]) {
    let r = n.blocksByName[s];
    r && t.blocksCantBreak.add(r.id);
  }
  if (!e.hardDig)
    for (let s of Object.values(n.blocksByName))
      /stone|ore$|deepslate|andesite|diorite|granite|tuff|calcite|basalt|blackstone|terracotta|sandstone|obsidian|bedrock|cobble|brick|dripstone|amethyst/.test(
        s.name,
      ) && t.blocksCantBreak.add(s.id);
  return (
    a.pathfinder.setMovements(t),
    (a.pathfinder.thinkTimeout = 3e3),
    (a.pathfinder.tickTimeout = 25),
    t
  );
}
async function Ma() {
  let e = 0;
  for (let a = 0; a < 48 && X(); a++) {
    let t = pe(),
      n = ae(t.offset(0, -1, 0)),
      o = ae(t.offset(0, -2, 0));
    if (
      !n ||
      n.boundingBox !== "block" ||
      !o ||
      o.boundingBox !== "block" ||
      ![
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].every(([l, u]) => {
        let d = ae(t.offset(l, -1, u)),
          m = ae(t.offset(l, -2, u));
        return (
          d &&
          m &&
          d.boundingBox !== "block" &&
          m.boundingBox !== "block" &&
          !/water|lava/.test(d.name) &&
          !/water|lava/.test(m.name)
        );
      })
    )
      break;
    let r = /^(dirt|grass_block|sand|red_sand|gravel|coarse_dirt|podzol)$/.test(
      n.name,
    );
    if (
      !(await oo(
        n,
        r ? { hand: !0, maxMs: 4e3 } : { tool: "stone_pickaxe", maxMs: 6e3 },
      ))
    )
      break;
    let i = z.bot.entity.position.y;
    for (let l = 0; l < 20 && z.bot.entity.position.y > i - 0.9; l++)
      await ze(50);
    e++;
  }
  return (e && be("pillar taken down", { blocks: e, at: pe() }), e);
}
async function Ae(e, a = {}) {
  try {
    for (let o = 0; o < 480 && z.xr2Busy && X(); o++) await ze(250);
  } catch {}
  if (z.selfRescue && !z.rescuing && X()) {
    z.rescuing = !0;
    try {
      await z.selfRescue();
    } catch {
    } finally {
      z.rescuing = !1;
    }
  }
  if (
    X() &&
    (z.quickNoPath || 0) >= 6 &&
    ee() - (z.lastBoxEscape || 0) > 2e4 &&
    !z.unsticking &&
    !z.stopSide
  ) {
    ((z.lastBoxEscape = ee()),
      be("no path from here: breaking out", { at: pe(), n: z.quickNoPath }),
      (z.quickNoPath = 0));
    try {
      Kt().pathfinder.setGoal(null);
    } catch {}
    Ye(it);
    let n = pe();
    if (((await Ma()) || (await Xt(2)), X() && z.pillarOut)) {
      for (let s = 0; s < 12 && X() && !Kt().entity.onGround; s++) await ze(50);
      let o = pe();
      if (o.x === n.x && o.z === n.z && o.y <= n.y)
        try {
          await z.pillarOut();
        } catch {}
    }
  }
  let t = await Ka(e, a);
  for (let n = 0; n < 2 && t === "drowning" && X(); n++) {
    for (let o = 0; o < 480 && z.xr2Busy && X(); o++) await ze(250);
    for (let o = 0; o < 100 && (z.drowning || z.escapingWater) && X(); o++)
      await ze(250);
    if (a.until && a.until()) break;
    t = await Ka(e, a);
  }
  return t;
}
var Kt = () => z.bot;
function Ka(e, a = {}) {
  let t = z.bot;
  if (!X()) return Promise.resolve("nobot");
  if (z.drowning || z.escapingWater) return ze(300).then(() => "drowning");

  if (xr2Hook()) return Promise.resolve("until");
  let n = a.timeoutMs ?? 2e4,
    o = a.stuckMs ?? 5e3;
  return new Promise((s) => {
    let r = !1,
      i = t.entity.position.clone(),
      l = ee(),
      u = ee(),
      d = (b) => {
        if (!r) {
          ((r = !0),
            b === "noPath" && ee() - u < 1500
              ? (z.quickNoPath = (z.quickNoPath || 0) + 1)
              : (b === "reached" || b === "stuck" || b === "timeout") &&
                (z.quickNoPath = 0),
            (z.wantMove = !1),
            clearInterval(h),
            t.removeListener("goal_reached", m),
            t.removeListener("path_update", p));
          try {
            t.pathfinder.setGoal(null);
          } catch {}
          try {
            t.clearControlStates();
          } catch {}
          s(b);
        }
      },
      m = () => d("reached"),
      p = (b) => {
        b && b.status === "noPath" && d(Ya(e) ? "reached" : "noPath");
      },
      h = setInterval(() => {
        if (!X()) return d("nobot");
        if (z.drowning || z.escapingWater) return d("drowning");
        if (Ya(e)) return d("reached");
        if (a.until && a.until()) return d("until");
        if (xr2Hook()) return d("until");
        let b = t.entity.position;
        if (
          (b.distanceTo(i) > 0.4 && ((i = b.clone()), (l = ee())), ee() - l > o)
        )
          return d("stuck");
        if (ee() - u > n) return d("timeout");
      }, 200);
    (t.on("goal_reached", m), t.on("path_update", p), (z.wantMove = !0));
    try {
      t.pathfinder.setGoal(e, !!a.dynamic);
    } catch {
      d("error");
    }
  });
}
function Ya(e) {
  try {
    return X() && e.isEnd(pe());
  } catch {
    return !1;
  }
}
var eo = () =>
  z.bot.entity.position.offset(0, z.bot.entity.eyeHeight || 1.62, 0);
function je(e) {
  let a = eo(),
    t = Math.max(e.x - a.x, 0, a.x - (e.x + 1)),
    n = Math.max(e.y - a.y, 0, a.y - (e.y + 1)),
    o = Math.max(e.z - a.z, 0, a.z - (e.z + 1));
  return Math.sqrt(t * t + n * n + o * o);
}
var Xe = class extends Ke.Goal {
  constructor(a, t = 4.2) {
    (super(), (this.p = a), (this.reach = t));
  }
  dist(a) {
    let t = a.x + 0.5,
      n = a.y + 1.62,
      o = a.z + 0.5,
      s = this.p,
      r = Math.max(s.x - t, 0, t - (s.x + 1)),
      i = Math.max(s.y - n, 0, n - (s.y + 1)),
      l = Math.max(s.z - o, 0, o - (s.z + 1));
    return Math.sqrt(r * r + i * i + l * l);
  }
  heuristic(a) {
    return Math.max(0, this.dist(a) - this.reach);
  }
  isEnd(a) {
    return a.x === this.p.x &&
      a.z === this.p.z &&
      (a.y === this.p.y || a.y + 1 === this.p.y)
      ? !1
      : this.dist(a) <= this.reach;
  }
};
async function vn(e, a = {}) {
  let t = a.reach ?? 4;
  if (!X()) return !1;
  if (je(e) <= t && !De(e)) return !0;

  let xrU = a.until ? { until: a.until } : {},
    xrAe = (g, op) =>
      a.until && a.until()
        ? Promise.resolve("until")
        : Ae(g, { ...op, ...xrU });
  let n = a.range ?? 2,
    o = z.bot.entity.position.distanceTo(e),
    s = a.timeoutMs ?? Math.min(6e4, 1e4 + o * 800),
    r = await xrAe(new Xe(e, Math.max(2.5, t - 0.3)), { timeoutMs: s });
  if (
    (X() && je(e) <= t + 0.3 && !De(e)) ||
    (r === "reached" &&
      ((r = await xrAe(new Xe(e, Math.max(2, t - 1.3)), {
        timeoutMs: Math.max(8e3, s / 2),
      })),
      (X() && je(e) <= t + 0.3 && !De(e)) ||
        (r === "reached" &&
          (r = await xrAe(new Ke.GoalNear(e.x, e.y + 1, e.z, n), {
            timeoutMs: Math.min(s, 15e3),
          })),
        X() && je(e) <= t + 0.3 && !De(e)))) ||
    (r === "stuck" &&
      (await _a(),
      (r = await xrAe(new Xe(e, Math.max(2.5, t - 0.3)), {
        timeoutMs: Math.max(8e3, s / 2),
      })),
      X() && je(e) <= t + 0.3 && !De(e))) ||
    (r !== "reached" &&
      (r = await xrAe(new Ke.GoalNear(e.x, e.y + 1, e.z, n), {
        timeoutMs: Math.min(s, 15e3),
      })),
    X() && je(e) <= t + 0.3 && !De(e))
  )
    return !0;
  if (r !== "reached" && !a.noEscalate && !(a.until && a.until())) {
    let l = it;
    (Ye({ ...l, maxDropDown: 12, digCost: 2, towers: !0, hardDig: !0 }),
      (r = await xrAe(new Ke.GoalNear(e.x, e.y + 1, e.z, n), { timeoutMs: s })),
      Ye(l));
  }
  De(e) && (await za(e));
  let i = X() && je(e) <= t + 0.3 && !De(e);
  return (
    i || be("approach failed", { to: e, at: X() ? pe() : null, status: r }),
    i
  );
}
function De(e) {
  if (!X()) return !1;
  let a = z.bot.entity.position,
    t = a.x + 0.3 > e.x && a.x - 0.3 < e.x + 1,
    n = a.z + 0.3 > e.z && a.z - 0.3 < e.z + 1,
    o = a.y + 1.8 > e.y && a.y < e.y + 1;
  return t && n && o;
}
async function za(e) {
  let a = z.bot;
  for (let [t, n] of [
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
    [2, 2],
    [-2, -2],
  ]) {
    let o = await Ae(new Ke.GoalBlock(e.x + t, e.y, e.z + n), {
      timeoutMs: 4e3,
      stuckMs: 2e3,
    });
    if (!De(e)) return !0;
    if (o === "reached") break;
  }
  return !De(e);
}
var ka = new Set(["air", "cave_air", "void_air"]),
  va = (e) => !e || ka.has(e.name);
function ae(e) {
  try {
    return z.bot.blockAt(e);
  } catch {
    return null;
  }
}
function to(e, a, t) {
  return new Promise((n) => {
    let o = z.bot,
      s = `blockUpdate:${e}`,
      r = null,
      i = (l, u) => {
        (!a || a(u)) && (clearTimeout(r), o.removeListener(s, i), n(!0));
      };
    ((r = setTimeout(() => {
      (o.removeListener(s, i), n(a ? a(ae(e)) : !1));
    }, t)),
      o.on(s, i));
  });
}
async function ao(e, a = gt(0, 1, 0), t = {}) {
  let n = z.bot;
  if (!e) return !1;
  let o = t.expectAt || null,
    s = o ? to(o, t.expect, t.waitMs ?? 1200) : null;
  try {
    (await n.lookAt(
      e.position.offset(0.5 + a.x * 0.5, 0.5 + a.y * 0.5, 0.5 + a.z * 0.5),
      !0,
    ),
      await Ge(
        n.activateBlock(
          e,
          a,
          gt(0.5 + a.x * 0.5, 0.5 + a.y * 0.5, 0.5 + a.z * 0.5),
        ),
        2500,
        "activate",
      ));
  } catch {
    return !1;
  }
  return s || !0;
}
async function Sn(e, a, t, n = {}) {
  if (!e) return !1;
  let o = e.position.plus(a);
  if (!(await Jt(t))) return !1;
  De(o) && (await za(o));
  let s = n.expectName || null;
  return ao(e, a, {
    expectAt: o,
    expect: (r) => !!r && !va(r) && r.name !== "water" && (!s || r.name === s),
    waitMs: n.waitMs ?? 1500,
  });
}
async function oo(e, a = {}) {
  let t = z.bot;
  if (!e || va(e)) return !1;
  if (a.tool) {
    try {
      (t.pathfinder.isBuilding() || t.pathfinder.isMoving()) &&
        t.pathfinder.setGoal(null);
    } catch {}
    for (
      let n = 0;
      n < 2 &&
      !(t.heldItem && t.heldItem.name === a.tool) &&
      (await Jt(a.tool));
      n++
    )
      for (
        let o = 0;
        o < 12 && !(t.heldItem && t.heldItem.name === a.tool);
        o++
      )
        await ze(50);
  } else a.hand && (await Xa());
  try {
    if (!e.diggable || je(e.position) > 5) return !1;
    let n = 4e3;
    try {
      n = Math.max(1500, t.digTime(e) * 1.6 + 1200);
    } catch {}
    return (
      a.maxMs && (n = Math.min(n, a.maxMs)),
      await Ge(t.dig(e, !0), n, "dig"),
      !0
    );
  } catch {
    try {
      t.stopDigging();
    } catch {}
    return !1;
  }
}
var no =
  /^(terracotta|[a-z_]+_terracotta|diorite|andesite|granite|tuff|calcite|gravel|flint|mud|mangrove_roots|muddy_mangrove_roots|mangrove_log|raw_copper|raw_gold|clay_ball|snowball|red_sand|pointed_dripstone|dripstone_block|rotten_flesh)$/;
async function Bn(e = 8) {
  let a = z.bot;
  if (!X() || Pt() >= e) return 0;
  let t = 0;
  for (let n of a.inventory.items())
    if (no.test(n.name))
      try {
        (await Ge(a.tossStack(n), 1500, "toss"), t++, await ze(120));
      } catch {}
  return (t && be("junk dropped", { stacks: t, free: Pt() }), t);
}
function so(e, a, t) {
  let n = z.bot,
    o = [];
  for (let s of Object.values(n.entities)) {
    if (
      !s ||
      s.name !== "item" ||
      !s.position ||
      xt(s.position, e) > a ||
      Math.abs(s.position.y - e.y) > (z.itemDy || 8)
    )
      continue;
    let r = null;
    try {
      r = s.getDroppedItem && s.getDroppedItem();
    } catch {}
    (r && no.test(r.name)) ||
      (t && (!r || !t.has(r.name))) ||
      (z.itemSkip && z.itemSkip.has(s.id)) ||
      o.push(s);
  }
  return o;
}
async function ro(e, a, t = 0.35, n = !1, xyGone = null) {
  let o = z.bot,
    s = ee() + a;
  try {
    for (
      n && o.setControlState("sneak", !0);
      ee() < s && X() && xt(o.entity.position, e) > t && !(xyGone && xyGone());
    ) {
      let r = o.entity.position,
        i = e.x - r.x,
        l = e.z - r.z,
        u = Math.hypot(i, l) || 1,
        d = new Ut(
          r.x + (i / u) * 0.8,
          r.y + 0.1,
          r.z + (l / u) * 0.8,
        ).floored(),
        m = !1;
      for (let p = 0; p <= 3 && !m; p++) {
        let h = ae(d.offset(0, -p, 0));
        (!h || h.boundingBox === "block" || h.name === "water") && (m = !0);
      }

      try {
        m &&
          z.noStep &&
          z.noStep.has(`${d.x},${d.z}`) &&
          !z.noStep.has(`${Math.floor(r.x)},${Math.floor(r.z)}`) &&
          (m = !1);
      } catch {}
      if (!m) break;
      (await o.lookAt(new Ut(e.x, o.entity.position.y + 1.6, e.z), !0),
        o.setControlState("forward", !0),
        await ze(n ? 50 : 60));
    }
  } catch {
  } finally {
    try {
      o.clearControlStates();
    } catch {}
  }
}
function On(e) {
  let a = e.floored(),
    t = null;
  for (let n = -1; n <= 1; n++)
    for (let o = -1; o <= 1; o++)
      if (!(!n && !o))
        for (let s of [1, 0]) {
          let r = a.offset(n, s, o),
            i = ae(r.offset(0, -1, 0)),
            l = ae(r),
            u = ae(r.offset(0, 1, 0));
          if (
            !i ||
            i.boundingBox !== "block" ||
            !l ||
            l.boundingBox === "block" ||
            /water|lava/.test(l.name) ||
            !u ||
            u.boundingBox === "block" ||
            /water|lava/.test(u.name) ||
            Math.abs(r.x + 0.5 - e.x) > 1.35 ||
            Math.abs(r.z + 0.5 - e.z) > 1.35
          )
            continue;
          let d = r.distanceTo(z.bot.entity.position);
          (!t || d < t.d) && (t = { f: r, d });
          break;
        }
  return t ? t.f : null;
}

var XYP = { t: new Map(), bot: null, on: !0 };
function xyItemHook() {
  try {
    let b = z.bot;
    if (!b || XYP.bot === b) return;
    XYP.bot = b;
    b.on("entitySpawn", (en) => {
      try {
        if (!en || en.name !== "item") return;
        XYP.t.set(en.id, ee());
        if (XYP.t.size > 800) {
          let lim = ee() - 6e4;
          for (let [k, v] of XYP.t) v < lim && XYP.t.delete(k);
        }
      } catch {}
    });
  } catch {}
}
function xyPickSt() {
  return (
    z.xyPickSt ||
    (z.xyPickSt = { calls: 0, tries: 0, got: 0, waitAge: 0, ageGot: 0, ms: 0 })
  );
}
async function xyPickWait(h, k, l) {
  let s = z.bot,
    P = xyPickSt(),
    t0 = ee(),
    lim = k ? 600 : 120;
  for (; ee() - t0 < lim && s.entities[h.id];) await ze(25);
  if (!s.entities[h.id] || !l || k || !X() || !h.position || Pt() < 1) return;
  let me = s.entity.position,
    q = h.position;
  if (xt(me, q) > 1.25 || q.y < me.y - 0.75 || q.y > me.y + 2.2) return;
  let age = XYP.t.has(h.id) ? ee() - XYP.t.get(h.id) : 1e9;
  if (age >= 700) return;
  P.waitAge++;
  let t1 = ee() + Math.min(700, 720 - age);
  for (; ee() < t1 && s.entities[h.id];) await ze(25);
  s.entities[h.id] || P.ageGot++;
}
async function Cn(e, a, t, n = 15e3, o = {}) {
  xyItemHook();
  let s = z.bot,
    r = ee() + n,
    i = new Map(),
    l = !!o.quick,
    u = l ? 1 : 2,
    d = 0,
    xyT0 = ee(),
    xyTries = 0;
  try {
    return await xyCn(e, a, t, n, o, s, r, i, l, u, d, xyT0, () => xyTries++);
  } finally {
    try {
      let P = xyPickSt();
      (P.calls++, (P.ms += ee() - xyT0), (P.tries += xyTries));
    } catch {}
  }
}
async function xyCn(e, a, t, n, o, s, r, i, l, u, d, xyT0, xyTry) {
  for (; ee() < r && X();) {
    await xa();
    let m = s.entity.position,
      p = so(e, a, t).filter((S) => (i.get(S.id) || 0) < u);
    if (!p.length) break;
    p.sort((S, C) => S.position.distanceTo(m) - C.position.distanceTo(m));
    let h = p[0];
    i.set(h.id, (i.get(h.id) || 0) + 1);
    let b = h.position,
      _ = ae(b.floored()),
      k =
        !!_ &&
        (_.name === "water" ||
          _.name === "kelp" ||
          _.name === "kelp_plant" ||
          _.name === "seagrass"),
      y = () => {
        (z.itemSkip || (z.itemSkip = new Set())).add(h.id);
        let S = null;
        try {
          S = h.getDroppedItem().name;
        } catch {}
        ((z.itemSkipBy = z.itemSkipBy || {}),
          (z.itemSkipBy[S] = (z.itemSkipBy[S] || 0) + 1),
          z.itemSkipBy[S] <= 3 &&
            be("item out of reach", {
              name: S,
              at: b.floored(),
              me: X() ? pe() : null,
              wet: k,
              quick: l,
            }));
      };
    if ((l || o.dry) && k) {
      let S = On(b);
      if (S) {
        await Ae(new Ke.GoalBlock(S.x, S.y, S.z), {
          timeoutMs: Math.max(
            500,
            Math.min(3e3 + S.distanceTo(m) * 300, r - ee()),
          ),
          stuckMs: 1800,
        });
        for (let C = 0; C < 8 && s.entities[h.id]; C++) await ze(100);
        if (!s.entities[h.id]) {
          d++;
          continue;
        }
      }
      l ? y() : i.set(h.id, u);
      continue;
    }
    let N = Math.floor(b.y + 0.5),
      g = b.distanceTo(m),
      xyG = XYP.on ? () => !s.entities[h.id] : null;
    xyTry();
    (await Ae(new Ke.GoalNear(b.x, N, b.z, k ? 1.6 : 1), {
      timeoutMs: Math.max(
        500,
        Math.min(l ? 2500 + g * 300 : 6e3 + g * 400, r - ee()),
      ),
      stuckMs: l ? 1800 : 2500,
    }),
      s.entities[h.id] &&
        !k &&
        X() &&
        xt(s.entity.position, b) < 2.5 &&
        (await ro(b, 700, 0.35, !1, xyG)));
    if (XYP.on)
      try {
        await xyPickWait(h, k, l);
      } catch {
        await ze(k ? 600 : 120);
      }
    else await ze(k ? 600 : 120);
    s.entities[h.id] ? (i.get(h.id) || 0) >= u && y() : (d++, xyPickSt().got++);
  }
  return d;
}
async function $n(e, a, t = {}) {
  let n = t.reach ?? 4.2,
    o = t.until ?? (() => !1),
    s = e.slice(),
    r = new Map(),
    i = t.maxFails ?? 2,
    l = 0,
    u = 0,
    d = [],
    m = () => o() || (z.stopSide && !t.final);
  for (; s.length && X() && !m();) {
    await xa();
    let p = z.bot.entity.position;
    s.sort((k, y) => k.pos.distanceTo(p) - y.pos.distanceTo(p));
    let h = s.filter(
      (k) => je(k.pos) <= n && !(t.avoidOccupy && De(k.pos.offset(0, 1, 0))),
    );
    if (h.length) {
      for (let k of h) {
        if (m()) break;
        if (je(k.pos) > n) continue;
        s.splice(s.indexOf(k), 1);
        let y = !1;
        try {
          y = await a(k);
        } catch {
          y = !1;
        }
        y && l++;
      }
      continue;
    }
    let b = s[0],
      _ = await Ae(new Xe(b.pos, Math.max(2.5, n - 0.4)), {
        timeoutMs: t.moveMs ?? 12e3,
        stuckMs: 3500,
      });
    if (
      (_ === "reached" &&
        X() &&
        je(b.pos) > n &&
        (_ = await Ae(new Xe(b.pos, Math.max(2, n - 1.3)), {
          timeoutMs: 6e3,
          stuckMs: 3e3,
        })),
      je(b.pos) > n)
    ) {
      let k = (r.get(b) || 0) + 1;
      if (
        (r.set(b, k),
        (u = _ === "noPath" ? u + 1 : 0),
        t.final && u >= 3 && (z.finalRescues || 0) < 3 && X())
      ) {
        ((z.finalRescues = (z.finalRescues || 0) + 1),
          be("final harvest: no path from here, breaking out", {
            at: pe(),
            left: s.length + d.length,
            n: z.finalRescues,
          }));
        let y = it;
        try {
          Kt().pathfinder.setGoal(null);
        } catch {}
        let N = (g) =>
          /water|kelp|seagrass/.test(
            (ae(pe().offset(0, g, 0)) || {}).name || "",
          );
        if (N(0) || N(1)) {
          for (let g of [1, 2]) {
            let S = ae(pe().offset(0, g, 0));
            if (S && /ice$/.test(S.name))
              try {
                await Ge(Kt().dig(S, !0), 3e3, "ice");
              } catch {}
          }

          let xo = !1;
          try {
            for (let g = 0; g < 80 && (z.xeBusy || z.waterBusy); g++)
              await ze(250);
            xo =
              !xeWetHere() || (await xeEscape("final rescue", { maxMs: 15e3 }));
          } catch {}
          if (!xo)
            try {
              await Qa();
            } catch {}
        } else (await Ma()) || (await Xt(2));
        (Ye({
          maxDropDown: 4,
          digCost: 1.5,
          towers: !0,
          hardDig: !0,
          water: !0,
        }),
          await Ae(new Xe(b.pos, Math.max(2.5, n - 0.4)), {
            timeoutMs: 15e3,
            stuckMs: 5e3,
          }),
          Ye(y));
        for (let g of d.splice(0)) s.includes(g) || s.push(g);
        (r.clear(), (u = 0));
        continue;
      }
      if (
        (k >= i &&
          (s.splice(s.indexOf(b), 1),
          t.final && _ === "noPath" && d.push(b),
          be("work target unreachable", {
            pos: b.pos,
            at: X() ? pe() : null,
            status: _,
            label: t.label || null,
          }),
          t.onUnreachable && t.onUnreachable(b, _)),
        u >= 6 && !t.final)
      ) {
        be("work set: no path from here", {
          at: X() ? pe() : null,
          left: s.length,
          label: t.label || null,
        });
        break;
      }
    } else u = 0;
  }
  return l;
}
module.exports = {
  settleCursor: Ja,
  GoalReach: Xe,
  unstick: _a,
  escape: Xt,
  dropJunk: Bn,
  tick: xa,
  workSet: $n,
  nudge: ro,
  protectColumn: zn,
  protectedCols: _t,
  ENV: kt,
  T0: ga,
  S: z,
  goals: Ke,
  Vec3: Ut,
  v3: gt,
  now: ee,
  secs: Va,
  timeLeft: wn,
  sleep: ze,
  emit: Yt,
  log: be,
  withTimeout: Ge,
  hasBot: X,
  pos: yn,
  feet: pe,
  key: bn,
  hdist: xt,
  allItems: Vt,
  count: kn,
  findInv: gn,
  inventorySummary: xn,
  equip: Jt,
  unequip: Xa,
  freeSlots: Pt,
  tossJunk: _n,
  connect: Za,
  protect: Mn,
  setMovements: Ye,
  goto: Ae,
  approach: vn,
  occupies: De,
  stepOff: za,
  eye: eo,
  reachOf: je,
  isAir: va,
  blockAt: ae,
  waitBlockChange: to,
  useOn: ao,
  placeOn: Sn,
  dig: oo,
  droppedItems: so,
  collectItems: Cn,
  descendPillar: Ma,
  w4Climb,
};
