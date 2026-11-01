#!/usr/bin/env node
/**
 * scripts/raia-protocol-crawl.cjs — RAIA Protocol federated crawl for MoveHome.org.
 *
 * For every approved row in `tbl_raia_agent_registry`, fetches the agent card
 * and validates it against schemas/agent-card.json v0.2, searches the agent and
 * validates each listing against schemas/listing.json v0.2, normalises via
 * lib/raia-protocol-listing-mapper.cjs, and UPSERTs into
 * `tbl_external_raia_listings`.
 *
 * Two card shapes are supported:
 *   - flat A2A v0.2 card (`preferredTransport: "JSONRPC"` + `url`): JSON-RPC 2.0
 *     `message/send` POST to that url, invoking skill `search_properties`
 *   - legacy card (`endpoints.search` / `endpoints.property`): anonymous GET,
 *     one request per listing via the `{raia_id}` placeholder
 *
 * USAGE:
 *   node scripts/raia-protocol-crawl.cjs                 # dry run, all approved agents
 *   node scripts/raia-protocol-crawl.cjs --write         # commit to DB
 *   node scripts/raia-protocol-crawl.cjs --agent-id <id> # single agent only
 *   node scripts/raia-protocol-crawl.cjs --force         # ignore freshness window
 *   node scripts/raia-protocol-crawl.cjs --validate-cards
 *   node scripts/raia-protocol-crawl.cjs --verbose
 *
 * REQUIRED ENV (GitHub Actions secrets):
 *   NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   GITHUB_RUN_ID (optional, set by Actions)
 *
 * EXIT CODES:
 *   0 — success (all candidates ok)
 *   1 — partial (some agents failed, others ok)
 *   2 — total failure (zero agents succeeded out of >0 candidates)
 *   3 — fatal infra error (DB unreachable, missing env)
 *
 * Ported from raia main's raia-protocol-crawl.cjs (commit 4c55b88) with
 * MoveHome-specific adaptations:
 *   - tbl_pipeline_runs writes dropped (raia has it; we don't yet)
 *   - mapper adapted for MoveHome's single-table cache + JSONB blocks
 */

"use strict";

const path = require("node:path");
const fs   = require("node:fs");

const { createClient } = require("@supabase/supabase-js");
const { normaliseListing } = require("./lib/raia-protocol-listing-mapper.cjs");

// ─── Config ─────────────────────────────────────────────────────────────────

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GITHUB_RUN_ID = process.env.GITHUB_RUN_ID ?? null;

const ARGS           = process.argv.slice(2);
const WRITE_MODE     = ARGS.includes("--write");
const DRY_RUN        = !WRITE_MODE || ARGS.includes("--dry-run");
const FORCE          = ARGS.includes("--force");
const VALIDATE_CARDS = ARGS.includes("--validate-cards");
const VERBOSE        = ARGS.includes("--verbose") || ARGS.includes("-v");
const AGENT_ID       = (() => {
  const i = ARGS.indexOf("--agent-id");
  return i >= 0 ? ARGS[i + 1] : null;
})();

const FRESHNESS_WINDOW_MS       = 1000 * 60 * 60 * 3.5;   // 3.5h — schedule is every 4h
const FETCH_TIMEOUT_CARD_MS     = 10_000;
const FETCH_TIMEOUT_SEARCH_MS   = 30_000;
const FETCH_TIMEOUT_LISTING_MS  = 15_000;
const MAX_REDIRECTS             = 3;
const PER_AGENT_LISTING_CAP     = 1000;
const PER_LISTING_CONCURRENCY   = 4;
const MAX_PAGINATED_ITEMS       = 10_000;
const STALE_AFTER_MISSED_CRAWLS = 3;

// Lazy: the module must be requireable from tests without Supabase env.
let sb = null;
function db() {
  if (!sb) {
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return sb;
}

// ─── Logging ────────────────────────────────────────────────────────────────

const ts = () => new Date().toISOString().slice(11, 19);
const log  = (...a) => console.log(`[${ts()}]`, ...a);
const info = (...a) => console.log(`[${ts()}]`, ...a);
const warn = (...a) => console.warn(`[${ts()}] ⚠️ `, ...a);
const err  = (...a) => console.error(`[${ts()}] ❌`, ...a);
const vlog = (...a) => { if (VERBOSE) console.log(`[${ts()}]   ·`, ...a); };

// ─── Schema loading ─────────────────────────────────────────────────────────

const SCHEMAS_DIR = path.join(__dirname, "lib", "schemas");
const AGENT_CARD_SCHEMA = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, "agent-card.json"), "utf8"));
const LISTING_SCHEMA    = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, "listing.json"), "utf8"));

