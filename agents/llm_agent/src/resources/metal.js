"use strict";

const B = require("../runtime/connection");
const Soil = require("../agriculture/terrain");

let Food = null;
const now = () => B.now();
const bot = () => B.S.bot;
const ORES = ["iron_ore", "deepslate_iron_ore"];
const FLUID = /^(lava|water|bubble_column)$/;

function anyCount(re) {
  let n = 0;
  for (const it of B.allItems()) re.test(it.name) && (n += it.count);
  return n;
}
const cobble = () =>
  B.count("cobblestone") + B.count("cobbled_deepslate") + B.count("blackstone");
const iron = () => B.count("raw_iron") + B.count("iron_ingot");

function fluidNear(p, r = 1) {
  for (let dx = -r; dx <= r; dx++)
    for (let dy = -r; dy <= r; dy++)
      for (let dz = -r; dz <= r; dz++) {
        const b = B.blockAt(p.offset(dx, dy, dz));
        if (!b || FLUID.test(b.name)) return true;
      }
  return false;
}

async function tableHere() {
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
  if (!B.count("crafting_table")) {
    const pl = planksName();
    if (B.count(pl) < 4) await logsToPlanks(4);
    await Food.craftN("crafting_table", 1);
  }
  if (!B.count("crafting_table")) return null;
  for (let i = 0; i < 3; i++) {
    const p = await Soil.placeNear(B.feet(), "crafting_table");
    if (p) {
      await B.sleep(300);
      const b = B.blockAt(p);
      if (b && b.name === "crafting_table") return b;
    }
    const [dx, dz] = [
      [5, 0],
      [0, 5],
      [-5, 0],
    ][i];
    const f = B.feet();
    await B.goto(new B.goals.GoalNear(f.x + dx, f.y, f.z + dz, 1), {
      timeoutMs: 6e3,
      stuckMs: 2500,
    });
  }
  return null;
}

async function freshTable(tb, k) {
  B.log("ah food shears table retry", {
    k,
    tb:
      tb && tb.position
        ? { x: tb.position.x, y: tb.position.y, z: tb.position.z }
        : null,
    reach: tb && tb.position ? +B.reachOf(tb.position).toFixed(1) : null,
    at: B.feet(),
    win: bot().currentWindow ? bot().currentWindow.type : null,
  });
  try {
    if (bot().currentWindow) bot().closeWindow(bot().currentWindow);
  } catch {}
  await pickTable(tb);
  if (k >= 2) {
    const f = B.feet();
    const [dx, dz] = [
      [5, 3],
      [-4, 5],
      [3, -5],
    ][k % 3];
    await B.goto(new B.goals.GoalNear(f.x + dx, f.y, f.z + dz, 1), {
      timeoutMs: 6e3,
      stuckMs: 2500,
    });
  }
  return await tableHere();
}

async function pickTable(tb) {
  if (!tb || (B.blockAt(tb.position) || {}).name !== "crafting_table") return;
  await B.dig(B.blockAt(tb.position), { hand: true, maxMs: 6e3 });
  await B.collectItems(tb.position, 4, new Set(["crafting_table"]), 3e3);
}
function planksName() {
  const pl = B.allItems()
    .filter((i) => /_planks$/.test(i.name))
    .sort((a, b) => B.count(b.name) - B.count(a.name))[0];
  return pl ? pl.name : "oak_planks";
}
async function logsToPlanks(n) {
  for (let i = 0; i < 6 && anyCount(/_planks$/) < n; i++) {
    const log = B.allItems().find((x) => /_log$/.test(x.name));
    if (!log) break;
    await Food.craftN(
      log.name.replace(/_log$/, "_planks"),
      Math.min(B.count(log.name), Math.ceil((n - anyCount(/_planks$/)) / 4)),
    );
  }
  return anyCount(/_planks$/);
}

async function mine(names, want, until, opts = {}) {
  const t0 = now();
  const set = new Set(names);
  let fails = 0;
  while (!until() && opts.count() < want && fails < 6) {
    const me = B.pos();
    let ps = [];
    try {
      ps = Food.find(names, opts.r || 24, {
        dy: Math.max(12, opts.depth || 10),
        count: 400,
      });
    } catch {}
    ps = ps
      .filter(
        (p) =>
          !Food.isBad(p) &&
          p.y >= me.y - (opts.depth || 10) &&
          p.y <= me.y + 6 &&
          !fluidNear(p) &&
          Food.mayDig(p),
      )
      .map((p) => {
        let open = 0;
        for (const [dx, dy, dz] of [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
          [0, 0, -1],
        ]) {
          const b = B.blockAt(p.offset(dx, dy, dz));
          b && b.boundingBox !== "block" && open++;
        }
        return {
          pos: p,
          cost: p.distanceTo(me) + Math.max(0, me.y - p.y) * 1.5 - open * 3,
        };
      })
      .sort((a, b) => a.cost - b.cost)
      .slice(0, 12);
    if (!ps.length) break;
    B.setMovements({
      hardDig: true,
      towers: true,
      digCost: 1.5,
      maxDropDown: 4,
    });
    let got;
    try {
      got = await Food.work(
        ps.map((x) => ({ pos: x.pos })),
        async (t) => {
          const b = B.blockAt(t.pos);
          if (
            !b ||
            !set.has(b.name) ||
            fluidNear(t.pos) ||
            !Food.mayDig(t.pos, b)
          )
            return false;
          const ok = await B.dig(b, { tool: opts.tool, maxMs: 9e3 });
          ok || Food.markBad(t.pos);
          return ok;
        },
        () => until() || opts.count() >= want,
        4.2,
        opts.label || "mine",
        opts.label === "iron" ? 3e4 : 15e3,
      );

      await B.collectItems(B.pos(), 6, new Set(opts.items), 6e3);
    } finally {
      B.setMovements({});
    }
    got ? (fails = 0) : fails++;
  }
  B.log("ah food mine", {
    what: opts.label,
    have: opts.count(),
    want,
    ms: now() - t0,
    at: B.feet(),
  });
  return opts.count() >= want;
}

