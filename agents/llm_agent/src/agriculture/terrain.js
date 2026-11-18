"use strict";
var B = require("../runtime/connection"),
  {
    S: Re,
    v3: Mt,
    log: Fe,
    now: ve,
    timeLeft: Tn,
    count: se,
    blockAt: oe,
    isAir: Ze,
  } = B,
  ct = {
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
    open_eyeblossom: 0.65,
    closed_eyeblossom: 0.65,
    lily_pad: 0.65,
    moss_block: 0.65,
    azalea: 0.65,
    flowering_azalea: 0.85,
    apple: 0.65,
    fern: 0.65,
    large_fern: 0.65,
    torchflower: 0.85,
    pitcher_plant: 0.85,
    carrot: 0.65,
    potato: 0.65,
    beetroot: 0.65,
    wheat: 0.65,
    nether_wart: 0.65,
    cocoa_beans: 0.65,
    red_mushroom: 0.65,
    pumpkin: 0.65,
    melon: 0.65,
    mushroom_stem: 0.65,
    big_dripleaf: 0.65,
    spore_blossom: 0.65,
    tall_grass: 0.5,
    vine: 0.5,
    glow_lichen: 0.5,
    cactus: 0.5,
    sugar_cane: 0.5,
    melon_slice: 0.5,
    flowering_azalea_leaves: 0.5,
    pink_petals: 0.3,
    wildflowers: 0.3,
    wheat_seeds: 0.3,
    beetroot_seeds: 0.3,
    melon_seeds: 0.3,
    pumpkin_seeds: 0.3,
    oak_sapling: 0.3,
    birch_sapling: 0.3,
    spruce_sapling: 0.3,
    jungle_sapling: 0.3,
    acacia_sapling: 0.3,
    dark_oak_sapling: 0.3,
    cherry_sapling: 0.3,
    short_grass: 0.3,
    moss_carpet: 0.3,
    short_dry_grass: 0.3,
    tall_dry_grass: 0.3,
    bush: 0.3,
    firefly_bush: 0.3,
    cactus_flower: 0.3,
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
    kelp: 0.3,
    dried_kelp: 0.3,
    seagrass: 0.3,
    sweet_berries: 0.3,
    glow_berries: 0.3,
    hanging_roots: 0.3,
    small_dripleaf: 0.3,
    mangrove_propagule: 0.3,
    pale_oak_sapling: 0.3,

    leaf_litter: 0.3,
  },
  co = [
    "large_fern",
    "fern",
    "tall_grass",
    "vine",
    "short_grass",
    "short_dry_grass",
    "tall_dry_grass",
    "bush",
    "oak_leaves",
    "birch_leaves",
    "spruce_leaves",
    "jungle_leaves",
    "acacia_leaves",
    "dark_oak_leaves",
    "mangrove_leaves",
    "cherry_leaves",
    "azalea_leaves",
    "flowering_azalea_leaves",
    "pale_oak_leaves",
  ],
  Zt = [
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
    "open_eyeblossom",
    "closed_eyeblossom",
    "flowering_azalea",
    "azalea",
    "pink_petals",
    "wildflowers",
    "cactus_flower",
    "firefly_bush",
    "cactus",
    "sugar_cane",
  ],
  Sa = {
    large_fern: 1.3,
    tall_grass: 0.6,
    vine: 0.5,
    glow_lichen: 0.5,
    short_grass: 0.3,
    short_dry_grass: 0.3,
    tall_dry_grass: 0.3,
    bush: 0.3,
  };
