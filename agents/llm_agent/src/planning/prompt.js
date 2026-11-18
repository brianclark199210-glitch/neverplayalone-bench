"use strict";

const MILESTONE_SEC = 20 * 60;

const KEYWORDS = {
  logs: { kind: "resource", priority: 2, blocks: ["oak_log", "birch_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"], items: ["oak_log", "birch_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"], aliases: ["log", "logs"] },
  cobblestone: { kind: "resource", priority: 3, blocks: ["stone", "cobblestone"], items: ["cobblestone"], aliases: ["cobble", "cobblestone"] },
  dirt: { kind: "resource", priority: 3, blocks: ["dirt", "grass_block"], items: ["dirt"], aliases: ["dirt"] },
  sand: { kind: "resource", priority: 3, blocks: ["sand", "red_sand"], items: ["sand", "red_sand"], aliases: ["sand"] },
  gravel: { kind: "resource", priority: 3, blocks: ["gravel"], items: ["gravel"], aliases: ["gravel"] },
  clay: { kind: "resource", priority: 3, blocks: ["clay"], items: ["clay_ball"], aliases: ["clay"] },
  coal: { kind: "resource", priority: 2, y: 96, blocks: ["coal_ore", "deepslate_coal_ore"], items: ["coal"], aliases: ["coal"] },
  iron: { kind: "resource", priority: 1, y: 16, blocks: ["iron_ore", "deepslate_iron_ore"], items: ["raw_iron", "iron_ingot"], aliases: ["iron"] },
  copper: { kind: "resource", priority: 2, y: 48, blocks: ["copper_ore", "deepslate_copper_ore"], items: ["raw_copper", "copper_ingot"], aliases: ["copper"] },
  gold: { kind: "resource", priority: 1, y: -16, blocks: ["gold_ore", "deepslate_gold_ore"], items: ["raw_gold", "gold_ingot"], aliases: ["gold"] },
  redstone: { kind: "resource", priority: 2, y: -32, blocks: ["redstone_ore", "deepslate_redstone_ore"], items: ["redstone"], aliases: ["redstone"] },
  lapis: { kind: "resource", priority: 2, y: 0, blocks: ["lapis_ore", "deepslate_lapis_ore"], items: ["lapis_lazuli"], aliases: ["lapis", "lapis lazuli"] },
  diamond: { kind: "resource", priority: 1, y: -54, blocks: ["diamond_ore", "deepslate_diamond_ore"], items: ["diamond"], aliases: ["diamond", "diamonds"] },
  emerald: { kind: "resource", priority: 2, y: 85, blocks: ["emerald_ore", "deepslate_emerald_ore"], items: ["emerald"], aliases: ["emerald"] },
  wheat: { kind: "resource", priority: 3, blocks: ["wheat"], items: ["wheat", "wheat_seeds"], aliases: ["wheat"] },
  carrot: { kind: "resource", priority: 3, blocks: ["carrots"], items: ["carrot"], aliases: ["carrot", "carrots"] },
  potato: { kind: "resource", priority: 3, blocks: ["potatoes"], items: ["potato"], aliases: ["potato", "potatoes"] },
  beetroot: { kind: "resource", priority: 3, blocks: ["beetroots"], items: ["beetroot"], aliases: ["beetroot", "beetroots"] },
  cow: { kind: "animal", priority: 3, entities: ["cow"], aliases: ["cow", "cows", "cattle"] },
  sheep: { kind: "animal", priority: 2, entities: ["sheep"], aliases: ["sheep"] },
  pig: { kind: "animal", priority: 2, entities: ["pig"], aliases: ["pig", "pigs"] },
  chicken: { kind: "animal", priority: 1, entities: ["chicken"], aliases: ["chicken", "chickens"] },
  rabbit: { kind: "animal", priority: 1, entities: ["rabbit"], aliases: ["rabbit", "rabbits", "bunny", "bunnies"] },
};

const PHRASES = [];
for (const [key, spec] of Object.entries(KEYWORDS)) {
  for (const alias of spec.aliases) PHRASES.push({ phrase: alias, key });
}
PHRASES.sort((a, b) => b.phrase.length - a.phrase.length);

let cache = null;

function milestoneSec(timeoutSec) {
  const given = Number(timeoutSec);
  const cap = Number.isFinite(given) && given > 0 ? given : MILESTONE_SEC;
  return Math.min(MILESTONE_SEC, cap);
}

