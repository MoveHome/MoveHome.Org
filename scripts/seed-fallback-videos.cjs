#!/usr/bin/env node
"use strict";

/**
 * seed-fallback-videos.cjs — demo safety net for the Slide-1 Video Reel.
 *
 * Many canonical RAIA snapshots carry video_urls whose Cloudinary asset has
 * since been deleted (HEAD lies, the body 404s), so the reel stage renders a
 * black player. This script keeps any video that actually streams, and gives
 * THBKK / GBLON listings without one a verified vertical fallback.
 *
 * Demo only: a fallback is generic city footage, never a claim about the
 * specific property. Re-run the canonical backfill first, then this.
 *
 *   node scripts/seed-fallback-videos.cjs            # dry run
 *   node scripts/seed-fallback-videos.cjs --write
 */

const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const envLocal = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envLocal)) process.loadEnvFile(envLocal);

const CACHE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const CACHE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!CACHE_URL || !CACHE_KEY) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

const WRITE = process.argv.includes("--write");
const CACHE = createClient(CACHE_URL, CACHE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// Verified 2026-11-16: 480x848 / 720x1280, H.264 mp4, streams end to end.
const FALLBACK = {
  GBLON: "https://res.cloudinary.com/www-rentlondonflat-com/video/upload/raia/a0450010-0778-4000-8000-000000000010/9619f3da-0cae-4d6a-8396-e30cca3d4e0c/abe244bd-5f7a-434f-b4f8-2c1b66e92b86.mp4",
  THBKK: "https://res.cloudinary.com/demo/video/upload/w_720,h_1280,c_fill/walking.mp4",
};

// Cloudinary answers HEAD 200 for deleted assets; a ranged GET is the only
// cheap proof that the body exists and is video.
async function isPlayable(url) {
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-1024" } });
    return (res.status === 200 || res.status === 206) && String(res.headers.get("content-type")).startsWith("video/");
  } catch {
    return false;
  }
}

(async () => {
  for (const [locode, url] of Object.entries(FALLBACK)) {
    if (!(await isPlayable(url))) throw new Error(`fallback for ${locode} is not playable: ${url}`);
  }

  const { data: rows, error } = await CACHE
    .from("tbl_external_raia_listings")
    .select("raia_id, un_locode, media")
    .in("un_locode", Object.keys(FALLBACK));
  if (error) throw error;

  let kept = 0, seeded = 0, cleared = 0;
  for (const row of rows) {
    const current = row.media?.video_url ?? null;
    let next = current;
    if (current && await isPlayable(current)) { kept++; continue; }
    if (current) cleared++;
    next = FALLBACK[row.un_locode];
    seeded++;
    if (!WRITE) continue;
    const { error: upErr } = await CACHE
      .from("tbl_external_raia_listings")
      .update({ media: { ...(row.media ?? {}), video_url: next } })
      .eq("raia_id", row.raia_id);
    if (upErr) throw new Error(`${row.raia_id}: ${upErr.message}`);
  }

  console.log(`kept=${kept} seeded=${seeded} (dead-replaced=${cleared}) total=${rows.length}${WRITE ? "" : " — DRY RUN, use --write"}`);
})().catch((err) => { console.error(err.message); process.exit(1); });
