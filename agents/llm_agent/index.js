"use strict";

const B = require("./src/runtime/connection");
require("./src/runtime/view").attach(B);
const AH = require("./src/husbandry/mission");
const gather = require("./src/resources/gather");
const prompt = require("./src/planning/prompt");

async function idle() {
  for (;;) await B.sleep(5e3);
}

async function main() {
  process.on("unhandledRejection", (err) =>
    B.log("unhandled rejection", { err: String((err && err.stack) || err).slice(0, 500) }),
  );
  process.on("uncaughtException", (err) =>
    B.log("uncaught exception", { err: String((err && err.stack) || err).slice(0, 500) }),
  );

  const plan = await prompt.recognize(B.ENV.PROMPT, B.ENV.TIMEOUT_SEC);
  B.log("prompt plan", {
    model: plan.model,
    milestone_s: plan.milestoneSec,
    targets: plan.targets.map((t) => ({ name: t.name, kind: t.kind, count: t.count, priority: t.priority })),
    rejected: plan.rejected,
  });
  if (plan.rejected.length) B.log("rejected keywords", { rejected: plan.rejected });

  let ok = await B.connect();
  for (let i = 0; i < 4 && !ok; i++) ok = await B.connect();
  if (!ok) return (B.log("connect failed"), idle());

  try {
    if (prompt.animalMap()) await AH.run();
    else if (plan.resources.length) await gather.run(plan.resources);
    else B.log("prompt failed", { reason: "no confirmed minecraft targets" });
  } catch (err) {
    B.log("mission failed", {
      reason: String((err && err.message) || err).slice(0, 300),
      err: String((err && err.stack) || err).slice(0, 600),
    });
  }
  B.S.finished = false;
  B.log("mission returned; holding position", { t: B.secs() });
  return idle();
}

main().catch((err) => {
  B.log("fatal", { err: String((err && err.stack) || err).slice(0, 600) });
  setInterval(() => {}, 1 << 30);
});