// Lightweight required-field + pattern checks. Avoid an ajv dep.
function checkPattern(value, pattern) {
  if (typeof value !== "string") return false;
  return new RegExp(pattern).test(value);
}

function validateAgentCard(card) {
  const errors = [];
  if (!card || typeof card !== "object") {
    errors.push("agent card is not an object");
    return errors;
  }
  // Flat A2A cards carry protocolVersion + url, not RAIA agent_id/schema_version/endpoints;
  // identity comes from the registry row.
  if (isJsonRpcCard(card)) return errors;
  for (const f of (AGENT_CARD_SCHEMA.required ?? [])) {
    if (!(f in card)) errors.push(`missing required field: ${f}`);
  }
  if (typeof card.schema_version !== "string" ||
      !/^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/.test(card.schema_version)) {
    errors.push("schema_version must be a SemVer-like string");
  }
  if (!checkPattern(card.agent_id, "^org-[a-z]{2}-[a-z0-9-]{2,32}$")) {
    errors.push(`agent_id failed pattern: ${card.agent_id}`);
  }
  // Flat A2A v0.2 cards advertise a JSON-RPC url instead of endpoints.*
  if (isJsonRpcCard(card)) return errors;
  const ep = card.endpoints;
  if (!ep || typeof ep !== "object") {
    errors.push("endpoints object missing");
  } else {
    if (!ep.search || typeof ep.search !== "string" || !/^https?:\/\//.test(ep.search)) {
      errors.push("endpoints.search must be a URI");
    }
    if (!ep.property || typeof ep.property !== "string" || !ep.property.includes("{raia_id}")) {
      errors.push("endpoints.property must contain '{raia_id}' placeholder");
    }
  }
  return errors;
}

function validateListing(listing) {
  const errors = [];
  if (!listing || typeof listing !== "object") {
    errors.push("listing is not an object");
    return errors;
  }
  for (const f of (LISTING_SCHEMA.required ?? [])) {
    if (!(f in listing)) errors.push(`missing required field: ${f}`);
  }
  if (listing.raia_id && !checkPattern(listing.raia_id, "^prop-[a-z]{2}-[a-z0-9-]{2,32}-[0-9]{4,}$")) {
    errors.push(`raia_id failed pattern: ${listing.raia_id}`);
  }
  if (listing.agent_id && !checkPattern(listing.agent_id, "^org-[a-z]{2}-[a-z0-9-]{2,32}$")) {
    errors.push(`agent_id failed pattern: ${listing.agent_id}`);
  }
  if (listing.un_locode && !checkPattern(listing.un_locode, "^[A-Z]{2}[A-Z0-9]{3}$")) {
    errors.push(`un_locode failed pattern: ${listing.un_locode}`);
  }
  if (listing.service_type &&
      !["long_term", "short_term", "sale", "longlet", "shortlet"].includes(listing.service_type)) {
    errors.push(`service_type out of enum: ${listing.service_type}`);
  }
  return errors;
}

// ─── HTTP fetch with timeout + redirects ───────────────────────────────────

const CRAWLER_UA = "movehome-protocol-crawler/0.1 (+https://movehome.org)";

