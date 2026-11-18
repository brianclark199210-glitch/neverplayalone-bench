"use strict";

// Priority taken from the animal-mission planner: feed a known baby before
// starting another pair, and never treat an unknown-age animal as an adult.
function decide(row) {
  const babies = row.babies || 0;
  const known = row.knownAdults || 0;
  const unknown = row.unknown || 0;
  const food = row.food || 0;
  const goal = row.goal || 0;
  const done = row.done || 0;
  if (goal > 0 && done >= goal)
    return { type: "done", priority: 0, reason: "objective met" };
  if (babies > 0 && food > 0)
    return {
      type: "feed_baby",
      priority: 100,
      reason: "Accelerate a nearby baby animal",
    };
  if (known >= 2 && food >= 2)
    return {
      type: "breed",
      priority: 90,
      reason: "Breed two observed adult animals",
    };
  if (food <= 0)
    return {
      type: "blocked",
      priority: 70,
      reason: "Missing breeding food",
    };
  if (known < 2)
    return {
      type: "blocked",
      priority: 70,
      reason: `Need two adults; found ${known} known adults and ${unknown} unknown-age animals`,
    };
  return {
    type: "breed",
    priority: 90,
    reason: "Breed two observed adult animals",
  };
}

module.exports = { decide };
