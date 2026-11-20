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

const htmlCache = new Map();

function setHTML(node, html) {
  if (!node || htmlCache.get(node) === html) return;
  htmlCache.set(node, html);
  node.innerHTML = html;
}

function setText(node, text) {
  if (!node || node.textContent === text) return;
  node.textContent = text;
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
    frame.hidden = true;
    frame.removeAttribute("src");
    if (wait) wait.hidden = false;
    delete label.dataset.live;
    delete label.dataset.pos;
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
  fetch("/mc/", { method: "HEAD", cache: "no-store" })
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
    : "Type a seed, then start the run.";
  document.getElementById("mission-meta").textContent = mission
    ? `seed ${mission.seed_text || mission.seed} · ${mission.duration_seconds}s`
    : "";

  const board = Object.assign(blankBoard(), data.board || {});
  const animals = speciesRows(data, board);
  setHTML(
    document.getElementById("targets"),
    animals.length
      ? animals.map((animal) => speciesCard(data, animal)).join("")
      : `<p class="muted empty-note">Two species appear here after the run starts.</p>`
  );

  const babies = animals.reduce((sum, animal) => sum + (animal.babies || 0), 0);
  const adults = animals.reduce((sum, animal) => sum + (animal.adults || 0), 0);
  const raised = animals.reduce((sum, animal) => sum + scoredRaised(data, animal), 0);
  const goal = board.raised_goal || animals.reduce((sum, animal) => sum + (animal.target_count || 0), 0);
  const live = status === "running" || status === "done" || status === "error";
  setText(document.getElementById("stat-animals"), live ? String(board.animals_total || 0) : "0");
  setText(document.getElementById("stat-animals-note"), live
    ? `${babies} babies · ${adults} adults`
    : "In the pen");
  setText(document.getElementById("stat-growth"), live ? `${board.growth || 0}%` : "0%");
  setText(document.getElementById("stat-growth-note"), animals.length
    ? animals.map((animal) => `${animal.display_name || animal.key} ${animal.growth || 0}%`).join(" · ")
    : "Toward adult");
  setText(document.getElementById("stat-raised"), goal ? `${raised} / ${goal}` : "0 / 0");
  setText(document.getElementById("stat-raised-note"), status === "done"
    ? "Scored adult offspring"
    : "Adult offspring in the pen");

  setText(document.getElementById("pen-line"), penLine(board.pen, started));
  setHTML(document.getElementById("bag"), bagList(board.bag || []));
  setText(document.getElementById("bag-count"), board.bag_total ? `${board.bag_total} items` : "");
  document.getElementById("supplies").textContent = supplyLine(mission);

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
  setHTML(document.getElementById("timeline"), steps.map((step) =>
    `<li class="step ${esc(step.state)}"><span class="dot"></span><div><b>${esc(step.label)}</b><p class="muted">${esc(step.detail)}</p></div></li>`
  ).join(""));

  appendLogs(data);
  const frame = document.getElementById("world");
  const port = data.viewer && data.viewer.port;
  const place = document.getElementById("view-pos");
  if (place && !Array.isArray(board.pos)) delete place.dataset.pos;
  if (frame && port) showWorld(true);
  else showWorld(false);
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
  drawChart(data.series, data.clock && data.clock.duration_seconds);
}

let mindSignature = "";

function heldLabel(row) {
  const raw = row && Object.prototype.hasOwnProperty.call(row, "held") ? row.held : "";
  const text = itemName(raw).trim();
  if (!text || text === "none" || text === "empty") return "Empty";
  return text;
}

