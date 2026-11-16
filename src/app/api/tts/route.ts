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
const LOCK_TTL_MS = 120_000;
const LOCK_WAIT_MS = 5_000;
const LOCK_POLL_MS = 150;

type Store = ReturnType<typeof createSupabaseAdminClient>;
type BucketApi = ReturnType<Store['storage']['from']>;

// shortcut: per-instance memory cache stays as the no-Storage fallback; the
// bucket is the shared copy once provisioned.
const cache = new Map<string, ArrayBuffer>();
// Synthesised on this instance but the shared write failed — retry it later.
const pendingWrite = new Set<string>();
// Claims are zero-byte Storage objects so instances agree on who is working;
// without Storage only this instance can be coordinated (expiry as the value).
const localClaims = new Map<string, number>();

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

// Create-if-absent: true when this caller now owns `key`. A Storage outage
// falls back to local in-memory coordination rather than bypassing rate limits
// or 429-ing every request during an incident.
async function claim(key: string, store: Store | null, ttlMs: number): Promise<boolean> {
  const now = Date.now();
  if (store) {
    try {
      const payload = JSON.stringify({ expiresAt: now + ttlMs });
      const res = await bucketOf(store).upload(key, new Blob([payload], { type: 'application/json' }), {
        contentType: 'application/json',
        upsert: false
      });
      if (!res.error) return true;
      if (isAlreadyExistsError(res.error)) {
        // Inspect lock marker for expiration
        const hit = await bucketOf(store).download(key);
        if (hit.data) {
          try {
            const text = await hit.data.text();
            const data = JSON.parse(text) as { expiresAt?: number };
            if (data.expiresAt && data.expiresAt < now) {
              const over = await bucketOf(store).upload(key, new Blob([payload], { type: 'application/json' }), {
                contentType: 'application/json',
                upsert: true
              });
              if (!over.error) return true;
            }
          } catch {
            // Ignore parse errors, treat lock as active
          }
        }
        return false;
      }
      console.error('[tts] claim storage upload error, falling back to local:', res.error);
    } catch (err) {
      console.error('[tts] claim storage exception, falling back to local:', err);
    }
  }

  const held = localClaims.get(key);
  if (held && held > now) return false;
  if (localClaims.size > 5_000) for (const [k, exp] of localClaims) if (exp <= now) localClaims.delete(k);
  localClaims.set(key, now + ttlMs);
  return true;
}

async function release(key: string, store: Store | null) {
  if (!store) {
    localClaims.delete(key);
    return;
  }
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

// Shared abuse control: at most MISS_LIMIT billable misses per client per
// minute, agreed across instances through create-if-absent slot markers.
async function withinMissBudget(ip: string, store: Store | null): Promise<boolean> {
  const window = Math.floor(Date.now() / MISS_WINDOW_MS);
  const dir = `tts/_budget/${ip}/${window}`;
  for (let slot = 0; slot < MISS_LIMIT; slot++) {
    if (await claim(`${dir}/${slot}`, store, MISS_WINDOW_MS)) {
      if (store) void dropPrefix(`tts/_budget/${ip}/${window - 1}`, store);
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
  if (!store) return;
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
    if (!fresh) return;
    const currentListingPath = cachePath(raia_id, lang, gender, scriptHash(scriptFor(fresh)));
    const dir = `tts/${raia_id}/${lang}/${gender}`;
    const listed = await bucketOf(store).list(dir);
    const stale = (listed.data ?? [])
      .map((e) => `${dir}/${e.name}`)
      .filter((p) => p.endsWith('.mp3') && p !== currentListingPath);
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
    try {
      if (await claim(lock, store, LOCK_TTL_MS)) {
        try {
          audio = cache.get(path) ?? (await download(path, store));
          if (!audio) {
            audio = await synthesize(apiKey, script, lang, gender);
            setCache(path, audio);
            await persist(raia_id, lang, gender, path, audio, store);
          }
        } finally {
          await release(lock, store);
        }
      } else {
        // Another worker is already paying for this exact script: use its
        // upload, and only synthesise if it never lands (crashed lock holder).
        audio = await waitForUpload(path, store);
        if (audio) {
          setCache(path, audio);
        } else {
          audio = cache.get(path) ?? (await download(path, store));
          if (audio) {
            setCache(path, audio);
          } else {
            audio = await synthesize(apiKey, script, lang, gender);
            setCache(path, audio);
            await persist(raia_id, lang, gender, path, audio, store);
          }
        }
      }
    } catch (err) {
      if (err instanceof UpstreamError) {
        return json({ error: err.message }, err.status);
      }
      throw err;
    }
  }

  if (!audio) {
    return json({ error: 'TTS unavailable' }, 502);
  }
  return new NextResponse(audio, {
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': CACHE_CONTROL }
  });
}
