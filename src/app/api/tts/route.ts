// GET /api/tts?raia_id=…&lang=en-GB&gender=female — narrates the listing's
// description through ElevenLabs TTS (eleven_flash_v2_5) and stores the MP3 once in Supabase
// Storage, keyed by provider/script hash, so a changed price or CTA makes a new file.
// Without a key the client falls back to speechSynthesis, so a 503 here is normal.

import { NextResponse } from 'next/server';
import { getListingByRaiaId } from '@/lib/queries';
import { buildPropertyDescriptionWithCta } from '@/lib/property-card';
import { getEstateAgentProfile } from '@/lib/agent-directory';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { cacheDir, cachePath, resolveLang, scriptHash, voiceFor, type TtsLang, type VoiceGender } from '@/lib/tts';
import type { Listing } from '@/lib/types';

const RAIA_ID_RE = /^prop-[a-z]{2}-[a-z0-9-]{2,32}-[0-9]{4,}$/;
const MAX_CHARS = 2500;
const MAX_CACHE_ENTRIES = 100;
const BUCKET = 'tts-audio';
// The lookup URL is mutable (raia_id only, no script hash), so a reprice or a
// withdrawal must take effect on the very next request: nothing may store it.
const CACHE_CONTROL = 'no-store';
const MISS_LIMIT = 10; // billable syntheses per client per minute
const MISS_WINDOW_MS = 60_000;
const LOCK_TTL_MS = 30_000; // covers the 8s provider call plus the write
const LOCK_WAIT_MS = 5_000;
const LOCK_POLL_MS = 150;

type Store = ReturnType<typeof createSupabaseAdminClient>;
type BucketApi = ReturnType<Store['storage']['from']>;
type Claim = 'claimed' | 'busy' | 'local';

// Per-instance memory cache for downloaded/synthesised audio buffers
const cache = new Map<string, ArrayBuffer>();
// Synthesised audio retained in memory between a failed Storage write and the
// next request. Storage is the durable copy: a restart loses this and costs one
// re-synthesis, so the buffer is capped instead of trusted.
const MAX_PENDING_WRITES = 32;
const pendingWriteMap = new Map<string, ArrayBuffer>();

// Local locks & miss budget fallback used strictly when Supabase Storage is unavailable
const localClaims = new Map<string, { owner: string; expiresAt: number }>();
const localMiss = new Map<string, { window: number; count: number }>();

function setCache(key: string, value: ArrayBuffer) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined && !pendingWriteMap.has(firstKey)) cache.delete(firstKey);
  }
  cache.set(key, value);
}

function setPending(path: string, audio: ArrayBuffer) {
  if (pendingWriteMap.size >= MAX_PENDING_WRITES) {
    const oldest = pendingWriteMap.keys().next().value;
    if (oldest !== undefined) pendingWriteMap.delete(oldest);
  }
  pendingWriteMap.set(path, audio);
}

// Storage is best-effort: a missing bucket logs and falls through to the
// in-memory/upstream path rather than failing the request.
function storage(): Store | null {
  try {
    return createSupabaseAdminClient();
  } catch {
    return null;
  }
}

function bucketOf(store: Store): BucketApi {
  return store.storage.from(BUCKET);
}

// Only a header our own edge sets can name the peer. x-forwarded-for is
// client-writable (Vercel appends to whatever the caller sent), so trusting it
// is a rate-limit bypass; unidentifiable clients share one conservative bucket.
function clientIp(request: Request): string {
  if (process.env.TRUST_PROXY === 'true') {
    const real = request.headers.get('x-real-ip')?.trim();
    if (real) return real;
  }
  return 'unknown';
}

function json(data: unknown, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': CACHE_CONTROL, ...headers }
  });
}

function isAlreadyExistsError(err: { message?: string } | null): boolean {
  if (!err || !err.message) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('exists') || msg.includes('duplicate') || msg.includes('already');
}

