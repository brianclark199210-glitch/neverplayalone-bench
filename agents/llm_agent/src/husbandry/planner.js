"use strict";

const Strategy = require("./strategy");

// Feed a baby only when it will miss adulthood. Breed when the remaining
// time can still produce an adult, and leave naturally growing babies alone.
function decide(row) {
  const babies = row.babyRows && row.babyRows.length
    ? row.babyRows
    : Array.from({ length: row.babies || 0 }, () => ({ remTicks: Strategy.GROW_TICKS }));
  const plan = Strategy.planSpecies({
    species: row.species,
    goal: row.goal || 0,
    done: row.done || 0,
    adults: row.knownAdults || 0,
    breedable: row.breedable,
    food: row.food || 0,
    leftMs: row.leftMs == null ? 20 * 60 * 1000 : row.leftMs,
    tps: row.tps || 1,
    newBabyFeeds: row.newBabyFeeds,
    babies,
  });
  const type = {
    feed: "feed_baby",
    breed: "breed",
    search: "search",
    collect: "blocked",
    hold: "hold",
    done: "done",
  }[plan.action] || plan.action;
  return {
    type,
    priority: plan.priority,
    reason: plan.reason,
    chance: plan.chance,
    plan,
  };
}

module.exports = { decide };
