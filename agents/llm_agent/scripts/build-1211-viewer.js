"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const loader = require("minecraft-assets/lib/loader");
const { prepareBlocksStates } = require("prismarine-viewer/viewer/lib/modelsBuilder");

const version = "1.21.11";
const assetRoot = path.join(
  path.dirname(require.resolve("minecraft-assets/package.json")),
  "minecraft-assets/data",
  version
);
const viewerPublic = path.join(
  path.dirname(require.resolve("prismarine-viewer/package.json")),
  "public"
);
const missingTexture = path.join(
  path.dirname(require.resolve("prismarine-viewer/package.json")),
  "viewer/lib/missing_texture.png"
);

function loadAssets() {
  const raw = {
    blocksTextures: require(path.join(assetRoot, "blocks_textures.json")),
    itemsTextures: require(path.join(assetRoot, "items_textures.json")),
    textureContent: require(path.join(assetRoot, "texture_content.json")),
    blocksStates: require(path.join(assetRoot, "blocks_states.json")),
    blocksModels: require(path.join(assetRoot, "blocks_models.json")),
  };
  return loader(raw, version);
}

function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

function blit(src, dst, dx, dy, size) {
  for (let y = 0; y < size; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / size));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / size));
      const si = (sy * src.width + sx) << 2;
      const di = ((dy + y) * dst.width + (dx + x)) << 2;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
}

function makeAtlas(assets) {
  const blocksDir = path.join(assets.directory, "blocks");
  const textureFiles = fs.readdirSync(blocksDir).filter((file) => file.endsWith(".png"));
  textureFiles.unshift("missing_texture.png");
  let grid = 1;
  while (grid * grid < textureFiles.length) grid <<= 1;
  const tile = 16;
  const image = new PNG({ width: grid * tile, height: grid * tile });
  const textures = {};
  textureFiles.forEach((file, index) => {
    const x = (index % grid) * tile;
    const y = Math.floor(index / grid) * tile;
    const source = file === "missing_texture.png" ? missingTexture : path.join(blocksDir, file);
    blit(readPng(source), image, x, y, tile);
    textures[file.slice(0, -4)] = {
      u: x / image.width,
      v: y / image.height,
      su: tile / image.width,
      sv: tile / image.height,
    };
  });
  return {
    image: PNG.sync.write(image),
    json: { size: tile / image.width, textures },
  };
}

const assets = loadAssets();
const atlas = makeAtlas(assets);
const states = prepareBlocksStates(assets, atlas);
fs.mkdirSync(path.join(viewerPublic, "textures"), { recursive: true });
fs.mkdirSync(path.join(viewerPublic, "blocksStates"), { recursive: true });
fs.writeFileSync(path.join(viewerPublic, "textures", `${version}.png`), atlas.image);
fs.writeFileSync(path.join(viewerPublic, "blocksStates", `${version}.json`), JSON.stringify(states));
console.log(`wrote ${version} atlas ${atlas.image.length} bytes`);
