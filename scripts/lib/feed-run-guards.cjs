"use strict";

/**
 * feed-run-guards.cjs — the two acceptance-critical writes of the ADR-427
 * backfill, kept out of the script so they can be tested without a database.
 *
 * Telemetry (tbl_pipeline_runs) and the last_seen_at/synced_at bookkeeping
 * stamps are gates, not best-effort logging: a run that cannot record what it
 * did must not report success. Both return the error message instead of
 * swallowing it, and the caller decides the run outcome.
 */

async function writeTelemetry(db, { pipeline, stats, startedAt, mode }) {
  const { error } = await db.from("tbl_pipeline_runs").insert({
    pipeline,
    run_at: new Date(startedAt).toISOString(),
    status: stats.failed > 0 ? "partial" : "success",
    records_new: stats.succeeded,
    records_total: stats.attempted,
    breakdown: {
      mode,
      attempted: stats.attempted,
      succeeded: stats.succeeded,
      failed: stats.failed,
      unchanged: stats.unchanged,
      ineligible: stats.ineligible,
      withdrawn: stats.withdrawn,
      source_gaps: stats.gaps,
      failures: stats.failures.slice(0, 50),
    },
  });
  return error ? error.message : null;
}

async function touchBookkeeping(db, current, row) {
  const { error } = await db
    .from("tbl_external_raia_listings")
    .update({ last_seen_at: row.last_seen_at, synced_at: row.synced_at })
    .eq("agent_id", current.agent_id)
    .eq("raia_id", current.raia_id);
  return error ? error.message : null;
}

module.exports = { writeTelemetry, touchBookkeeping };
