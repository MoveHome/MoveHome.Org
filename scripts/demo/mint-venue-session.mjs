#!/usr/bin/env node
// Mint a venue session code for the booth QR.
//
//   DEMO_SESSION_SECRET=… node scripts/demo/mint-venue-session.mjs <venue_id> [ttl_minutes]
//
// Format (frozen): v1.<venue_id>.<exp_base36>.<hmac16>
// Telegram deep-link start payloads are capped at 64 chars of [A-Za-z0-9_-], so
// the QR carries this tag rather than a JWT. The webhook verifies the same HMAC
// with the same DEMO_SESSION_SECRET, then binds the chat to the venue.
import { createHmac } from 'node:crypto';

function die(message) {
  console.error(message);
  process.exit(1);
}

const [venueId, ttlMinutes = '480'] = process.argv.slice(2);
const secret = process.env.DEMO_SESSION_SECRET;

if (!venueId) die('usage: mint-venue-session.mjs <venue_id> [ttl_minutes]');
if (!secret) die('DEMO_SESSION_SECRET is required (must match the demo webhook build)');
if (!/^[A-Za-z0-9_-]{1,24}$/.test(venueId)) {
  die('venue_id must be 1-24 chars of [A-Za-z0-9_-] so the code fits Telegram’s 64-char start payload');
}

const ttl = Number(ttlMinutes);
if (!Number.isFinite(ttl) || ttl <= 0) die('ttl_minutes must be a positive number');

const exp = Math.floor(Date.now() / 1000) + Math.round(ttl * 60);
const expBase36 = exp.toString(36);
const tag = createHmac('sha256', secret).update(`v1.${venueId}.${expBase36}`).digest('base64url').slice(0, 16);
const code = `v1.${venueId}.${expBase36}.${tag}`;

if (code.length > 64) die(`session code is ${code.length} chars — Telegram allows 64`);

console.log(`https://t.me/MoveHomeDemoBot?start=${code}`);
console.log(`code=${code} venue=${venueId} expires=${new Date(exp * 1000).toISOString()} (${code.length} chars)`);
