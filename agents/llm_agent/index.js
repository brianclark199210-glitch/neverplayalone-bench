'use strict';
// SN98 animal-husbandry agent: build and register a fenced pen near spawn, raise the starter babies
// (or lure wild adults in), breed pairs inside and raise their offspring with foraged/farmed food.
// Contract: node index.js; env NPABENCH_*; JSON event lines on stdout. Survival play only.

const { Vec3 } = require('vec3');
const log = require('./lib/log');
const { Clock } = require('./lib/clock');
const { createBot, waitForSetup, waitFor, settleView } = require('./lib/session');
const { SeedX } = require('./lib/seedx'); // x4: world seed from the herds in view + exact villages (coordinator)
const { Nav } = require('./lib/nav');
// x17c (E1e, coordinator 11-15): S3's nav wrapper s3nav.v5 (fast-fail walk for silent empty paths, panel unpin and gate
// step-off for fence/gate pins, a jumpOut that does not jump back into water). x17c - x17a +5.21 +- 2.63 (20 worlds).
require('./lib/s3nav').install(Nav, require('./lib/nav').goals);
const { Pen } = require('./lib/pen');
const { installPhysics, pairStats, guardStats, physStats, awayStats } = require("./lib/speed");
const { Herd, isBaby } = require('./lib/herd');
const { Food } = require('./lib/food');
const { Iron } = require('./lib/iron');
const { Valve } = require('./lib/valve');
const U = require('./lib/util');
// x14b (S3, coordinator 11-14): rotation-aware village start biome. The start piece's rotation is the first nextInt(4) after
// setLargeFeatureSeed(seed, cx, cz), and its houses sit in the rotated quadrant, so the biome there types the village.
// Workflow sn98-relocation-next (skeptic, 978 candidates within 700 with /locate truth): p >= 0.8 found 158 of 178 real hay
// villages, the rotation-aware check 178 of 178 (5 false either way); the type was right in 302 of 303.
const WG = require('./lib/worldgen');
const i64 = (q) => BigInt.asIntN(64, q);
const nextLong = (r) => i64((BigInt(r.next(32)) << 32n) + BigInt(r.next(32)));
function villageRot(seed, cx, cz) {
  const r = new WG.JavaRandom(seed);
  const a = nextLong(r); const b = nextLong(r);
  return new WG.JavaRandom(i64(i64(BigInt(cx) * a) ^ i64(BigInt(cz) * b) ^ BigInt(seed))).nextInt(4);
}
const ROT_Q = [[1, 1], [-1, 1], [-1, -1], [1, -1]]; // NONE, CW90, CW180, CCW90
function startBiome(sx, c) {
  const [qx, qz] = ROT_Q[villageRot(sx.seed, c.x >> 4, c.z >> 4)];
  for (const a of (qx > 0 ? [4] : [4, 8])) for (const b of (qz > 0 ? [4] : [4, 8])) {
    const bb = sx.world.biome(c.x + qx * a, c.z + qz * b);
    if (WG.VILLAGE_BIOMES.has(bb)) return bb;
  }
  return null;
}

const env = {
  host: process.env.NPABENCH_HOST || '127.0.0.1',
  port: parseInt(process.env.NPABENCH_PORT || '25565', 10),
  username: process.env.NPABENCH_AGENT_USERNAME || 'npabench_agent',
  prompt: process.env.NPABENCH_AGENT_PROMPT || '',
  timeout: parseInt(process.env.NPABENCH_TIMEOUT_SECONDS || '1200', 10),
};
const clock = new Clock(env.timeout);

// Both prompt forms: "2 raised adult sheep offspring (50 points)" (bench 7f46cd0) and "Raise 2 adult sheep offspring and
// 4 adult rabbit offspring within 20 minutes." (bench 00bf207). Without a count, plan for the maximum: extra offspring
// cost nothing, stopping at 2 of 4 caps the half at 25.
function parseTargets(prompt) {
  const out = [];
  const re = /(\d+)\s+(?:raised\s+)?adult\s+(cows?|sheep|pigs?|chickens?|rabbits?)\s+offspring/gi;
  let m;
  while ((m = re.exec(prompt))) {
    const key = m[2].toLowerCase().replace(/s$/, '');
    if (!out.some((t) => t.key === key)) out.push({ key, count: Math.max(1, Math.min(8, parseInt(m[1], 10))) });
  }
  if (!out.length) {
    for (const s of ['cow', 'sheep', 'pig', 'chicken', 'rabbit']) if (new RegExp(`\\b${s}s?\\b`, 'i').test(prompt)) out.push({ key: s, count: 4 });
  }
  return out.slice(0, 2);
}
const targets = parseTargets(env.prompt);
log.info('targets', { targets });

const state = { bot: null, readySent: false, mainStarted: false, spawn: null, pen: null, herd: null, food: null, nav: null };

function connect() {
  const bot = createBot(env);
  // x4: before the login packet (hashedSeed) and the first spawn_entity packets (yaw bytes)
  try { if (!state.seedx) state.seedx = new SeedX(bot); else state.seedx.attach(bot); } catch (e) { log.info('seedx attach error', { err: String(e).slice(0, 120) }); }
  installPhysics(bot); // Round 4 (S2) speed: sprint ~8.6 b/s on land, vanilla in water, catch-up guard (lib/speed.js)
  state.bot = bot;
  bot.once('spawn', () => {
    // x2: bot.blockAt(null) threw inside prismarine-world and killed main() (w213e/w213f: 2 of 123 games idled from ~230 s
    // and scored 0; a lost crafting table left Food.table null before the composter step). A null position now reads as no block.
    if (typeof bot.blockAt === 'function' && !bot._npaSafeBlockAt) {
      const blockAt = bot.blockAt.bind(bot);
      bot.blockAt = (p, ...rest) => (p ? blockAt(p, ...rest) : null);
      bot._npaSafeBlockAt = true;
    }
    if (!state.readySent) {
      state.readySent = true;
      log.emit('ready', { prompt: env.prompt.slice(0, 80) });
    }
    try { require('./lib/dashboard').open(bot, state, clock); } catch (e) { log.info('dashboard failed', { err: String(e).slice(0, 160) }); }
    if (!state.mainStarted) {
      state.mainStarted = true;
      try { if (state.seedx) state.seedx.start(); } catch (e) { log.info('seedx start error', { err: String(e).slice(0, 120) }); }
      // x17a (E1b): a crash in main() used to idle the bot for the rest of the game (production 11-13 x7 t0: no swing, move
      // or item change from ~420 s to the end, 4 unfed starters, 0 points); recover() keeps it working
      main().catch(async (err) => { log.error('main crashed', err); try { await recover(); } catch (e) { log.error('recover crashed', e); } }).finally(() => idle());
      if (process.env.NPADEV_DROP_AT) setTimeout(() => { log.info('TEST-ONLY drop'); try { state.bot._client.end('test'); } catch (_) { /* fine */ } }, Number(process.env.NPADEV_DROP_AT) * 1000);
    } else {
      // reconnected: rebind the modules to the new bot object
      rebind(bot);
    }
  });
  bot.on('time', () => clock.sampleWorldAge(bot.time && bot.time.age));
  bot.on('forcedMove', () => { state.forced = (state.forced || 0) + 1; });
  // x12g (R): the death message (vanilla sends death_combat_event before the zero-health update)
  // (x14c: the translate key first - it sits past char 300 of the NBT text on every death)
  try { bot._client.on('death_combat_event', (p) => { try { const m = p && p.message; const v = m && m.value; const tr = v && v.translate && v.translate.value; state.deathMsg = (tr ? tr + ' ' : '') + JSON.stringify(m).slice(0, 200); } catch (_) { /* skip */ } }); } catch (_) { /* no client */ }
  if (process.env.NPADEV_DEBUG) {
    let n = 0;
    bot._client.on('position', (p) => { if (n++ < 6 || n % 40 === 0) log.info('dbg position packet', { n, p: JSON.stringify(p).slice(0, 300) }); });
  }
  bot.on('death', () => {
    // The husbandry bench keeps no death counter, so the monitor sees each respawn as an impossible move and two of
    // them zero the game (w28 s100: 66.7 -> 0 after two falls in the iron shaft). After one: no more mining.
    state.deaths = (state.deaths || 0) + 1;
    let where = null;
    try {
      const q = bot.entity.position.floored();
      const nm = (b) => (b ? b.name : null);
      where = { at: [q.x, q.y, q.z], lava: !!bot.entity.isInLava, feet: nm(bot.blockAt(q)), head: nm(bot.blockAt(q.offset(0, 1, 0))), below: nm(bot.blockAt(q.offset(0, -1, 0))) };
    } catch (_) { /* no position */ }
    log.info('died', { n: state.deaths, water: !!(bot.entity && bot.entity.isInWater), air: bot.oxygenLevel, msg: state.deathMsg || null, where });
    state.deathMsg = null;
    if (state.food && state.food.iron) state.food.iron.noMining = true;
    // drowned (w41 s170: twice in the same pond by the field): water costs 40 from now on and the field leaves the shore
    if (state.nav && bot.entity && (bot.entity.isInWater || bot.oxygenLevel === 0)) state.nav.waterAlarm(bot.entity.position.floored(), 'drowned');
    try { bot.respawn(); } catch (_) { /* auto */ }
  });
  bot.on('kicked', (reason) => log.error('kicked', String(reason)));
  bot.on('error', (err) => log.error('bot error', err));
  bot.on('end', () => {
    log.info('disconnected; reconnecting');
    if (clock.remaining() > 3) setTimeout(connect, 1500);
  });
}

function rebind(bot) {
  if (state.pen) state.pen.bind(bot);
  if (state.herd) state.herd.bind(bot);
  for (const k of ['food']) if (state[k]) state[k].bot = bot;
  if (state.food && state.food.iron) state.food.iron.bot = bot;
  if (state.nav) {
    const nav = new Nav(bot);
    if (state.pen) nav.setPen(state.pen);
    for (const k of ['pen', 'herd', 'food']) if (state[k]) state[k].nav = nav;
    if (state.food && state.food.iron) state.food.iron.nav = nav;
    state.nav = nav;
  }
}

