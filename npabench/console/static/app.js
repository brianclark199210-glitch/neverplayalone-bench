const logsEl = document.getElementById("logs");
const mineButton = document.getElementById("mine");
const form = document.getElementById("mine-form");
const formError = document.getElementById("form-error");

const STATUS_LABEL = {
  idle: "Idle",
  running: "Running",
  done: "Complete",
  error: "Error",
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"]/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  }[ch]));
}

let logCount = 0;

function appendLogs(data) {
  const incoming = data.logs || "";
  const reset = data.reset || data.log_from === 0;
  const pinned = logsEl.scrollHeight - logsEl.scrollTop - logsEl.clientHeight < 32;
  if (reset) {
    if (logsEl.value !== incoming) logsEl.value = incoming;
  } else if (incoming) {
    logsEl.value = logsEl.value ? `${logsEl.value}\n${incoming}` : incoming;
  }
  logCount = Number.isInteger(data.log_count) ? data.log_count : logCount;
  if (pinned) logsEl.scrollTop = logsEl.scrollHeight;
}

function targetCard(target) {
  const have = target.have || 0;
  const total = target.target_count || 0;
  const width = total ? Math.min(100, Math.round((have / total) * 100)) : 0;
  return `<article class="target">
    <div class="target-top">
      <span class="ore ${esc(target.key)}"></span>
      <strong>${esc(target.display_name)}</strong>
      <span class="role ${esc(target.role)}">${esc(target.role)}</span>
    </div>
    <div class="bar"><span style="width:${width}%"></span></div>
    <p class="count muted">${have} / ${total} · ${esc(target.points)} pts</p>
  </article>`;
}

function paint(data) {
  const status = data.status || "idle";
  const pill = document.getElementById("status");
  pill.textContent = STATUS_LABEL[status] || status;
  pill.className = `status ${status}`;

  const mission = data.mission;
  document.getElementById("mission-id").textContent = mission ? mission.id : "—";
  document.getElementById("mission-content").textContent = mission
    ? mission.content
    : "Press Mine. A random seed runs animal husbandry.";
  document.getElementById("mission-meta").textContent = mission
    ? `seed ${mission.seed} · ${mission.duration_seconds}s · Minecraft seed ${mission.minecraft_seed}`
    : "";

  const targets = data.targets || [];
  document.getElementById("targets").innerHTML = targets.map(targetCard).join("");

  const percent = Math.round((data.progress || 0) * 100);
  document.getElementById("progress-label").textContent = `${percent}%`;
  document.getElementById("progress-fill").style.width = `${percent}%`;
  document.getElementById("scorebar").setAttribute("aria-valuenow", String(percent));
  rememberClock(data.clock);
  drawClock();
  document.getElementById("score-line").textContent = data.score == null
    ? "Score appears when the run finishes."
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
  if (frame && port) {
    const src = "/mc/";
    if (frame.getAttribute("src") !== src) frame.src = src;
    frame.hidden = false;
    document.getElementById("view-pos").textContent = "Live Minecraft world. The player on screen is your agent.";
  }
  const busy = status === "running";
  mineButton.disabled = busy;
  mineButton.textContent = busy ? "Running…" : "Mine";
  if (data.error && status === "error") formError.textContent = data.error;
}

async function refresh() {
  const response = await fetch(`/api/session?logs=${logCount}`, { cache: "no-store" });
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
      body: "{}",
    });
    const payload = await response.json();
    if (!response.ok) {
      formError.textContent = payload.detail || "Mining could not start.";
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
  label.textContent = `${formatClock(remaining)} left`;
}
