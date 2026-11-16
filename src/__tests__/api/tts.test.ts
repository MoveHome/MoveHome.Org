import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/tts/route';
import { TTS_LANGS, cachePath, resolveLang, scriptHash, voiceFor, type TtsLang, type VoiceGender } from '@/lib/tts';
import { buildPropertyDescriptionWithCta, ttsLocaleOf } from '@/lib/property-card';
import type { Listing } from '@/lib/types';

const state = vi.hoisted(() => ({
  listing: null as Listing | null,
  // Optional scripted sequence of listing reads (request, then cleanup re-read).
  queue: [] as (Listing | null)[],
  files: new Map<string, Blob>(),
  uploadFails: false,
  readFails: false
}));

vi.mock('@/lib/queries', () => ({
  getListingByRaiaId: vi.fn(async () => (state.queue.length ? state.queue.shift() ?? null : state.listing))
}));

vi.mock('@/lib/agent-directory', () => ({
  getEstateAgentProfile: () => ({ name: 'Acme Estates' })
}));

vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: () => ({
    storage: {
      from: () => ({
        download: async (path: string) => {
          if (state.readFails) throw new Error('storage read down');
          const file = state.files.get(path);
          return file ? { data: file, error: null } : { data: null, error: { message: 'not found' } };
        },
        // create-if-absent when upsert is false, like the real bucket.
        upload: async (path: string, file: Blob, opts?: { upsert?: boolean }) => {
          if (state.uploadFails) throw new Error('storage write down');
          if (!opts?.upsert && state.files.has(path)) return { data: null, error: { message: 'exists' } };
          state.files.set(path, file);
          return { data: {}, error: null };
        },
        list: async (prefix: string) => {
          if (state.readFails) throw new Error('storage list down');
          return {
            data: [...state.files.keys()]
              .filter((k) => k.startsWith(`${prefix}/`))
              .map((k) => ({ name: k.slice(prefix.length + 1) })),
            error: null
          };
        },
        remove: async (paths: string[]) => {
          paths.forEach((p) => state.files.delete(p));
          return { data: [], error: null };
        }
      })
    }
  })
}));

const listing = (overrides: Partial<Listing> = {}): Listing =>
  ({
    raia_id: 'prop-gb-london-abcd-1234',
    agent_id: 'org-gb-acme',
    currency: 'GBP',
    service_type: 'long_term',
    rent_pcm: 2500,
    listing_status: 'available',
    jurisdiction: 'GB',
    un_locode: 'GBLON',
    headline: '2-bed flat in Canary Wharf',
    marketing_description: 'Bright apartment with river views.',
    features: [],
    photos: [],
    ...overrides
  }) as Listing;

// Each test uses its own client IP so the per-client miss budget is isolated.
const get = (query: string, ip = 'ip-default') =>
  GET(new Request(`http://localhost/api/tts?${query}`, { headers: { 'x-forwarded-for': ip } }));

const pathOf = (l: Listing, lang: TtsLang = 'en-GB', gender: VoiceGender = 'female') =>
  cachePath(l.raia_id, lang, gender, scriptHash(buildPropertyDescriptionWithCta(l, 'Acme Estates')));

function googleOk() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ audioContent: btoa('audio-bytes') })
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.restoreAllMocks();
  state.listing = listing();
  state.queue = [];
  state.files.clear();
  state.uploadFails = false;
  state.readFails = false;
  process.env.GOOGLE_TTS_API_KEY = 'test-key';
  delete process.env.GEMINI_API_KEY;
});

// Subset of Google's official voice list, gender per
// https://cloud.google.com/text-to-speech/docs/list-voices-and-types
const CATALOG: Record<string, 'FEMALE' | 'MALE'> = {
  'en-GB-Neural2-F': 'FEMALE',
  'en-GB-Neural2-D': 'MALE',
  'th-TH-Neural2-C': 'FEMALE',
  'th-TH-Standard-A': 'FEMALE',
  'th-TH-Chirp3-HD-Achird': 'MALE',
  'ms-MY-Wavenet-A': 'FEMALE',
  'ms-MY-Wavenet-D': 'MALE',
  'ja-JP-Neural2-B': 'FEMALE',
  'ja-JP-Neural2-C': 'MALE'
};

