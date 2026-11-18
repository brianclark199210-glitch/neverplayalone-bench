"use strict";

const FOOD_ITEM = {
  rabbit: "carrot",
  sheep: "wheat",
  cow: "wheat",
  pig: "carrot",
  chicken: "wheat_seeds",
};

const GROW_TICKS = 24000;
const FORCE_LEFT_MS = 8 * 60 * 1000;
const FINISH_LEFT_MS = 3 * 60 * 1000;

function feedsForNewborn(leftMs) {
  let rem = GROW_TICKS;
  let n = 0;
  const avail = Math.max(0, (leftMs - 30000) / 50);
  while (rem > avail && n < 40) {
    const saved = Math.floor(Math.floor(rem / 20) * 0.1) * 20;
    if (saved <= 0) break;
    rem -= saved;
    n++;
  }
  return rem > avail ? 40 : n;
}

function requirements(targets, leftMs = 20 * 60 * 1000) {
  const species = {};
  const growthEach = feedsForNewborn(leftMs);
  for (const [sp, goal] of Object.entries(targets || {})) {
    const g = goal | 0;
    if (g <= 0 || !FOOD_ITEM[sp]) continue;
    const breed = g * 2;
    const growth = g * growthEach;
    species[sp] = {
      goal: g,
      pairs: 1,
      adults: 2,
      food_item: FOOD_ITEM[sp],
      breed,
      growth,
      growth_each: growthEach,
      food: breed + growth,
    };
  }
  const n = Object.keys(species).length;
  return { species, pens: n ? 1 : 0 };
}

function decide(req, stock, clock) {
  const missing = [];
  const have = (stock && stock.species) || {};
  let thin = false;
  for (const [sp, row] of Object.entries((req && req.species) || {})) {
    const got = have[sp] || {};
    const adults = got.adults || 0;
    const food = got.food || 0;
    if (adults < 2) thin = true;
    if (adults < row.adults) missing.push(`${sp} adults ${adults}/${row.adults}`);
    if (food < row.food) missing.push(`${sp} ${row.food_item} ${food}/${row.food}`);
  }
  const pens = (stock && stock.pens) || 0;
  const needPens = (req && req.pens) || 1;
  if (pens < needPens) missing.push(`pens ${pens}/${needPens}`);

  const left = (clock && clock.leftMs) || 0;
  const ready = missing.length === 0;
  if (left <= FINISH_LEFT_MS)
    return { phase: "finish", ready, force: true, missing };

  // Search only while every species is still missing a breeding pair.
  // Once any pair is on hand, breed, feed, and collect on the same loop.
  const species = Object.entries((req && req.species) || {});
  const anyPair = species.some(([sp]) => ((have[sp] || {}).adults || 0) >= 2);
  if (!anyPair && missing.length)
    return { phase: "prepare", ready: false, force: false, missing };
  return {
    phase: "breed",
    ready,
    force: !ready && !thin && pens >= 1 && left <= FORCE_LEFT_MS,
    missing,
  };
}

module.exports = {
  requirements,
  decide,
  feedsForNewborn,
  FINISH_LEFT_MS,
  FOOD_ITEM,
  STOCK: FOOD_ITEM,
};
