"use strict";
// node --test scripts/lib/movehome-feed-parity.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkParity, changedFields } = require("./movehome-feed-parity.cjs");

const snapshot = {
  raia_id: "prop-gb-rlf-000427",
  service_type: "long_term",
  rent_pcm: 2271,
  currency: "GBP",
  furnishing: "furnished",
  available_from: "2026-11-01",
  marketing_description: "A two bed flat",
  headline: "2-bed flat, London",
  bedrooms: 2,
  bathrooms: 1,
  daily_rate: null,
  asking_price: null,
  media: { photos: [{ url: "https://cdn/a.jpg" }, { url: "https://cdn/b.jpg" }], featured_image_url: "https://cdn/a.jpg", photo_url: "https://cdn/at.jpg" },
};

function rowFrom(snap) {
  return { ...snap, photo_count: snap.media.photos.length };
}

test("parity passes when every source-populated field survives", () => {
  const { mismatches } = checkParity(snapshot, rowFrom(snapshot));
  assert.deepEqual(mismatches, []);
});

test("a source-null field is a gap, never a mismatch (no invented prices)", () => {
  const { mismatches, gaps } = checkParity(snapshot, rowFrom(snapshot));
  assert.ok(gaps.includes("daily_rate"));
  assert.ok(gaps.includes("asking_price"));
  assert.ok(!gaps.includes("rent_pcm"));
  assert.deepEqual(mismatches, []);
});

test("a lost rent fails the item", () => {
  const row = { ...rowFrom(snapshot), rent_pcm: null };
  const { mismatches } = checkParity(snapshot, row);
  assert.equal(mismatches.length, 1);
  assert.match(mismatches[0], /rent_pcm lost/);
});

test("photo order and count are enforced", () => {
  const row = rowFrom(snapshot);
  row.media = { ...row.media, photos: [{ url: "https://cdn/b.jpg" }, { url: "https://cdn/a.jpg" }] };
  assert.match(checkParity(snapshot, row).mismatches[0], /photos\[0\] url differs/);

  const fewer = rowFrom(snapshot);
  fewer.media = { ...fewer.media, photos: [fewer.media.photos[0]] };
  fewer.photo_count = 1;
  assert.match(checkParity(snapshot, fewer).mismatches[0], /count 2 → 1/);

  const miscount = { ...rowFrom(snapshot), photo_count: 1 };
  assert.match(checkParity(snapshot, miscount).mismatches[0], /photo_count 2 → 1/);
});

test("a source with no photos reports a gap rather than failing", () => {
  const noMedia = { ...snapshot, media: { photos: [] } };
  const { mismatches, gaps } = checkParity(noMedia, { ...noMedia, photo_count: 0 });
  assert.deepEqual(mismatches, []);
  assert.ok(gaps.includes("media.photos"));
});

test("changedFields is empty for an identical row and lists only real changes", () => {
  const next = rowFrom(snapshot);
  assert.deepEqual(changedFields({ ...next }, next), []);
  assert.deepEqual(changedFields({ ...next, media: null, rent_pcm: null }, next), ["rent_pcm", "media"]);
});

test("timestamp rendering differences are not content changes", () => {
  const next = { listed_at: "2026-10-28T12:05:46.250Z" };
  assert.deepEqual(changedFields({ listed_at: "2026-10-28T12:05:46.25+00:00" }, next), []);
  assert.deepEqual(changedFields({ listed_at: "2026-10-28T11:00:00.000Z" }, next), ["listed_at"]);
});

test("derived geography column is never diffed (it is written with lat/lon)", () => {
  const next = { location: "POINT(-0.19 51.6)", latitude: 51.6, longitude: -0.19 };
  assert.deepEqual(changedFields({ location: "0101000020E6100000A9", latitude: 51.6, longitude: -0.19 }, next), []);
});
