const STATUS_URL = "data/status.json";

const overallPill = document.getElementById("overall-pill");
const overallLabel = document.getElementById("overall-label");
const lastUpdated = document.getElementById("last-updated");
const countsEl = document.getElementById("counts");
const boardEl = document.getElementById("board");
const refreshBtn = document.getElementById("refresh-btn");

const STATUS_LABELS = {
  healthy: "All OK",
  degraded: "Check items",
  unhealthy: "Issues",
  unknown: "Loading",
};

/** Short display names — keeps tiles one line */
const SHORT_NAMES = {
  "bible-morning": "Morning API",
  "bible-rss": "RSS Feed",
  "urdu-votd": "Urdu VOTD",
  "urdu-votd-bilingual": "Urdu + EN VOTD",
  "dailybread-pwa": "Daily Bread",
  "votd-urdu-english": "VOTD PWA",
  "bible-cron-refresh": "Cron Refresh",
  "votd-ig-post": "VOTD Instagram",
  "dailybread-pages": "Daily Bread deploy",
  "votd-urdu-pages": "VOTD deploy",
  "bible-widget-build": "Bible Widget APK",
  "bible-themes-build": "Bible Themes APK",
  "pinknubes-apk": "PinkNubes APK",
  "lead-engine": "LEAD-ENGINE",
  "cvbuilder-ci": "CV Builder CI",
  "gnome-schedule-test": "Gnome Schedule",
};

/** Panel order for single-screen layout */
const PANEL_ORDER = [
  "E-GEEK APIs",
  "E-GEEK Sites",
  "Social Automation",
  "Deployments",
  "Mobile Builds",
  "HR Automation",
  "Web Apps",
  "Desktop Tools",
  "Protected APIs",
];

function formatRelativeTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return `${diffHr}h ago`;
  return date.toLocaleDateString("en-AE", { timeZone: "Asia/Dubai" });
}

function shortName(item) {
  return SHORT_NAMES[item.id] || item.name.split("—").pop()?.trim() || item.name;
}

function tileHint(item) {
  if (item.latencyMs != null) return `${item.latencyMs}ms`;
  if (item.lastRun?.createdAt) return formatRelativeTime(item.lastRun.createdAt);
  if (item.status === "unknown" && item.message?.includes("Secret")) return "no secret";
  if (item.status === "unknown" && item.message?.includes("private")) return "private";
  if (item.status === "unknown") return "—";
  return item.message === "OK" || item.message === "Last run succeeded" ? "✓" : "·";
}

function renderCounts(summary) {
  const counts = summary?.counts || {};
  const kinds = [
    { kind: "healthy", label: "OK" },
    { kind: "unhealthy", label: "Fail" },
    { kind: "unknown", label: "?" },
  ];
  countsEl.innerHTML = kinds
    .map(
      ({ kind, label }) =>
        `<span class="count-chip" data-kind="${kind}">${counts[kind] ?? 0} ${label}</span>`
    )
    .join("");
}

function renderTile(item) {
  const href = item.link || item.lastRun?.htmlUrl || "#";
  const title = [item.name, item.message, item.note].filter(Boolean).join(" — ");
  return `
    <li>
      <a class="tile" data-status="${item.status}" href="${escapeAttr(href)}" target="_blank" rel="noopener" title="${escapeAttr(title)}">
        <span class="tile-dot" aria-hidden="true"></span>
        <span class="tile-name">${escapeHtml(shortName(item))}</span>
        <span class="tile-hint">${escapeHtml(tileHint(item))}</span>
      </a>
    </li>`;
}

function renderBoard(items) {
  if (!items.length) {
    boardEl.innerHTML = `<div class="empty-state">No status yet — run Collect Status on GitHub.</div>`;
    return;
  }

  const byGroup = new Map();
  for (const item of items) {
    const group = item.group || "Other";
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(item);
  }

  const orderedGroups = [
    ...PANEL_ORDER.filter((g) => byGroup.has(g)),
    ...[...byGroup.keys()].filter((g) => !PANEL_ORDER.includes(g)),
  ];

  boardEl.innerHTML = orderedGroups
    .map(
      (group) => `
      <section class="panel">
        <h2 class="panel-title">${escapeHtml(group)}</h2>
        <ul class="panel-list">${byGroup.get(group).map(renderTile).join("")}</ul>
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

function escapeAttr(str) {
  return escapeHtml(str).replaceAll("'", "&#39;");
}

function render(data) {
  const overall = data.summary?.overall || "unknown";
  overallPill.dataset.status = overall;
  overallLabel.textContent = STATUS_LABELS[overall] || overall;

  const parts = [`${data.dubaiDate || "—"}`, formatRelativeTime(data.generatedAt)];
  if (!data.tokenConfigured) parts.push("· add GH_STATUS_TOKEN for private repos");
  lastUpdated.textContent = parts.join(" ");

  renderCounts(data.summary);
  renderBoard(data.items || []);
}

async function loadStatus() {
  refreshBtn.disabled = true;
  try {
    const response = await fetch(`${STATUS_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    overallPill.dataset.status = "unknown";
    overallLabel.textContent = "Load failed";
    lastUpdated.textContent = error.message;
    boardEl.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener("click", loadStatus);
loadStatus();
setInterval(loadStatus, 5 * 60 * 1000);