for (let e of Zt) Sa[e] = ct[e] || 0.3;
Sa.fern = 0.65;
var O = {
  composter: null,
  blocked: new Set(),
  skip: new Map(),
  failed: new Map(),
  bad: new Set(),
  miss: {},
  made: 0,
  used: 0,
};
function In(e) {
  let a = Re.bot.registry.itemsByName[e];
  return a ? a.id : null;
}
async function ot(e, a, t) {
  let n = Re.bot,
    o = In(e);
  if (o === null) return !1;

  if (t && t.position && B.reachOf(t.position) > 4.2) {
    try {
      await B.approach(t.position, { reach: 3.5, timeoutMs: 8e3 });
    } catch {}
    if (B.reachOf(t.position) > 4.5)
      return (
        Fe("craft table out of reach", {
          name: e,
          reach: +B.reachOf(t.position).toFixed(1),
        }),
        !1
      );
  }
  let s = 0;
  for (let r = 0; s < a && r < a + 3; r++) {
    try {
      n.currentWindow && n.closeWindow(n.currentWindow);
    } catch {}
    try {
      (n.pathfinder.setGoal(null), n.clearControlStates());
    } catch {}
    await B.sleep(r ? 600 : 150);
    let i = n.recipesFor(o, null, 1, t || null);
    if (!i.length) {
      const pt = {};
      for (const it of n.inventory.items())
        if (/_planks$|_log$|^stick$/.test(it.name))
          pt[it.name] = (pt[it.name] || 0) + it.count;
      Fe("craft no recipe", { name: e, attempt: r, inv: pt, table: !!t });
      const lg =
        r === 0 &&
        n.inventory
          .items()
          .find((it) => /_log$/.test(it.name) && !/stripped/.test(it.name));
      if (lg && e !== lg.name.replace(/_log$/, "_planks")) {
        const pid = In(lg.name.replace(/_log$/, "_planks")),
          pr = pid === null ? [] : n.recipesFor(pid, null, 1, null);
        if (pr.length) {
          try {
            await B.withTimeout(n.craft(pr[0], 1, null), 8e3, "craft planks");
          } catch {}
          await B.sleep(300);
          i = n.recipesFor(o, null, 1, t || null);
        }
      }
      if (!i.length) break;
    }
    try {
      const before = se(e);
      (await B.withTimeout(n.craft(i[0], 1, t || null), 8e3, `craft ${e}`),
        s++);
      if (se(e) <= before) {
        await B.sleep(250);
        if (se(e) <= before)
          Fe("craft no item", {
            name: e,
            attempt: r,
            cursor: n.inventory.selectedItem && n.inventory.selectedItem.name,
            win: n.currentWindow && n.currentWindow.type,
          });
      }
    } catch (l) {
      Fe("craft failed", {
        name: e,
        attempt: r,
        err: String(l).slice(0, 160),
        cursor: n.inventory.selectedItem && n.inventory.selectedItem.name,
        grid: [1, 2, 3, 4].map(
          (u) => n.inventory.slots[u] && n.inventory.slots[u].name,
        ),
      });
    }
  }
  return s > 0;
}
async function Nn(e) {
  if (O.composter && oe(O.composter) && oe(O.composter).name === "composter")
    return !0;
  if (!se("composter")) {
    if (
      (se("birch_planks") < 10 &&
        se("birch_log") >= 3 &&
        (await ot("birch_planks", 3)),
      !se("crafting_table") &&
        se("birch_planks") >= 4 &&
        (await ot("crafting_table", 1)),
      !se("crafting_table"))
    )
      return !1;
    let t = await Qt(e, "crafting_table");
    if (!t) return !1;
    let n = oe(t);
    (se("birch_slab") < 7 && (await ot("birch_slab", 2, n)),
      await ot("composter", 1, n),
      await B.dig(oe(t), { tool: "stone_axe" }),
      await B.collectItems(t, 4, new Set(["crafting_table"]), 3e3));
  }
  if (!se("composter")) return !1;
  let a = await Qt(e, "composter");
  return a ? ((O.composter = a), Fe("composter ready", { at: a }), !0) : !1;
}

