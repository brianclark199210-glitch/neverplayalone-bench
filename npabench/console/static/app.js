const mineButton = document.getElementById("mine");
const seedInput = document.getElementById("seed");
const form = document.getElementById("mine-form");
const formError = document.getElementById("form-error");

const STATUS_LABEL = {
  idle: "Idle",
  running: "Running",
  done: "Complete",
  error: "Error",
};

const FOOD = /^(wheat|carrot|potato|beetroot|dandelion|hay_block|bone_meal|golden_carrot|[a-z_]*seeds)$/;

function esc(value) {
  return String(value ?? "").replace(/[&<>"]/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  }[ch]));
}

function itemName(name) {
  return String(name || "").replace(/_/g, " ");
}

let logCount = 0;
let mindCount = 0;
let mindRows = [];

function showWorld(on) {
  const frame = document.getElementById("world");
  const label = document.getElementById("view-pos");
  if (!frame || !label) return;
  const wait = document.getElementById("world-wait");
  if (!on) {
    if (!frame.hidden) {
      frame.hidden = true;
      frame.removeAttribute("src");
    }
    if (wait) wait.hidden = false;
    delete label.dataset.live;
    label.textContent = "The Minecraft world appears when the agent joins.";
    return;
  }
  if (frame.getAttribute("src") !== "/mc/") frame.src = "/mc/";
  frame.hidden = false;
  if (wait) wait.hidden = true;
  label.dataset.live = "1";
  if (!label.dataset.pos) label.textContent = "Live Minecraft world. The player on screen is your agent.";
}

let worldProbe = 0;

function probeWorld() {
  const now = Date.now();
  if (now - worldProbe < 4000) return;
  worldProbe = now;
  fetch("/mc/", { cache: "no-store" })
    .then((response) => {
      if (response.ok) showWorld(true);
    })
    .catch(() => {});
}

function appendLogs(data) {
  logCount = Number.isInteger(data.log_count) ? data.log_count : logCount;
}

function blankBoard() {
  return {
    animals: [],
    bag: [],
    bag_total: 0,
    crops: [],
    pen: {},
    pos: null,
    animals_total: 0,
    growth: 0,
    raised: 0,
    raised_goal: 0,
  };
}

function speciesRows(data, board) {
  if (board.animals && board.animals.length) return board.animals;
  return (data.targets || []).map((target) => ({
    key: target.key,
    display_name: target.display_name,
    target_count: target.target_count,
    count: 0,
    adults: 0,
    babies: 0,
    starters: 0,
    offspring: 0,
    raised: target.have || 0,
    food: 0,
    growth: 0,
  }));
}

function scoredRaised(data, animal) {
  if (data.status === "done" || data.status === "error") {
    const target = (data.targets || []).find((row) => row.key === animal.key);
    if (target && Number.isInteger(target.have)) return target.have;
  }
  return animal.raised || 0;
}

function speciesCard(data, animal) {
  const raised = scoredRaised(data, animal);
  const goal = animal.target_count || 0;
  const growth = Math.max(0, Math.min(100, animal.growth || 0));
  return `<article class="species ${esc(animal.key)}">
    <div class="species-top">
      <strong>${esc(animal.display_name || animal.key)}</strong>
      <span class="goal">${raised} / ${goal}</span>
    </div>
    <dl class="meters">
      <div><dt>In pen</dt><dd>${animal.count || 0}</dd></div>
      <div><dt>Babies</dt><dd>${animal.babies || 0}</dd></div>
      <div><dt>Adults</dt><dd>${animal.adults || 0}</dd></div>
      <div><dt>Growth</dt><dd>${growth}%</dd></div>
    </dl>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${growth}" aria-label="${esc(animal.display_name)} growth">
      <span style="width:${growth}%"></span>
    </div>
    <p class="food-line muted">${animal.food || 0} food in bag · ${animal.offspring || 0} offspring · ${animal.starters || 0} starters</p>
  </article>`;
}

function penLine(pen, started) {
  if (!started) return "The pen is registered once the agent fences a plot.";
  if (!pen || !pen.registered) return "Pen not registered yet.";
  if (pen.valid === true) return "Pen registered. Enclosure is valid.";
  if (pen.valid === false) {
    const issues = pen.issues ? ` ${pen.issues} issue${pen.issues === 1 ? "" : "s"}.` : "";
    return `Pen registered. Enclosure still has problems.${issues}`;
  }
  return "Pen registered. Enclosure has not been checked yet.";
}

function bagList(items) {
  if (!items.length) return `<li class="empty">Nothing in the bag yet.</li>`;
  return items.map((item) => {
    const food = FOOD.test(item.item) ? " food" : "";
    return `<li class="${food.trim()}"><b>${item.count}</b> ${esc(itemName(item.item))}</li>`;
  }).join("");
}

function cropCards(crops) {
  if (!crops.length) return `<p class="muted empty-note">No farmland tracked yet.</p>`;
  return crops.map((crop) => {
    const name = crop.name === "empty" ? "Bare farmland" : itemName(crop.name);
    const growth = crop.name === "empty" ? 0 : Math.max(0, Math.min(100, crop.growth || 0));
    const detail = crop.name === "empty" ? `${crop.plots} plots` : `${crop.plots} plots · ${growth}% grown`;
    return `<div>
      <div class="crop-top"><b>${esc(name)}</b><span class="muted">${detail}</span></div>
      <div class="bar"><span style="width:${growth}%"></span></div>
    </div>`;
  }).join("");
}

function supplyLine(mission) {
  const crops = mission && mission.starter_crops;
  if (!crops || typeof crops !== "object") return "";
  const parts = Object.entries(crops)
    .filter(([, count]) => count)
    .map(([name, count]) => `${count} ${itemName(name)}`);
  if (!parts.length) return "";
  return `Supply chest also starts with 128 oak fence, 8 oak fence gates, ${parts.join(", ")}.`;
}

function paint(data) {
  const status = data.status || "idle";
  const pill = document.getElementById("status");
  pill.textContent = STATUS_LABEL[status] || status;
  pill.className = `status ${status}`;

  const mission = data.mission;
  const started = Boolean(mission);
  document.getElementById("mission-id").textContent = mission ? mission.id : "—";
  document.getElementById("mission-content").textContent = mission
    ? mission.content
    : "Choose a seed from 0 to 5, then start the run.";
  document.getElementById("mission-meta").textContent = mission
    ? `seed ${mission.seed} · ${mission.duration_seconds}s`
    : "";

  const board = Object.assign(blankBoard(), data.board || {});
  const animals = speciesRows(data, board);
  const targets = document.getElementById("targets");
  targets.innerHTML = animals.length
    ? animals.map((animal) => speciesCard(data, animal)).join("")
    : `<p class="muted empty-note">Two species appear here after the run starts.</p>`;

  const babies = animals.reduce((sum, animal) => sum + (animal.babies || 0), 0);
  const adults = animals.reduce((sum, animal) => sum + (animal.adults || 0), 0);
  const raised = animals.reduce((sum, animal) => sum + scoredRaised(data, animal), 0);
  const goal = board.raised_goal || animals.reduce((sum, animal) => sum + (animal.target_count || 0), 0);
  const live = status === "running" || status === "done" || status === "error";
  document.getElementById("stat-animals").textContent = live ? String(board.animals_total || 0) : "0";
  document.getElementById("stat-animals-note").textContent = live
    ? `${babies} babies · ${adults} adults`
    : "In the pen";
  document.getElementById("stat-growth").textContent = live ? `${board.growth || 0}%` : "0%";
  document.getElementById("stat-growth-note").textContent = animals.length
    ? animals.map((animal) => `${animal.display_name || animal.key} ${animal.growth || 0}%`).join(" · ")
    : "Toward adult";
  document.getElementById("stat-bag").textContent = live ? String(board.bag_total || 0) : "0";
  const topBag = (board.bag || []).slice(0, 2).map((item) => `${item.count} ${itemName(item.item)}`);
  document.getElementById("stat-bag-note").textContent = topBag.length ? topBag.join(" · ") : "Items held";
  document.getElementById("stat-raised").textContent = goal ? `${raised} / ${goal}` : "0 / 0";
  document.getElementById("stat-raised-note").textContent = status === "done"
    ? "Scored adult offspring"
    : "Adult offspring in the pen";

  document.getElementById("pen-line").textContent = penLine(board.pen, started);
  document.getElementById("bag").innerHTML = bagList(board.bag || []);
  document.getElementById("bag-count").textContent = board.bag_total ? `${board.bag_total} items` : "";
  document.getElementById("supplies").textContent = supplyLine(mission);
  document.getElementById("crops").innerHTML = cropCards(board.crops || []);

  const percent = Math.round((data.progress || 0) * 100);
  document.getElementById("progress-label").textContent = `${percent}%`;
  document.getElementById("progress-fill").style.width = `${percent}%`;
  document.getElementById("scorebar").setAttribute("aria-valuenow", String(percent));
  rememberClock(data.clock);
  drawClock();
  document.getElementById("score-line").textContent = data.score == null
    ? "The bar follows adult offspring raised so far. The official score lands when the run finishes."
    : `Score ${data.score} / ${data.max_score}`;

  const steps = data.timeline || [];
  const timeline = document.getElementById("timeline");
  const nextTimeline = steps.map((step) =>
    `<li class="step ${esc(step.state)}"><span class="dot"></span><div><b>${esc(step.label)}</b><p class="muted">${esc(step.detail)}</p></div></li>`
  ).join("");
  if (timeline.innerHTML !== nextTimeline) timeline.innerHTML = nextTimeline;

  appendLogs(data);
  const frame = document.getElementById("world");
  const port = data.viewer && data.viewer.port;
  if (frame && port) showWorld(true);
  else if ((data.status || "idle") !== "running") showWorld(false);
  else probeWorld();
  const place = document.getElementById("view-pos");
  if (place && Array.isArray(board.pos)) {
    place.dataset.pos = board.pos.join(",");
    place.textContent = place.dataset.live
      ? `Live world. Agent at ${board.pos.join(", ")}.`
      : `Agent at ${board.pos.join(", ")}.`;
  }
  const busy = status === "running";
  mineButton.disabled = busy;
  if (seedInput) seedInput.disabled = busy;
  mineButton.textContent = busy ? "Running…" : "Start run";
  if (data.error && status === "error") formError.textContent = data.error;
  paintMind(data, mission);
}

function paintMind(data, mission) {
  const now = data.mind_now;
  const doing = now ? (now.doing || now.think || "Working") : "Waiting to start";
  const phase = now ? (now.status || "Running") : "Idle";
  const plan = now ? (now.plan || now.think || "") : "The plan appears once a second.";
  const seen = now ? (now.observe || "Nothing observed yet.") : "Nothing observed yet.";
  document.getElementById("now-doing").textContent = doing;
  document.getElementById("now-status").textContent = phase;
  document.getElementById("mind-think").textContent = plan;
  document.getElementById("mind-observe").textContent = seen;
  document.getElementById("mind-clock").textContent = now ? formatClock(now.second || 0) : "";
  document.getElementById("mind-file").textContent = mission
    ? `Saved each second in results/runs/${mission.id}/logs`
    : "";
  if (data.mind_reset || data.mind_from === 0) {
    mindRows = [];
    mindCount = 0;
  }
  const incoming = data.mind || [];
  if (incoming.length) mindRows = mindRows.concat(incoming);
  if (Number.isInteger(data.mind_count)) mindCount = data.mind_count;
  const body = document.getElementById("mind");
  const recent = mindRows.slice(-80).reverse();
  const next = recent.length
    ? recent.map((row, index) => `<tr class="${index === 0 ? "fresh" : ""}">
        <td class="when">${esc(formatClock(row.second || 0))}</td>
        <td>${esc(row.doing || row.think || "")}</td>
        <td><span class="tag">${esc(row.status || "Running")}</span></td>
        <td>${esc(row.plan || row.think || "")}</td>
        <td>${esc(row.observe || "")}</td>
      </tr>`).join("")
    : `<tr class="empty-row"><td colspan="5">Each second of the run is added here.</td></tr>`;
  if (body.innerHTML !== next) body.innerHTML = next;
}

async function refresh() {
  const response = await fetch(`/api/session?logs=${logCount}&mind=${mindCount}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await response.text());
  paint(await response.json());
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formError.textContent = "";
  mineButton.disabled = true;
  try {
    const response = await fetch("/api/mine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed: Number(seedInput.value) }),
    });
    const payload = await response.json();
    if (!response.ok) {
      formError.textContent = payload.detail || "The run could not start.";
      mineButton.disabled = false;
      return;
    }
    paint(payload);
  } catch (error) {
    formError.textContent = error.message;
    mineButton.disabled = false;
  }
});

refresh().catch((error) => {
  formError.textContent = error.message;
});
setInterval(() => {
  refresh().catch(() => {});
}, 1000);
setInterval(drawClock, 200);

let clockState = null;

function rememberClock(clock) {
  if (!clock || clock.started_at == null) {
    clockState = null;
    return;
  }
  clockState = {
    duration: Number(clock.duration_seconds) || 600,
    startedAt: Number(clock.started_at),
    endedAt: clock.ended_at == null ? null : Number(clock.ended_at),
    skew: Number(clock.server_now) - Date.now() / 1000,
  };
}

function formatClock(seconds) {
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

function drawClock() {
  const label = document.getElementById("time-label");
  const fill = document.getElementById("time-fill");
  const bar = document.getElementById("timebar");
  if (!label || !fill || !bar) return;
  if (!clockState) {
    label.textContent = "20:00";
    fill.style.width = "100%";
    bar.classList.remove("low");
    bar.setAttribute("aria-valuenow", "100");
    return;
  }
  const now = clockState.endedAt == null ? Date.now() / 1000 + clockState.skew : clockState.endedAt;
  const remaining = Math.max(0, clockState.duration - (now - clockState.startedAt));
  const ratio = clockState.duration > 0 ? remaining / clockState.duration : 0;
  const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  fill.style.width = `${percent}%`;
  bar.classList.toggle("low", ratio <= 0.2 && clockState.endedAt == null);
  bar.setAttribute("aria-valuenow", String(percent));
  label.textContent = formatClock(remaining);
}
