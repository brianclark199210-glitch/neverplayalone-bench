"use strict";

module.exports = function install(bot, log) {
  if (!bot || bot.__clickFix || !bot._client || process.env.AH_CLICKFIX === "0")
    return;
  if (
    typeof bot.clickWindow !== "function" ||
    typeof bot.putAway !== "function"
  ) {
    if (!bot.__clickFixDefer)
      ((bot.__clickFixDefer = true),
        bot.once("spawn", () => install(bot, log)));
    return;
  }
  bot.__clickFix = true;
  let lastPkt = 0,
    lastWin = -1;
  bot._client.on("packet", (d, meta) => {
    if (
      (meta.name === "window_items" || meta.name === "set_slot") &&
      d &&
      d.windowId !== 0
    )
      ((lastPkt = Date.now()), (lastWin = d.windowId));
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function settle(wid, since) {
    const t0 = Date.now();
    while (Date.now() - t0 < 250 && !(lastWin === wid && lastPkt >= since))
      await sleep(8);

    const t1 = Date.now();
    while (Date.now() - t1 < 150 && Date.now() - lastPkt < 30) await sleep(8);
  }
  for (const name of ["clickWindow", "putSelectedItemRange", "putAway"]) {
    const orig = bot[name];
    bot[name] = async function (...args) {
      const w = bot.currentWindow;
      if (!w || w.id === 0 || !/crafting/.test(String(w.type)))
        return orig.apply(bot, args);
      const since = Date.now();
      const r = await orig.apply(bot, args);
      await settle(w.id, since);
      return r;
    };
  }
  try {
    log("ah clickfix on", {});
  } catch {}
};