function xeNearShaft(m) {
  try {
    let ns = B.S.noStep;
    if (!ns || !ns.size || !m) return !1;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        if (ns.has(`${m.x + dx},${m.z + dz}`)) return !0;
  } catch {}
  return !1;
}
async function Qt(e, a) {
  let t = (o) =>
      !!o &&
      !Ze(o) &&
      o.boundingBox === "empty" &&
      /^(snow|short_grass|tall_grass|fern|large_fern|short_dry_grass|tall_dry_grass|bush|dead_bush|leaf_litter|dandelion|poppy|blue_orchid|allium|azure_bluet|red_tulip|orange_tulip|white_tulip|pink_tulip|oxeye_daisy|cornflower|lily_of_the_valley|sunflower|lilac|rose_bush|peony|pink_petals|wildflowers|firefly_bush)$/.test(
        o.name,
      ),
    n = (o, s, r) => {
      let i = [];
      for (let l = -s; l <= s; l++)
        for (let u = -s; u <= s; u++)
          for (let d of [-1, 0, -2, 1, -3]) {
            let m = o.offset(l, d, u),
              p = oe(m),
              h = oe(m.offset(0, 1, 0)),
              b = oe(m.offset(0, 2, 0));
            if (
              !(
                !p ||
                p.boundingBox !== "block" ||
                /farmland|soul_sand|podzol|jungle_log|barrel|leaves|composter|crafting|cactus|furnace/.test(
                  p.name,
                )
              ) &&
              !(!(Ze(h) || (r && t(h))) || !(Ze(b) || (r && t(b)))) &&
              !B.protectedCols.has(`${m.x},${m.z}`) &&
              !xeNearShaft(m)
            ) {
              i.push(m);
              break;
            }
          }
      return i;
    };
  for (let o of [!1, !0])
    for (let s = 0; s < 2; s++) {
      let r = B.feet(),
        i = n(r, 3, o)
          .filter((u) => !(u.x === r.x && u.z === r.z))
          .sort((u, d) => u.distanceTo(e) - d.distanceTo(e));
      for (let u of i.slice(0, 8))
        if (!(B.reachOf(u) > 4.2 || B.occupies(u.offset(0, 1, 0)))) {
          for (let d of [2, 1]) {
            let m = oe(u.offset(0, d, 0));
            m && !Ze(m) && t(m) && (await B.dig(m, { hand: !0, maxMs: 2500 }));
          }
          if (
            Ze(oe(u.offset(0, 1, 0))) &&
            (await B.placeOn(oe(u), Mt(0, 1, 0), a, { expectName: a }))
          )
            return (
              B.protectColumn(u.x, u.z),
              o &&
                Fe("placed on cleared ground", {
                  item: a,
                  at: u.offset(0, 1, 0),
                }),
              u.offset(0, 1, 0)
            );
        }
      let l = n(e, 6, o).sort((u, d) => u.distanceTo(e) - d.distanceTo(e))[0];
      if (!l) break;
      await B.goto(new B.goals.GoalNear(l.x, l.y + 1, l.z, 2), {
        timeoutMs: 15e3,
      });
    }
  return null;
}
function qe(e = O.composter) {
  let a = e && oe(e);
  if (!a || a.name !== "composter") return -1;
  try {
    return Number(a.getProperties().level) || 0;
  } catch {
    return 0;
  }
}
async function An() {
  if (!O.composter || qe(O.composter) < 0) return !1;
  if (O.composter2 && qe(O.composter2) >= 0) return !0;
  if (O.second === "failed") return !1;
  let e = (n) => (
    (O.second = "failed"),
    Fe("second composter: no", {
      why: n,
      slabs: se("birch_slab"),
      planks: se("birch_planks"),
      logs: se("birch_log"),
      table: se("crafting_table"),
    }),
    !1
  );
  if (!se("composter")) {
    if (
      se("birch_slab") < 7 &&
      (se("birch_planks") < 3 &&
        se("birch_log") >= 1 &&
        (await ot("birch_planks", 1)),
      se("birch_planks") < 3)
    )
      return e("planks");
    let n = null,
      o = !1;
    try {
      let r = Re.bot.findBlock({
        matching: Re.bot.registry.blocksByName.crafting_table.id,
        maxDistance: 16,
      });
      r && (n = r.position);
    } catch {}
    if (
      (n &&
        B.reachOf(n) > 4.2 &&
        !(await B.approach(n, { reach: 4, range: 2, timeoutMs: 1e4 })) &&
        (n = null),
      !n)
    ) {
      if (!se("crafting_table")) return e("table");
      ((n = await Qt(O.composter.offset(0, -1, 0), "crafting_table")),
        (o = !!n));
    }
    if (!n) return e("table spot");
    let s = oe(n);
    (se("birch_slab") < 7 && (await ot("birch_slab", 1, s)),
      se("birch_slab") >= 7 && (await ot("composter", 1, s)),
      o &&
        (await B.dig(oe(n), { tool: "stone_axe" }),
        await B.collectItems(n, 4, new Set(["crafting_table"]), 3e3)));
  }
  if (!se("composter")) return e("craft");
  let a = (n) =>
      !!n &&
      n.boundingBox === "empty" &&
      !/water|lava|wheat|carrots|potatoes|beetroots|stem|sapling|wart|cocoa|cave_vines|sugar_cane|bamboo|mushroom|berry|torch/.test(
        n.name,
      ),
    t = [];
  for (let [n, o] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ])
    for (let s of [0, -1, 1]) t.push(O.composter.offset(n, s, o));
  for (let n of t) {
    let o = n.offset(0, -1, 0),
      s = oe(o);
    if (
      !s ||
      s.boundingBox !== "block" ||
      /farmland|soul_sand|podzol|jungle_log|barrel|leaves|composter|crafting|cactus|furnace/.test(
        s.name,
      ) ||
      xeNearShaft(o)
    )
      continue;
    let r = oe(n),
      i = oe(n.offset(0, 1, 0));
    if (
      !(
        !(Ze(r) || a(r)) ||
        !(Ze(i) || a(i)) ||
        B.protectedCols.has(`${o.x},${o.z}`)
      ) &&
      !(
        B.reachOf(o) > 4 &&
        !(await B.approach(o, { reach: 3.6, range: 2, timeoutMs: 8e3 }))
      ) &&
      (Ze(i) || (await B.dig(i, { hand: !0, maxMs: 2e3 })),
      Ze(oe(n)) || (await B.dig(oe(n), { hand: !0, maxMs: 2e3 })),
      B.occupies(n) && (await B.stepOff(n)),
      await B.placeOn(oe(o), Mt(0, 1, 0), "composter", {
        expectName: "composter",
      }))
    )
      return (
        B.protectColumn(n.x, n.z),
        (O.composter2 = n),
        Fe("second composter", { at: n }),
        !0
      );
  }
  return e("spot");
}
var lo = (e) =>
  typeof e == "function" ? e : (a) => (e && e.has(a) ? 1 / 0 : 0);

function xw2Low(lv, list) {
  try {
    if (lv !== 0 || !list || list.length < 2 || !O.xw2Grain || !O.xw2Grain())
      return null;
    let hi = list[0],
      lw = list[list.length - 1];
    if (!(ct[lw.name] < ct[hi.name])) return null;
    let L = (O.xw2L0 = O.xw2L0 || { n: 0, gain: 0 });
    ((L.n += 1), (L.gain = +(L.gain + ct[hi.name] - ct[lw.name]).toFixed(2)));
    L.n <= 3 && Fe("xw2 level0", { lo: lw.name, hi: hi.name, n: L.n });
    return lw;
  } catch {
    return null;
  }
}