async function fetchJson(url, { timeoutMs, label, method = "GET", headers = {}, body = null }) {
  let currentUrl = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let resp;
    try {
      resp = await fetch(currentUrl, {
        method,
        redirect: "manual",
        signal:   controller.signal,
        headers: {
          "User-Agent": CRAWLER_UA,
          "Accept":     "application/json",
          ...(body == null ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        ...(body == null ? {} : { body: JSON.stringify(body) }),
      });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === "AbortError") {
        throw Object.assign(new Error(`${label} timeout after ${timeoutMs}ms`), { code: "timeout" });
      }
      throw Object.assign(new Error(`${label} fetch failed: ${e.message}`), { code: "network" });
    }
    clearTimeout(timer);

    if (resp.status >= 300 && resp.status < 400) {
      // A redirected JSON-RPC POST would lose its body; treat it as a protocol error.
      if (method !== "GET") {
        throw Object.assign(new Error(`${label} ${resp.status} redirect on ${method}`), { code: "redirect" });
      }
      const loc = resp.headers.get("location");
      if (!loc) throw Object.assign(new Error(`${label} ${resp.status} no Location header`), { code: "redirect" });
      currentUrl = new URL(loc, currentUrl).toString();
      continue;
    }
    if (resp.status === 429) {
      throw Object.assign(new Error(`${label} rate-limited (429)`), { code: "rate_limited" });
    }
    if (!resp.ok) {
      throw Object.assign(new Error(`${label} HTTP ${resp.status}`), { code: `http_${resp.status}` });
    }
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw Object.assign(new Error(`${label} non-JSON body: ${e.message}`), { code: "schema_invalid" });
    }
  }
  throw Object.assign(new Error(`${label} too many redirects`), { code: "redirect" });
}

// ─── Search request building (pure — unit-tested) ───────────────────────────

const PAGE_LIMIT = 50;  // A2A search skill caps limit at 50
const ITEM_KEYS  = ["properties", "results", "listings"];

function isJsonRpcCard(card) {
  return card?.preferredTransport === "JSONRPC" &&
    typeof card.url === "string" && /^https?:\/\//.test(card.url);
}

/**
 * Pure: no fetch, no clock, no env reads. Returns { url, method, headers, body }.
 * `credentials` is { token } or null — anonymous is the default.
 */
function buildSearchRequest(card, params = {}, credentials = null) {
  const headers = {
    "User-Agent": CRAWLER_UA,
    "Accept":     "application/json",
    ...(credentials?.token ? { Authorization: `Bearer ${credentials.token}` } : {}),
  };

  if (isJsonRpcCard(card)) {
    const { offset: _offset, ...skillParams } = params;
    return {
      url:    card.url,
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: {
        jsonrpc: "2.0",
        id:      `movehome-crawl-${params.offset ?? 0}`,
        method:  "message/send",
        params:  {
          message: {
            role:      "user",
            kind:      "message",
            messageId: `movehome-crawl-${params.offset ?? 0}`,
            parts:     [{ kind: "data", data: { skill: "search_properties", params: skillParams } }],
          },
        },
      },
    };
  }

  const url = new URL(card.endpoints.search);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  return { url: url.toString(), method: "GET", headers, body: null };
}

/** JSON-RPC task result → the skill's data object (throws on a failed/error task). */
function jsonRpcData(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (payload.error) {
    throw Object.assign(new Error(`jsonrpc error ${payload.error.code}: ${payload.error.message}`), { code: "schema_invalid" });
  }
  const result = payload.result;
  if (!result || typeof result !== "object") return null;
  const parts = [
    ...(Array.isArray(result.artifacts) ? result.artifacts.flatMap(a => a?.parts ?? []) : []),
    ...(result.status?.message?.parts ?? []),
  ];
  if (result.status?.state === "failed") {
    const text = parts.find(p => p?.kind === "text" && typeof p.text === "string")?.text ?? "no detail";
    throw Object.assign(new Error(`jsonrpc task failed: ${text}`), { code: "schema_invalid" });
  }
  return parts.find(p => p?.kind === "data" && p.data && typeof p.data === "object")?.data ?? null;
}

/** Frozen F4 envelope: bare array, or {properties|results|listings: []} (+ optional total). */
function extractItems(payload) {
  if (Array.isArray(payload)) return { items: payload, total: payload.length };
  const body = jsonRpcData(payload) ?? payload;
  for (const key of ITEM_KEYS) {
    if (Array.isArray(body?.[key])) {
      return { items: body[key], total: Number.isFinite(body.total) ? body.total : null };
    }
  }
  return null;
}