async function lootChest(bot, spawn) {
  const chestPos = new Vec3(spawn.x + 2, spawn.y, spawn.z);
  const t0 = Date.now();
  // the server ignores block clicks for a few seconds after the setup teleport
  const since = Date.now() - (state.setupAt || 0);
  if (since < 3200) await U.sleep(3200 - since);
  let passes = 0;
  let openFails = 0;
  while (Date.now() - t0 < 40000) {
    const block = bot.blockAt(chestPos);
    if (!block || block.name !== 'chest') { await U.sleep(500); continue; }
    passes++;
    let win;
    try {
      win = await bot.openContainer(block);
      await U.sleep(300);
      for (const item of win.containerItems()) {
        try {
          await win.withdraw(item.type, null, item.count, item.components || null);
        } catch (_) {
          try { await bot.clickWindow(item.slot, 0, 1); } catch (__) { /* next */ }
        }
      }
    } catch (err) {
      log.error('chest open failed', err);
      openFails++;
      if (openFails === 2) {
        // a double chest will not open with a solid block over either half (5945043906266675: 6 timeouts, empty kit, 0 points)
        for (const dx of [-1, 0, 1, 2]) {
          const above = bot.blockAt(chestPos.offset(dx, 1, 0));
          const half = bot.blockAt(chestPos.offset(dx, 0, 0));
          if (!half || half.name !== 'chest' || !above || above.boundingBox !== 'block') continue;
          try { await bot.dig(above, true); log.info('kit: cleared the block over the chest', { at: above.position, name: above.name }); } catch (e) { log.info('kit: could not clear over the chest', { err: String(e).slice(0, 80) }); }
        }
      }
    } finally {
      try { if (win) win.close(); } catch (_) { /* closed */ }
    }
    const fences = U.count(bot, 'oak_fence');
    const gates = U.count(bot, 'oak_fence_gate');
    if (fences >= 120 && gates >= 1) break;
    await U.sleep(800);
  }
  log.info('kit', { passes, inv: U.counts(bot), ms: Date.now() - t0 });
}

// The site scan needs every chunk within ~60 blocks; on a busy server they arrive slowly.
// Natural spawns can sit on a treetop: path finding then has no way down (drops > 3). Dig straight down
// through leaves/logs until we stand on real ground.
async function descendIfPerched(bot) {
  const W = require('./lib/world');
  let steps = 0;
  for (let i = 0; i < 24; i++) {
    const f = bot.entity.position.floored();
    const below = bot.blockAt(f.offset(0, -1, 0));
    if (!below) break;
    const perched = /_leaves$|_log$|_wood$|mushroom_block|vine|bee_nest/.test(below.name);
    if (!perched) break;
    // landing check: the first non-air block under the one we dig must be within 3 blocks and not liquid
    let landing = null;
    for (let d = 2; d <= 6; d++) {
      const b = bot.blockAt(f.offset(0, -d, 0));
      if (b && b.boundingBox === 'block') { landing = { d, b }; break; }
      if (b && /water|lava/.test(b.name)) { landing = { d, b, liquid: true }; break; }
    }
    if (!landing || landing.liquid || landing.d > 4) break;
    // never dig into liquid or a long fall without a landing
    try {
      await U.equipNeutral(bot);
      const axe = bot.inventory.items().find((it) => /_axe$/.test(it.name));
      if (axe && /_log$|_wood$/.test(below.name)) await bot.equip(axe, 'hand');
      await bot.dig(below, true);
    } catch (_) { break; }
    for (let w = 0; w < 20 && bot.entity.position.floored().y >= f.y; w++) await U.sleep(50);
    steps++;
  }
  if (steps) log.info('descended from perch', { steps, at: bot.entity.position.floored() });
  return steps;
}

async function waitChunks(bot, spawn, radius = 60, maxMs = 15000) {
  const t0 = Date.now();
  let frac = 0;
  await waitFor(() => {
    let n = 0;
    let ok = 0;
    for (let dx = -radius; dx <= radius; dx += 16) {
      for (let dz = -radius; dz <= radius; dz += 16) {
        n++;
        if (bot.blockAt(new Vec3(spawn.x + dx, spawn.y, spawn.z + dz))) ok++;
      }
    }
    frac = ok / n;
    return ok === n;
  }, maxMs, 300);
  log.info('chunks', { loaded: Math.round(frac * 100), ms: Date.now() - t0 });
}

// x17a (E1c, coordinator 11-15): main() reads the live bot and nav. A reconnect makes new ones, and main() used to keep the
// dead bot (bench: lootChest timed out after a drop at ~60 s; production 11-04 t0 / 11-06 t3 never registered after one).
function liveProxy(get) {
  return new Proxy({}, {
    get: (_, k) => { const o = get(); const v = o[k]; return typeof v === 'function' ? v.bind(o) : v; },
    set: (_, k, v) => { get()[k] = v; return true; },
    has: (_, k) => k in get(),
  });
}

