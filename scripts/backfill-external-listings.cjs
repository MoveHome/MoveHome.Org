#!/usr/bin/env node
"use strict";

/**
 * backfill-external-listings.cjs — ADR-427 Stage 3.
 *
 * Re-hydrates this (MoveHome) public cache `tbl_external_raia_listings` from
 * RAIA's canonical `tbl_asset_snapshots.snapshot_listing` — media, furnishing,
 * availability, rent and descriptions — with per-field source-fidelity gates.
 *
 * Contract (ADR-427 D3/D5/D6):
 *   - The snapshot is the ONLY source; nothing is read from AppSheet/MySQL here.
 *   - A listing without a canonical snapshot is INELIGIBLE: it is reported with
 *     its gap, never published, and its expected NULLs are never mismatches.
 *   - A source-populated field that the mapping loses FAILS that item only.
 *   - A field the source does not populate is a reported gap, never invented
 *     (this is why TH rows with no source price keep rent_pcm = NULL).
 *   - Idempotent: only columns that actually differ are written; a rerun over an
 *     unchanged snapshot writes nothing.
 *
 * USAGE
 *   node scripts/backfill-external-listings.cjs                          # dry run
 *   node scripts/backfill-external-listings.cjs --raia-ids ids.txt       # narrowed cohort
 *   node scripts/backfill-external-listings.cjs --write --report-json /tmp/r.json
 *
 * ENV
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   this project (cache)
 *   RAIA_SUPABASE_URL / RAIA_SUPABASE_SERVICE_ROLE_KEY     RAIA primary (canonical)
 */

const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const { normaliseListing } = require("./lib/raia-protocol-listing-mapper.cjs");
const { checkParity, changedFields, newStats, countGap } = require("./lib/movehome-feed-parity.cjs");
const { writeTelemetry, touchBookkeeping } = require("./lib/feed-run-guards.cjs");

// ── Env ───────────────────────────────────────────────────────────────────────
const envLocal = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envLocal)) require("dotenv").config({ path: envLocal, quiet: true });

const CACHE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const CACHE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RAIA_URL = process.env.RAIA_SUPABASE_URL;
const RAIA_KEY = process.env.RAIA_SUPABASE_SERVICE_ROLE_KEY;

