"use strict";

const B = require("../runtime/connection");

function have(target) {
  return (target.items || []).reduce((sum, name) => sum + B.count(name), 0);
}

function toolName(blockName) {
  const suffix = /_log$|_wood$/.test(blockName)
    ? "_axe"
    : /ore|stone|deepslate/.test(blockName)
      ? "_pickaxe"
      : /dirt|sand|gravel|clay|grass_block/.test(blockName)
        ? "_shovel"
        : null;
  if (!suffix) return null;
  const item = B.allItems().find((entry) => entry.name.endsWith(suffix));
  return item ? item.name : null;
}

function nearFluid(pos) {
  for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const block = B.blockAt(pos.offset(x, y, z));
    if (block && /lava|water/.test(block.name)) return true;
  }
  return false;
}

function bestBlock(names) {
  const bot = B.S.bot;
  const table = bot.registry && bot.registry.blocksByName;
  if (!table) return null;
  const ids = names.map((name) => table[name] && table[name].id).filter((id) => id != null);
  if (!ids.length) return null;
  const me = B.pos();
  const blocks = bot.findBlocks({ matching: ids, maxDistance: 96, count: 32 })
    .map((pos) => bot.blockAt(pos))
    .filter((block) => block && names.includes(block.name) && !nearFluid(block.position));
  blocks.sort((a, b) => {
    const cost = (block) => block.position.distanceTo(me) + Math.abs(block.position.y - me.y) * 1.6;
    return cost(a) - cost(b);
  });
  return blocks[0] || null;
}

function sliceMs(target, pending) {
  const remaining = Math.max(0, B.timeLeft() - 4e4);
  if (pending.length === 1) return remaining;
  const weight = (item) => 6 - Math.min(5, item.priority);
  const total = pending.reduce((sum, item) => sum + weight(item), 0) || 1;
  return Math.max(8000, Math.min(remaining * (weight(target) / total), remaining * 0.45));
}

async function search(spawn, step) {
  const radius = 16 + (step % 6) * 12;
  const angle = step * 0.9;
  const here = B.pos();
  await B.goto(new B.goals.GoalNear(
    Math.floor(spawn.x + Math.cos(angle) * radius),
    Math.floor(here.y),
    Math.floor(spawn.z + Math.sin(angle) * radius),
    2,
  ), { timeoutMs: 12e3 });
}

async function stepDown() {
  const below = B.blockAt(B.feet().offset(0, -1, 0));
  if (!below || below.boundingBox !== "block" || /lava|water|bedrock/.test(below.name)) return false;
  return B.dig(below, { tool: toolName(below.name), maxMs: 4e3 });
}

async function pursue(target, pending, spawn) {
  const end = B.now() + sliceMs(target, pending);
  let misses = 0;
  B.log("gather start", { target: target.name, count: target.count, priority: target.priority });
  while (B.now() < end && B.timeLeft() > 4e4 && have(target) < target.count) {
    const block = bestBlock(target.blocks);
    if (!block) {
      misses += 1;
      if (misses > 8) break;
      try {
        if (target.y != null && B.pos().y > target.y + 8 && (misses === 3 || misses === 6)) await stepDown();
        else await search(spawn, misses);
      } catch (e) {
        B.log("gather search failed", { target: target.name, err: String(e).slice(0, 160) });
      }
      continue;
    }
    misses = 0;
    try {
      await B.goto(new B.goals.GoalNear(block.position.x, block.position.y, block.position.z, 1), { timeoutMs: 2e4 });
      const dug = await B.dig(block, { tool: toolName(block.name), maxMs: 8e3 });
      if (!dug) B.log("gather dig failed", { target: target.name, block: block.name });
      else await B.collectItems(B.pos(), 8, new Set(target.items), 5e3);
    } catch (e) {
      B.log("gather dig failed", { target: target.name, block: block.name, err: String(e).slice(0, 160) });
    }
  }
  const got = have(target);
  if (got < target.count) B.log("gather target incomplete", { target: target.name, have: got, count: target.count });
  B.log("gather done", { target: target.name, have: got });
}

async function run(targets) {
  if (!targets || !targets.length || !B.hasBot()) return;
  const spawn = B.pos().clone();
  B.setMovements({ canDig: true, digCost: 2, maxDropDown: 4, hardDig: true, towers: true });
  try {
    for (let i = 0; i < targets.length && B.timeLeft() > 4e4; i++)
      await pursue(targets[i], targets.slice(i), spawn);
    await B.goto(new B.goals.GoalNear(spawn.x, spawn.y, spawn.z, 8), { timeoutMs: 3e4 });
    B.log("gather returned", { at: B.feet() });
  } catch (e) {
    B.log("gather failed", { err: String((e && e.stack) || e).slice(0, 240) });
  }
}

module.exports = { run };
