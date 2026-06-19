const STATUS_URL = "data/status.json";

const overallPill = document.getElementById("overall-pill");
const overallLabel = document.getElementById("overall-label");
const lastUpdated = document.getElementById("last-updated");
const statsRow = document.getElementById("stats-row");
const groupsEl = document.getElementById("groups");
const refreshBtn = document.getElementById("refresh-btn");

const STATUS_LABELS = {
  healthy: "All systems go",
  degraded: "Some items need attention",
  unhealthy: "Issues detected",
  unknown: "Status unknown",
};

const KIND_LABELS = {
  api: "API",
  site: "Site",
  workflow: "Workflow",
  "protected-api": "Protected API",
};

function formatRelativeTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return `${diffHr} hr ago`;
  return date.toLocaleString("en-AE", { timeZone: "Asia/Dubai" });
}

function formatDubaiTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-AE", {
    timeZone: "Asia/Dubai",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function renderStats(summary) {
  const counts = summary?.counts || {};
  const entries = [
    { kind: "healthy", label: "Healthy" },
    { kind: "unhealthy", label: "Issues" },
    { kind: "unknown", label: "Unknown" },
    { kind: "skipped", label: "Skipped" },
  ];

  statsRow.innerHTML = entries
    .map(
      ({ kind, label }) => `
      <div class="stat-card" data-kind="${kind}">
        <div class="label">${label}</div>
        <div class="value">${counts[kind] ?? 0}</div>
      </div>`
    )
    .join("");
}

function renderCard(item) {
  const title = item.link
    ? `<a href="${item.link}" target="_blank" rel="noopener">${escapeHtml(item.name)}</a>`
    : escapeHtml(item.name);

  const meta = [];
  if (item.latencyMs != null) meta.push(`<span>⏱ ${item.latencyMs} ms</span>`);
  if (item.httpStatus != null) meta.push(`<span>HTTP ${item.httpStatus}</span>`);
  if (item.repo) meta.push(`<span>📦 ${escapeHtml(item.repo)}</span>`);
  if (item.lastRun?.event) meta.push(`<span>⚡ ${escapeHtml(item.lastRun.event)}</span>`);
  if (item.lastRun?.createdAt) {
    meta.push(`<span>🕐 ${formatRelativeTime(item.lastRun.createdAt)}</span>`);
  }
  if (item.scheduleHint) meta.push(`<span>📅 ${escapeHtml(item.scheduleHint)}</span>`);

  let detail = "";
  if (item.summary && Object.keys(item.summary).length) {
    detail = `<p class="card-detail">${escapeHtml(JSON.stringify(item.summary))}</p>`;
  } else if (item.note) {
    detail = `<p class="card-detail">${escapeHtml(item.note)}</p>`;
  }

  return `
    <article class="card" data-status="${item.status}">
      <div class="card-header">
        <h3 class="card-title">${title}</h3>
        <span class="status-badge" data-status="${item.status}">${item.status}</span>
      </div>
      <span class="kind-tag">${KIND_LABELS[item.kind] || item.kind}</span>
      <p class="card-message">${escapeHtml(item.message || "—")}</p>
      ${meta.length ? `<div class="card-meta">${meta.join("")}</div>` : ""}
      ${detail}
    </article>
  `;
}

function renderGroups(items) {
  const byGroup = new Map();
  for (const item of items) {
    const group = item.group || "Other";
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(item);
  }

  if (!items.length) {
    groupsEl.innerHTML = `<div class="empty-state"><p>No status data yet. Run the Collect Status workflow on GitHub.</p></div>`;
    return;
  }

  groupsEl.innerHTML = [...byGroup.entries()]
    .map(
      ([group, groupItems]) => `
      <section class="group">
        <h2 class="group-title">${escapeHtml(group)}</h2>
        <div class="cards">${groupItems.map(renderCard).join("")}</div>
      </section>`
    )
    .join("");
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function render(data) {
  const overall = data.summary?.overall || "unknown";
  overallPill.dataset.status = overall;
  overallLabel.textContent = STATUS_LABELS[overall] || overall;

  const parts = [
    `UAE date: ${data.dubaiDate || "—"}`,
    `Updated ${formatRelativeTime(data.generatedAt)}`,
    `(${formatDubaiTime(data.generatedAt)} UAE)`,
  ];
  if (!data.tokenConfigured) {
    parts.push("· GH_STATUS_TOKEN not set (private workflows may show unknown)");
  }
  lastUpdated.textContent = parts.join(" ");

  renderStats(data.summary);
  renderGroups(data.items || []);
}

async function loadStatus() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Loading…";
  try {
    const response = await fetch(`${STATUS_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    render(data);
  } catch (error) {
    overallPill.dataset.status = "unknown";
    overallLabel.textContent = "Could not load status";
    lastUpdated.textContent = error.message;
    groupsEl.innerHTML = `<div class="empty-state"><p>${escapeHtml(error.message)}</p></div>`;
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Refresh";
  }
}

refreshBtn.addEventListener("click", loadStatus);
loadStatus();

// Auto-refresh every 5 minutes while tab is open
setInterval(loadStatus, 5 * 60 * 1000);
