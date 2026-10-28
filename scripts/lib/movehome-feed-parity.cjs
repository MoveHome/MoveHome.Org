"use strict";

/**
 * movehome-feed-parity.cjs — pure source-fidelity checks for the ADR-427
 * canonical-snapshot → tbl_external_raia_listings backfill.
 *
 * Two jobs:
 *   1. checkParity(snapshot, row) — every field the snapshot populates must
 *      survive the mapping into the public cache. A source-populated field that
 *      arrives NULL is mapper loss and fails the item. A field the source does
 *      not populate is recorded as a gap (never fabricated, never a failure).
 *   2. changedFields(current, next) — idempotency: only differing columns are
 *      written, so a rerun over an unchanged snapshot writes nothing.
 */

// Fields compared for parity, in the order the public card reads them.
const PARITY_FIELDS = [
  "raia_id",
  "service_type",
  "rent_pcm",
  "daily_rate",
  "asking_price",
  "currency",
  "furnishing",
  "available_from",
  "marketing_description",
  "headline",
  "bedrooms",
  "bathrooms",
];

// Columns the backfill is allowed to write. Everything else on the shared
// table (enquiries, provenance, flags, first_seen_at) belongs to other writers.
const WRITABLE_COLUMNS = [
  ...PARITY_FIELDS,
  "agent_id",
  "agent_card_url",
  "enquiry_endpoint",
  "raia_schema_version",
  "property_type",
  "floor_area_sqm",
  "floor",
  "total_floors",
  "is_new_build",
  "development_name",
  "location",
  "latitude",
  "longitude",
  "postcode_full",
  "postcode_district",
  "postcode_sector",
  "street_name",
  "building_number",
  "suburb",
  "un_locode",
  "pricing_id",
  "listing_status",
  "visibility",
  "publish_from",
  "publish_until",
  "features",
  "media",
  "provenance",
  "jurisdiction_extensions",
  "photo_url",
  "photo_count",
  "listed_at",
  "last_seen_at",
  "withdrawn_at",
  "snapshot_version",
  "synced_at",
];

const MEDIA_FIELDS = ["featured_image_url", "photo_url", "floor_plan_url", "video_url", "tour_360_url"];

function isPopulated(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * Compare the canonical snapshot listing against the mapped cache row.
 *
 * @returns {{ mismatches: string[], gaps: string[] }}
 *   mismatches — source-populated field lost in the mapping (item must fail)
 *   gaps       — field the source itself does not populate (reported, not failed)
 */
function checkParity(snapshot, row) {
  const mismatches = [];
  const gaps = [];

  for (const field of PARITY_FIELDS) {
    if (field === "raia_id") {
      if (snapshot.raia_id !== row.raia_id) mismatches.push(`raia_id ${snapshot.raia_id} → ${row.raia_id}`);
      continue;
    }
    if (!isPopulated(snapshot[field])) { gaps.push(field); continue; }
    if (!isPopulated(row[field])) mismatches.push(`${field} lost (source=${JSON.stringify(snapshot[field])})`);
    else if (String(snapshot[field]) !== String(row[field])) {
      mismatches.push(`${field} changed (source=${JSON.stringify(snapshot[field])} row=${JSON.stringify(row[field])})`);
    }
  }

  // Media: the photo set is the field ADR-427 exists to restore, so it is
  // compared in full — every source photo URL must appear in order.
  const sourcePhotos = Array.isArray(snapshot?.media?.photos) ? snapshot.media.photos : [];
  const rowPhotos = Array.isArray(row?.media?.photos) ? row.media.photos : [];
  if (sourcePhotos.length === 0) gaps.push("media.photos");
  else if (rowPhotos.length !== sourcePhotos.length) {
    mismatches.push(`media.photos count ${sourcePhotos.length} → ${rowPhotos.length}`);
  } else {
    for (let i = 0; i < sourcePhotos.length; i++) {
      if (sourcePhotos[i]?.url !== rowPhotos[i]?.url) {
        mismatches.push(`media.photos[${i}] url differs`);
        break;
      }
    }
    if (row.photo_count !== sourcePhotos.length) {
      mismatches.push(`photo_count ${sourcePhotos.length} → ${row.photo_count}`);
    }
  }
  for (const f of MEDIA_FIELDS) {
    if (!isPopulated(snapshot?.media?.[f])) continue;
    if (snapshot.media[f] !== row?.media?.[f]) mismatches.push(`media.${f} lost`);
  }

  return { mismatches, gaps };
}

// PostgREST returns geography as WKB hex while the mapper writes WKT, so this
// column can never compare equal. It is derived from latitude/longitude (which
// are compared), so it is written alongside them instead of being diffed.
const DERIVED_COLUMNS = ["location"];

const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

function sameValue(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  // Same instant, different rendering ("...250Z" vs "...25+00:00") is not a change.
  if (typeof a === "string" && typeof b === "string" && ISO_TS_RE.test(a) && ISO_TS_RE.test(b)) {
    return Date.parse(a) === Date.parse(b);
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Columns whose value differs between the live cache row and the mapped row. */
function changedFields(current, next) {
  const changed = [];
  for (const col of WRITABLE_COLUMNS) {
    if (DERIVED_COLUMNS.includes(col)) continue;
    if (!sameValue(current?.[col], next?.[col])) changed.push(col);
  }
  return changed;
}

/** Load-independent summary of a run, used for the report and telemetry. */
function newStats() {
  return { attempted: 0, succeeded: 0, failed: 0, unchanged: 0, ineligible: 0, withdrawn: 0, gaps: {}, failures: [] };
}

function countGap(stats, field) {
  stats.gaps[field] = (stats.gaps[field] ?? 0) + 1;
}

module.exports = { PARITY_FIELDS, WRITABLE_COLUMNS, DERIVED_COLUMNS, checkParity, changedFields, sameValue, newStats, countGap, isPopulated };
