#!/usr/bin/env node
/**
 * Collects health status for E-GEEK automations.
 * Runs in GitHub Actions with optional GH_STATUS_TOKEN for private repos.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const config = JSON.parse(readFileSync(join(root, "config", "services.json"), "utf8"));

const TIMEOUT_MS = 15000;
const githubToken = process.env.GH_STATUS_TOKEN || process.env.GITHUB_TOKEN || "";

function nowIso() {
  return new Date().toISOString();
}

function dubaiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const latencyMs = Date.now() - started;
    const contentType = response.headers.get("content-type") || "";
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "";
    }
    return { response, latencyMs, contentType, bodyText };
  } finally {
    clearTimeout(timer);
  }
}

function statusFromHttp(ok, message, extra = {}) {
  return {
    status: ok ? "healthy" : "unhealthy",
    message,
    ...extra,
  };
}

async function checkJsonApi(item) {
  const checkedAt = nowIso();
  try {
    const { response, latencyMs, bodyText } = await fetchWithTimeout(item.url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return {
        id: item.id,
        name: item.name,
        group: item.group,
        kind: "api",
        link: item.link,
        repo: item.repo,
        checkedAt,
        latencyMs,
        httpStatus: response.status,
        ...statusFromHttp(false, `HTTP ${response.status}`),
      };
    }

    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      return {
        id: item.id,
        name: item.name,
        group: item.group,
        kind: "api",
        link: item.link,
        repo: item.repo,
        checkedAt,
        latencyMs,
        httpStatus: response.status,
        ...statusFromHttp(false, "Invalid JSON response"),
      };
    }

    const missing = (item.expectFields || []).filter((field) => !(field in data));
    if (missing.length) {
      return {
        id: item.id,
        name: item.name,
        group: item.group,
        kind: "api",
        link: item.link,
        repo: item.repo,
        checkedAt,
        latencyMs,
        httpStatus: response.status,
        ...statusFromHttp(false, `Missing fields: ${missing.join(", ")}`),
        detail: data,
      };
    }

    const summary = {};
    if (data.reference) summary.reference = data.reference;
    if (data.generated_at) summary.generatedAt = data.generated_at;
    if (data.cached !== undefined) summary.cached = data.cached;
    if (data.date) summary.date = data.date;

    return {
      id: item.id,
      name: item.name,
      group: item.group,
      kind: "api",
      link: item.link,
      repo: item.repo,
      checkedAt,
      latencyMs,
      httpStatus: response.status,
      ...statusFromHttp(true, "OK"),
      summary,
    };
  } catch (error) {
    return {
      id: item.id,
      name: item.name,
      group: item.group,
      kind: "api",
      link: item.link,
      repo: item.repo,
      checkedAt,
      ...statusFromHttp(false, error.name === "AbortError" ? "Timeout" : error.message),
    };
  }
}

async function checkRssApi(item) {
  const checkedAt = nowIso();
  try {
    const { response, latencyMs, bodyText } = await fetchWithTimeout(item.url);
    const hasRss = bodyText.includes("<rss") && bodyText.includes("<channel>");
    return {
      id: item.id,
      name: item.name,
      group: item.group,
      kind: "api",
      link: item.link,
      repo: item.repo,
      checkedAt,
      latencyMs,
      httpStatus: response.status,
      ...statusFromHttp(response.ok && hasRss, response.ok && hasRss ? "RSS OK" : "RSS invalid or HTTP error"),
    };
  } catch (error) {
    return {
      id: item.id,
      name: item.name,
      group: item.group,
      kind: "api",
      link: item.link,
      repo: item.repo,
      checkedAt,
      ...statusFromHttp(false, error.name === "AbortError" ? "Timeout" : error.message),
    };
  }
}

async function checkSite(item) {
  const checkedAt = nowIso();
  try {
    const { response, latencyMs, bodyText } = await fetchWithTimeout(item.url);
    const hasHtml = bodyText.toLowerCase().includes("<html");
    return {
      id: item.id,
      name: item.name,
      group: item.group,
      kind: "site",
      link: item.link,
      repo: item.repo,
      checkedAt,
      latencyMs,
      httpStatus: response.status,
      ...statusFromHttp(response.ok && hasHtml, response.ok && hasHtml ? "Site reachable" : `HTTP ${response.status}`),
    };
  } catch (error) {
    return {
      id: item.id,
      name: item.name,
      group: item.group,
      kind: "site",
      link: item.link,
      repo: item.repo,
      checkedAt,
      ...statusFromHttp(false, error.name === "AbortError" ? "Timeout" : error.message),
    };
  }
}

async function checkProtectedApi(item) {
  const checkedAt = nowIso();
  const secret = process.env[item.secretEnv];

  if (!secret) {
    return {
      id: item.id,
      name: item.name,
      group: item.group,
      kind: "protected-api",
      link: item.link,
      repo: item.repo,
      checkedAt,
      status: "unknown",
      message: `Secret ${item.secretEnv} not configured`,
      note: item.note,
    };
  }

  try {
    const headers = {
      Accept: "application/json",
      [item.authHeader]: `${item.authPrefix || ""}${secret}`,
    };
    const { response, latencyMs, bodyText } = await fetchWithTimeout(item.url, { headers });
    let message = `HTTP ${response.status}`;
    if (response.ok) message = "Authenticated endpoint OK";
    else if (response.status === 401 || response.status === 403) message = "Auth failed — check secret";

    return {
      id: item.id,
      name: item.name,
      group: item.group,
      kind: "protected-api",
      link: item.link,
      repo: item.repo,
      checkedAt,
      latencyMs,
      httpStatus: response.status,
      ...statusFromHttp(response.ok, message),
      note: item.note,
    };
  } catch (error) {
    return {
      id: item.id,
      name: item.name,
      group: item.group,
      kind: "protected-api",
      link: item.link,
      repo: item.repo,
      checkedAt,
      ...statusFromHttp(false, error.name === "AbortError" ? "Timeout" : error.message),
      note: item.note,
    };
  }
}

async function githubRequest(path) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "e-geek-mission-control",
  };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (response.status === 404) return { notFound: true, status: 404 };
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function checkWorkflow(item) {
  const checkedAt = nowIso();
  const owner = config.owner;

  try {
    const workflowPath = `/repos/${owner}/${item.repo}/actions/workflows/${item.workflowFile}`;
    let workflow;
    try {
      workflow = await githubRequest(workflowPath);
    } catch (error) {
      if (!githubToken) {
        return {
          id: item.id,
          name: item.name,
          group: item.group,
          kind: "workflow",
          link: item.link,
          repo: item.repo,
          checkedAt,
          status: "unknown",
          message: "Private repo — set GH_STATUS_TOKEN secret",
          scheduleHint: item.scheduleHint,
        };
      }
      throw error;
    }

    if (workflow.notFound) {
      return {
        id: item.id,
        name: item.name,
        group: item.group,
        kind: "workflow",
        link: item.link,
        repo: item.repo,
        checkedAt,
        status: "unknown",
        message: "Workflow not found or no access",
        scheduleHint: item.scheduleHint,
      };
    }

    const runs = await githubRequest(`${workflowPath}/runs?per_page=1`);
    const run = runs.workflow_runs?.[0];

    if (!run) {
      return {
        id: item.id,
        name: item.name,
        group: item.group,
        kind: "workflow",
        link: item.link,
        repo: item.repo,
        checkedAt,
        status: "unknown",
        message: "No runs yet",
        scheduleHint: item.scheduleHint,
      };
    }

    const conclusion = run.conclusion || run.status;
    const healthy = conclusion === "success";
    const skipped = conclusion === "skipped";

    return {
      id: item.id,
      name: item.name,
      group: item.group,
      kind: "workflow",
      link: item.link,
      repo: item.repo,
      checkedAt,
      status: healthy ? "healthy" : skipped ? "skipped" : conclusion === "failure" ? "unhealthy" : "unknown",
      message: healthy ? "Last run succeeded" : `Last run: ${conclusion}`,
      lastRun: {
        id: run.id,
        event: run.event,
        status: run.status,
        conclusion: run.conclusion,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
        htmlUrl: run.html_url,
      },
      scheduleHint: item.scheduleHint,
    };
  } catch (error) {
    return {
      id: item.id,
      name: item.name,
      group: item.group,
      kind: "workflow",
      link: item.link,
      repo: item.repo,
      checkedAt,
      status: "unknown",
      message: error.message,
      scheduleHint: item.scheduleHint,
    };
  }
}

function summarize(items) {
  const counts = { healthy: 0, unhealthy: 0, unknown: 0, skipped: 0 };
  for (const item of items) {
    counts[item.status] = (counts[item.status] || 0) + 1;
  }
  const overall =
    counts.unhealthy > 0 ? "unhealthy" : counts.unknown > 0 ? "degraded" : "healthy";
  return { overall, counts };
}

async function main() {
  const apiResults = await Promise.all(
    config.apis.map((item) => (item.type === "rss" ? checkRssApi(item) : checkJsonApi(item)))
  );
  const siteResults = await Promise.all(config.sites.map(checkSite));
  const protectedResults = await Promise.all((config.optionalApis || []).map(checkProtectedApi));
  const workflowResults = await Promise.all(config.workflows.map(checkWorkflow));

  const all = [...apiResults, ...siteResults, ...protectedResults, ...workflowResults];
  const summary = summarize(all);

  const payload = {
    generatedAt: nowIso(),
    dubaiDate: dubaiDate(),
    timezone: config.timezone,
    tokenConfigured: Boolean(process.env.GH_STATUS_TOKEN),
    summary,
    items: all,
  };

  const outPath = join(root, "data", "status.json");
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(`Overall: ${summary.overall}`, summary.counts);

  if (summary.overall === "unhealthy") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