/** Paginated search: advances offset until a short page, the total, or the hard cap. */
async function collectSearchPages(card, params, credentials, fetchPage) {
  const items = [];
  let offset = 0;
  for (;;) {
    const page = extractItems(await fetchPage(buildSearchRequest(card, { ...params, offset }, credentials)));
    if (!page) throw Object.assign(new Error("search payload was not a listings envelope"), { code: "schema_invalid" });
    items.push(...page.items);
    offset += page.items.length;
    if (page.items.length < (params.limit ?? PAGE_LIMIT)) break;
    // shortcut: the A2A search skill has no offset (strict schema) — one page per crawl;
    // upgrade when the skill advertises offset. Legacy endpoints.search does advance.
    if (isJsonRpcCard(card)) break;
    if (page.total != null && offset >= page.total) break;
    if (offset >= MAX_PAGINATED_ITEMS) break;
  }
  return items.slice(0, MAX_PAGINATED_ITEMS);
}

/** A2A search needs un_locode + transaction_type; env wins, LOCODE-shaped registry jurisdictions are the fallback. */
function searchParams(agent) {
  const jurisdictions = Array.isArray(agent.jurisdictions) ? agent.jurisdictions : [];
  const params = {
    transaction_type: process.env.RAIA_A2A_TRANSACTION_TYPE || "LETTINGS",
    limit:            PAGE_LIMIT,
  };
  const locode = process.env.RAIA_A2A_UN_LOCODE || jurisdictions.find(j => checkPattern(j, "^[A-Z]{2}[A-Z0-9]{3}$"));
  if (locode) params.un_locode = locode;
  return params;
}

/** Bearer credentials. DDL-verified: tbl_raia_agent_registry has no credential column, so env is the only live source today. */
function credentialsFor(agent) {
  const token = agent?.agent_token || process.env.RAIA_AGENT_TOKEN || null;
  return token ? { token } : null;
}

// ─── Registry helpers ──────────────────────────────────────────────────────

async function fetchApprovedAgents() {
  let q = db().from("tbl_raia_agent_registry")
    .select("agent_id, agent_card_url, last_crawled_at, last_crawl_status, listing_count_last, jurisdictions")
    .eq("verification_status", "approved")
    .is("revoked_at", null);
  if (AGENT_ID) q = q.eq("agent_id", AGENT_ID);
  const { data, error } = await q;
  if (error) throw new Error(`registry fetch: ${error.message}`);
  return data ?? [];
}

function isStale(agent) {
  if (FORCE) return true;
  if (!agent.last_crawled_at) return true;
  const last = new Date(agent.last_crawled_at).getTime();
  return Date.now() - last > FRESHNESS_WINDOW_MS;
}

async function updateRegistry(agentId, patch) {
  if (DRY_RUN) {
    vlog(`[dry] update registry ${agentId}`, patch);
    return;
  }
  const { error } = await db().from("tbl_raia_agent_registry")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("agent_id", agentId);
  if (error) warn(`registry update ${agentId}: ${error.message}`);
}

// ─── Listing UPSERTs ───────────────────────────────────────────────────────

async function upsertListing(row) {
  if (DRY_RUN) {
    vlog(`[dry] upsert ${row.agent_id} / ${row.raia_id}`);
    return;
  }
  const { error } = await db()
    .from("tbl_external_raia_listings")
    .upsert(row, { onConflict: "agent_id,raia_id" })
    .select("external_id")
    .maybeSingle();
  if (error) throw new Error(`upsert ${row.raia_id}: ${error.message}`);
}

async function markStaleListings(agentId, seenRaiaIds) {
  // Anything we previously stored from this agent that we did NOT see in
  // this run → withdrawn after STALE_AFTER_MISSED_CRAWLS missed cycles.
  const cutoff = new Date(Date.now() - (STALE_AFTER_MISSED_CRAWLS * FRESHNESS_WINDOW_MS)).toISOString();

  const { data: candidates, error: qErr } = await db()
    .from("tbl_external_raia_listings")
    .select("external_id, raia_id, last_seen_at")
    .eq("agent_id", agentId)
    .is("withdrawn_at", null)
    .lt("last_seen_at", cutoff);

  if (qErr) {
    warn(`stale-scan ${agentId}: ${qErr.message}`);
    return 0;
  }

  const toWithdraw = (candidates ?? []).filter(c => !seenRaiaIds.has(c.raia_id));
  if (toWithdraw.length === 0) return 0;

  if (DRY_RUN) {
    vlog(`[dry] would withdraw ${toWithdraw.length} stale listings for ${agentId}`);
    return toWithdraw.length;
  }

  const ids = toWithdraw.map(r => r.external_id);
  const { error: uErr } = await db()
    .from("tbl_external_raia_listings")
    .update({ withdrawn_at: new Date().toISOString() })
    .in("external_id", ids);
  if (uErr) {
    warn(`stale-update ${agentId}: ${uErr.message}`);
    return 0;
  }
  return toWithdraw.length;
}

