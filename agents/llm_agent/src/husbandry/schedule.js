"use strict";

const FOOD_ITEM = {
  rabbit: "carrot",
  sheep: "wheat",
  cow: "wheat",
  pig: "carrot",
  chicken: "wheat_seeds",
};

const GROW_TICKS = 24000;
const BREED_MS = 2 * 60 * 1000;
const FEED_MS = 12 * 60 * 1000;
const CHECK_MS = 18 * 60 * 1000;
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
  const force = !ready && !thin && pens >= 1 && left <= FORCE_LEFT_MS;
  if (!ready && !force) {
    return {
      phase: left <= FINISH_LEFT_MS ? "finish" : "prepare",
      ready: false,
      force: false,
      missing,
    };
  }

  const since =
    !clock || clock.breedAt == null ? 0 : Math.max(0, clock.now - clock.breedAt);
  let phase = "breed";
  if (since >= BREED_MS) phase = "feed";
  if (since >= FEED_MS) phase = "check";
  if (since >= CHECK_MS || left <= FINISH_LEFT_MS) phase = "finish";
  return { phase, ready, force, missing };
}

module.exports = {
  requirements,
  decide,
  feedsForNewborn,
  FINISH_LEFT_MS,
  FOOD_ITEM,
  STOCK: FOOD_ITEM,
};