describe('voice selection', () => {
  it('maps every locale and gender to a catalog voice of that gender', () => {
    for (const lang of TTS_LANGS) {
      for (const gender of ['female', 'male'] as const) {
        const name = voiceFor(lang, gender);
        expect(CATALOG[name], `${lang}/${gender} -> ${name}`).toBe(gender === 'male' ? 'MALE' : 'FEMALE');
        expect(name.startsWith(`${lang}-`)).toBe(true);
      }
    }
  });

  it('uses a catalog-verified male Thai voice', () => {
    expect(voiceFor('th-TH', 'male')).toBe('th-TH-Chirp3-HD-Achird');
    // Thai has no male voice below the Chirp 3: HD tier.
    expect(CATALOG[voiceFor('th-TH', 'male')]).toBe('MALE');
    expect(new Set(TTS_LANGS.map((l) => voiceFor(l, 'male'))).size).toBe(TTS_LANGS.length);
    expect(new Set(TTS_LANGS.map((l) => voiceFor(l, 'female'))).size).toBe(TTS_LANGS.length);
  });

  it('derives the locale from the listing when omitted, matching the client resolver', () => {
    expect(resolveLang(null, listing())).toBe('en-GB');
    expect(resolveLang(null, listing({ jurisdiction: 'TH', currency: 'THB' }))).toBe('th-TH');
    expect(resolveLang(null, listing({ jurisdiction: 'MY', currency: 'MYR' }))).toBe('ms-MY');
    expect(resolveLang(null, listing({ jurisdiction: 'JP', currency: 'JPY' }))).toBe('ja-JP');
    expect(resolveLang('ja-JP', listing())).toBe('ja-JP');
    expect(resolveLang('fr-FR', listing())).toBeNull();
    for (const l of [
      listing(),
      listing({ jurisdiction: 'TH', currency: 'THB' }),
      listing({ jurisdiction: 'MY', currency: 'MYR' }),
      listing({ jurisdiction: 'JP', currency: 'JPY' })
    ]) {
      expect(resolveLang(null, l)).toBe(ttsLocaleOf(l));
    }
  });
});

describe('storage cache key', () => {
  it('changes when the spoken script changes and is stable when it does not', () => {
    const l = listing();
    const a = scriptHash(buildPropertyDescriptionWithCta(l, 'Acme Estates'));
    expect(scriptHash(buildPropertyDescriptionWithCta(l, 'Acme Estates'))).toBe(a);

    const repriced = scriptHash(
      buildPropertyDescriptionWithCta(listing({ rent_pcm: 3100 }), 'Acme Estates')
    );
    const revendored = scriptHash(buildPropertyDescriptionWithCta(l, 'Other Agent'));
    const redescribed = scriptHash(
      buildPropertyDescriptionWithCta(listing({ marketing_description: 'Tiny studio.' }), 'Acme Estates')
    );

    expect(new Set([a, repriced, revendored, redescribed]).size).toBe(4);
    expect(cachePath(l.raia_id, 'en-GB', 'female', a)).toBe(
      `tts/${l.raia_id}/en-GB/female/${a}.mp3`
    );
  });
});