function paintMind(data, mission) {
  const now = data.mind_now;
  const doing = now ? (now.doing || now.think || "Working") : "Waiting to start";
  const phase = now ? (now.status || "Running") : "Idle";
  const tool = now ? heldLabel(now) : "Empty";
  const plan = now ? (now.plan || now.think || "") : "The plan appears once a second.";
  const seen = now ? (now.observe || "Nothing observed yet.") : "Nothing observed yet.";
  setText(document.getElementById("now-doing"), doing);
  setText(document.getElementById("now-status"), phase);
  setText(document.getElementById("now-tool"), tool);
  setText(document.getElementById("mind-think"), plan);
  setText(document.getElementById("mind-observe"), seen);
  setText(document.getElementById("mind-clock"), now ? formatClock(now.second || 0) : "");
  setText(
    document.getElementById("mind-file"),
    mission ? `Saved each second in results/runs/${mission.id}/logs` : ""
  );
  const incoming = data.mind || [];
  if (data.mind_reset || data.mind_from === 0) {
    mindRows = [];
    mindCount = 0;
  }
  if (incoming.length) mindRows = mindRows.concat(incoming);
  if (mindRows.length > 80) mindRows = mindRows.slice(-80);
  if (Number.isInteger(data.mind_count)) mindCount = data.mind_count;
  const last = mindRows[mindRows.length - 1];
  const signature = last
    ? `${mindRows.length}:${last.second}:${last.doing || ""}:${last.held || ""}:${last.observe || ""}`
    : "empty";
  if (signature === mindSignature) return;
  mindSignature = signature;
  const body = document.getElementById("mind");
  const scroller = body.parentElement;
  const top = scroller ? scroller.scrollTop : 0;
  const recent = mindRows.slice().reverse();
  const next = recent.length
    ? recent.map((row, index) => `<tr class="${index === 0 ? "fresh" : ""}">
        <td class="when" data-label="Time">${esc(formatClock(row.second || 0))}</td>
        <td data-label="Doing">${esc(row.doing || row.think || "")}</td>
        <td data-label="Status"><span class="tag">${esc(row.status || "Running")}</span></td>
        <td class="tool" data-label="Held">${esc(heldLabel(row))}</td>
        <td data-label="Planning">${esc(row.plan || row.think || "")}</td>
        <td data-label="Observes">${esc(row.observe || "")}</td>
      </tr>`).join("")
    : `<tr class="empty-row"><td colspan="6">Each second of the run is added here.</td></tr>`;
  body.innerHTML = next;
  if (scroller) scroller.scrollTop = top < 16 ? 0 : top;
}

let epoch = 0;

function resetView() {
  htmlCache.clear();
  logCount = 0;
  mindCount = 0;
  mindRows = [];
  mindSignature = "";
  clockState = null;
  worldProbe = 0;
  showWorld(false);
  const status = document.getElementById("status");
  status.textContent = "Running";
  status.className = "status running";
  setText(document.getElementById("mission-id"), "—");
  setText(document.getElementById("mission-content"), "Type a seed, then start the run.");
  setText(document.getElementById("mission-meta"), "");
  setHTML(document.getElementById("targets"), `<p class="muted empty-note">Two species appear here after the run starts.</p>`);
  setText(document.getElementById("stat-animals"), "0");
  setText(document.getElementById("stat-animals-note"), "In the pen");
  setText(document.getElementById("stat-growth"), "0%");
  setText(document.getElementById("stat-growth-note"), "Toward adult");
  setText(document.getElementById("stat-raised"), "0 / 0");
  setText(document.getElementById("stat-raised-note"), "Adult offspring in the pen");
  setText(document.getElementById("pen-line"), "The pen is registered once the agent fences a plot.");
  setHTML(document.getElementById("bag"), `<li class="empty">Nothing in the bag yet.</li>`);
  setText(document.getElementById("bag-count"), "");
  setText(document.getElementById("supplies"), "");
  setText(document.getElementById("progress-label"), "0%");
  document.getElementById("progress-fill").style.width = "0%";
  document.getElementById("scorebar").setAttribute("aria-valuenow", "0");
  setText(document.getElementById("score-line"), "The bar follows adult offspring raised so far. The official score lands when the run finishes.");
  setHTML(document.getElementById("timeline"), "");
  setText(document.getElementById("now-doing"), "Waiting to start");
  setText(document.getElementById("now-status"), "Idle");
  setText(document.getElementById("now-tool"), "Empty");
  setText(document.getElementById("mind-think"), "The plan appears once a second.");
  setText(document.getElementById("mind-observe"), "Nothing observed yet.");
  setText(document.getElementById("mind-clock"), "");
  setText(document.getElementById("mind-file"), "");
  setHTML(document.getElementById("mind"), `<tr class="empty-row"><td colspan="6">Each second of the run is added here.</td></tr>`);
  drawChart([], 1200);
  drawClock();
}

async function refresh() {
  const ticket = epoch;
  const response = await fetch(`/api/session?logs=${logCount}&mind=${mindCount}`, { cache: "no-store" });
  if (ticket !== epoch) return;
  if (!response.ok) throw new Error(await response.text());
  const payload = await response.json();
  if (ticket !== epoch) return;
  paint(payload);
}

