/**
 * scripts/lib/raia-protocol-listing-mapper.cjs
 *
 * Normalises a RAIA Protocol v0.2 listing payload into the row shape
 * expected by MoveHome's `tbl_external_raia_listings`.
 *
 * Differences from raia main's mapper:
 *   - Single `currency` field (raia has rent_currency / sale_currency split).
 *   - `marketing_description` (raia uses `description`).
 *   - Stores `media`, `provenance`, `jurisdiction_extensions` JSONB verbatim
 *     so the protocol payload round-trips with no loss.
 *   - No `property_type_group` column on MoveHome.
 *   - Includes street_name / building_number / postcode_full / pricing_id /
 *     publish_from / publish_until / visibility — fields raia doesn't store
 *     on its federated cache (since raia's cache is for valuation comps,
 *     not consumer search).
 *
 * Inputs are validated upstream against `schemas/listing.json` (v0.2).
 * Returns `{ row, warnings: [] }`.
 */

"use strict";

// v0.1 → v0.2 backwards compatibility for service_type.
const SERVICE_TYPE_MAP = {
  long_term:  "long_term",
  short_term: "short_term",
  sale:       "sale",
  longlet:    "long_term",
  shortlet:   "short_term",
};

const ISO_CURRENCY_RE  = /^[A-Z]{3}$/;
const UN_LOCODE_RE     = /^[A-Z]{2}[A-Z0-9]{3}$/;
const POSTCODE_FULL_RE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;

function asNumberOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asIntOrNull(v) {
  const n = asNumberOrNull(v);
  return n == null ? null : Math.trunc(n);
}

function asTrimmedStringOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function asBoolOrNull(v) {
  if (v === true || v === false) return v;
  return null;
}

function asArrayOrNull(v) {
  return Array.isArray(v) ? v : null;
}

function asObjectOrNull(v) {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
  return v;
}

// MoveHome's property_type column is a closed enum
// (flat | house | studio | commercial | land | other) while RAIA stores free
// text ("Flat", "apartment", ...). Lower-case, then bucket anything outside the
// enum as other — the column cannot hold the detail and inventing a category
// would be worse than the honest bucket.
const PROPERTY_TYPE_ENUM = new Set(["flat", "house", "studio", "commercial", "land", "other"]);

function normalisePropertyType(v) {
  const s = asTrimmedStringOrNull(v);
  if (!s) return null;
  const lower = s.toLowerCase();
  return PROPERTY_TYPE_ENUM.has(lower) ? lower : "other";
}

function postcodeSector(full) {
  if (!full) return null;
  const m = String(full).toUpperCase().match(POSTCODE_FULL_RE);
  if (!m) return null;
  const outward = m[1];
  const inwardFirst = m[2][0];
  return `${outward} ${inwardFirst}`;
}

function postcodeDistrict(full, fallbackDistrict) {
  const explicit = asTrimmedStringOrNull(fallbackDistrict);
  if (explicit) return explicit.toUpperCase();
  if (!full) return null;
  const m = String(full).toUpperCase().match(POSTCODE_FULL_RE);
  return m ? m[1] : null;
}

// PostGIS WKT — Supabase parses SRID=4326;POINT(lon lat) for geography columns.
function locationWkt(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return `SRID=4326;POINT(${lon} ${lat})`;
}

function pickPhotoUrl(media) {
  if (!media || typeof media !== "object") return { url: null, count: 0 };
  let url = asTrimmedStringOrNull(media.featured_image_url);
  let count = 0;
  if (Array.isArray(media.photos)) {
    count = media.photos.length;
    if (!url && count > 0) {
      const sorted = media.photos
        .filter(p => p && asTrimmedStringOrNull(p.url))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      if (sorted.length > 0) url = asTrimmedStringOrNull(sorted[0].url);
    }
  }
  if (!url) url = asTrimmedStringOrNull(media.photo_url);
  return { url, count };
}

/**
 * @param {object} listing  Raw v0.2 listing JSON (already schema-validated).
 * @param {object} ctx      { agent_id, agent_card_url, schema_version }
 * @returns {{ row: object, warnings: string[] }}
 */