describe('GET /api/tts', () => {
  it('returns 404 for a missing listing even when no provider key is set', async () => {
    delete process.env.GOOGLE_TTS_API_KEY;
    state.listing = null;
    const res = await get('raia_id=prop-gb-london-abcd-1234', 'ip-404');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a withdrawn listing after audio was cached', async () => {
    const l = listing({ marketing_description: 'withdrawal test property.' });
    state.listing = l;
    const fetchMock = googleOk();
    expect((await get(`raia_id=${l.raia_id}`, 'ip-withdraw')).status).toBe(200);
    state.listing = null;
    const res = await get(`raia_id=${l.raia_id}`, 'ip-withdraw');
    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when Google TTS is unconfigured and nothing is stored', async () => {
    delete process.env.GOOGLE_TTS_API_KEY;
    const res = await get('raia_id=prop-gb-london-abcd-1234', 'ip-503');
    expect(res.status).toBe(503);
  });

  it('rejects unknown gender and language', async () => {
    expect((await get('raia_id=prop-gb-london-abcd-1234&gender=robot', 'ip-400')).status).toBe(400);
    expect((await get('raia_id=prop-gb-london-abcd-1234&lang=fr-FR', 'ip-400')).status).toBe(400);
  });

  it('serves stored audio without a provider key', async () => {
    const l = listing({ marketing_description: 'stored audio without key.' });
    state.listing = l;
    state.files.set(pathOf(l), new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }));
    delete process.env.GOOGLE_TTS_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await get(`raia_id=${l.raia_id}&lang=en-GB&gender=female`, 'ip-nokey');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await res.arrayBuffer()).byteLength).toBe(3);
  });

  it('never lets a cache store the mutable lookup URL', async () => {
    const l = listing({ marketing_description: 'cache boundary test property.' });
    state.listing = l;
    const fetchMock = googleOk();

    const res = await get(`raia_id=${l.raia_id}`, 'ip-nostore');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    // A reprice must not be served from cache: new hash, new synthesis.
    state.listing = { ...l, rent_pcm: 9999 };
    expect((await get(`raia_id=${l.raia_id}`, 'ip-nostore')).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const audioFiles = [...state.files.keys()].filter((p) => p.endsWith('.mp3'));
    expect(audioFiles).toEqual([pathOf({ ...l, rent_pcm: 9999 })]);
  });

  it('synthesises once for simultaneous misses', async () => {
    const l = listing({ marketing_description: 'parallel miss test property.' });
    state.listing = l;
    const fetchMock = googleOk();

    const [a, b] = await Promise.all([
      get(`raia_id=${l.raia_id}&lang=en-GB&gender=male`, 'ip-parallel'),
      get(`raia_id=${l.raia_id}&lang=en-GB&gender=male`, 'ip-parallel')
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await a.arrayBuffer()).byteLength).toBe((await b.arrayBuffer()).byteLength);
  });

  it('keeps the current audio when an older in-flight version finishes later', async () => {
    const v1 = listing({ marketing_description: 'race safe cleanup v1.' });
    const v2 = { ...v1, rent_pcm: 4200 };
    // A newer version is already stored; this request still holds v1.
    state.files.set(pathOf(v2), new Blob([new Uint8Array([9])], { type: 'audio/mpeg' }));
    state.queue = [v1, v2];
    googleOk();

    const res = await get(`raia_id=${v1.raia_id}&lang=en-GB&gender=female`, 'ip-order');

    expect(res.status).toBe(200);
    expect(state.files.has(pathOf(v2))).toBe(true);
    expect(state.files.has(pathOf(v1))).toBe(false);
  });

  it('retries persisting memory-only audio after a storage outage', async () => {
    const l = listing({ marketing_description: 'storage outage recovery test.' });
    state.listing = l;
    const fetchMock = googleOk();
    state.uploadFails = true;

    const first = await get(`raia_id=${l.raia_id}`, 'ip-outage');
    expect(first.status).toBe(200);
    expect((await first.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect(state.files.has(pathOf(l))).toBe(false);

    state.uploadFails = false;
    const second = await get(`raia_id=${l.raia_id}`, 'ip-outage');
    expect(second.status).toBe(200);
    expect(state.files.has(pathOf(l))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('survives a storage read failure by synthesising again', async () => {
    const l = listing({ marketing_description: 'storage read outage test.' });
    state.listing = l;
    state.files.set(pathOf(l), new Blob([new Uint8Array([7])], { type: 'audio/mpeg' }));
    state.readFails = true;
    const fetchMock = googleOk();

    const res = await get(`raia_id=${l.raia_id}`, 'ip-read-outage');

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('limits repeated billable misses per client', async () => {
    const l = listing({ marketing_description: 'abuse budget test property.' });
    state.listing = l;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, text: async () => 'nope' }))
    );

    for (let i = 0; i < 10; i++) {
      expect((await get(`raia_id=${l.raia_id}`, 'ip-abuse')).status).toBe(502);
    }
    const limited = await get(`raia_id=${l.raia_id}`, 'ip-abuse');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    // Another client is unaffected.
    expect((await get(`raia_id=${l.raia_id}`, 'ip-other')).status).toBe(502);
  });
});
