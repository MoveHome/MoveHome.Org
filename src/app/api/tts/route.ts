// GET /api/tts?raia_id=…&lang=en-GB&gender=female — narrates the listing's
// description through Google Cloud TTS and stores the MP3 once in Supabase
// Storage, keyed by the script hash, so a changed price or CTA makes a new file.
// Without a key the client falls back to speechSynthesis, so a 503 here is normal.

import { NextResponse } from 'next/server';
import { getListingByRaiaId } from '@/lib/queries';
import { buildPropertyDescriptionWithCta } from '@/lib/property-card';
import { getEstateAgentProfile } from '@/lib/agent-directory';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { cachePath, resolveLang, scriptHash, voiceFor, type VoiceGender } from '@/lib/tts';
import type { Listing } from '@/lib/types';

const RAIA_ID_RE = /^prop-[a-z]{2}-[a-z0-9-]{2,32}-[0-9]{4,}$/;
const MAX_CHARS = 2500;
const MAX_CACHE_ENTRIES = 100;
const BUCKET = 'tts-audio';
const CACHE_CONTROL = 'public, max-age=86400, s-maxage=604800';

// shortcut: per-instance memory cache stays as the no-Storage fallback; the
// bucket is the shared copy once provisioned.
const cache = new Map<string, ArrayBuffer>();

function setCache(key: string, value: ArrayBuffer) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, value);
}

// Storage is best-effort: a missing bucket logs and falls through to the
// in-memory/upstream path rather than failing the request.
function storage() {
  try {
    return createSupabaseAdminClient();
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raia_id = params.get('raia_id') ?? '';
  if (!RAIA_ID_RE.test(raia_id)) {
    return NextResponse.json({ error: 'Invalid raia_id' }, { status: 400 });
  }
  const genderParam = params.get('gender');
  if (genderParam && genderParam !== 'female' && genderParam !== 'male') {
    return NextResponse.json({ error: 'Invalid gender' }, { status: 400 });
  }
  const gender: VoiceGender = genderParam === 'male' ? 'male' : 'female';

  const apiKey = process.env.GOOGLE_TTS_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'TTS not configured' }, { status: 503 });
  }

  let listing: Listing | null = null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    listing = await getListingByRaiaId(raia_id, controller.signal);
  } catch (err) {
    console.error('[tts] DB lookup failed or timed out:', err);
    return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!listing) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  }

  const lang = resolveLang(params.get('lang'), listing);
  if (!lang) {
    return NextResponse.json({ error: 'Invalid lang' }, { status: 400 });
  }

  const script = buildPropertyDescriptionWithCta(
    listing,
    getEstateAgentProfile(listing.agent_id)?.name
  ).slice(0, MAX_CHARS);
  const hash = scriptHash(script);
  const path = cachePath(raia_id, lang, gender, hash);
  const store = storage();

  let fresh = false;
  let audio: ArrayBuffer | null = cache.get(path) ?? null;
  if (!audio && store) {
    const hit = await store.storage.from(BUCKET).download(path);
    if (hit.data) {
      audio = await hit.data.arrayBuffer();
      setCache(path, audio);
    }
  }

  if (!audio) {
    const fetchController = new AbortController();
    const fetchTimeoutId = setTimeout(() => fetchController.abort(), 8000);
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
          signal: fetchController.signal
        }
      );
      if (!res.ok) {
        console.error('[tts] google', res.status, await res.text().catch(() => ''));
        return NextResponse.json({ error: 'TTS upstream failed' }, { status: 502 });
      }
      const body = (await res.json()) as { audioContent?: string };
      if (!body.audioContent) {
        return NextResponse.json({ error: 'TTS upstream returned no audio' }, { status: 502 });
      }
      audio = Uint8Array.from(atob(body.audioContent), (c) => c.charCodeAt(0)).buffer;
      fresh = true;
      setCache(path, audio);
    } catch (err) {
      console.error('[tts] google fetch failed or timed out:', err);
      return NextResponse.json({ error: 'TTS upstream timeout or failure' }, { status: 504 });
    } finally {
      clearTimeout(fetchTimeoutId);
    }
  }

  if (store && fresh) {
    const bucket = store.storage.from(BUCKET);
    try {
      const up = await bucket.upload(path, new Blob([audio], { type: 'audio/mpeg' }), {
        contentType: 'audio/mpeg',
        cacheControl: '604800',
        upsert: true
      });
      if (up.error) throw new Error(up.error.message);
      // One file per (listing, locale, voice): drop the previous script hashes.
      const dir = path.slice(0, path.lastIndexOf('/'));
      const old = await bucket.list(dir);
      const stale = (old.data ?? []).map((e) => `${dir}/${e.name}`).filter((p) => p !== path);
      if (stale.length) await bucket.remove(stale);
    } catch (err) {
      console.error('[tts] storage write failed (serving uncached):', err);
    }
  }

  return new NextResponse(audio, {
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': CACHE_CONTROL }
  });
}