async function main() {
  const bot0 = state.bot;
  const bot = liveProxy(() => state.bot);
  const spawn = await waitForSetup(bot);
  if (!spawn) {
    log.error('no supply chest found');
    return;
  }
  state.spawn = spawn;
  state.setupAt = Date.now();
  log.info('spawn', { spawn, pos: bot.entity.position });
  try { settleView(() => state.bot); } catch (_) { /* view only */ }
  state.nav = new Nav(bot0);
  const nav = liveProxy(() => state.nav);
  const pen = new Pen(bot0, state.nav, spawn);
  pen.targetSpecies = targets.map((t) => t.key);
  pen.fillHelp = async (n) => {
    if (food.logsHave() < 3 && Math.max(0, ...Object.values(food.plankTypes())) < 9) await food.getWood(4, 45000);
    if (!food.iron || !(await food.iron.ensurePick())) return;
    // snow-capped rock: no stone is exposed at pen level. A pit straight down yields ~1 cobblestone per block.
    if (U.countAny(state.bot, ['cobblestone', 'cobbled_deepslate', 'dirt']) < n) {
      await food.iron.pitForStone(n + 2, 90000);
      log.info('pen: fill from a pit', { want: n, cobble: U.countAny(state.bot, ['cobblestone', 'cobbled_deepslate']) });
    }
  };
  pen.clock = clock;
  pen.craftFn = (name, n) => food.craft(name, n, null); // x1: snowballs -> snow blocks for fill
  const herd = new Herd(bot0, state.nav, pen, targets, clock);
  // a herd map from the first seconds: target adults seen anywhere (pen build, trips, forage) are remembered for 10 min
  // and the scout walks back to them (the ah lineage logs sightings every 2 s; ours scanned only inside herd calls)
  setInterval(() => { try { herd.scan(); } catch (_) { /* entity churn */ } }, 2000);
  const food = new Food(bot0, state.nav, pen, herd, clock);
  // x17a (E1b/c): rebind() moves these to a new bot after a reconnect (state.pen/herd/food were never set before, so it
  // rebound nothing); recover() uses them after a crash; the death handler reads state.food.iron
  state.pen = pen; state.herd = herd; state.food = food;
  // x7: hay by village type, for cow tasks (x4 sv4: plains / savanna villages gave 4-10 bales each; snowy_plains 0 and 0,
  // taiga 0 - their trips brought potatoes only and the cow half stayed at 0-1)
  const HAY_W = { plains: 1, meadow: 1, sunflower_plains: 1, savanna: 1, savanna_plateau: 1, desert: 0.7, taiga: 0.35, snowy_plains: 0 };
  const hayW = (b) => (b in HAY_W ? HAY_W[b] : 0.5);
  food.skipVillage = (at) => {
    const sx = state.seedx;
    if (!sx || sx.state !== 'found' || !(targets.some((t) => t.key === 'cow') && herd.wantsMore('cow'))) return false;
    if (targets.some((t) => t.key === 'pig' || t.key === 'rabbit')) return false; // their crops still pay
    const v = sx.villagesWithin(at.x, at.z, 120)[0];
    return !!v && hayW(v.biome) === 0;
  };
  // shears pay off for every species that eats crops (wheat, carrots, potatoes)
  herd.incomeFn = (s) => food.hasIncome(s);
  herd.mealFlowFn = () => !!food.composter || U.count(bot, 'bone_meal') > 0;
  herd.seedPoorFn = () => !!food.seedPoor;
  herd.dandRichFn = () => pen.registered && food.countDandelions() >= 80;
  // a predator fenced in by the build is dealt with before the register command: the starters appear the moment the pen
  // registers (fresh seed 2022: a cat inside at 209.7 s, both rabbit starters dead at 218-219 s, the guard after the
  // registration killed it at 237.7 s - rabbit 0/3)
  // (the whole pack, not only the first: ab211a s113880804951 three foxes fenced in at 313 s, one dead by 341 s, the other two took both chicken
  // starters at 407-421 s; foxes in s981623762813 and s690860633040 the same way, 4 starters dead within 15 s of registering; a wolf in
  // s198489469029 stayed in the pen until 819 s and took 3 sheep)
  pen.beforeRegister = async () => {
    const t0 = Date.now();
    for (let n = 0; n < 6 && Date.now() - t0 < 80000 && clock.remaining() > 240; n++) {
      const th = herd.fencedPredator();
      if (!th) break;
      await food.craftWeapon();
      await herd.guard(th, { stay: true });
    }
    await herd.huntNear(45000); // foxes clear fences: deal with them before the starters appear
    if (pen.botInside()) await pen.exit();
  };
  herd.weaponFn = () => food.craftWeapon();
  food.iron = new Iron(bot, nav, pen, food, clock);
  if (!targets.some((t) => t.key !== 'chicken')) food.iron.gaveUp = true; // chickens only: no iron trip
  Object.assign(state, { pen, herd, food });
  require('./lib/s3dand').install({ herd, food, seedx: () => state.seedx }); // S3 hook: dandelion trip
  require('./lib/s3lure').installLure(herd.constructor); // S3 hook: long-lure lead

  // x12 RELOCATE (coordinator, 11-13): a cow task with no plains / savanna / meadow village within 480 blocks of spawn walks
  // to the nearest one within 1100 first and builds the pen beside it. x7 census: cow halves without village food scored
  // 1.8 of 50 (n 33), with it 37.5 (n 39); of 163 cow-task pool worlds, 75 have their nearest hay village 480-1100 out.
  // The pen need not be near spawn; its hay, farms and herds are then next to it. Over land only (no ocean biome on the line).
  let home = spawn;
  let relocated = false;
  // x12g (S1): relocation walks keep their feet at y >= 58 (or 2 below a low spawn); see Nav._walkGuard
  const yFloor = Math.min(58, spawn.y - 2);
  // x19 (coordinator 11-15): the cow relocation check is a function with two passes. Capped-server games (dX, x17d) lost
  // 62.5 / 75 points against same-world replicates that relocated: the wait below broke on "140+ columns" 3.4-3.5 s before
  // the 45 s crack attempt found the seed (57199679606879 at 91.7 s, 49210221433537 at 90.3 s), and nothing looked again.
  // Pass 1 now also waits for an attempt that is in flight or due within 6 s; pass 2 looks again after the terrain wait,
  // before the site is chosen. Both use the E3 late-seed guards.
  let cowSeedChecked = false;
  const cowRelocate = async (pass) => {
    const sx = state.seedx;
    if (targets.some((t) => t.key === 'cow') && sx) {
      // x16 (coordinator 11-15): production servers send the world slowly (round 11-13 recordings: ~35 chunks and 0-6 animals
      // by 22 s, the view takes 2-3 min; x12b never relocated on t0 there while the bench cracked at 8.5 s). Wait until the
      // crack ends, or the view is in (140+ columns after 22 s) and still no seed, at most 75 s. On fast hosts this ends
      // when the crack does (~8-18 s), as before.
      const cols = () => { try { return bot.world.getColumns().length; } catch (_) { return 999; } };
      const due = () => !!(sx.cracking || (sx.nextAt && sx.nextAt - Date.now() < 6000));
      if (pass === 1) {
        const t0w = Date.now();
        while (sx.state !== 'found' && sx.state !== 'none') {
          const el = Date.now() - t0w;
          if (el > 75000 || (el > 22000 && cols() >= 140 && !due())) break;
          await U.sleep(300);
        }
        log.info('relocate wait', { ms: Date.now() - t0w, cols: cols(), state: sx.state });
      } else {
        const t0w = Date.now();
        while (sx.state === 'running' && due() && Date.now() - t0w < 20000) await U.sleep(300);
        log.info('relocate second look', { pass, ms: Date.now() - t0w, cols: cols(), state: sx.state, left_s: Math.round(clock.remaining()) });
      }
      if (sx.state === 'found') {
        cowSeedChecked = true;
        const hayVs = sx.villagesWithin(spawn.x, spawn.z, 1100).filter((v) => hayW(v.biome) >= 1);
        const overLand = (v) => {
          const vx = v.x + 8, vz = v.z + 8;
          const n = Math.ceil(v.d / 32);
          for (let i = 1; i < n; i++) {
            const b = sx.world.biome(Math.round(spawn.x + ((vx - spawn.x) * i) / n), Math.round(spawn.z + ((vz - spawn.z) * i) / n));
            if (/ocean/.test(String(b))) return false;
          }
          return true;
        };
        // x12i (= x12d's rule): relocate from 260 out (x12b: 480). vrl12d x12d - x12b +11.57 +- 7.66 over 9 worlds with the
        // nearest hay village at 260-480; real task 11-12 t1 (chicken4 + cow3, meadow at 448): every miner scored 0
        const go = !hayVs.length || hayVs[0].d <= 260 ? null : hayVs.find((x) => overLand(x));
        // x14b (S3): a hidden hay village within 300 (p < 0.8, but its start piece's quadrant lies in a hay biome) keeps the pen
        // at home, and seedVillage trips there after registration (vrl12: x12 relocated past 1023844503953321 /
        // 2228278184732372 / 1118217871567720; x12 - x7 there +8.3 / -16.7 / -33.4)
        let hidden = [];
        try {
          hidden = (sx.villages || []).filter((c) => c.p < 0.8 && c.dist <= 300)
            .map((c) => ({ ...c, sb: startBiome(sx, c) })).filter((c) => hayW(c.sb || '') >= 1);
        } catch (e) { log.info('hidden hay error', { err: String(e).slice(0, 160) }); }
        state.hiddenHay = hidden;
        // x17b (E3 guards, workflow sn98-path-to-100): a seed that arrives after the old 22 s window only moves the pen when the
        // walk still pays: 480-1100 out (260-480 is seedVillage's R 480), not a pig task beyond 800 (11-13 t0 pig2 + cow3, 1021
        // out: relocating scored 16.7 below staying home, bench and capped server), and setup + predicted walk <= 280 s
        // (0.216 s/block dry, 0.57 river/beach/shore, 0.36 swamp; ocean = no, as RELOC_RANKING S6)
        let lateVeto = null;
        const lateSeed = Date.now() - state.setupAt > 22000;
        if (go && lateSeed) {
          const secPer = (b) => (/ocean/.test(b) ? null : /river|beach|shore/.test(b) ? 0.57 : /swamp/.test(b) ? 0.36 : 0.216);
          const vx = go.x + 8, vz = go.z + 8, D = Math.hypot(vx - spawn.x, vz - spawn.z) || 1, L = Math.max(0, D - 55);
          let pred = 0;
          const n = Math.max(1, Math.ceil(L / 8));
          for (let i = 1; i <= n && pred !== null; i++) {
            const f = (L * i) / n / D;
            const c = secPer(String(sx.world.biome(Math.round(spawn.x + (vx - spawn.x) * f), Math.round(spawn.z + (vz - spawn.z) * f))));
            pred = c === null ? null : pred + (c * L) / n;
          }
          const elapsed = (Date.now() - state.setupAt) / 1000;
          // x19: no 480 floor. 260-480 relies on seedVillage's R 480, measured from the pen centre, and the pen can sit on the
          // far side (dX 92107665422507: meadow 448 from spawn, 504 from the pen, so no trip; 0 vs replicates that relocated
          // 41.7 / 16.7). x12i measured relocating from 260 at +11.57 +- 7.66 (9 worlds).
          if (go.d > 1100) lateVeto = 'band';
          else if (targets.some((t) => t.key === 'pig') && go.d > 800) lateVeto = 'pig-far';
          else if (pred === null || elapsed + pred > 280) lateVeto = 'walk';
          log.info('relocate late', { d: go.d, pred_s: pred === null ? null : Math.round(pred), elapsed_s: Math.round(elapsed), veto: lateVeto });
        }
        const v = go && !hidden.length && !lateVeto ? go : null;
        log.info('relocate check', { hay: hayVs.slice(0, 4).map((x) => [x.d, x.biome]), go: !!v,
          hidden: hidden.slice(0, 3).map((c) => [c.x + 8, c.z + 8, c.dist, c.p, c.sb]), veto: !!(go && hidden.length), pass });
        if (v) {
          await lootChest(bot, spawn);
          relocated = true;
          const vx = v.x + 8, vz = v.z + 8;
          const d = Math.hypot(vx - spawn.x, vz - spawn.z) || 1;
          const k = Math.max(0, d - 55) / d; // stop ~55 blocks short of the centre, on the spawn side (fields, not houses)
          const goal = new Vec3(Math.round(spawn.x + (vx - spawn.x) * k), spawn.y, Math.round(spawn.z + (vz - spawn.z) * k));
          log.info('relocate', { village: [vx, vz, Math.round(d), v.biome], to: [goal.x, goal.z], left_s: Math.round(clock.remaining()) });
          // x30 (coordinator 11-17): production round 11-15 (recordings, workflow sn98-prod-timing-1115). x22 found the seed at
          // the 8 s attempt with 5-6 chunks in view, and its walk ended at once, so the pen stayed home (cow 0 on t0/t3/t4) while
          // x19 and UID 244 (seed at 17-62 s) moved and scored cows. Bench signature: walks started with <= 15 columns ended with
          // 'No path to the goal!' x5 after 3.5-12 s, 194-873 blocks short (8 of 22; with 16+ columns 3 of 83). So wait for the
          // terrain round the bot first (at most 25 s), and retry a walk that ends far from the goal after another terrain wait.
          const cols0 = cols();
          if (cols0 < 60) {
            const tw = Date.now();
            await waitChunks(bot, bot.entity.position, 64, 25000);
            log.info('relocate terrain wait', { cols0, cols: cols(), ms: Date.now() - tw });
          }
          const t0 = Date.now();
          const near = () => Math.hypot(goal.x - bot.entity.position.x, goal.z - bot.entity.position.z) <= 12;
          await nav.travel(goal, { maxMs: 200000, range: 10, tag: 'relocate', stopWhen: near, yFloor, escapeFree: 16 });
          for (let tries = 1; tries <= 2 && !near(); tries++) {
            const q = bot.entity.position;
            const left = Math.hypot(goal.x - q.x, goal.z - q.z);
            if (left < 150 || clock.remaining() < 900 || Date.now() - t0 > 120000) break;
            log.info('relocate retry', { tries, left: Math.round(left), moved: Math.round(Math.hypot(q.x - spawn.x, q.z - spawn.z)), cols: cols(), ms: Date.now() - t0 });
            await waitChunks(bot, q, 80, 20000);
            await nav.travel(goal, { maxMs: 200000, range: 10, tag: 'relocate', stopWhen: near, yFloor, escapeFree: 16 });
          }
          const p = bot.entity.position;
          home = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
          pen.spawn = home;
          // (deep: the 3 vrl12 traps ended at y 27 / 47 / 38, all 34 good walks at y >= 58; log only)
          log.info('relocate done', { at: [home.x, home.y, home.z], left: Math.round(Math.hypot(goal.x - p.x, goal.z - p.z)), ms: Date.now() - t0, left_s: Math.round(clock.remaining()),
            y: home.y, deep: home.y < 55 && spawn.y - home.y > 25 });
        }
      }
    }
  };
  try { await cowRelocate(1); } catch (e) { log.info('relocate error', { err: String(e && e.stack).slice(0, 300) }); }
  try { const r6 = await require('./lib/s3reloc').rabbit({ bot, nav, clock, targets, spawn, state, relocated, yFloor, lootChest }); if (r6) { home = r6; pen.spawn = home; relocated = true; state.s3reloc = true; } } catch (e) { log.info('S3 reloc error', { err: String(e && e.stack).slice(0, 300) }); } // S3 hook: rabbit relocation
  // x19 pass 2: no seed at pass 1 and the crack still running. The terrain wait pickSite does anyway comes first, then an
  // attempt in flight or due within 6 s (at most 20 s more), then the same check with the E3 late-seed guards.
  if (!relocated && !cowSeedChecked && targets.some((t) => t.key === 'cow') && state.seedx && state.seedx.state === 'running') {
    try {
      await waitChunks(bot, home, 60, 45000);
      await cowRelocate(2);
    } catch (e) { log.info('relocate error', { pass: 2, err: String(e && e.stack).slice(0, 300) }); }
  }
  // x19 rabbit pass 2 (coordinator 11-15): S3's rabbit relocation (+50.7 +- 7.2 a task where it fired, 6 of 40 rabbit worlds)
  // needs the seed by 22 s after setup. On the bench the seed comes at ~8 s; under the server cap (dX / ct17) at 16-100 s,
  // so in production it would rarely fire. Same second look as the cow pass 2, then S3's own rule again, with its own
  // guards (1000 s left, walk at most 110 s).
  if (!relocated && targets.some((t) => t.key === 'rabbit') && !targets.some((t) => t.key === 'cow') && state.seedx && state.seedx.state === 'running') {
    try {
      await waitChunks(bot, home, 60, 45000);
      const sx2 = state.seedx;
      const t0w = Date.now();
      while (sx2.state === 'running' && (sx2.cracking || (sx2.nextAt && sx2.nextAt - Date.now() < 6000)) && Date.now() - t0w < 20000) await U.sleep(300);
      log.info('S3 reloc second look', { ms: Date.now() - t0w, state: sx2.state, left_s: Math.round(clock.remaining()) });
      // (S3, 11-15 18:00: cap the late walk - targets within 300 blocks and 1050+ s left, so the walk ends by about 230 s)
      if (sx2.state === 'found' && clock.remaining() >= 1050) {
        const r6 = await require('./lib/s3reloc').rabbit({ bot, nav, clock, targets, spawn, state, relocated, yFloor, lootChest, rmax: 640 }); // S3 hook: v5's time budget bounds the late walk
        if (r6) { home = r6; pen.spawn = home; relocated = true; state.s3reloc = true; }
      }
    } catch (e) { log.info('S3 reloc error', { pass: 2, err: String(e && e.stack).slice(0, 300) }); }
  }
  let animals = [];
  const pickSite = async () => {
    // (x16: up to 45 s for the terrain within 60 - production loads chunks slowly; fast hosts return in 5-13 s as before)
    await waitChunks(bot, home, 60, 45000);
    animals = Object.values(bot.entities)
      .filter((e) => e && targets.some((t) => t.key === e.name) && e.metadata && e.metadata[16] !== true)
      .map((e) => ({ x: e.position.x, z: e.position.z, name: e.name }));
    pen.wantGrass = targets.some((t) => ['chicken', 'cow', 'sheep'].includes(t.key));
    pen.wantFloorGrass = targets.some((t) => t.key === 'sheep');
    pen.wantSeeds = targets.some((t) => t.key === 'chicken');
    {
      const logIds = Object.values(bot.registry.blocksByName).filter((b) => /_log$/.test(b.name) && !/stripped/.test(b.name)).map((b) => b.id);
      pen.trees = bot.findBlocks({ matching: logIds, maxDistance: 150, count: 4000, point: bot.entity.position });
    }
    // Leveling dominates the build (cost 0-25: 40-110 s; cost 70-160: 115-240 s, about 50 + 1.1 s per cost unit),
    // and walking 40 blocks further costs ~10 s: look further out for flatter ground well before it gets that bad.
    let site = await pen.chooseSite({ radius: 36, animals });
    // (chickens live on the grass around the pen: chicken half by plants within 12 blocks of the footprint, 178 runs: < 40 8.0,
    // 40-80 19.3, >= 220 41.6; 55% of the runs had a site under 80)
    if (!site || site.cost > 50 || (pen.wantGrass && site.grass < 40) || (pen.wantSeeds && site.grass < 150)) {
      // rough ground around spawn, or no grass: look further out
      const far = await pen.chooseSite({ radius: 60, animals, step: 2 });
      if (far && (!site || far.score < site.score)) site = far;
    }
    if (!site || site.cost > 90 || (pen.wantGrass && site.grass < 40) || (pen.wantSeeds && site.grass < 100)) {
      // very rough ground, or no grass near (desert/snow/stone) while chickens or sheep need it
      await waitChunks(bot, home, 112, 8000);
      const farther = await pen.chooseSite({ radius: 90, animals, step: 2 });
      if (farther && (!site || (farther.score < site.score && (farther.cost + 40 < site.cost || (pen.wantGrass && farther.grass >= 40 && site.grass < 40) || (pen.wantSeeds && farther.grass >= 150 && site.grass < 100))))) site = farther;
    }
    if (site && site.cost > 250) {
      // mountains: every site within 90 needs hundreds of digs and fills (s105: cost 559, 266 s of leveling)
      await waitChunks(bot, home, 150, 8000);
      const far = await pen.chooseSite({ radius: 130, animals, step: 3 });
      if (far && far.cost + 80 < site.cost && far.score < site.score) site = far;
    }
    // the ring around a wild pair anywhere in view (~100 blocks), not only near the spawn: its own short search around each herd
    try {
      const spots = pen.herdSpots(animals);
      for (const h of spots) {
        const near = await pen.chooseSite({ radius: 10, animals, center: { x: h.x, y: home.y, z: h.z }, step: 2 });
        if (!near || !Object.values(near.within || {}).some((n) => n >= 2)) continue;
        const walk = 0.12 * Math.hypot(h.x - home.x, h.z - home.z);
        log.info('herd site', { herd: h, cost: Math.round(near.cost), score: Math.round(near.score + walk), vs: site ? Math.round(site.score) : null, within: near.within });
        if (!site || near.score + walk < site.score) site = { ...near, score: near.score + walk };
      }
    } catch (e) { log.info('herd site failed', { err: String(e) }); }
    return site;
  };
  let site = await pickSite();
  // x19 pass 3 (review sn98-review-x19, confirmed): pass 1 stops on the column rule only when no attempt is due within 6 s, so
  // pass 2 then finds the same state and the chunks already in, and exits at once. pickSite takes 11-21 s on a capped server,
  // so a 45 / 70 s seed can land meanwhile: look once more here (at most 20 s more, only while an attempt is in flight or
  // due), with the E3 late-seed guards, and pick the site again at the new home. The bot has not moved yet (chooseSite scans).
  if (!relocated && !cowSeedChecked && targets.some((t) => t.key === 'cow') && state.seedx && ['running', 'found'].includes(state.seedx.state)) {
    try { await cowRelocate(3); } catch (e) { log.info('relocate error', { pass: 3, err: String(e && e.stack).slice(0, 300) }); }
    if (relocated) site = await pickSite();
  }
  // x12b (coordinator, 11-14): a relocation that stalled short of the village can leave the bot where every pen site needs
  // hundreds of fills (vrl12 1065327670094774: stalled 335 blocks short in a river valley, best site cost 2001 within 130,
  // the pen never registered: 0 vs x7 83.3). x7/x2 first sites near spawn, 396 games: median cost 71, p99 458, max 826.
  // Back to spawn then (the way the bot came) and pick the site there.
  if (relocated && (!site || site.cost > 600)) {
    log.info('relocate back', { cost: site ? Math.round(site.cost) : null, at: [home.x, home.y, home.z], left_s: Math.round(clock.remaining()) });
    const t0 = Date.now();
    const nearSpawn = () => Math.hypot(spawn.x - bot.entity.position.x, spawn.z - bot.entity.position.z) <= 12;
    try { await nav.travel(new Vec3(spawn.x, spawn.y, spawn.z), { maxMs: 200000, range: 10, tag: 'relocate-back', stopWhen: nearSpawn, yFloor, escapeFree: 0 }); } catch (e) { log.info('relocate back error', { err: String(e).slice(0, 200) }); }
    const p = bot.entity.position;
    home = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    pen.spawn = home;
    const back = await pickSite();
    log.info('relocate back done', { at: [home.x, home.y, home.z], left: Math.round(Math.hypot(spawn.x - p.x, spawn.z - p.z)), cost: back ? Math.round(back.cost) : null, ms: Date.now() - t0, left_s: Math.round(clock.remaining()) });
    if (back && (!site || back.cost < site.cost)) site = back;
  }
  // (x19, review verdict: not again when S3's rabbit relocation already looted the kit - the same test lootChest stops on; a
  // failed first loot still retries here)
  if (!relocated && !(U.count(bot, 'oak_fence') >= 120 && U.count(bot, 'oak_fence_gate') >= 1)) await lootChest(bot, spawn);
  await descendIfPerched(bot);
  // s1q11 v2 (S1, 11-18): a site with no fill to be had by hand, and no wood near. d1a 4705180799247201 is a terracotta badlands
  // plateau at y108: terracotta dug by hand drops nothing, 2 dirt within 36, the nearest logs 110 blocks off (every 15 s reach to
  // them timed out), so no tools and no fill; 76 fills, never registered, 0 in all 10 local games. Walk to the nearest grove first
  // (40-block legs) and pick the site there, where the soil and the wood are (q11b: registered at 348 s, 16.7; husb_x31 never).
  // v3: the logs at 110 blocks are at the edge of the loaded area and pickSite can miss them (q11e: pen.trees empty, the trigger
  // stayed off and the 'leveling stuck' fallback moved at 248 s, registered at 462 s): look for logs again here when pickSite
  // saw none, and check once more after the early-tools wood trip. (pen.build's 'leveling stuck' check stays as the last fallback.)
  const treeLogIds = Object.values(bot.registry.blocksByName).filter((b) => /_log$/.test(b.name) && !/stripped/.test(b.name)).map((b) => b.id);
  const treeLineEarly = async (tag, fresh) => {
    if (relocated || !site || site.fills <= 12 || pen._treeLineTried || pen._woodOrPick() || clock.remaining() <= 700) return false;
    // (v3.2: any tool in the bag means the wood trip got wood: its trees were in reach, so no walk)
    if (bot.inventory.items().some((i) => /_(axe|shovel|pickaxe|hoe|sword)$/.test(i.name))) return false;
    try {
      const me = bot.entity.position;
      let trees = pen.trees || [];
      if (fresh || !trees.length) {
        try { trees = bot.findBlocks({ matching: treeLogIds, maxDistance: 160, count: 4000, point: me }); } catch (_) { /* keep */ }
      }
      let dmin = Infinity;
      for (const t of trees) dmin = Math.min(dmin, Math.hypot(t.x - me.x, t.z - me.z));
      const fillHere = dmin > 48 && dmin <= 160 ? pen._fillNear(site) + pen._fillInside(site) + pen.fillCount() : null;
      log.info('pen: tree line check', { tag, trees: trees.length, d: Number.isFinite(dmin) ? Math.round(dmin) : null, fills: site.fills, fillHere });
      if (fillHere == null || fillHere >= site.fills) return false;
      const g = Pen.grove(trees, me);
      if (!g) return false;
      pen._treeLineTried = true;
      const t0 = Date.now();
      const arrived = await nav.travel(new Vec3(g.x, g.y, g.z), { maxMs: 150000, range: 12, tag: 's1-treeline-early' });
      const p = bot.entity.position;
      const left = Math.hypot(p.x - g.x, p.z - g.z);
      const movedFar = Math.hypot(p.x - home.x, p.z - home.z) > 40;
      log.info('pen: tree line early', { tag, from: { x0: site.x0, z0: site.z0, y: site.y, fills: site.fills, fillHere }, grove: [g.x, g.y, g.z], d: Math.round(dmin), arrived, left: Math.round(left), movedFar, ms: Date.now() - t0 });
      if (!(left <= 40 || movedFar)) {
        pen._treeLineFailed = true; // the walk got nowhere: the 'leveling stuck' fallback does not try it again
        return false;
      }
      // (v3.3, review: home and pen.spawn are staged, and put back when the new site is not taken)
      const was = { home, spawn: pen.spawn, trees: pen.trees };
      home = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      pen.spawn = home;
      const s2 = await pickSite();
      const fill2 = s2 ? pen._fillNear(s2) + pen._fillInside(s2) : null;
      // at the grove any site will do (its wood makes the pickaxe and the fill); stalled on the way there, only a site whose
      // fill lies around it
      const taken = !!s2 && (left <= 40 || s2.fills <= 12 || fill2 >= s2.fills);
      log.info('pen: tree line early site', { tag, site: s2 ? { x0: s2.x0, z0: s2.z0, y: s2.y, cost: Math.round(s2.cost), fills: s2.fills } : null, fill: fill2, taken, left_s: Math.round(clock.remaining()) });
      if (!taken) {
        home = was.home; pen.spawn = was.spawn; pen.trees = was.trees;
        pen._treeLineFailed = true;
        return false;
      }
      site = s2;
      return true;
    } catch (e) { log.info('tree line early error', { tag, err: String(e && e.stack).slice(0, 200) }); return false; }
  };
  await treeLineEarly('after kit', false);
  if (!site) {
    log.error('no pen site');
    return;
  }
  pen.site = site;
  pen.gate = pen.chooseGate(home);
  nav.setPen(pen);
  pen.wantGrass = targets.some((t) => ['chicken', 'cow', 'sheep'].includes(t.key));
  // (with chickens to raise, the pen comes first: their schedule is worth more than an early field)
  // (no early field any more: it took 50-130 s before the pen on wheat tasks, and a kit seed planted ~250 s earlier
  // gains about half a stage on dry farmland; bone meal does the growing)
  let early = false;
  if (process.env.NPA_EARLY_FIELD && food.plantables().length && food.treesNear() && !targets.some((t) => t.key === 'chicken')) {
    early = await food.earlyFarm(Date.now() + 90000);
  }
  // (also after an early field: s105 leveled a cost-559 mountain site, 311 digs and fills, by hand in 266 s)
  if (site.cost > 100 && !state.bot.inventory.items().some((i) => /_shovel$/.test(i.name))) {
    // heavy leveling ahead: shovel, axe and pickaxe pay for themselves
    await food.earlyTools(Date.now() + 80000);
  }
  // s1q11 v3: the wood trip found no wood it could reach: look for a grove once more, with the logs in view now
  if (await treeLineEarly('after tools', true)) {
    pen.site = site;
    pen.gate = pen.chooseGate(home);
    nav.setPen(pen);
  }
  // Wheat tasks are decided by bone meal, and shears make it ~8x faster: mine the iron before the pen so it
  // smelts while the pen goes up (lambs are adult long before the first wheat anyway).
  // (not with sheep: lambs graze to adult in ~3 min from registration and the pen first got the shears as early on
  // s114, 332 s vs 371 s, with the lambs grown 120 s sooner)
  // (not with village bales in sight: the cows' wheat comes from them)
  // (not with pigs or rabbits: their pair comes first, a pig kit raises a piglet only if born by ~325-560 s; the post-pen trip
  // below still runs. A cow half without village hay scores ~0 with or without the shears.)
  const balesSeen = () => { const v = food.scanVillage(true); return !!(v && v.hay > 0); };
  if (targets.some((t) => t.key === 'cow') && !targets.some((t) => ['chicken', 'sheep', 'pig', 'rabbit'].includes(t.key)) && !food.iron.gaveUp && !balesSeen()) {
    await food.iron.earlyTrip(Date.now() + 170000);
  }
  if (await pen.startTempt(animals, targets)) {
    await herd.preLure(pen.temptSpecies);
    // the other target's herd too, while the first waits on the site
    if (await pen.swapTempt(animals, targets)) await herd.preLure(pen.temptSpecies);
  }
  await pen.establish(Date.now() + 300000);
  await pen.endTempt();
  if (pen.registered) herd.onRegistered(pen.starters);
  if (process.env.NPADEV_FORCE_CRASH && pen.registered) throw new Error('TEST-ONLY forced crash after registration');
  if (pen.registered && !pen.valve) {
    pen.valve = new Valve(bot, nav, pen);
    if (!(await pen.valve.place(Date.now() + 25000))) pen.valve = null;
  }
  if (pen.registered) await herd.huntNear(30000);
  food.updateReserves();
  // a predator fenced in with the herd: the opening steps below run minutes without the main loop's guard (w114 dev s100:
  // a wolf inside from the build, both starter sheep dead at 266-275 s, first guard at 352 s - sheep 0/2)
  const seedVillage = async () => {
    const sx = state.seedx;
    if (!sx || !pen.registered || food.villageDone || clock.remaining() < 600) return false;
    // x7: a village the base found by itself without hay in sight, on a cow task: when the seed says it is a snowy / taiga
    // one and a hay village lies within reach, go to that one instead
    if (food.village && !food.village.seed) {
      const cowT = targets.some((t) => t.key === 'cow') && herd.wantsMore('cow');
      if (!cowT || food.village.hay > 0 || sx.state !== 'found') return false;
      const seen = sx.villagesWithin(food.village.pos.x, food.village.pos.z, 120)[0];
      // (snowy only: a taiga village had 1 bale in 1 of 3 trips, and the base finds it again anyway - sv7 813707231364 lost
      // 214 s that way)
      if (!seen || hayW(seen.biome) > 0) return false;
      log.info('seedx village: seen one has no hay', { at: [food.village.pos.x, food.village.pos.z], biome: seen.biome });
      food.village = null;
    }
    if (food.village) return false;
    if (sx.state === 'running') {
      // the crack may still be running (registration ~70-250 s): wait a little for it on cow tasks only
      if (!targets.some((t) => t.key === 'cow')) return false;
      const until = Date.now() + 8000;
      while (sx.state === 'running' && Date.now() < until) await U.sleep(500);
    }
    if (sx.state !== 'found') return false;
    const c = pen.center();
    const cow = targets.some((t) => t.key === 'cow') && herd.wantsMore('cow');
    const R = cow ? 480 : 260;
    if (!cow && !food.villageUseful()) return false;
    // cow tasks: nearest by distance over expected hay (snowy villages never); others: the nearest (farm crops)
    // x14b (S3): the hidden hay villages (rotation-aware type) too, so the trip goes there at registration (x7 found the
    // village only at 189 s in 2228278184732372 and at 500 s in 1118217871567720)
    const extra = cow ? (state.hiddenHay || []).map((h) => ({ ...h, biome: h.sb, d: Math.round(Math.hypot(h.x + 8 - c.x, h.z + 8 - c.z)) })).filter((h) => h.d <= R) : [];
    const vs = [...sx.villagesWithin(c.x, c.z, R), ...extra].filter((v) => !cow || hayW(v.biome) > 0)
      .map((v) => ({ ...v, cost: cow ? v.d / hayW(v.biome) : v.d })).filter((v) => !cow || v.cost <= R).sort((a, b) => a.cost - b.cost);
    log.info('seedx village', { cow, R, n: vs.length, best: vs[0] ? [vs[0].x + 8, vs[0].z + 8, vs[0].d, vs[0].biome] : null, left_s: Math.round(clock.remaining()) });
    if (!vs.length) return false;
    const v = vs[0];
    food.village = { pos: new Vec3(v.x + 8, c.y, v.z + 8), hay: 1, bell: true, path: false, seed: true };
    const t0 = Date.now();
    // x7: the 150 s cap included the walk: a plains trip 311 blocks out stopped scavenging with 24 loot blocks left and 36
    // wheat (sv4 103655516631); cow tasks get up to 220 s
    const tripMs = cow ? 220000 : 150000;
    const got = await food.villageTrip(Math.min(tripMs, Math.max(30000, clock.remaining() * 1000 - 300000)));
    log.info('seedx village done', { got, ms: Date.now() - t0, inv: food.foodInv(), left_s: Math.round(clock.remaining()) });
    await guardNow();
    return true;
  };
  const guardNow = async () => {
    const th = pen.registered ? herd.threat() : null;
    if (!th) return;
    state.lastGuard = Date.now();
    await food.craftWeapon();
    await herd.guard(th);
  };
  await guardNow();
  // adults fenced in by the build: breed them before anything takes the bot away (w120 round 10-31 t3: a wild pig pair
  // inside at registration, then the search over 245-456 s, the piglet at 682 s; 5 kit items raise one born by 325 s)
  const pairWaiting = () => herd.species.some((x) => herd.wantsMore(x) && herd.readyAdults(x).length >= 2 && herd.food(x) >= 2);
  if (pen.registered && pairWaiting()) await herd.service(Math.min(Date.now() + 30000, clock.deadline - 30000));
  // a pig kit of F items raises a piglet only if it is born by 1200 - 1200 * 0.9^(F-2) s (5: 325 s, 6: 413 s, 7: 491 s, 8:
  // 562 s). Pig halves over 166 runs: born in time ~30, late ~8, no birth 0, and only 34% in time; with a cow target the
  // first pig lure came at 445 s, after the search, the first wheat and the iron. So the pair comes first.
  if (pen.registered && targets.some((t) => t.key === 'pig') && herd.wantsMore('pig') && clock.remaining() > 700) {
    for (let k = 0; k < 2 && herd.members('pig').filter((r) => !r.baby).length < 2; k++) {
      let c = herd.lureCandidate('pig');
      if (!c && k === 0 && herd.scoutable('pig', true)) {
        await herd.scout('pig');
        c = herd.lureCandidate('pig');
      }
      if (!c) break;
      await herd.lure(c, Math.min(Date.now() + 120000, clock.deadline - 60000));
    }
    if (pairWaiting()) await herd.service(Math.min(Date.now() + 30000, clock.deadline - 30000));
  }
  // a village in sight first: its bales and farms beat the shears' meal by minutes (w80 round 10-30 t4: the iron trip
  // took 186 s after registration while 29 bales lay 144 blocks off, unseen until 525 s)
  if (pen.registered && targets.some((t) => t.key === 'sheep')) food.scanVillage(true);
  const villageNow = pen.registered && food.villageUseful() && !!food.scanVillage(true);
  // rabbits beside sheep / cows in a dandelion-rich world: the kits' first feed before the first wheat (an early feed takes
  // the most off; w107/w110 round 10-28 t3 rabbit2+sheep2: the first wheat took 34-113 s, the kits were first fed at
  // 461-505 s and grew up at 776-1083 s - rabbit 0-0.5/2; w102 skipped it and fed them at 247-257 s - rabbit 2/2).
  // Not with bales in sight on a cow task (the calves' hay trip comes first).
  // (a whole first dose in one go, every partner species: round 11-07 t0 sheep4+rabbit3, u158 and u170 fed 35-38 dandelions and
  // 3 carrots to the starters at registration, adult by 436 s, births 440, 770, 1075, rabbit 3/3. Ours over 235 rich-world
  // runs: both adult at a median 523 s, first birth 596 s, 1.67 births, 28.6 points. 18 feeds take a starter from 1200 to 180 s.)
  if (pen.registered && targets.some((t) => t.key === 'rabbit') &&
      !(targets.some((t) => t.key === 'cow') && villageNow && food.village && food.village.hay > 0) && food.wantDandelion && !food.noDand &&
      clock.remaining() > 700 && herd.wantsMore('rabbit') && U.count(bot, 'dandelion') < 12 && food.countDandelions() >= 30) {
    const t0 = Date.now();
    const dose = 36;
    let n = await food.forage(['dandelion'], { maxMs: 20000, radius: 40, local: true, stopWhen: () => U.count(bot, 'dandelion') >= dose });
    if (U.count(bot, 'dandelion') < dose - 8) n += await food.dandelionRun(food.countDandelions() >= 80 ? 60000 : 45000, dose);
    // x22 (workflow sn98-capped-failures, critique-checked): the starters are fed only while in entity view - sm20 107826 x19 held
    // 39 dandelions 120 blocks out at 263 s and first fed them at 536 s; 8 of 22 early doses ended with 8+ held far away
    if (U.count(bot, 'dandelion') >= 8 && bot.entity && bot.entity.position.distanceTo(pen.center()) > 40) await nav.goNear(pen.center(), 12, { timeoutMs: 30000, tag: 'dose-home' });
    if (herd.hasWork()) await herd.service(Math.min(Date.now() + 30000, clock.deadline - 30000));
    log.info('early dandelions', { n, held: U.count(bot, 'dandelion'), ms: Date.now() - t0, left_s: Math.round(clock.remaining()) });
  }
  // chicken tasks: the first chicken trip before the first wheat (its pile walk and field took 106-112 s: w114 dev s125
  // sheep2+chicken4, first chicken lure at 310 s against 116 s for w98 - chicken 1/4 against 3/4; s138 chicken3+cow4,
  // 271 s against 87 s)
  if (pen.registered && targets.some((t) => t.key === 'chicken') && targets.some((t) => t.key === 'sheep' || t.key === 'cow') &&
      herd.wantsMore('chicken') && herd.members('chicken').filter((r) => !r.baby).length < 2 && clock.remaining() > 700) {
    const c = herd.lureCandidate();
    if (c && c.species === 'chicken') await herd.lure(c, Math.min(Date.now() + 150000, clock.deadline - 60000));
  }
  // cow tasks: the village search now, before the first wheat and the lures (calves come from village hay only - cow 0 in
  // every dev game without one; the first wheat's pile walk took ~100 s for 1-3 wheat). It waited for a step with 700 s
  // left: w114 dev s138 chicken3+cow4, two chicken lures took 178 + 150 s and it never ran (w98 there: found at 159 s,
  // 81 wheat, cows bred).
  // (off since w135: found in 13% of 267 searches at 94-218 s each, and the rest of the game paid for it - first iron trip at
  // ~470 s, no shears at all in 38% of the cow games and 80% of the rabbit games; a village in view still gets its trip)
  // x4: with the world seed known (lib/seedx.js) the villages are exact, so the trip goes straight to a real one - no blind
  // ring. Cow tasks: up to 480 blocks from the pen (w213i cow half: village within 300 -> 19.5-23.1 of 50, 300-500 -> 0.0,
  // seen in 8 of 94 such games; none -> 0.0). Other tasks the base finds useful (sheep without chickens, pigs, rabbits
  // short of food): up to 260.
  await seedVillage();
  if (false && pen.registered && targets.some((t) => t.key === 'cow') && herd.wantsMore('cow') && !food.village && !food.villageExplored &&
      clock.remaining() > 700) {
    await food.exploreVillage(210000);
    if (food.village && !food.villageDone && food.villageUseful() && clock.remaining() > 330) {
      await food.villageTrip(Math.min(150000, Math.max(30000, clock.remaining() * 1000 - 300000)));
    }
    await guardNow();
  }
  // the first wheat from the clearing's compost pile before anything else (Food.firstWheat) - not with village hay in hand
  if (pen.registered && targets.some((t) => t.key === 'sheep' || t.key === 'cow') && !(villageNow && food.village && food.village.hay > 0) &&
      U.count(bot, 'wheat') + 9 * U.count(bot, 'hay_block') < 12 && clock.remaining() > 700) {
    const t0 = Date.now();
    const r = await food.firstWheat(Date.now() + 80000);
    log.info('first wheat', { ...r, ms: Date.now() - t0, left_s: Math.round(clock.remaining()) });
    // the rabbit kits' dandelions go in now, not after the lures and field rounds (an early feed takes the most off)
    if (targets.some((t) => t.key === 'rabbit') && herd.hasWork()) await herd.service(Math.min(Date.now() + 30000, clock.deadline - 30000));
  }
  await guardNow();
  // x14b (S2, coordinator 11-14): relocated cow + pig tasks: hay and farm crops first, then hand compost if the village gave
  // fewer than 12 pig items. compostFirst is skipped with a village in view, and it alone sets food.compostRich for the
  // compost runs: relocated pig tasks ran it in 1 of 12 (x7 9 of 12), 0 compost runs (x7 51), median 14 bone meal (x7 47.5);
  // the pig half was -14.6 +- 6.4 vs x7, -35.4 in the 4 villages without crops.
  let relocPig = false;
  if (relocated && !state.s3reloc && pen.registered && villageNow && targets.some((t) => t.key === 'pig') && herd.wantsMore('pig') && // S3 hook: not after a rabbit relocation
      clock.remaining() > 650) {
    const t0 = Date.now();
    let how = 'none';
    if (!food.scavenged && food.findLoot().length) {
      food.scavenged = true; how = 'scavenge';
      await food.scavenge(150000);
    } else if (!food.villageDone && food.village && food.villageUseful()) {
      food.scavenged = true; how = 'trip';
      await food.villageTrip(Math.min(150000, Math.max(30000, clock.remaining() * 1000 - 300000)));
    }
    const pf = U.count(bot, 'carrot') + U.count(bot, 'potato') + U.count(bot, 'beetroot'); // before any feeding
    relocPig = pf < 12;
    log.info('reloc pig food', { how, pf, compost: relocPig, wheat: U.count(bot, 'wheat'), ms: Date.now() - t0, left_s: Math.round(clock.remaining()) });
    if (herd.hasWork()) await herd.service(Math.min(Date.now() + 30000, clock.deadline - 30000)); // calves before compost
    await guardNow();
  }
  // Hand compost in reach: the composter, the kit in the ground and a load of compost before anything else (Food.compostFirst).
  // (S2 F1b, 11-18) with chickens to raise, the opening compost block waits: F1 made mealTask() true on chicken + pig tasks, and the
  // up-to-110 s block right after the pen pushed the first chick birth from 322 to 533 s (x17d s2cp + g14, 43 pairs) and from 464 to
  // 512 s (x22 suite), chicken -4.8 +- 2.0 a half on x31 (f1x31a/b, coordinator 02:52). It runs once from the main loop after the
  // first chick is born or at 450 s.
  const chickFirst = targets.some((t) => t.key === 'chicken') && herd.wantsMore('chicken');
  if (pen.registered && clock.remaining() > 600 && food.mealTask() && (!villageNow || relocPig) && !chickFirst) {
    const t0 = Date.now();
    const r = await food.compostFirst(Date.now() + 110000);
    log.info('compost first', { ...r, ms: Date.now() - t0, left_s: Math.round(clock.remaining()) });
    await guardNow();
  } else if (pen.registered && chickFirst && food.mealTask() && (!villageNow || relocPig)) {
    state.f1bDefer = true;
    log.info('compost first deferred', { left_s: Math.round(clock.remaining()) });
  }
  // Every species but chickens eats what bone meal grows, and shears make the meal: the trip right after the pen.
  // (it waited behind field, dandelion and herd steps: first iron at 250-500 s, shears ~550 s median in w56)
  // Not with chickens (their seed schedule, s110), nor for rabbits in dandelion-rich worlds (the starters' early feeds),
  // nor with village hay in hand (the cow search above).
  if (pen.registered && food.iron && !food.compostRich && !food.iron.done() && !food.iron.gaveUp && !food.iron.loaded && clock.remaining() > 600 &&
      U.count(bot, 'raw_iron') < 2 && !targets.some((t) => t.key === 'chicken') && !villageNow &&
      U.count(bot, 'wheat') + 9 * U.count(bot, 'hay_block') < 12) {
    let dand = 0;
    if (targets.some((t) => t.key === 'rabbit')) {
      const reg = bot.registry.blocksByName;
      try { dand = reg.dandelion ? bot.findBlocks({ matching: [reg.dandelion.id], maxDistance: 140, count: 300, point: pen.center() }).length : 0; } catch (_) { dand = 0; }
    }
    if (dand < 30) {
      const t0 = Date.now();
      let ok = await food.iron.earlyTrip(Date.now() + 150000);
      log.info('post-pen iron', { ok, dand, ms: Date.now() - t0, left_s: Math.round(clock.remaining()) });
      // (shears by 350 s: sheep half 40.6, none: 13.6; only 43 of 153 trips made it. A failed try is mostly a table or a pit
      // that found no spot: once more from the pen)
      if (!ok && !food.iron.gaveUp && !food.iron.loaded && U.count(bot, 'raw_iron') < 2 && clock.remaining() > 650 && Date.now() - t0 < 60000) {
        await state.nav.goNear(pen.center(), 16, { timeoutMs: 30000, tag: 'iron-retry' });
        ok = await food.iron.earlyTrip(Date.now() + 120000);
        log.info('post-pen iron again', { ok, left_s: Math.round(clock.remaining()) });
      }
    }
  }
  log.info('pen ready', { registered: pen.registered, left_s: Math.round(clock.remaining()), inv: U.counts(bot) });

  let lastCheck = Date.now();
  let lastLure = 0;
  let lastCensus = 0;
  while (clock.remaining() > 4) {
    try {
      const left = clock.remaining();
      if (!pen.registered) {
        await pen.establish(Date.now() + 90000);
        // x7b: two failed rounds at one site -> a new site (sv7 8732053689235983, a snowy mountain: 'floor_not_full_solid'
        // with no fill in hand, register looped once a second from 85 s to the end, score 0; x2 there resited to a site
        // with no fills and registered at 111 s)
        if (!pen.registered) {
          state.estFails = (state.estFails || 0) + 1;
          const ls = pen.lastStatus;
          const floorHoles = !!(ls && Array.isArray(ls.issues) && ls.issues.some((i) => i.code === 'floor_not_full_solid'));
          // only the stuck case: floor holes, nothing to fill them with, and the ring mostly unbuilt (fences still in the
          // bag for a new site; other failures keep their site and retry)
          if (state.estFails % 2 === 0 && pen.site && floorHoles && pen.fillCount() === 0 && U.count(state.bot, 'oak_fence') >= 70) {
            try { if (await pen.resite(60)) log.info('pen resite after failed registrations', { rounds: state.estFails }); } catch (e) { log.info('resite error', { err: String(e).slice(0, 120) }); }
          }
        }
        if (pen.registered) herd.onRegistered(pen.starters);
        // before the first lure: a village in sight is food coming (Food.hasIncome)
        if (pen.registered && food.villageUseful()) food.scanVillage(true);
        continue;
      }
      // x5: the seed can come after the opening steps (a 3-animal herd only in view at ~100-140 s); the village trip then
      if (!state.seedTripLate && state.seedx && state.seedx.state === 'found' && left > 600) {
        state.seedTripLate = true;
        if (await seedVillage()) continue;
      }
      // Validity check every ~6.5 minutes and in the final minute (785 checks in 56 games after registration
      // were all valid; each cost a walk to the gate).
      // x2: after an invalid status the next check comes in 30 s, not 400 s (x1 s7693: the gate stayed open from 748 s to the
      // end after one failed repair walk, and the game scored 0)
      const recheckMs = pen.lastStatus && pen.lastStatus.valid === false ? 30000 : 400000;
      if (Date.now() - lastCheck > recheckMs || (left < 70 && Date.now() - lastCheck > 25000)) {
        lastCheck = Date.now();
        if (pen.botInside() && !pen.lateGame()) await pen.exit();
        await pen.closeGate();
        const res = await pen.status();
        if (res && res.valid === false) await pen.repair(res, Date.now() + 40000);
        continue;
      }
      if (left < 25) {
        // final seconds: gate shut, nothing tempting in hand (animals must not press against a fence)
        await U.equipNeutral(state.bot);
        if (!pen.botInside()) await pen.closeGate();
        await U.sleep(1000);
        continue;
      }
      U.closeStray(state.bot);
      food.updateReserves();
      if (Date.now() - lastCensus > 60000) {
        lastCensus = Date.now();
        const c = pen.center();
        const wild = {};
        for (const e of Object.values(state.bot.entities)) {
          if (!e || !targets.some((t) => t.key === e.name) || pen.insidePos(e.position)) continue;
          const d = Math.round(e.position.distanceTo(c));
          const k = `${e.name}${isBaby(e) === true ? '_baby' : ''}`;
          (wild[k] = wild[k] || []).push(d);
        }
        const bp = state.bot.entity.position;
        // our own animals: where they are and their health (starters have vanished in some worlds)
        const own = [...herd.recs.values()].filter((r) => r.kind === 'starter' || r.kind === 'offspring').map((r) => {
          const e = state.bot.entities[r.id];
          const p = e ? e.position : r.pos;
          const hp = e && e.metadata ? e.metadata[9] : null;
          return [r.species.slice(0, 3), r.kind[0], r.inside ? 1 : 0, e ? 1 : 0, hp == null ? null : Math.round(hp * 10) / 10,
            p ? Math.round(p.x) : null, p ? Math.round(p.y) : null, p ? Math.round(p.z) : null];
        });
        log.info('census', { wild, herd: herd.summary(), own, inv: food.foodInv(), crops: food.cropCensus(), at: [Math.round(bp.x), Math.round(bp.y), Math.round(bp.z)], water: !!state.bot.entity.isInWater, left_s: Math.round(clock.remaining()) });
      }
      // fell into a cave / ravine and cannot path out: pillar straight up (digging the ceiling)
      const ff = state.bot.entity.position.floored();
      const wall = (dx, dz) => { const b = state.bot.blockAt(ff.offset(dx, 1, dz)); return !!b && b.boundingBox === 'block'; };
      const boxedIn = ff.y < pen.y - 1 && wall(1, 0) && wall(-1, 0) && wall(0, 1) && wall(0, -1); // e.g. an iron shaft
      // a cave has a roof; a field or shore far below the pen does not (pillaring up there wastes the game)
      let roofed = false;
      if (!boxedIn && ff.y < pen.y - 6) {
        for (let dy = 2; dy <= 14 && !roofed; dy++) {
          const b = state.bot.blockAt(ff.offset(0, dy, 0));
          if (b && b.boundingBox === 'block' && !/_leaves$|_log$|_wood$/.test(b.name)) roofed = true; // trees are no roof
        }
      }
      if (pen.site && (boxedIn || roofed) && (state.nav.lastStuckAt || Date.now() - (state.deepSince || Date.now()) > 30000)) {
        state.deepSince = state.deepSince || Date.now();
        if (Date.now() - state.deepSince > 8000 && food.iron) {
          log.info('climb out', { at: state.bot.entity.position.floored(), to: pen.y });
          await food.iron.climbTo(pen.y, true);
          state.deepSince = 0;
          continue;
        }
      } else state.deepSince = 0;
      // animals out of tracking range are invisible to the planner: come back now and then to look (rarely when
      // there is nothing to feed them: from a patch ~100 blocks out each visit costs ~50 s)
      const visitEvery = herd.species.some((s) => herd.food(s) > 0) ? 70000 : 150000;
      const sinceVisit = Date.now() - (state.lastPenVisit || 0);
      const expect = sinceVisit > 20000 && Date.now() > (state.expectBackoff || 0) && herd.expectWork();
      if (pen.site && state.bot.entity.position.distanceTo(pen.center()) > 40 && (sinceVisit > visitEvery || expect)) {
        state.lastPenVisit = Date.now();
        await U.equipNeutral(state.bot);
        await state.nav.goNear(pen.center(), 14, { timeoutMs: 30000, tag: 'pen-visit' });
        herd.scan();
        // came for a pair the planner then does not breed (not enough food by its rules): not again soon
        if (expect && !herd.hasWork()) state.expectBackoff = Date.now() + 120000;
      }
      if (pen.site && state.bot.entity.position.distanceTo(pen.center()) <= 40) state.lastPenVisit = Date.now();
      // never idle inside the pen (food work happens outside; the gate must stay shut)
      if (pen.botInside() && !pen.lateGame()) await pen.exit();
      if (pen.gateIsOpen() && !pen.botInside()) await pen.closeGate();
      // an offspring about to grow up: make sure it does so in the middle of the pen (scored bounds)
      const soon = herd.matureSoon();
      if (soon && !pen.lateGame()) {
        // x25 F3b (b): a ready pair's love before the escort (Herd.loveFirst: the offspring's R above 20 s, once per offspring);
        // the next pass comes back to the escort through matureSoon
        if (await herd.loveFirst(soon)) continue;
        await herd.escort(soon);
        continue;
      }
      // a fox / ocelot / cat / wolf at the pen kills the herd: deal with it first
      const th = Date.now() - (state.lastGuard || 0) > 8000 ? herd.threat() : null;
      if (th && !pen.lateGame()) {
        state.lastGuard = Date.now();
        await food.craftWeapon();
        await herd.guard(th);
        continue;
      }
      // (S2 F1b) the deferred opening compost block, once: after the first chick or at 450 s, with 450+ s left
      if (state.f1bDefer && clock.remaining() > 450 && (herd.members('chicken').some((r) => r.kind === 'offspring') || clock.elapsed() > 450)) {
        state.f1bDefer = false;
        if (food.mealTask()) {
          const t0 = Date.now();
          const r = await food.compostFirst(Date.now() + 90000);
          log.info('compost first', { ...r, deferred: true, ms: Date.now() - t0, left_s: Math.round(clock.remaining()) });
          continue;
        }
      }
      // food work between lure trips: ripe crops, unused meal or a full pile waited otherwise (w106 round 10-30 t1: six
      // trips over 514-939 s, three of them empty, no compost / meal / harvest in between - the first lamb at 994 s)
      if (state.afterLure && food.urgent()) {
        state.afterLure = false;
        await food.step(20000);
        continue;
      }
      // wild adults beat raising starters: fetch them first while a species still lacks a breeding pair
      // (goal 3-4 of a cheap feeder: a second pair, while there is time for it to breed twice)
      const lureNow = Date.now() - lastLure > 20000 ? herd.lureCandidate() : null;
      const adultsNow = lureNow ? herd.members(lureNow.species).filter((r) => !r.baby).length : 0;
      // a second pair only from close by while the other species waits on us (w99 round 10-30 t1: four chicken trips of
      // 60-97 s, one bird each, over 286-575 s, the adult sheep waiting for wheat until 724 s - chickens 1/4, sheep 0.5/4)
      const otherWaits = lureNow && herd.species.some((x) => x !== lureNow.species && herd.wantsMore(x));
      const nearPen = lureNow && pen.site && lureNow.target && lureNow.target.position.distanceTo(pen.center()) < 45;
      if (lureNow && (adultsNow < 2 || (adultsNow < herd.parentsWanted(lureNow.species) && clock.remaining() > 500 && (nearPen || !otherWaits)))) {
        lastLure = Date.now();
        await herd.lure(lureNow, Math.min(Date.now() + 170000, clock.deadline - 60000));
        state.afterLure = true;
        continue;
      }
      if (herd.hasWork() && Date.now() - herd.lastService > 6000) {
        await herd.service(Math.min(Date.now() + 60000, clock.deadline - 30000));
        continue;
      }
      let cand = Date.now() - lastLure > 20000 ? herd.lureCandidate() : null;
      // (the same rule for a far second pair here: food work first while another species waits)
      if (cand && herd.members(cand.species).filter((r) => !r.baby).length >= 2 && pen.site && cand.target &&
          cand.target.position.distanceTo(pen.center()) >= 45 && herd.species.some((x) => x !== cand.species && herd.wantsMore(x)) &&
          (state.farLureSkips = (state.farLureSkips || 0) + 1) % 4 !== 0) cand = null;
      if (cand) {
        lastLure = Date.now();
        await herd.lure(cand, Math.min(Date.now() + 170000, clock.deadline - 60000));
        state.afterLure = true;
        continue;
      }
      // pigs / cows / rabbits with food for a pair and no wild pair known: go and look for one
      const sc = Date.now() - (state.lastScout || 0) > 30000 ? herd.scoutWanted() : null;
      if (sc) {
        state.lastScout = Date.now();
        await herd.scout(sc);
        continue;
      }
      const st0 = Date.now();
      const pos0 = state.bot.entity.position.floored();
      const inv0 = JSON.stringify(U.counts(state.bot));
      const what = await food.step(left < 120 ? 15000 : 25000);
      // the same quick step again and again without moving or changing the inventory: it is stuck in a loop
      const idle = Date.now() - st0 < 3000 && state.bot.entity.position.floored().equals(pos0) && JSON.stringify(U.counts(state.bot)) === inv0;
      state.stall = idle && what === state.lastWhat ? (state.stall || 0) + 1 : 0;
      state.lastWhat = what;
      if (state.stall >= 8) {
        log.info('step stall', { what, at: pos0 });
        state.stall = 0;
        food.blockedUntil = food.blockedUntil || {};
        food.blockedUntil[String(what).split(':')[0]] = Date.now() + 120000;
        await food.forageForNeeds(20000);
      }
      if (what === 'forage' && clock.remaining() < 300) {
        // late game: stay near the pen
        await U.equipNeutral(state.bot);
        await state.nav.goNear(pen.center(), 14, { timeoutMs: Math.min(25000, 3000 + 300 * state.bot.entity.position.distanceTo(pen.center())), tag: 'late-home' });
        food.lateRadius = 30; // (far patches made it walk out and back 14 times in 4 games)
      }
    } catch (err) {
      log.error('loop error', err);
      await U.sleep(500);
    }
  }
  log.info('end', { summary: herd.summary(), food: food.stats, burst: herd.burstStats || null, miss: herd.missStats || null, pairs: pairStats, guard: guardStats, phys: physStats, tick: bot.tickStats || null, away: awayStats, inv: food.foodInv() });
}