function leaseOwner(): string {
  return `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function leaseBlob(owner: string, expiresAt: number) {
  return new Blob([JSON.stringify({ owner, expiresAt })], { type: 'application/json' });
}

async function readLease(
  store: Store,
  key: string
): Promise<{ owner?: string; expiresAt?: number } | null> {
  try {
    const hit = await bucketOf(store).download(key);
    if (hit.error || !hit.data) return null;
    return JSON.parse(await hit.data.text()) as { owner?: string; expiresAt?: number };
  } catch {
    return null;
  }
}

// A lease's *name* carries its ownership token: the TTL-length window it was
// taken in. Creating a name is atomic (create-if-absent), so contenders race on
// one key and exactly one wins; releasing deletes a name only its owner could
// hold — no read-then-delete, and no upsert takeover where two winners exist.
export function leasePath(
  lang: TtsLang,
  gender: VoiceGender,
  raia_id: string,
  hash: string,
  at = Date.now()
) {
  return `tts/_locks/${lang}/${gender}/${raia_id}-${hash}/${Math.floor(at / LOCK_TTL_MS)}`;
}

async function claim(
  key: string,
  previousKey: string,
  store: Store | null,
  ttlMs: number,
  owner: string
): Promise<Claim> {
  const now = Date.now();
  if (store) {
    try {
      // The previous window's lease still covers this instant unless it expired;
      // once expired it is dead, so reclaiming its name is safe.
      const prev = await readLease(store, previousKey);
      if (prev?.expiresAt && prev.expiresAt > now) return 'busy';
      if (prev) {
        try {
          await bucketOf(store).remove([previousKey]);
        } catch {}
      }
      const res = await bucketOf(store).upload(key, leaseBlob(owner, now + ttlMs), {
        contentType: 'application/json',
        upsert: false
      });
      if (!res.error) return 'claimed';
      if (isAlreadyExistsError(res.error)) return 'busy';
      // Storage upload failure during claim: fall back to local in-memory claim so request proceeds safely
      console.error('[tts] claim storage upload error, falling back to local:', res.error);
    } catch (err) {
      console.error('[tts] claim storage exception, falling back to local:', err);
    }
  }

  const held = localClaims.get(key);
  if (held && held.expiresAt > now) return 'busy';
  if (localClaims.size > 5_000) {
    for (const [k, v] of localClaims) if (v.expiresAt <= now) localClaims.delete(k);
  }
  localClaims.set(key, { owner, expiresAt: now + ttlMs });
  return 'local';
}

// `store` is passed only when the Storage lease is known to be ours: after an
// ambiguous transport failure the key may belong to a competitor.
async function release(key: string, store: Store | null, owner: string) {
  if (localClaims.get(key)?.owner === owner) localClaims.delete(key);
  if (!store) return;
  try {
    await bucketOf(store).remove([key]);
  } catch (err) {
    console.error('[tts] claim release failed:', err);
  }
}

async function download(path: string, store: Store | null): Promise<ArrayBuffer | null> {
  if (!store) return null;
  try {
    const hit = await bucketOf(store).download(path);
    if (hit.error || !hit.data) return null;
    return await hit.data.arrayBuffer();
  } catch (err) {
    console.error('[tts] storage read failed:', err);
    return null;
  }
}

async function dropPrefix(prefix: string, store: Store) {
  try {
    const listed = await bucketOf(store).list(prefix);
    const names = (listed.data ?? []).map((e) => `${prefix}/${e.name}`);
    if (names.length) await bucketOf(store).remove(names);
  } catch (err) {
    console.error('[tts] prefix cleanup skipped:', err);
  }
}

function withinLocalBudget(ip: string): boolean {
  const window = Math.floor(Date.now() / MISS_WINDOW_MS);
  const seen = localMiss.get(ip);
  const count = seen && seen.window === window ? seen.count : 0;
  if (count >= MISS_LIMIT) return false;
  if (localMiss.size > 5_000) {
    for (const [k, v] of localMiss) if (v.window !== window) localMiss.delete(k);
  }
  localMiss.set(ip, { window, count: count + 1 });
  return true;
}

// The local counter is the client's accounting of record: it runs on every
// miss, so a Storage outage (or a flap back to it) can neither reset the count
// nor skip metering. Storage markers add the cross-instance ceiling on top.
async function withinMissBudget(ip: string, store: Store | null): Promise<boolean> {
  if (!withinLocalBudget(ip)) return false;
  if (!store) return true;
  const window = Math.floor(Date.now() / MISS_WINDOW_MS);
  const dir = `tts/_budget/${ip}/${window}`;
  for (let slot = 0; slot < MISS_LIMIT; slot++) {
    const slotKey = `${dir}/${slot}`;
    try {
      const payload = leaseBlob(`budget-${ip}-${window}`, Date.now() + MISS_WINDOW_MS);
      const res = await bucketOf(store).upload(slotKey, payload, { contentType: 'application/json', upsert: false });
      if (!res.error) {
        void dropPrefix(`tts/_budget/${ip}/${window - 1}`, store);
        return true;
      }
      if (!isAlreadyExistsError(res.error)) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

function scriptFor(l: Listing): string {
  return buildPropertyDescriptionWithCta(l, getEstateAgentProfile(l.agent_id)?.name).slice(0, MAX_CHARS);
}

class UpstreamError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

async function synthesize(
  apiKey: string,
  script: string,
  lang: TtsLang,
  gender: VoiceGender
): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  const voiceId = voiceFor(lang, gender);
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey
        },
        body: JSON.stringify({
          text: script,
          model_id: 'eleven_flash_v2_5'
        }),
        signal: controller.signal
      }
    );
    if (!res.ok) {
      console.error('[tts] elevenlabs', res.status, await res.text().catch(() => ''));
      throw new UpstreamError(502, 'TTS upstream failed');
    }
    return await res.arrayBuffer();
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    console.error('[tts] elevenlabs fetch failed or timed out:', err);
    throw new UpstreamError(504, 'TTS upstream timeout or failure');
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitForUpload(path: string, store: Store | null): Promise<ArrayBuffer | null> {
  if (!store) return null;
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    const hit = await download(path, store);
    if (hit) return hit;
  }
  return null;
}

async function persist(
  raia_id: string,
  lang: TtsLang,
  gender: VoiceGender,
  path: string,
  audio: ArrayBuffer,
  store: Store | null
) {
  setPending(path, audio);
  setCache(path, audio);
  if (!store) return;
  try {
    const up = await bucketOf(store).upload(path, new Blob([audio], { type: 'audio/mpeg' }), {
      contentType: 'audio/mpeg',
      cacheControl: '604800',
      upsert: true
    });
    if (up.error) throw new Error(up.error.message);
    pendingWriteMap.delete(path);
  } catch (err) {
    console.error('[tts] storage write failed (retrying on a later request):', err);
    return;
  }
  await prune(raia_id, lang, gender, path, store);
}

async function retryPendingWrites(store: Store | null) {
  if (!store || pendingWriteMap.size === 0) return;
  for (const [path, audio] of Array.from(pendingWriteMap.entries())) {
    try {
      const up = await bucketOf(store).upload(path, new Blob([audio], { type: 'audio/mpeg' }), {
        contentType: 'audio/mpeg',
        cacheControl: '604800',
        upsert: true
      });
      if (!up.error) {
        pendingWriteMap.delete(path);
      }
    } catch {
      // Retained in pendingWriteMap for future retries
    }
  }
}

// One file per (listing, locale, voice). Delete only hashes that are neither
// the listing's *current* script nor the file just written, and that were
// already present when the listing was re-read: a version written by a
// concurrent request after that read is never ours to remove.
async function prune(
  raia_id: string,
  lang: TtsLang,
  gender: VoiceGender,
  writtenPath: string,
  store: Store
) {
  try {
    const readAt = Date.now();
    const fresh = await getListingByRaiaId(raia_id);
    const dir = cacheDir(raia_id, lang, gender);
    const listed = await bucketOf(store).list(dir);
    const validPaths = new Set<string>([writtenPath]);
    if (fresh) {
      validPaths.add(cachePath(raia_id, lang, gender, scriptHash(scriptFor(fresh))));
    }
    const stale = (listed.data ?? [])
      .filter((e) => e.name.endsWith('.mp3'))
      .map((e) => ({ path: `${dir}/${e.name}`, at: Date.parse(e.updated_at ?? '') }))
      // Unknown age is not proof of staleness.
      .filter((f) => !validPaths.has(f.path) && Number.isFinite(f.at) && f.at < readAt)
      .map((f) => f.path);
    if (stale.length) await bucketOf(store).remove(stale);
  } catch (err) {
    console.error('[tts] stale cleanup skipped:', err);
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raia_id = params.get('raia_id') ?? '';
  if (!RAIA_ID_RE.test(raia_id)) {
    return json({ error: 'Invalid raia_id' }, 400);
  }
  const genderParam = params.get('gender');
  if (genderParam && genderParam !== 'female' && genderParam !== 'male') {
    return json({ error: 'Invalid gender' }, 400);
  }
  const gender: VoiceGender = genderParam === 'male' ? 'male' : 'female';

  // The lookup comes first: a withdrawn or unknown listing is 404 whether or
  // not a provider key is configured, and stored audio needs no key at all.
  let listing: Listing | null = null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    listing = await getListingByRaiaId(raia_id, controller.signal);
  } catch (err) {
    console.error('[tts] DB lookup failed or timed out:', err);
    return json({ error: 'DB lookup failed' }, 500);
  } finally {
    clearTimeout(timeoutId);
  }
  if (!listing) {
    return json({ error: 'Listing not found' }, 404);
  }

  const lang = resolveLang(params.get('lang'), listing);
  if (!lang) {
    return json({ error: 'Invalid lang' }, 400);
  }

  const script = scriptFor(listing);
  const hash = scriptHash(script);
  const path = cachePath(raia_id, lang, gender, hash);
  const store = storage();

  if (store && pendingWriteMap.size > 0) {
    void retryPendingWrites(store);
  }

  let audio: ArrayBuffer | null = cache.get(path) ?? pendingWriteMap.get(path) ?? null;
  if (audio) {
    if (pendingWriteMap.has(path)) await persist(raia_id, lang, gender, path, audio, store);
  } else {
    audio = await download(path, store);
    if (audio) setCache(path, audio);
  }

  if (!audio) {
    // Never fall back to another provider's credential: an invalid xi-api-key
    // is a billable 401 round trip and an opaque 502 to the client.
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return json({ error: 'TTS not configured' }, 503);
    }
    if (!(await withinMissBudget(clientIp(request), store))) {
      return json(
        { error: 'Too many narration requests' },
        429,
        { 'Retry-After': '60' }
      );
    }

    const lock = leasePath(lang, gender, raia_id, hash);
    const previousLock = leasePath(lang, gender, raia_id, hash, Date.now() - LOCK_TTL_MS);
    const owner = leaseOwner();
    let claimState: Claim = 'busy';
    try {
      claimState = await claim(lock, previousLock, store, LOCK_TTL_MS, owner);
      if (claimState !== 'busy') {
        audio = cache.get(path) ?? (await download(path, store));
        if (!audio) {
          audio = await synthesize(apiKey, script, lang, gender);
          await persist(raia_id, lang, gender, path, audio, store);
        }
      } else {
        // Another worker is paying for this exact script: serve its upload.
        // Past the wait, tell the client to retry rather than paying twice.
        audio =
          (await waitForUpload(path, store)) ?? cache.get(path) ?? (await download(path, store));
        if (!audio) {
          return json({ error: 'Narration in progress' }, 503, { 'Retry-After': '5' });
        }
        setCache(path, audio);
      }
    } catch (err) {
      if (err instanceof UpstreamError) {
        return json({ error: err.message }, err.status);
      }
      throw err;
    } finally {
      if (claimState !== 'busy') {
        await release(lock, claimState === 'claimed' ? store : null, owner);
      }
    }
  }

  if (!audio) {
    return json({ error: 'TTS unavailable' }, 502);
  }
  return new NextResponse(audio, {
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': CACHE_CONTROL }
  });
}
