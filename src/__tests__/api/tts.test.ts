import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/tts/route';
import { cachePath, resolveLang, scriptHash, voiceFor } from '@/lib/tts';
import { buildPropertyDescriptionWithCta } from '@/lib/property-card';
import type { Listing } from '@/lib/types';

const state = vi.hoisted(() => ({
  listing: null as Listing | null,
  download: vi.fn(),
  upload: vi.fn(),
  list: vi.fn(),
  remove: vi.fn()
}));

vi.mock('@/lib/queries', () => ({
  getListingByRaiaId: vi.fn(async () => state.listing)
}));

vi.mock('@/lib/agent-directory', () => ({
  getEstateAgentProfile: () => ({ name: 'Acme Estates' })
}));

vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: () => ({
    storage: {
      from: () => ({
        download: state.download,
        upload: state.upload,
        list: state.list,
        remove: state.remove
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

const get = (query: string) => GET(new Request(`http://localhost/api/tts?${query}`));

beforeEach(() => {
  vi.restoreAllMocks();
  state.listing = listing();
  state.download.mockReset().mockResolvedValue({ data: null, error: null });
  state.upload.mockReset().mockResolvedValue({ data: {}, error: null });
  state.list.mockReset().mockResolvedValue({ data: [], error: null });
  state.remove.mockReset().mockResolvedValue({ data: [], error: null });
  process.env.GOOGLE_TTS_API_KEY = 'test-key';
});

describe('voice selection', () => {
  it('maps every locale and gender to a distinct Google Cloud voice', () => {
    expect(voiceFor('en-GB', 'female')).toBe('en-GB-Neural2-F');
    expect(voiceFor('en-GB', 'male')).toBe('en-GB-Neural2-D');
    expect(voiceFor('th-TH', 'female')).toBe('th-TH-Neural2-C');
    expect(voiceFor('th-TH', 'male')).toBe('th-TH-Standard-A');
    expect(voiceFor('ms-MY', 'female')).toBe('ms-MY-Wavenet-A');
    expect(voiceFor('ms-MY', 'male')).toBe('ms-MY-Wavenet-D');
    expect(voiceFor('ja-JP', 'female')).toBe('ja-JP-Neural2-B');
    expect(voiceFor('ja-JP', 'male')).toBe('ja-JP-Neural2-C');
  });

  it('derives the locale from the listing country when omitted', () => {
    expect(resolveLang(null, listing())).toBe('en-GB');
    expect(resolveLang(null, listing({ jurisdiction: 'TH', currency: 'THB' }))).toBe('th-TH');
    expect(resolveLang(null, listing({ jurisdiction: 'MY', currency: 'MYR' }))).toBe('ms-MY');
    expect(resolveLang(null, listing({ jurisdiction: 'JP', currency: 'JPY' }))).toBe('ja-JP');
    expect(resolveLang('ja-JP', listing())).toBe('ja-JP');
    expect(resolveLang('fr-FR', listing())).toBeNull();
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
  it('returns 404 when the listing is missing', async () => {
    state.listing = null;
    const res = await get('raia_id=prop-gb-london-abcd-1234');
    expect(res.status).toBe(404);
  });

  it('returns 503 when Google TTS is unconfigured', async () => {
    delete process.env.GOOGLE_TTS_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const res = await get('raia_id=prop-gb-london-abcd-1234');
    expect(res.status).toBe(503);
  });

  it('rejects unknown gender and language', async () => {
    expect((await get('raia_id=prop-gb-london-abcd-1234&gender=robot')).status).toBe(400);
    expect((await get('raia_id=prop-gb-london-abcd-1234&lang=fr-FR')).status).toBe(400);
  });

  it('serves a storage cache hit without calling Google TTS', async () => {
    const l = listing({ marketing_description: 'Cache hit test property.' });
    state.listing = l;
    const script = buildPropertyDescriptionWithCta(l, 'Acme Estates');
    const hash = scriptHash(script);
    state.download.mockResolvedValue({
      data: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }),
      error: null
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await get(`raia_id=${l.raia_id}&lang=en-GB&gender=male`);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=604800');
    expect(state.download).toHaveBeenCalledWith(cachePath(l.raia_id, 'en-GB', 'male', hash));
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await res.arrayBuffer()).byteLength).toBe(3);
  });
});
