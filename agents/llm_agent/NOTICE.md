# NOTICE

SN98 animal-husbandry agent (`index.js` + `lib/`). Written for the NPA-Bench `animal_husbandry` mission.
No third-party source is bundled; at runtime it uses only the sandbox's baked `mineflayer`,
`mineflayer-pathfinder`, `vec3` and `prismarine-*` modules.

World-seed and world-generation code (`lib/seedx.js`, `lib/crack48.js`, `lib/worldgen.js`) is our own. `lib/owsurface.js`
holds the 1.21.11 overworld surface biome parameter table, generated with the vanilla server's built-in data report.