var XYC = {
  on: !0,
  batch: 8,
  gap: 45,
  bad: 0,
  calls: 0,
  batches: 0,
  clicks: 0,
  used: 0,
  ms: 0,
  made: 0,
};
O.xyc = XYC;
async function Dn(e) {
  if (!O.composter) return 0;
  let a = lo(e);
  if (
    ((Re.step = "compost:approach"),
    !(await B.approach(O.composter, { reach: 4, timeoutMs: 2e4 })))
  )
    return (
      (O.unreachable = (O.unreachable || 0) + 1),
      Fe("composter unreachable", {
        at: O.composter,
        me: B.hasBot() ? B.feet() : null,
        n: O.unreachable,
      }),
      O.unreachable >= 2 && se("composter") === 0 && (O.composter = null),
      0
    );
  O.unreachable = 0;
  let t = [O.composter];
  (O.composter2 &&
    qe(O.composter2) >= 0 &&
    (B.reachOf(O.composter2) > 4.2 &&
      (await B.approach(O.composter2, { reach: 3.2, timeoutMs: 5e3 })),
    B.reachOf(O.composter2) <= 4.2 &&
      B.reachOf(O.composter) <= 4.2 &&
      (t = [O.composter, O.composter2])),
    (Re.step = "compost:feed"));

  let xrSnap = {},
    xrHeld = () => {
      try {
        return !y0 || (Re.bot.heldItem && Re.bot.heldItem.name === y0);
      } catch {
        return !0;
      }
    },
    y0 = null,
    xrBad = (fed) => {
      try {
        for (let nm of Object.keys(xrSnap)) {
          let now = se(nm);
          if (nm !== fed && now < xrSnap[nm])
            return { why: "other", item: nm, before: xrSnap[nm], now };
          if (nm === fed && now < a(nm))
            return {
              why: "keep",
              item: nm,
              before: xrSnap[nm],
              now,
              keep: a(nm),
            };
          xrSnap[nm] = now;
        }
      } catch {}
      return null;
    };
  try {
    for (let C of B.allItems())
      ct[C.name] && a(C.name) > 0 && (xrSnap[C.name] = se(C.name));
  } catch {}
  let n = Re.bot,
    o = se("bone_meal"),
    s = (h) => h.offset(0.5, 0.5, 0.5),
    r = async (h, b) => {
      (await n.lookAt(s(h), !0),
        await B.withTimeout(
          n.activateBlock(oe(h), Mt(0, 1, 0), Mt(0.5, 0.5, 0.5)),
          1500,
          b,
        ));
    },
    i = 0,
    l = 0,
    u = 0,
    d = 0,
    xyT0 = ve();
  XYC.calls++;
  for (let h = 0; h < 600 && !Re.stopSide && Tn() > (O.reserveMs || 6e4); h++) {
    await B.tick();
    let b = t.map((C) => qe(C));
    if (b[0] < 0) break;
    let _ = b.indexOf(8);
    if (_ >= 0) {
      try {
        await r(t[_], "compost out");
      } catch {}
      for (let C = 0; C < 6 && qe(t[_]) === 8; C++) await B.sleep(50);
      (O.made++, u++);
      continue;
    }
    if (b[d] >= 7 || b[d] < 0) {
      let C = t.findIndex((q, L) => L !== d && b[L] >= 0 && b[L] < 7);
      if (C >= 0) d = C;
      else {
        await B.sleep(100);
        continue;
      }
    }
    let k = t[d],
      xw2C = B.allItems()
        .filter(
          (C) => ct[C.name] && !O.bad.has(C.name) && se(C.name) > a(C.name),
        )
        .sort((C, q) => ct[q.name] - ct[C.name]),
      y = xw2C[0],
      xw2L = xw2Low(b[d], xw2C);
    xw2L && (y = xw2L);
    if (!y) break;
    if (B.reachOf(k) > 4.3) {
      if (++l > 2 || !(await B.approach(k, { reach: 3.6, timeoutMs: 12e3 })))
        break;
      continue;
    }
    let N = n.heldItem;
    if (!(N && N.name === y.name) && !(await B.equip(y.name))) break;
    let g = se(y.name),
      S = 0,
      xyF = XYC.on && !xw2L;
    y0 = y.name;
    try {
      await n.lookAt(s(k), !0);
      let C = Math.min(g - a(y.name), xw2L ? 1 : xyF ? XYC.batch : 4);
      for (let q = 0; q < C && !(qe(k) >= 7) && xrHeld(); q++)
        (await B.withTimeout(
          n.activateBlock(oe(k), Mt(0, 1, 0), Mt(0.5, 0.5, 0.5)),
          1500,
          "compost",
        ),
          S++,
          await B.sleep(xyF ? XYC.gap : 60));
    } catch {}
    O.used += S;
    for (let C = 0; C < 4 && se(y.name) >= g; C++) await B.sleep(50);

    if (xyF && S > 0)
      try {
        let chk = XYC.batches < 12;
        if (chk)
          for (let C = 0; C < 4 && g - se(y.name) < S && qe(k) < 7; C++)
            await B.sleep(40);
        let xu = g - se(y.name);
        ((XYC.batches += 1), (XYC.clicks += S), (XYC.used += Math.max(0, xu)));
        if (
          chk &&
          S >= 3 &&
          qe(k) >= 0 &&
          qe(k) < 7 &&
          xu < S - 1 &&
          xrHeld()
        ) {
          XYC.bad++;
          Fe("xy compost check", {
            clicks: S,
            used: xu,
            level: qe(k),
            item: y.name,
            bad: XYC.bad,
          });
          XYC.bad >= 2 &&
            ((XYC.on = !1),
            Fe("xy compost slow", { bad: XYC.bad, batches: XYC.batches }));
        }
      } catch {}
    {
      let xb = xrBad(y.name);
      if (xb) {
        ((O.xrGuard = (O.xrGuard || 0) + 1),
          Fe("xr compost guard", {
            ...xb,
            fed: y.name,
            held: n.heldItem ? n.heldItem.name : null,
            level: qe(k),
            n: O.xrGuard,
          }));
        break;
      }
    }
    if (se(y.name) >= g && qe(k) < 7 && B.reachOf(k) <= 4.3) {
      if (
        (i++,
        (O.miss[y.name] = (O.miss[y.name] || 0) + 1),
        O.miss[y.name] >= 6 &&
          (O.accepted || 0) >= 3 &&
          (O.bad.add(y.name),
          Fe("composter refuses", { item: y.name, level: qe(k) })),
        i >= 12)
      ) {
        Fe("composter not taking items", {
          level: qe(k),
          reach: +B.reachOf(k).toFixed(2),
        });
        break;
      }
    } else
      se(y.name) < g &&
        ((i = 0), (O.miss[y.name] = 0), (O.accepted = (O.accepted || 0) + 1));
  }
  for (let h of t) {
    for (let b = 0; b < 14 && qe(h) === 7; b++) await B.sleep(100);
    if (qe(h) === 8) {
      try {
        await r(h, "compost out");
      } catch {}
      (await B.sleep(150), qe(h) !== 8 && (O.made++, u++));
    }
  }
  ((XYC.ms += ve() - xyT0), (XYC.made += u));

  try {
    await xuMealPick(t, u);
  } catch (xe) {
    Fe("xu meal pick error", {
      err: String((xe && xe.stack) || xe).slice(0, 200),
    });
  }
  u && (await B.collectItems(O.composter, 4, new Set(["bone_meal"]), 3e3));
  let m = oe(B.feet());
  m &&
    m.name === "composter" &&
    (n.setControlState("jump", !0),
    n.setControlState("back", !0),
    await B.sleep(600),
    n.clearControlStates());
  let p = se("bone_meal") - o;
  return (
    p &&
      Fe("bone meal made", {
        got: p,
        total: se("bone_meal"),
        fed: O.used,
        two: t.length === 2,
      }),
    p
  );
}