if (!CACHE_URL || !CACHE_KEY) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
if (!RAIA_URL || !RAIA_KEY) { console.error("Missing RAIA_SUPABASE_URL or RAIA_SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

// ── Args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
const idsIdx = argv.indexOf("--raia-ids");
const reportIdx = argv.indexOf("--report-json");
const REPORT_PATH = reportIdx !== -1 ? argv[reportIdx + 1] : null;
const ONLY_IDS = idsIdx !== -1
  ? fs.readFileSync(argv[idsIdx + 1], "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
  : null;

const cache = createClient(CACHE_URL, CACHE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const raia = createClient(RAIA_URL, RAIA_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const PAGE = 500;

async function loadCohort() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let q = cache
      .from("tbl_external_raia_listings")
      .select("*") // a real diff needs the live values of every writable column
      .order("raia_id")
      .range(from, from + PAGE - 1);
    if (ONLY_IDS) q = q.in("raia_id", ONLY_IDS);
    const { data, error } = await q;
    if (error) throw new Error(`cache cohort read failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** raia_id → { asset_id, snapshot_listing } for the cohort. */
async function loadCanonical(raiaIds) {
  const out = new Map();
  for (let i = 0; i < raiaIds.length; i += 200) {
    const chunk = raiaIds.slice(i, i + 200);
    const { data: assets, error } = await raia
      .from("tbl_assets").select("asset_id, raia_id, organisation_id").in("raia_id", chunk);
    if (error) throw new Error(`tbl_assets read failed: ${error.message}`);
    if (!assets?.length) continue;
    const { data: snaps, error: snapErr } = await raia
      .from("tbl_asset_snapshots").select("asset_id, snapshot_listing")
      .in("asset_id", assets.map((a) => a.asset_id));
    if (snapErr) throw new Error(`tbl_asset_snapshots read failed: ${snapErr.message}`);
    const snapByAsset = new Map((snaps ?? []).map((s) => [s.asset_id, s.snapshot_listing]));
    for (const a of assets) {
      out.set(a.raia_id, { organisation_id: a.organisation_id, listing: snapByAsset.get(a.asset_id) ?? null });
    }
  }
  return out;
}

async function main() {
  const startedAt = Date.now();
  console.log(`\nMOVEHOME CACHE BACKFILL (ADR-427) | mode=${WRITE ? "WRITE" : "DRY RUN"}`);

  const cohort = await loadCohort();
  console.log(`  cohort: ${cohort.length} cache row(s)`);
  const canonical = await loadCanonical(cohort.map((r) => r.raia_id));

  const stats = newStats();
  const report = [];

  for (const current of cohort) {
    stats.attempted++;
    const canon = canonical.get(current.raia_id);
    if (!canon) { stats.ineligible++; countGap(stats, "raia_asset_missing"); report.push({ raia_id: current.raia_id, outcome: "ineligible", reason: "raia_asset_missing" }); continue; }
    if (!canon.listing) { stats.ineligible++; countGap(stats, "no_canonical_snapshot"); report.push({ raia_id: current.raia_id, outcome: "ineligible", reason: "no_canonical_snapshot" }); continue; }

    let mapped;
    try {
      mapped = normaliseListing(canon.listing, {
        agent_id: canon.listing.agent_id,
        agent_card_url: canon.listing.agent_card_url,
        schema_version: canon.listing.raia_schema_version || "0.2",
      });
    } catch (err) {
      stats.failed++; stats.failures.push({ raia_id: current.raia_id, reason: `mapper: ${err.message}` });
      report.push({ raia_id: current.raia_id, outcome: "failed", reason: `mapper: ${err.message}` });
      continue;
    }

    const { mismatches, gaps } = checkParity(canon.listing, mapped.row);
    for (const g of gaps) countGap(stats, g);
    if (mismatches.length) {
      stats.failed++;
      stats.failures.push({ raia_id: current.raia_id, reason: "source fidelity", mismatches });
      report.push({ raia_id: current.raia_id, outcome: "failed", mismatches });
      continue;
    }

    // Publication identity belongs to the cache row already on the table (the
    // registered agent that owns this card). The snapshot derives agent_id from
    // the raia_id slug, which need not exist in tbl_raia_agent_registry, so a
    // content backfill never rewrites it.
    mapped.row.agent_id = current.agent_id;

    const changed = changedFields(current, mapped.row);
    // last_seen_at / synced_at are "seen now" stamps, not content: refreshing them
    // on every run is the whole point of the column, so they never count as churn.
    const BOOKKEEPING = ["last_seen_at", "synced_at"];
    const contentChanged = changed.filter((c) => !BOOKKEEPING.includes(c));
    if (contentChanged.length === 0) {
      stats.unchanged++;
      if (WRITE && changed.length) {
        // A failed "seen now" stamp means the row was NOT touched: report it as
        // a failure rather than as unchanged.
        const stampErr = await touchBookkeeping(cache, current, mapped.row);
        if (stampErr) {
          stats.failed++;
          stats.failures.push({ raia_id: current.raia_id, reason: `bookkeeping: ${stampErr}` });
          report.push({ raia_id: current.raia_id, outcome: "failed", reason: `bookkeeping: ${stampErr}` });
          continue;
        }
      }
      report.push({ raia_id: current.raia_id, outcome: "unchanged", bookkeeping_only: changed.length > 0 });
      continue;
    }

    if (!WRITE) {
      stats.succeeded++;
      console.log(`  [would-write] ${current.raia_id} cols=${contentChanged.join(",")} media=${mapped.row.photo_count} rent=${mapped.row.rent_pcm ?? "-"}`);
      report.push({ raia_id: current.raia_id, outcome: "would_write", columns: contentChanged });
      continue;
    }

    const { error } = await cache.from("tbl_external_raia_listings")
      // external_id is the table PK with its own default — sending it back would
      // collide when the row is matched on (agent_id, raia_id) instead.
      .upsert(mapped.row, { onConflict: "agent_id,raia_id" });
    if (error) {
      stats.failed++; stats.failures.push({ raia_id: current.raia_id, reason: `write: ${error.message}` });
      report.push({ raia_id: current.raia_id, outcome: "failed", reason: `write: ${error.message}` });
      continue;
    }
    stats.succeeded++;
    console.log(`  [written ] ${current.raia_id} cols=${contentChanged.join(",")} media=${mapped.row.photo_count} rent=${mapped.row.rent_pcm ?? "-"}`);
    report.push({ raia_id: current.raia_id, outcome: "written", columns: contentChanged });
  }

  const telemetryErr = await writeTelemetry(raia, {
    pipeline: "movehome_feed_backfill",
    stats,
    startedAt,
    mode: WRITE ? "write" : "dry_run",
  });
  if (telemetryErr) {
    console.error(`  telemetry insert failed: ${telemetryErr}`);
    // A gated --write run without its tbl_pipeline_runs audit record is not a
    // successful run, whatever it wrote.
    if (WRITE) stats.failed++;
  }

  const gapSummary = Object.entries(stats.gaps).map(([k, v]) => `${k}=${v}`).join(" ") || "none";
  console.log(`\n  attempted=${stats.attempted} written=${stats.succeeded} unchanged=${stats.unchanged} ineligible=${stats.ineligible} failed=${stats.failed}`);
  console.log(`  source gaps: ${gapSummary}`);
  for (const f of stats.failures) console.log(`  FAILED ${f.raia_id}: ${JSON.stringify(f.mismatches ?? f.reason)}`);
  if (!WRITE) console.log(`  DRY RUN — re-run with --write.`);

  if (REPORT_PATH) {
    fs.writeFileSync(REPORT_PATH, JSON.stringify({ mode: WRITE ? "write" : "dry_run", stats, items: report }, null, 2));
    console.log(`  report: ${REPORT_PATH}`);
  }
  if (stats.failed) process.exitCode = 1;
}

main().catch((err) => { console.error("fatal:", err.message); process.exit(1); });