// x17a (E1b): after a crash in main(): keep the pen registered, the herd serviced, wild animals lured, food coming in
async function recover() {
  const { pen, herd, food } = state;
  if (!pen || !herd || !food) return;
  log.info('recover start', { registered: !!pen.registered, left_s: Math.round(clock.remaining()) });
  let errs = 0;
  while (clock.remaining() > 5) {
    try {
      if (!pen.registered) {
        if (!pen.site) { await U.sleep(2000); continue; }
        await pen.establish(Date.now() + 90000);
        if (pen.registered) herd.onRegistered(pen.starters);
        continue;
      }
      // (the endgame: home from 120 s out, the gate shut; x17a injc 2181507855165619 bred chickens after a crash but was 228
      // blocks out at 1182 s and never shut the gate: 0 against 50)
      if (clock.remaining() < 120) {
        try {
          const c0 = pen.center();
          const me = state.bot.entity.position;
          if (Math.hypot(me.x - c0.x, me.z - c0.z) > 16) await state.nav.travel(c0, { maxMs: Math.max(5000, (clock.remaining() - 15) * 1000), range: 12, tag: 'recover-home' });
          if (!pen.botInside()) await pen.closeGate();
        } catch (_) { /* fine */ }
        if (herd.hasWork() && clock.remaining() > 40) await herd.service(Math.min(Date.now() + 20000, clock.deadline - 30000));
        await U.sleep(1000);
        continue;
      }
      if (herd.hasWork()) { await herd.service(Math.min(Date.now() + 30000, clock.deadline - 30000)); continue; }
      const c = herd.lureCandidate();
      if (c && clock.remaining() > 200) { await herd.lure(c, Math.min(Date.now() + 120000, clock.deadline - 150000)); continue; }
      if (clock.remaining() > 200) await food.step(30000);
      await U.sleep(500);
    } catch (e) {
      if (errs++ < 20) log.info('recover step error', { err: String(e && e.stack).slice(0, 240) });
      await U.sleep(1000);
    }
  }
}