async function xuMealPick(t, made) {
  if (!B.hasBot()) return 0;
  let n = Re.bot,
    P =
      O.xuPick ||
      (O.xuPick = {
        calls: 0,
        seen: 0,
        got: 0,
        inside: 0,
        top: 0,
        fail: 0,
        ms: 0,
      }),
    cs = (t || [])
      .concat([O.composter, O.composter2])
      .filter(
        (c, i, a) =>
          c && qe(c) >= 0 && a.findIndex((d) => d && d.equals(c)) === i,
      ),
    t0 = ve(),
    lim = O.xuPickMax || 9e3;
  if (!cs.length) return 0;
  let near = (q) =>
      cs.some(
        (c) =>
          Math.abs(q.x - c.x - 0.5) <= 4.5 &&
          Math.abs(q.z - c.z - 0.5) <= 4.5 &&
          q.y - c.y >= -3 &&
          q.y - c.y <= 3,
      ),
    list = () => {
      let r = [];
      for (let s of Object.values(n.entities)) {
        if (!s || s.name !== "item" || !s.position || !near(s.position))
          continue;
        let it = null;
        try {
          it = s.getDroppedItem && s.getDroppedItem();
        } catch {}
        it && it.name === "bone_meal" && r.push(s);
      }
      return r;
    },
    inBox = (s) => {
      let p = n.entity.position,
        q = s.position;
      return (
        Math.abs(p.x - q.x) < 1.4 &&
        Math.abs(p.z - q.z) < 1.4 &&
        q.y + 0.25 > p.y - 0.45 &&
        q.y < p.y + 2.25
      );
    },
    isComp = (q) => cs.some((c) => c.x === q.x && c.y === q.y && c.z === q.z),
    cells = (ip) => {
      let b = ip.floored(),
        out = [];
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++)
          for (let dy of [0, 1, -1]) {
            let q = b.offset(dx, dy, dz);
            if (isComp(q)) continue;
            let fb = oe(q),
              hb = oe(q.offset(0, 1, 0)),
              gb = oe(q.offset(0, -1, 0));
            if (!fb || !hb || !gb) continue;
            if (
              fb.boundingBox !== "empty" ||
              hb.boundingBox !== "empty" ||
              /water|lava|fire|cactus|berry|powder/.test(
                fb.name + " " + hb.name,
              )
            )
              continue;
            if (
              gb.boundingBox !== "block" ||
              /composter|farmland|water|lava|cactus|magma|campfire|leaves/.test(
                gb.name,
              )
            )
              continue;
            if (
              Math.abs(q.x + 0.5 - ip.x) > 1.3 ||
              Math.abs(q.z + 0.5 - ip.z) > 1.3
            )
              continue;
            if (!(q.y - 0.4 < ip.y + 0.25 && ip.y < q.y + 2.2)) continue;
            out.push(q);
            break;
          }
      let me = n.entity.position;
      return out.sort(
        (a, c) =>
          a.offset(0.5, 0, 0.5).distanceTo(me) -
          c.offset(0.5, 0, 0.5).distanceTo(me),
      );
    };
  if (made) for (let i = 0; i < 5 && !list().length; i++) await B.sleep(100);
  let items = list();
  if (!items.length) return 0;
  (P.calls++, (P.seen += items.length));
  let bm0 = se("bone_meal"),
    got = 0,
    ins = 0,
    top = 0,
    fail = 0;
  for (let s of items) Re.itemSkip && Re.itemSkip.delete(s.id);
  try {
    let fb = oe(B.feet()),
      gb = oe(B.feet().offset(0, -1, 0));
    gb && gb.name === "composter" && (top = 1);

    fb &&
      fb.name === "composter" &&
      (n.setControlState("jump", !0),
      n.setControlState("back", !0),
      await B.sleep(600),
      n.clearControlStates());
  } catch {}

  await B.sleep(made ? 450 : 50);
  for (let s of items) {
    if (ve() - t0 > lim || !B.hasBot()) break;
    isComp(s.position.floored()) && ins++;
    for (let k = 0; k < 2 && n.entities[s.id] && ve() - t0 < lim; k++) {
      if (inBox(s)) {
        for (let i = 0; i < 8 && n.entities[s.id]; i++) await B.sleep(100);
        if (!n.entities[s.id]) break;
      }
      let cl = cells(s.position),
        q = cl[k] || cl[0];
      if (!q) {
        await B.collectItems(s.position, 2, new Set(["bone_meal"]), 2500);
        break;
      }
      await B.goto(new B.goals.GoalBlock(q.x, q.y, q.z), {
        timeoutMs: Math.max(
          800,
          Math.min(5e3, 1500 + q.distanceTo(B.feet()) * 450, lim - (ve() - t0)),
        ),
        stuckMs: 1800,
      });
      for (let i = 0; i < 10 && n.entities[s.id]; i++) await B.sleep(100);
    }
    n.entities[s.id] ? fail++ : got++;
  }
  ((P.got += got),
    (P.inside += ins),
    (P.top += top),
    (P.fail += fail),
    (P.ms += ve() - t0));
  (P.calls <= 6 || fail || ins || top) &&
    Fe("xu meal pick", {
      seen: items.length,
      got,
      gained: se("bone_meal") - bm0,
      inside: ins,
      top,
      fail,
      made,
      ms: ve() - t0,
      n: P.calls,
    });
  return got;
}
async function jn(e, a, t = {}) {
  let n = Re.bot.registry,
    o = se("shears") > 0,
    s = (o ? Zt.concat(co) : Zt)
      .concat(t.extra || [])
      .filter(
        (u) =>
          !O.bad.has(u) && !(u === "tall_grass" && O.bad.has("short_grass")),
      ),
    r = s
      .map((u) => n.blocksByName[u] && n.blocksByName[u].id)
      .filter((u) => u !== void 0),
    i = ve() + e,
    l = 0;
  for (
    ;
    ve() < i &&
    !B.S.stopSide &&
    (B.freeSlots() < 8 && (await B.dropJunk(8)), !(B.freeSlots() < 3));
  ) {
    await B.tick();
    let u = a.y,
      d = (A) => {
        for (let R = 1; R <= 5; R++) {
          let V = oe(A.offset(0, -R, 0));
          if (!V || /water|lava/.test(V.name)) return !1;
          if (V.boundingBox === "block" && !/leaves|_log/.test(V.name))
            return !0;
        }
        return !1;
      };
    O.fails = (O.fails || []).filter((A) => A.until > ve());
    let m = (A) => {
        let R = 0;
        for (let V of O.fails)
          if (
            Math.abs(V.pos.y - A.y) <= 6 &&
            Math.abs(V.pos.x - A.x) <= 9 &&
            Math.abs(V.pos.z - A.z) <= 9 &&
            Math.hypot(V.pos.x - A.x, V.pos.z - A.z) <= 9 &&
            ++R >= 2
          )
            return !0;
        return !1;
      },
      p = (A) => {
        if (
          O.blocked.has(B.key(A)) ||
          (O.skip.get(B.key(A)) || 0) > ve() ||
          Math.abs(A.y - u) > 20 ||
          (t.near &&
            (Math.abs(A.y - u) > (t.nearY || 5) ||
              Math.hypot(A.x - a.x, A.z - a.z) >
                (t.near === !0 ? 20 : t.near))) ||
          m(A) ||
          (O.isOurs && O.isOurs(A))
        )
          return !1;
        let R = oe(A);
        if (R && /leaves|^vine$/.test(R.name)) return d(A);
        if (R && R.name !== "sugar_cane")
          for (let [V, Me] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            let Se = oe(A.offset(V, -1, Me));
            if (Se && Se.name === "water") return !1;
          }
        return !0;
      },
      h = [];
    for (let [A, R, V] of [
      [a, 32, 600],
      [a, 32, 3e3],
      [B.feet(), 48, 600],
      [B.feet(), 48, 3e3],
      [a, 64, 4e3],
    ]) {
      try {
        h = Re.bot
          .findBlocks({ matching: r, maxDistance: R, count: V, point: A })
          .filter(p);
      } catch {
        h = [];
      }
      if (h.length >= (V === 600 ? 8 : 1)) break;
    }
    if (
      (!h.length || h.every((A) => A.distanceTo(B.pos()) > 26)) &&
      O.climbTo &&
      (O.climbs || 0) < 6 &&
      i - ve() > 25e3
    ) {
      let A = O.climbTo;
      ((O.climbTo = null), (O.climbs = (O.climbs || 0) + 1));
      let R = Re.bot.pathfinder,
        V = R.thinkTimeout;
      ((R.thinkTimeout = 8e3),
        B.setMovements({
          maxDropDown: 4,
          digCost: 1.5,
          towers: !0,
          hardDig: !0,
        }));
      let Me = await B.goto(new B.goals.GoalNear(A.x, A.y, A.z, 4), {
        timeoutMs: Math.min(4e4, i - ve() - 5e3),
        stuckMs: 1e4,
      });
      (B.setMovements({}), (R.thinkTimeout = V));
      let Se = B.feet().y >= A.y - 5;
      if (
        (Fe("forage: climbed", {
          to: A,
          st: Me,
          at: B.feet(),
          up: Se,
          n: O.climbs,
        }),
        Se)
      ) {
        (O.skip.clear(), O.failed.clear(), (O.fails = []));
        continue;
      }
    }
    if (!h.length) break;
    let b = B.pos(),
      _ = (A) => {
        let R = oe(A);
        return (R && Sa[R.name]) || 0.3;
      },
      k = (A) =>
        A.distanceTo(b) +
        4 +
        2 * Math.max(0, A.y - b.y - 2) +
        1.5 * Math.max(0, u - A.y - 3);
    h.sort((A, R) => k(A) / _(A) - k(R) / _(R));
    let y = h.slice(0, o ? 24 : 12).map((A) => ({ pos: A })),
      N = 0,
      g = !1,
      S = !1,
      C = [];
    O.forage = O.forage || {
      calls: 0,
      broken: 0,
      ms: 0,
      digMs: 0,
      pickMs: 0,
      mown: 0,
    };
    let q = ve(),
      L = async (A) => {
        O.blocked.add(B.key(A));
        let R = oe(A);
        if (!R || !s.includes(R.name)) return !1;

        try {
          if (R.name === "cactus" || R.name === "sugar_cane") {
            let b = A;
            for (let k = 0; k < 4; k++) {
              let d = oe(b.offset(0, -1, 0));
              if (!d || d.name !== R.name) break;
              b = b.offset(0, -1, 0);
            }
            b.equals(A) ||
              B.reachOf(b) > 4.5 ||
              (O.isOurs && O.isOurs(b)) ||
              !oe(b) ||
              (O.blocked.add(B.key(b)),
              (R = oe(b)),
              (O.baseDigs = (O.baseDigs || 0) + 1));
          }
        } catch {}
        let V = await B.dig(R, o ? { tool: "shears" } : { hand: !0 });
        return (V && (N = 0), V);
      },
      W = (A, R) => {
        if (
          !S &&
          (/water/.test((oe(B.feet()) || {}).name || "") ||
            B.S.escapingWater ||
            B.S.drowning)
        ) {
          g = !0;
          return;
        }
        let V = B.pos();
        if (
          (R !== "noPath" && O.missAt && V.distanceTo(O.missAt) < 1.5
            ? (O.sameSpot = (O.sameSpot || 0) + 1)
            : (O.sameSpot = 0),
          (O.missAt = V.clone()),
          O.sameSpot >= 1 && !S)
        ) {
          ((g = !0), C.push([A, R]));
          return;
        }
        let Me = (O.failed.get(B.key(A.pos)) || 0) + 1,
          Se = Me >= 2 ? 1 / 0 : ve() + 15e4;
        if (((O.failN = (O.failN || 0) + 1), O.failN <= 25)) {
          let te = 0;
          for (; te < 12; te++) {
            let Ie = oe(A.pos.offset(0, -te - 1, 0));
            if (!Ie || (Ie.boundingBox === "block" && !/leaves/.test(Ie.name)))
              break;
          }
          let tt = oe(A.pos.offset(0, -te - 1, 0));
          Fe("forage miss", {
            name: (oe(A.pos) || {}).name,
            pos: A.pos,
            at: B.feet(),
            st: R,
            drop: te,
            under: tt ? tt.name : null,
            n: Me,
          });
        }
        for (let te of h)
          Math.hypot(te.x - A.pos.x, te.z - A.pos.z) > 5 ||
            Math.abs(te.y - A.pos.y) > 6 ||
            (O.skip.set(B.key(te), Se),
            O.failed.set(
              B.key(te),
              Math.max(Me, O.failed.get(B.key(te)) || 0),
            ));
        (O.skip.set(B.key(A.pos), Se),
          O.failed.set(B.key(A.pos), Me),
          O.fails.push({ pos: A.pos.clone(), until: ve() + 3e5 }));
        let Ue = B.feet();
        if (A.pos.y - Ue.y >= 6) {
          for (let te of h)
            te.y >= A.pos.y - 2 &&
              Math.hypot(te.x - A.pos.x, te.z - A.pos.z) <= 12 &&
              !((O.skip.get(B.key(te)) || 0) > Se) &&
              O.skip.set(B.key(te), Se);
          O.climbTo || (O.climbTo = A.pos.clone());
        }
        if (R === "noPath" && ++N >= 3)
          for (let te of h)
            te.distanceTo(A.pos) <= 5 &&
              !((O.skip.get(B.key(te)) || 0) > ve() + 15e4) &&
              O.skip.set(B.key(te), ve() + 15e4);
      },
      ie = (A) => {
        let R = oe(A);
        return !!R && !/leaves|vine|lichen/.test(R.name);
      },
      It = !1;
    if (ie(y[0].pos)) {
      let A = y[0].pos,
        R = h
          .filter(
            (V) => ie(V) && V.distanceTo(A) <= 12 && Math.abs(V.y - A.y) <= 3,
          )
          .slice(0, 48);
      if (R.length >= 4) {
        It = !0;
        let V = 0,
          Me = 0;
        for (
          ;
          R.length && ve() < i && !B.S.stopSide && V < 3 && Me < 60 && !g;
        ) {
          await B.tick();
          let Se = 0;
          for (let Ie = R.length - 1; Ie >= 0; Ie--) {
            if (B.reachOf(R[Ie]) > 2.4) continue;
            let at = R.splice(Ie, 1)[0];
            (await L(at)) && Se++;
          }
          if (((Me += Se), Se)) {
            V = 0;
            continue;
          }
          if (!R.length) break;
          let Ue = B.pos();
          R.sort((Ie, at) => Ie.distanceTo(Ue) - at.distanceTo(Ue));
          let te = R[0],
            tt = await B.goto(new B.goals.GoalNear(te.x, te.y, te.z, 1), {
              timeoutMs: Math.min(6e3, 1500 + te.distanceTo(Ue) * 350),
              stuckMs: 1800,
            });
          B.reachOf(te) > 2.4 && (R.shift(), V++, W({ pos: te }, tt));
        }
        ((l += Me), (O.forage.mown += Me));
      }
    }
    It ||
      (l += await B.workSet(y, (A) => L(A.pos), {
        until: () => ve() > i || N >= 3 || g,
        moveMs: 8e3,
        maxFails: 1,
        onUnreachable: W,
      }));
    let Nt = ve();
    if (((O.forage.digMs += Nt - q), g)) {
      let A = B.pos().clone();
      ((O.sameSpot = 0), (O.missAt = null));
      for (let [R, V] of [
        [3, 0],
        [-3, 0],
        [0, 3],
        [0, -3],
      ]) {
        if (B.pos().distanceTo(A) >= 1.2) break;
        await B.goto(
          new B.goals.GoalNear(
            Math.floor(A.x) + R,
            Math.floor(A.y),
            Math.floor(A.z) + V,
            1,
          ),
          {
            timeoutMs: 2200,
            stuckMs: 1100,
          },
        );
      }
      if (B.pos().distanceTo(A) >= 1.2) {
        S = !0;
        for (let [R, V] of C) W(R, V);
        ((S = !1), (O.sameSpot = 0), (O.missAt = null));
        continue;
      }
      if (
        ((O.stuckN = (O.stuckN || 0) + 1),
        Fe("forage: cannot move from here", {
          at: B.feet(),
          n: O.stuckN,
          in: (oe(B.feet()) || {}).name,
        }),
        await B.unstick(),
        B.pos().distanceTo(A) < 1.2 && (await B.escape(2)),
        B.pos().distanceTo(A) < 1.2 &&
          (B.setMovements({
            maxDropDown: 4,
            digCost: 1.5,
            towers: !0,
            hardDig: !0,
            water: !0,
          }),
          await B.goto(new B.goals.GoalNear(a.x, a.y + 1, a.z, 3), {
            timeoutMs: Math.min(25e3, Math.max(3e3, i - ve())),
            stuckMs: 8e3,
          }),
          B.setMovements({})),
        O.stuckN % 3 === 0)
      )
        break;
      continue;
    }
    (await B.collectItems(B.pos(), 8, null, It ? 3e3 : o ? 6e3 : 4e3, {
      quick: !0,
    }),
      (O.forage.pickMs += ve() - Nt));
  }
  return (
    (O.forage = O.forage || {
      calls: 0,
      broken: 0,
      ms: 0,
      digMs: 0,
      pickMs: 0,
      mown: 0,
    }),
    O.forage.calls++,
    (O.forage.broken += l),
    (O.forage.ms += e - Math.max(0, i - ve())),
    O.forage.calls % 5 === 1 &&
      Fe("forage", {
        ...O.forage,
        layers: +fo(new Set()).toFixed(1),
        shears: o,
        free: B.freeSlots(),
        baseDigs: O.baseDigs || 0,
      }),
    l
  );
}
function fo(e) {
  let a = lo(e),
    t = 0,
    n = new Set();
  for (let o of B.allItems())
    !ct[o.name] ||
      n.has(o.name) ||
      (n.add(o.name), (t += Math.max(0, se(o.name) - a(o.name)) * ct[o.name]));
  return t;
}
module.exports = {
  setupComposter: Nn,
  setupSecondComposter: An,
  compost: Dn,
  forage: jn,
  carriedCompostValue: fo,
  compostLevel: qe,
  craftOne: ot,
  placeNear: Qt,
  K: O,
  COMPOSTABLE: ct,
  SHEAR_BLOCKS: co,
  FORAGE_BLOCKS: Zt,
};
