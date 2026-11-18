"use strict";

const Module = require("module");
const path = require("path");

const PORT = Number(process.env.NPABENCH_VIEWER_PORT || 3007);
const canvasStub = path.join(__dirname, "canvas-stub.js");
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "canvas") return canvasStub;
  return resolveFilename.call(this, request, parent, isMain, options);
};

function attach(runtime) {
  let started = false;
  runtime.S.onSpawn.push((bot) => {
    if (started || !bot || !bot.entity) return;
    started = true;
    try {
      const { mineflayer: openViewer } = require("prismarine-viewer");
      openViewer(bot, { port: PORT, firstPerson: false, viewDistance: 4 });
      runtime.emit("viewer", { port: PORT });
      runtime.log("minecraft viewer", { port: PORT });
    } catch (err) {
      started = false;
      runtime.log("minecraft viewer failed", {
        err: String((err && err.stack) || err).slice(0, 400),
      });
    }
  });
}

module.exports = { attach, PORT };