async function idle() {
  // Never exit early: the snapshot is taken at the deadline.
  while (clock.remaining() > 0) await U.sleep(1000);
}

if (process.env.NPADEV_DEBUG) {
  setInterval(() => {
    const b = state.bot;
    if (!b || !b.entity) return;
    const pf = b.pathfinder;
    log.info('dbg', {
      pos: b.entity.position && b.entity.position.toArray().map((v) => Math.round(v * 100) / 100), ground: b.entity.onGround,
      phys: b.physicsEnabled, moving: pf && pf.isMoving && pf.isMoving(), mining: pf && pf.isMining && pf.isMining(),
      building: pf && pf.isBuilding && pf.isBuilding(), goal: !!(pf && pf.goal), held: b.heldItem && b.heldItem.name,
      ctl: Object.entries(b.controlState || {}).filter(([, v]) => v).map(([k]) => k), forced: state.forced || 0,
      mode: b.game && b.game.gameMode, water: b.entity.isInWater, vel: b.entity.velocity && b.entity.velocity.toArray().map((v) => Math.round(v * 1000) / 1000),
      below: (b.blockAt(b.entity.position.offset(0, -0.5, 0)) || {}).name, at: (b.blockAt(b.entity.position) || {}).name,
      attrs: b.entity.attributes ? Object.keys(b.entity.attributes).slice(0, 8) : null,
      speed: b.entity.attributes && (b.entity.attributes['minecraft:movement_speed'] || b.entity.attributes['movement_speed'] || b.entity.attributes['generic.movement_speed'] || {}).value,
    });
  }, 1000);
}

process.on('unhandledRejection', (err) => log.error('unhandled rejection', err));
process.on('uncaughtException', (err) => log.error('uncaught exception', err));
connect();
