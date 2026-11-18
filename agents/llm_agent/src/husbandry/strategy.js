"use strict";

// Growth and breeding choices for an animal mission.
// A baby matures in 24000 ticks. Each feeding removes about 10% of the
// remaining growth. Food is spent on babies that would miss the deadline,
// and kept for breeding when a baby will grow up on its own.

const GROW_TICKS = 24000;

function feedsToFit(remTicks, leftMs, marginMs = 3e4, tps = 1) {
  let rem = Math.max(0, remTicks | 0);
  let n = 0;
  const rate = tps > 0 ? tps : 1;
  const avail = ((leftMs - marginMs) / 50) * rate;
  while (rem > avail && n < 40) {
    const saved = Math.floor(Math.floor(rem / 20) * 0.1);
    if (saved <= 0) break;
    rem -= saved * 20;
    n++;
  }
  return rem > avail ? 99 : n;
}

function babyOutlook(remTicks, leftMs, tps = 1) {
  const rate = tps > 0 ? tps : 1;
  const naturalMs = (Math.max(0, remTicks | 0) / rate) * 50;
  const feeds = feedsToFit(remTicks, leftMs, 3e4, rate);
  let status = "natural";
  if (feeds >= 99) status = "hopeless";
  else if (feeds > 0) status = "accelerate";
  return { status, feeds, naturalMs };
}

function allocate(needs, food, breedCost) {
  const rows = (needs || [])
    .filter((row) => row && row.feeds > 0 && row.feeds < 99)
    .slice()
    .sort((a, b) => a.feeds - b.feeds);
  let pool = Math.max(0, food | 0);
  const grant = [];
  for (const row of rows) {
    if (pool < row.feeds) continue;
    grant.push({ id: row.id, n: row.feeds });
    pool -= row.feeds;
  }
  const cost = Math.max(0, breedCost | 0);
  const breed = cost > 0 && pool >= cost;
  if (breed) pool -= cost;
  if (!grant.length && !breed && (food | 0) > 0 && rows.length)
    grant.push({ id: rows[0].id, n: Math.min(food | 0, rows[0].feeds) });
  return { grant, breed, reserved: breed ? cost : 0 };
}

function planSpecies(row) {
  const tps = row.tps > 0 ? row.tps : 1;
  const left = Math.max(0, row.leftMs || 0);
  const goal = row.goal | 0;
  const done = Math.max(0, row.done | 0);
  const missing = Math.max(0, goal - done);
  const food = Math.max(0, row.food | 0);
  const adults = Math.max(0, row.adults | 0);
  const breedable = Math.max(0, row.breedable == null ? adults : row.breedable | 0);
  const babies = (row.babies || []).map((baby) =>
    babyOutlook(baby && baby.remTicks != null ? baby.remTicks : GROW_TICKS, left, tps),
  );
  const accelerate = babies.filter((baby) => baby.status === "accelerate");
  const natural = babies.filter((baby) => baby.status === "natural");
  const feedsOwed = accelerate.reduce((sum, baby) => sum + baby.feeds, 0);
  const computed = feedsToFit(GROW_TICKS, Math.max(0, left - 6e4), 3e4, tps);
  const newBabyFeeds = Number.isFinite(row.newBabyFeeds) ? row.newBabyFeeds : computed;
  const canFinishNewborn = newBabyFeeds < 99 && left > 45e3;
  const breedCost = canFinishNewborn ? 2 + Math.max(0, newBabyFeeds) : 0;

  const affordable = [];
  let pool = food;
  for (const baby of accelerate.slice().sort((a, b) => a.feeds - b.feeds)) {
    if (pool < baby.feeds) continue;
    affordable.push(baby);
    pool -= baby.feeds;
  }
  const saved = done + natural.length + affordable.length;
  const stillShort = Math.max(0, goal - saved);
  const breedLeft = Math.max(0, food - affordable.reduce((sum, baby) => sum + baby.feeds, 0));
  const canBreed =
    stillShort > 0 &&
    breedable >= 2 &&
    canFinishNewborn &&
    food >= 2 &&
    (breedLeft >= breedCost || (left > 5 * 60 * 1000 && breedLeft >= 2));

  let action = "hold";
  let reason = "waiting on animals already growing";
  if (goal > 0 && missing <= 0 && feedsOwed <= 0) {
    action = "done";
    reason = "objective met";
  } else if (affordable.length && food > 0) {
    action = "feed";
    reason = `feed ${affordable.length} ${row.species || "animals"} that miss adulthood without food; leave ${natural.length} to grow`;
  } else if (canBreed) {
    action = "breed";
    reason = `breed ${row.species || "animals"} that can still mature before the deadline`;
  } else if (stillShort > 0 && adults < 2) {
    action = "search";
    reason = `search for ${row.species || "animals"}; ${adults} adults nearby`;
  } else if (stillShort > 0 && (food < 2 || accelerate.length)) {
    action = "collect";
    reason = `collect food for ${row.species || "animals"} while time remains`;
  } else if (stillShort > 0) {
    action = "hold";
    reason = `a new ${row.species || "animal"} cannot reach adulthood in the time left`;
  }

  const securedRatio = goal ? Math.min(1, saved / goal) : 1;
  const nextBreed = canBreed ? (breedLeft >= breedCost ? 1 : 0.55) : 0;
  let chance = goal <= 0 || missing <= 0 ? 1 : 0.55 * securedRatio + 0.45 * nextBreed;
  if (action === "feed") chance += 0.12;
  chance = Math.max(0, Math.min(1, chance));

  return {
    species: row.species || null,
    action,
    reason,
    missing,
    stillShort,
    feedsOwed,
    natural: natural.length,
    accelerate: accelerate.length,
    affordable: affordable.length,
    newBabyFeeds: newBabyFeeds >= 99 ? null : newBabyFeeds,
    breedCost: breedCost || null,
    chance,
    priority: Math.round(chance * 100),
  };
}

function choose(rows) {
  const plans = (rows || []).map(planSpecies);
  const rank = { feed: 4, breed: 3, search: 2, collect: 1, hold: 0, done: -1 };
  const ranked = plans.slice().sort((a, b) => rank[b.action] - rank[a.action] || b.chance - a.chance);
  const best = ranked[0] || {
    action: "hold",
    species: null,
    reason: "nothing to do",
    chance: 0,
  };
  return {
    type: best.action,
    species: best.species,
    reason: best.reason,
    chance: best.chance,
    plans,
  };
}

module.exports = {
  GROW_TICKS,
  feedsToFit,
  babyOutlook,
  allocate,
  planSpecies,
  choose,
};