function readSeed() {
  const text = String(seedInput.value).trim();
  if (!text || text.length > 200) return null;
  return text;
}

seedInput.addEventListener("invalid", (event) => {
  event.preventDefault();
  formError.textContent = "Type a seed.";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formError.textContent = "";
  const seed = readSeed();
  if (seed === null) {
    formError.textContent = seedInput.value.trim().length > 200
      ? "Seed text can be at most 200 characters."
      : "Type a seed.";
    return;
  }
  epoch += 1;
  const ticket = epoch;
  mineButton.disabled = true;
  resetView();
  try {
    const response = await fetch("/api/mine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed }),
    });
    const payload = await response.json();
    if (ticket !== epoch) return;
    if (!response.ok) {
      formError.textContent = payload.detail || "The run could not start.";
      mineButton.disabled = false;
      epoch += 1;
      refresh().catch(() => {});
      return;
    }
    paint(payload);
  } catch (error) {
    if (ticket !== epoch) return;
    formError.textContent = error.message;
    mineButton.disabled = false;
    epoch += 1;
    refresh().catch(() => {});
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

const CHART_SERIES = [
  { key: "animals", label: "Animals", color: "#246b45" },
  { key: "growth", label: "Growth", color: "#a56a12", max: 100, suffix: "%" },
  { key: "bag", label: "Bag", color: "#3d6f8f" },
  { key: "raised", label: "Raised", color: "#9a4632" },
];

function chartSamples(rows) {
  const limit = 56;
  if (rows.length <= limit) return rows;
  const picked = [];
  const step = (rows.length - 1) / (limit - 1);
  for (let i = 0; i < limit; i++) picked.push(rows[Math.round(i * step)]);
  return picked;
}

function drawChart(series, durationSeconds) {
  const svg = document.getElementById("stat-chart");
  const note = document.getElementById("stat-chart-note");
  if (!svg) return;
  const rows = (Array.isArray(series) ? series : [])
    .map((point) => ({
      t: Number(point && point.t),
      animals: Number(point && point.animals) || 0,
      growth: Number(point && point.growth) || 0,
      bag: Number(point && point.bag) || 0,
      raised: Number(point && point.raised) || 0,
    }))
    .filter((point) => Number.isFinite(point.t));
  if (!rows.length) {
    svg.innerHTML = '<p class="muted empty-note">Statistics fill in once the agent is in the world.</p>';
    if (note) note.textContent = "Time";
    return;
  }
  const span = Math.max(60, Number(durationSeconds) || 0, rows[rows.length - 1].t);
  const dots = chartSamples(rows);
  const ticks = [0, Math.round(span / 2), Math.round(span)];
  const bands = CHART_SERIES.map((line) => {
    const max = line.max || Math.max(1, ...rows.map((point) => point[line.key]));
    const marks = dots.map((point) => {
      const value = Math.max(0, Math.min(max, point[line.key]));
      const x = 3 + (Math.max(0, point.t) / span) * 94;
      const y = 8 + (1 - value / max) * 84;
      const shown = `${point[line.key]}${line.suffix || ""}`;
      return `<i style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;background:${line.color}" title="${esc(formatClock(point.t))} · ${esc(line.label)} ${esc(shown)}"></i>`;
    }).join("");
    const last = rows[rows.length - 1][line.key];
    return `<div class="chart-row">
      <p class="chart-name"><b>${esc(line.label)}</b><span>0–${max}${line.suffix || ""}</span></p>
      <div class="chart-plot">${marks}</div>
      <p class="chart-now" style="color:${line.color}">${last}${line.suffix || ""}</p>
    </div>`;
  }).join("");
  const axis = `<div class="chart-axis" aria-hidden="true"><span></span><span class="chart-ticks">${ticks.map((t) => `<b>${formatClock(t)}</b>`).join("")}</span><span></span></div>`;
  svg.innerHTML = `${bands}${axis}`;
  const last = rows[rows.length - 1];
  if (note) {
    note.textContent = `${formatClock(rows[0].t)}–${formatClock(last.t)} · animals ${last.animals} · growth ${last.growth}% · bag ${last.bag} · raised ${last.raised}`;
  }
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
  const width = `${percent}%`;
  if (fill.style.width !== width) fill.style.width = width;
  bar.classList.toggle("low", ratio <= 0.2 && clockState.endedAt == null);
  bar.setAttribute("aria-valuenow", String(percent));
  setText(label, formatClock(remaining));
}
