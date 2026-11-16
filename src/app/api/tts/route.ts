// GET /api/tts?raia_id=… — reads the listing's sanitised description through
// ElevenLabs and caches the audio by content hash. Without a key the client
// falls back to speechSynthesis, so a 503 here is a normal path.

import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { getListingByRaiaId } from '@/lib/queries';
import { plainText, priceLabel, statusLabel, titleOf } from '@/lib/property-card';
import { sanitizeDescription } from '@/lib/sanitize-description';
import type { Listing } from '@/lib/types';

const RAIA_ID_RE = /^prop-[a-z]{2}-[a-z0-9-]{2,32}-[0-9]{4,}$/;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb'; // George
const MODEL_ID = 'eleven_turbo_v2_5';
const MAX_CHARS = 2500;
const MAX_CACHE_ENTRIES = 100;

// shortcut: per-instance memory cache — one warm instance keeps audio for free;
// move to shared KV/CDN when traffic spans several instances.
const cache = new Map<string, ArrayBuffer>();

function setCache(key: string, value: ArrayBuffer) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
    }
  }
  cache.set(key, value);
}

function speechText(l: Listing): string {
  const desc = plainText(sanitizeDescription(l.marketing_description));
  if (desc) return desc;
  // Agents who ship no description still get a two-sentence spoken summary.
  const beds = l.bedrooms != null ? `${l.bedrooms} bedroom` : 'studio';
  return `${titleOf(l)} in ${l.suburb ?? 'the area'}. ${beds} home at ${priceLabel(l)}, ${statusLabel(l)}.`;
}

export async function GET(request: Request) {
  const raia_id = new URL(request.url).searchParams.get('raia_id') ?? '';
  if (!RAIA_ID_RE.test(raia_id)) {
    return NextResponse.json({ error: 'Invalid raia_id' }, { status: 400 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
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

  const text = speechText(listing).slice(0, MAX_CHARS);
  const cacheKey = createHash('sha256').update(raia_id + text).digest('hex');

  let audio = cache.get(cacheKey);
  if (!audio) {
    const fetchController = new AbortController();
    const fetchTimeoutId = setTimeout(() => fetchController.abort(), 8000);
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, model_id: MODEL_ID }),
          signal: fetchController.signal
        }
      );

      if (!res.ok) {
        console.error('[tts] elevenlabs', res.status, await res.text().catch(() => ''));
        return NextResponse.json({ error: 'TTS upstream failed' }, { status: 502 });
      }
      audio = await res.arrayBuffer();
      setCache(cacheKey, audio);
    } catch (err) {
      console.error('[tts] elevenlabs fetch failed or timed out:', err);
      return NextResponse.json({ error: 'TTS upstream timeout or failure' }, { status: 504 });
    } finally {
      clearTimeout(fetchTimeoutId);
    }
  }

  return new NextResponse(audio, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800'
    }
  });
}