// ─── Per-agent crawl ───────────────────────────────────────────────────────

async function crawlAgent(agent) {
  const { agent_id, agent_card_url } = agent;
  const summary = {
    agent_id,
    status: "ok",
    listings_seen: 0,
    listings_upserted: 0,
    listings_withdrawn: 0,
    error: null,
  };

  let card;
  try {
    card = await fetchJson(agent_card_url, {
      timeoutMs: FETCH_TIMEOUT_CARD_MS,
      label: `agent-card[${agent_id}]`,
    });
  } catch (e) {
    summary.status = e.code === "rate_limited" ? "rate_limited" : "unreachable";
    summary.error  = e.message;
    return summary;
  }

  const cardErrors = validateAgentCard(card);
  if (cardErrors.length) {
    summary.status = "schema_invalid";
    summary.error  = `agent-card: ${cardErrors.join("; ")}`;
    return summary;
  }
  if (card.agent_id && card.agent_id !== agent_id) {
    warn(`${agent_id}: card agent_id mismatch (${card.agent_id})`);
  }

  if (VALIDATE_CARDS && !FORCE) return summary;

  let searchResults;
  try {
    searchResults = await collectSearchPages(card, searchParams(agent), credentialsFor(agent), req =>
      fetchJson(req.url, {
        timeoutMs: FETCH_TIMEOUT_SEARCH_MS,
        label:     `search[${agent_id}]`,
        method:    req.method,
        headers:   req.headers,
        body:      req.body,
      }));
  } catch (e) {
    summary.status = e.code === "rate_limited" ? "rate_limited"
                   : e.code === "schema_invalid" ? "schema_invalid" : "unreachable";
    summary.error  = e.message;
    return summary;
  }

  if (searchResults.length > PER_AGENT_LISTING_CAP) {
    warn(`${agent_id}: capping ${searchResults.length} listings → ${PER_AGENT_LISTING_CAP}`);
    searchResults = searchResults.slice(0, PER_AGENT_LISTING_CAP);
  }

  const seenRaiaIds = new Set();
  const raiaIds = searchResults
    .map(r => (typeof r === "string" ? r : r?.raia_id))
    .filter(Boolean);

  vlog(`${agent_id}: search returned ${raiaIds.length} raia_ids`);

  // Flat v0.2 cards publish full listing objects from search (no endpoints.property).
  const inlineListings = new Map(
    searchResults.filter(r => r && typeof r === "object" && r.raia_id).map(r => [r.raia_id, r]));
  const propertyTpl = card.endpoints?.property;
  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= raiaIds.length) break;
      const raia_id = raiaIds[idx];
      let listing = inlineListings.get(raia_id);
      if (!listing) {
        if (!propertyTpl) {
          warn(`${agent_id}: listing ${raia_id} not inline and card has no endpoints.property`);
          continue;
        }
        try {
          listing = await fetchJson(propertyTpl.replace("{raia_id}", encodeURIComponent(raia_id)), {
            timeoutMs: FETCH_TIMEOUT_LISTING_MS,
            label: `listing[${agent_id}/${raia_id}]`,
          });
        } catch (e) {
          warn(`${agent_id}: listing ${raia_id} fetch failed: ${e.message}`);
          continue;
        }
      }
      const lerrs = validateListing(listing);
      if (lerrs.length) {
        warn(`${agent_id}: listing ${raia_id} schema invalid: ${lerrs.join("; ")}`);
        continue;
      }
      summary.listings_seen++;
      try {
        const { row, warnings } = normaliseListing(listing, {
          agent_id,
          agent_card_url,
          schema_version: card.schema_version ?? card.protocolVersion,
        });
        if (warnings.length) vlog(`${agent_id}: ${raia_id} warnings:`, warnings);
        await upsertListing(row);
        summary.listings_upserted++;
        seenRaiaIds.add(row.raia_id);
      } catch (e) {
        warn(`${agent_id}: listing ${raia_id} normalise/upsert failed: ${e.message}`);
      }
    }
  }

  const workers = Array.from({ length: PER_LISTING_CONCURRENCY }, () => worker());
  await Promise.all(workers);

  summary.listings_withdrawn = await markStaleListings(agent_id, seenRaiaIds);
  return summary;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();
  info(`raia-protocol-crawl ${DRY_RUN ? "(dry-run)" : "(write)"}` +
       (AGENT_ID ? ` agent_id=${AGENT_ID}` : "") +
       (FORCE ? " --force" : "") +
       (VALIDATE_CARDS ? " --validate-cards" : "") +
       (GITHUB_RUN_ID ? ` run=${GITHUB_RUN_ID}` : ""));

  let agents;
  try {
    agents = await fetchApprovedAgents();
  } catch (e) {
    err(`registry fetch: ${e.message}`);
    process.exit(3);
  }

  info(`approved agents: ${agents.length}`);
  if (agents.length === 0) {
    info("no approved agents — exiting cleanly");
    return 0;
  }

  const candidates = (FORCE || VALIDATE_CARDS) ? agents : agents.filter(isStale);
  info(`crawling ${candidates.length} of ${agents.length} agent(s)` +
       (candidates.length < agents.length ? " (rest within freshness window)" : ""));

  const rollup = {
    agents_total:          candidates.length,
    agents_ok:             0,
    agents_unreachable:    0,
    agents_schema_invalid: 0,
    agents_rate_limited:   0,
    listings_seen:         0,
    listings_upserted:     0,
    listings_withdrawn:    0,
  };

  for (const agent of candidates) {
    info(`-- ${agent.agent_id} (${agent.agent_card_url})`);
    let summary;
    try {
      summary = await crawlAgent(agent);
    } catch (e) {
      err(`${agent.agent_id} unhandled: ${e.message}`);
      summary = {
        agent_id: agent.agent_id, status: "unreachable",
        listings_seen: 0, listings_upserted: 0, listings_withdrawn: 0,
        error: e.message,
      };
    }

    rollup[`agents_${summary.status}`] = (rollup[`agents_${summary.status}`] ?? 0) + 1;
    rollup.listings_seen      += summary.listings_seen;
    rollup.listings_upserted  += summary.listings_upserted;
    rollup.listings_withdrawn += summary.listings_withdrawn;

    info(`   ${summary.status} — seen=${summary.listings_seen} upserted=${summary.listings_upserted} withdrawn=${summary.listings_withdrawn}` +
         (summary.error ? ` err=${summary.error}` : ""));

    await updateRegistry(agent.agent_id, {
      last_crawled_at:    new Date().toISOString(),
      last_crawl_status:  summary.status,
      last_crawl_error:   summary.error,
      listing_count_last: summary.listings_seen,
    });
  }

  let pipelineStatus = "success";
  const oks = rollup.agents_ok;
  const failed = candidates.length - oks;
  if (failed > 0 && oks > 0) pipelineStatus = "partial";
  if (oks === 0 && candidates.length > 0) pipelineStatus = "failure";

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  info(`done in ${elapsed}s — ${pipelineStatus} ` +
       `agents ok=${rollup.agents_ok} unreachable=${rollup.agents_unreachable} ` +
       `schema_invalid=${rollup.agents_schema_invalid} rate_limited=${rollup.agents_rate_limited} ` +
       `listings seen=${rollup.listings_seen} upserted=${rollup.listings_upserted} ` +
       `withdrawn=${rollup.listings_withdrawn}`);

  if (pipelineStatus === "failure") return 2;
  if (pipelineStatus === "partial") return 1;
  return 0;
}

module.exports = { buildSearchRequest, extractItems, collectSearchPages, isJsonRpcCard };

if (require.main === module) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(3);
  }
  main()
    .then(code => process.exit(code))
    .catch(e => {
      err(`fatal: ${e.stack || e.message}`);
      process.exit(3);
    });
}
