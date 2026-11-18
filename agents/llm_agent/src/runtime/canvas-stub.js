"use strict";

function createCanvas(width, height) {
  return {
    width,
    height,
    getContext() {
      return {
        font: "",
        fillStyle: "",
        textAlign: "",
        textBaseline: "",
        fillText() {},
        measureText() {
          return { width: 10 };
        },
      };
    },
  };
}

module.exports = { createCanvas };