function normaliseListing(listing, ctx) {
  const warnings = [];

  // ── Service type ────────────────────────────────────────────────────────
  const rawServiceType = asTrimmedStringOrNull(listing.service_type);
  const service_type   = SERVICE_TYPE_MAP[rawServiceType];
  if (!service_type) throw new Error(`Unknown service_type: ${rawServiceType}`);

  // ── Location ────────────────────────────────────────────────────────────
  const lat = asNumberOrNull(listing?.location?.lat);
  const lon = asNumberOrNull(listing?.location?.lon);

  const un_locode = asTrimmedStringOrNull(listing.un_locode)?.toUpperCase() ?? null;
  if (un_locode && !UN_LOCODE_RE.test(un_locode)) {
    warnings.push(`un_locode failed regex: ${un_locode}`);
  }

  const postcode_full     = asTrimmedStringOrNull(listing.postcode_full);
  const postcode_district = postcodeDistrict(postcode_full, listing.postcode_district);
  const postcode_sector   = postcodeSector(postcode_full);

  // ── Pricing (whole-currency integers per v0.2) ──────────────────────────
  const currency = asTrimmedStringOrNull(listing.currency);
  if (currency && !ISO_CURRENCY_RE.test(currency)) {
    warnings.push(`Non-ISO currency: ${currency}`);
  }
  const rent_pcm     = service_type === "long_term"  ? asIntOrNull(listing.rent_pcm)     : null;
  const daily_rate   = service_type === "short_term" ? asIntOrNull(listing.daily_rate)   : null;
  const asking_price = service_type === "sale"       ? asIntOrNull(listing.asking_price) : null;

  // ── Media ───────────────────────────────────────────────────────────────
  const mediaBlock = asObjectOrNull(listing.media);
  const { url: photo_url, count: photo_count } = pickPhotoUrl(mediaBlock);

  // ── Withdrawn check ─────────────────────────────────────────────────────
  const status = asTrimmedStringOrNull(listing.listing_status);
  let withdrawn_at = null;
  if (status === "completed" || status === "withdrawn") {
    withdrawn_at = listing.synced_at ?? new Date().toISOString();
  }

  // ── Visibility (v0.2 enum: public | pre_launch | off_market) ───────────
  const visibilityRaw = asTrimmedStringOrNull(listing.visibility);
  const visibility = ["public", "pre_launch", "off_market"].includes(visibilityRaw)
    ? visibilityRaw
    : "public";

  // ── Build row ───────────────────────────────────────────────────────────
  const nowIso = new Date().toISOString();
  const row = {
    source:               "raia_protocol",
    agent_id:             ctx.agent_id,
    raia_id:              asTrimmedStringOrNull(listing.raia_id),
    agent_card_url:       asTrimmedStringOrNull(listing.agent_card_url) ?? ctx.agent_card_url ?? null,
    enquiry_endpoint:     asTrimmedStringOrNull(listing.enquiry_endpoint),
    raia_schema_version:  asTrimmedStringOrNull(ctx.schema_version) ?? "0.2",

    headline:              asTrimmedStringOrNull(listing.headline),
    marketing_description: asTrimmedStringOrNull(listing.marketing_description),

    property_type:    normalisePropertyType(listing.property_type),
    service_type,
    bedrooms:         asIntOrNull(listing.bedrooms),
    bathrooms:        asIntOrNull(listing.bathrooms),
    floor_area_sqm:   asNumberOrNull(listing.floor_area_sqm),
    floor:            asIntOrNull(listing.floor),
    total_floors:     asIntOrNull(listing.total_floors),
    furnishing:       asTrimmedStringOrNull(listing.furnishing),
    is_new_build:     asBoolOrNull(listing.is_new_build),
    development_name: asTrimmedStringOrNull(listing.development_name),

    location:          locationWkt(lat, lon),
    latitude:          lat,
    longitude:         lon,
    postcode_full,
    postcode_district,
    postcode_sector,
    street_name:       asTrimmedStringOrNull(listing.street_name),
    building_number:   asTrimmedStringOrNull(listing.building_number),
    suburb:            asTrimmedStringOrNull(listing.suburb),
    un_locode,
    // jurisdiction is a STORED generated column on MoveHome — let the DB compute it.

    rent_pcm,
    daily_rate,
    asking_price,
    currency,
    pricing_id:        asTrimmedStringOrNull(listing.pricing_id),
    available_from:    asTrimmedStringOrNull(listing.available_from),

    listing_status:    status,
    visibility,
    publish_from:      asTrimmedStringOrNull(listing.publish_from),
    publish_until:     asTrimmedStringOrNull(listing.publish_until),

    features:          asArrayOrNull(listing.features),

    media:                   mediaBlock,
    provenance:              asObjectOrNull(listing.provenance),
    jurisdiction_extensions: asObjectOrNull(listing.jurisdiction_extensions),

    photo_url,
    photo_count,

    listed_at:   asTrimmedStringOrNull(listing.publish_from)
                 ?? asTrimmedStringOrNull(listing.synced_at)
                 ?? nowIso,
    last_seen_at: nowIso,
    withdrawn_at,

    is_outlier: false,

    snapshot_version: asIntOrNull(listing.snapshot_version),
    synced_at:        asTrimmedStringOrNull(listing.synced_at) ?? nowIso,
  };

  if (!row.raia_id) throw new Error("listing missing raia_id");
  if (!row.un_locode) warnings.push("un_locode missing — jurisdiction will be NULL");

  return { row, warnings };
}

module.exports = {
  normaliseListing,
  normalisePropertyType,
  postcodeSector,
  postcodeDistrict,
  locationWkt,
  pickPhotoUrl,
};
