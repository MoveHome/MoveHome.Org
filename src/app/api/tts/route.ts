// GET /api/tts?raia_id=…&lang=en-GB&gender=female — narrates the listing's
// description through Google Cloud TTS and stores the MP3 once in Supabase
// Storage, keyed by the script hash, so a changed price or CTA makes a new file.
// Without a key the client falls back to speechSynthesis, so a 503 here is normal.

import { NextResponse } from 'next/server';
import { getListingByRaiaId } from '@/lib/queries';
import { buildPropertyDescriptionWithCta } from '@/lib/property-card';
import { getEstateAgentProfile } from '@/lib/agent-directory';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { cachePath, resolveLang, scriptHash, voiceFor, type TtsLang, type VoiceGender } from '@/lib/tts';
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

// shortcut: per-instance memory cache stays as the no-Storage fallback; the
// bucket is the shared copy once provisioned.
const cache = new Map<string, ArrayBuffer>();
// Synthesised on this instance but the shared write failed — retry it later.
const pendingWrite = new Set<string>();
// Claims are lease objects so instances agree on who is working; without
// Storage only this instance can be coordinated.
const localClaims = new Map<string, { owner: string; expiresAt: number }>();
// Local miss counter, used only while Storage is unavailable: an outage must
// neither bypass nor invent the per-client billable limit.
const localMiss = new Map<string, { window: number; count: number }>();

function setCache(key: string, value: ArrayBuffer) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, value);
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

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
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

// Own `key` until the lease expires. A Storage outage falls back to this
// instance's lease instead of bypassing the lock for every request.
async function claim(key: string, store: Store | null, ttlMs: number, owner: string): Promise<Claim> {
  const now = Date.now();
  if (store) {
    const payload = leaseBlob(owner, now + ttlMs);
    const opts = { contentType: 'application/json' };
    try {
      const res = await bucketOf(store).upload(key, payload, { ...opts, upsert: false });
      if (!res.error) return 'claimed';
      if (isAlreadyExistsError(res.error)) {
        const held = await readLease(store, key);
        if (held?.expiresAt && held.expiresAt < now) {
          // Takeover with a fresh owner-tagged key to guarantee atomic acquisition.
          const takeoverKey = `${key}.${owner}`;
          const tRes = await bucketOf(store).upload(takeoverKey, payload, { ...opts, upsert: false });
          if (!tRes.error || isAlreadyExistsError(tRes.error)) {
            // Delete original lock file so successors see takeover.
            await bucketOf(store).remove([key]).catch(() => {});
            return 'claimed';
          }
        }
        return 'busy';
      }
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

async function release(key: string, store: Store | null, owner: string) {
  if (localClaims.get(key)?.owner === owner) localClaims.delete(key);
  if (!store) return;
  try {
    const takeoverKey = `${key}.${owner}`;
    // Remove both primary lock and any takeover lock owned by this owner.
    const held = await readLease(store, key);
    const toRemove: string[] = [];
    if (held?.owner === owner) toRemove.push(key);
    toRemove.push(takeoverKey);
    await bucketOf(store).remove(toRemove);
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

// Shared abuse control: at most MISS_LIMIT billable misses per client per
// minute, agreed across instances through create-if-absent slot markers.
async function withinMissBudget(ip: string, store: Store | null): Promise<boolean> {
  if (!store) return withinLocalBudget(ip);
  const window = Math.floor(Date.now() / MISS_WINDOW_MS);
  const dir = `tts/_budget/${ip}/${window}`;
  for (let slot = 0; slot < MISS_LIMIT; slot++) {
    const res = await claim(`${dir}/${slot}`, store, MISS_WINDOW_MS, `budget-${ip}-${window}`);
    if (res === 'claimed') {
      void dropPrefix(`tts/_budget/${ip}/${window - 1}`, store);
      return true;
    }
    // Storage transport failure: count locally rather than 429-ing or letting
    // the request through unmetered.
    if (res === 'local') return withinLocalBudget(ip);
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
  try {
    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: script },
          voice: { languageCode: lang, name: voiceFor(lang, gender) },
          audioConfig: { audioEncoding: 'MP3' }
        }),
        signal: controller.signal
      }
    );
    if (!res.ok) {
      console.error('[tts] google', res.status, await res.text().catch(() => ''));
      throw new UpstreamError(502, 'TTS upstream failed');
    }
    const body = (await res.json()) as { audioContent?: string };
    if (!body.audioContent) throw new UpstreamError(502, 'TTS upstream returned no audio');
    return Uint8Array.from(atob(body.audioContent), (c) => c.charCodeAt(0)).buffer;
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    console.error('[tts] google fetch failed or timed out:', err);
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
  if (!store) {
    // Storage not initialised yet: keep the audio and upload it once it is.
    pendingWrite.add(path);
    return;
  }
  try {
    const up = await bucketOf(store).upload(path, new Blob([audio], { type: 'audio/mpeg' }), {
      contentType: 'audio/mpeg',
      cacheControl: '604800',
      upsert: true
    });
    if (up.error) throw new Error(up.error.message);
    pendingWrite.delete(path);
  } catch (err) {
    // Keep the audio for this instance and retry the shared write next time.
    console.error('[tts] storage write failed (retrying on a later request):', err);
    pendingWrite.add(path);
    return;
  }
  await prune(raia_id, lang, gender, path, store);
}

// One file per (listing, locale, voice). Delete only hashes that are neither
// the listing's *current* script nor the file just written, so an older
// in-flight version can never remove the audio a newer one serves.
async function prune(
  raia_id: string,
  lang: TtsLang,
  gender: VoiceGender,
  writtenPath: string,
  store: Store
) {
  try {
    const fresh = await getListingByRaiaId(raia_id);
    const dir = `tts/${raia_id}/${lang}/${gender}`;
    const listed = await bucketOf(store).list(dir);
    const validPaths = new Set<string>([writtenPath]);
    if (fresh) {
      validPaths.add(cachePath(raia_id, lang, gender, scriptHash(scriptFor(fresh))));
    }
    const stale = (listed.data ?? [])
      .map((e) => `${dir}/${e.name}`)
      .filter((p) => p.endsWith('.mp3') && !validPaths.has(p));
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

  let audio: ArrayBuffer | null = cache.get(path) ?? null;
  if (audio) {
    if (pendingWrite.has(path)) await persist(raia_id, lang, gender, path, audio, store);
  } else {
    audio = await download(path, store);
    if (audio) setCache(path, audio);
  }

  if (!audio) {
    const apiKey = process.env.GOOGLE_TTS_API_KEY || process.env.GEMINI_API_KEY;
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

    const lock = `tts/_locks/${lang}/${gender}/${raia_id}-${hash}`;
    const owner = leaseOwner();
    let held = false;
    try {
      held = (await claim(lock, store, LOCK_TTL_MS, owner)) !== 'busy';
      if (held) {
        audio = cache.get(path) ?? (await download(path, store));
        if (!audio) {
          audio = await synthesize(apiKey, script, lang, gender);
          setCache(path, audio);
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
      if (held) await release(lock, store, owner);
    }
  }

  if (!audio) {
    return json({ error: 'TTS unavailable' }, 502);
  }
  return new NextResponse(audio, {
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': CACHE_CONTROL }
  });
}