async function getShears(ctx, food, ms = 24e4) {
  Food = food;
  if (B.count("shears")) return true;
  const t0 = now(),
    end = now() + ms,
    until = () => now() > end || !B.hasBot() || B.timeLeft() < 6e4;
  const home = B.feet();
  const st = { stage: "start" };
  const fail = (why) => (
    B.log("ah food shears failed", {
      why,
      ms: now() - t0,
      inv: B.inventorySummary(),
    }),
    false
  );

  const plankNeed = 3 + 2 + 2 + 4;
  if (anyCount(/_planks$/) + 4 * anyCount(/_log$/) < plankNeed) {
    st.stage = "logs";
    await require("../agriculture/crops").getLogs(
      Math.ceil((plankNeed - anyCount(/_planks$/)) / 4),
      until,
    );
  }
  await logsToPlanks(plankNeed);
  if (anyCount(/_planks$/) < 7) return fail("no wood");
  B.count("stick") < 4 &&
    (await Food.craftN("stick", B.count("stick") < 2 ? 2 : 1));

  let tb = await tableHere();
  if (!tb) return fail("no table");

  for (
    let k = 0;
    k < 3 && tb && !B.count("wooden_pickaxe") && !B.count("stone_pickaxe");
    k++
  ) {
    if (k > 0) tb = await freshTable(tb, k);
    if (tb) await Food.craftN("wooden_pickaxe", 1, tb);
  }
  if (!B.count("wooden_pickaxe") && !B.count("stone_pickaxe"))
    return fail("no wooden pickaxe");
  await pickTable(tb);

  st.stage = "cobble";
  await mine(["stone", "cobblestone"], 11, until, {
    count: cobble,
    tool: B.count("stone_pickaxe") ? "stone_pickaxe" : "wooden_pickaxe",
    items: ["cobblestone", "cobbled_deepslate"],
    label: "cobble",
    r: 20,
    depth: 8,
  });
  if (cobble() < 3) return fail("no stone");
  tb = await tableHere();
  for (let i = 0; i < 3 && tb && !B.count("stone_pickaxe"); i++) {
    await Food.craftN("stone_pickaxe", 1, tb);
    if (!B.count("stone_pickaxe")) {
      B.log("ah food shears: stone pickaxe craft failed", {
        attempt: i,
        cobble: cobble(),
        inv: B.inventorySummary(),
      });
      tb = await freshTable(tb, i + 1);
    }
  }
  if (tb && cobble() >= 8 && !B.count("furnace"))
    await Food.craftN("furnace", 1, tb);
  await pickTable(tb);
  if (!B.count("stone_pickaxe")) return fail("no stone pickaxe");

  st.stage = "iron";
  const gear = require("./equipment");
  try {
    await gear.gatherMaterials(home, Math.max(3e4, end - now() - 4e4), 2);
  } catch (e) {
    B.log("ah food shears iron error", { err: String(e).slice(0, 160) });
  }
  if (iron() < 2) return fail("no iron");

  st.stage = "smelt";
  if (B.count("raw_iron") >= 2) {
    let ok = false;
    try {
      ok = await gear.startSmelt(home);
    } catch (e) {
      B.log("ah food shears smelt error", { err: String(e).slice(0, 160) });
    }
    if (!ok) return fail("smelt");
    const smeltAt = now();

    const late = () => !B.hasBot() || B.timeLeft() < 3e4;
    while (now() - smeltAt < 22e3 && !late()) {
      const r = await Food.sweep(
        Food.GRASS,
        () => now() - smeltAt > 21e3 || late(),
        {
          src: "grass",
          items: Food.SEEDS,
          center: home,
          radius: 16,
          legs: 2,
        },
      );
      if (r < 0) await B.sleep(1e3);
    }
  }
  let have = false;
  for (let i = 0; i < 3 && !B.count("shears") && B.timeLeft() > 3e4; i++) {
    try {
      have = await gear.finishShears();
    } catch (e) {
      B.log("ah food shears finish error", { err: String(e).slice(0, 160) });
    }
    if (B.count("shears")) break;
    if (B.count("iron_ingot") >= 2) await Food.craftN("shears", 1);
    else await B.sleep(6e3);
  }

  try {
    Food.F.placed = Food.F.placed || [];
    for (const p of Food.find(["furnace", "crafting_table"], 20, {
      point: home,
      dy: 6,
      count: 8,
    }))
      Food.F.placed.push({ x: p.x, y: p.y, z: p.z });
  } catch {}
  B.log("ah food shears", {
    ok: B.count("shears") > 0,
    ms: now() - t0,
    iron: B.count("iron_ingot"),
    raw: B.count("raw_iron"),
  });
  return B.count("shears") > 0 || have;
}

module.exports = { getShears, mine };