function orderTargets(targets) {
  return [...targets].sort((a, b) => a.priority - b.priority || b.count - a.count);
}

function fromKey(key, count, priority) {
  const spec = KEYWORDS[key];
  const rank = Number(priority);
  return {
    name: key,
    kind: spec.kind,
    count: Math.floor(count),
    priority: Number.isFinite(rank) ? Math.min(5, Math.max(1, rank)) : spec.priority,
    blocks: spec.blocks ? [...spec.blocks] : [],
    items: spec.items ? [...spec.items] : [],
    entities: spec.entities ? [...spec.entities] : [],
    y: spec.y,
  };
}

function confirmTargets(list) {
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  for (const raw of list || []) {
    const name = String((raw && raw.name) || "").toLowerCase().trim();
    const phrase = PHRASES.find((entry) => entry.phrase === name || entry.key === name);
    const count = Number(raw && raw.count);
    if (!phrase || !Number.isFinite(count) || count <= 0 || seen.has(phrase.key)) {
      rejected.push(name || "unknown");
      continue;
    }
    seen.add(phrase.key);
    accepted.push(fromKey(phrase.key, count, raw && raw.priority));
  }
  return { accepted: orderTargets(accepted), rejected };
}

function heuristicPlan(text) {
  const found = [];
  const seen = new Set();
  const lower = String(text || "").toLowerCase();
  for (const { phrase, key } of PHRASES) {
    if (seen.has(key)) continue;
    const body = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
    const match = lower.match(new RegExp(`(\\d+)\\s+(?:raised\\s+|adult\\s+|baby\\s+)?${body}\\b`));
    if (!match) continue;
    seen.add(key);
    found.push(fromKey(key, parseInt(match[1], 10)));
  }
  return orderTargets(found);
}

function catalogText() {
  const names = [];
  for (const { phrase } of PHRASES) if (!names.includes(phrase)) names.push(phrase);
  return names.join(", ");
}

async function askModel(text) {
  const base = process.env.OPENAI_BASE_URL || process.env.OPENROUTER_BASE_URL || "";
  const key = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || "";
  const model = process.env.AGENT_LLM_MODEL || "deepseek/deepseek-r1";
  if (!base || !key) return null;
  const system = [
    "You read a Minecraft mission prompt and return JSON only.",
    "Confirm every target is one of these resources, animals, or blocks:",
    catalogText() + ".",
    'Respond with {"targets":[{"name":"coal","kind":"resource","count":24,"priority":1}]}.',
    'kind is "resource" or "animal". priority is 1 (do first) through 5.',
    "Omit anything that is not in the keyword list. No prose.",
  ].join(" ");
  const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 500,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) throw new Error(`llm status ${res.status}`);
  const payload = await res.json();
  const content = (payload.choices && payload.choices[0].message.content) || "";
  const parsed = JSON.parse((content.match(/\{[\s\S]*\}/) || ["{}"])[0]);
  return { ...confirmTargets(parsed.targets), model };
}

async function recognize(text, timeoutSec) {
  const prompt = String(text || "");
  let targets = [];
  let rejected = [];
  let model = null;
  if (!prompt.trim()) {
    cache = { targets, rejected: ["empty prompt"], resources: [], model, milestoneSec: milestoneSec(timeoutSec) };
    return cache;
  }
  try {
    const llm = await askModel(prompt);
    if (llm && llm.accepted.length) {
      targets = llm.accepted;
      rejected = llm.rejected;
      model = llm.model;
    }
  } catch (e) {
    rejected.push(String(e && e.message || e));
  }
  if (!targets.length) targets = heuristicPlan(prompt);
  cache = {
    targets,
    rejected,
    resources: targets.filter((t) => t.kind === "resource"),
    model,
    milestoneSec: milestoneSec(timeoutSec),
  };
  return cache;
}

function animalMap() {
  if (!cache) return null;
  const animals = cache.targets.filter((t) => t.kind === "animal");
  if (!animals.length) return null;
  const out = {};
  for (const target of animals) {
    if (Object.keys(out).length >= 4) break;
    out[target.name] = Math.min(8, target.count);
  }
  return out;
}

module.exports = {
  KEYWORDS,
  MILESTONE_SEC,
  confirmTargets,
  heuristicPlan,
  recognize,
  animalMap,
  milestoneSec,
};
