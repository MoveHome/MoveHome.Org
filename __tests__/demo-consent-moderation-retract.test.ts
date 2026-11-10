// Must-fail checks for the expo consent, moderation and retract lanes: consent
// gates the broadcast, moderation fails closed to the placeholder, retract
// finishes inside the 60000 ms demo budget, and seeded rows stay read-only.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({ moderate: vi.fn() }));

vi.mock('@/lib/moderation', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, moderate: hoisted.moderate };
});

const { emitListing } = await import('@/lib/demo/emit');
const { MODERATION_PLACEHOLDER } = await import('@/lib/moderation');
const { retractListing, RETRACT_BUDGET_MS } = await import('@/lib/demo/retract');

const VERDICT = (over: Record<string, unknown> = {}) => ({
  allow: true,
  state: 'allow',
  reason: 'classifier_allow',
  fixture_id: null,
  checked_at: new Date().toISOString(),
  ...over
});

const LISTING = {
  headline: '2 bed, Croydon, £1,400',
  bedrooms: 2,
  rent_pcm: 1400,
  currency: 'GBP',
  photo_url: 'https://demo.example/photo.jpg'
};

beforeEach(() => {
  hoisted.moderate.mockReset();
  hoisted.moderate.mockResolvedValue(VERDICT());
});

describe('consent precedes the broadcast', () => {
  it('emits nothing while consent is pending and never classifies', async () => {
    const publish = vi.fn();
    const res = await emitListing(
      { venue_id: 'venue-a', listing_id: 'l1', consent_state: 'pending', listing: LISTING },
      publish
    );
    expect(res.emitted).toBe(false);
    expect(res.reason).toBe('consent_not_granted');
    expect(publish).not.toHaveBeenCalled();
    expect(hoisted.moderate).not.toHaveBeenCalled();
    expect(res.payload.headline).toBe(MODERATION_PLACEHOLDER);
  });

  it('publishes exactly one broadcast event once consent is granted', async () => {
    const publish = vi.fn();
    const res = await emitListing(
      { venue_id: 'venue-a', listing_id: 'l1', consent_state: 'granted', listing: LISTING },
      publish
    );
    expect(res.emitted).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(res.payload.headline).toBe(LISTING.headline);
  });
});

describe('moderation fails closed to the placeholder', () => {
  const FIXTURE = 'golden/slur.txt';
  const OFFENDING_TEXT = 'two bed in Croydon, the neighbours are vermin';

  it('blocks publication when the classifier times out', async () => {
    hoisted.moderate.mockResolvedValue(
      VERDICT({ allow: false, state: 'unavailable', reason: 'timeout', fixture_id: FIXTURE })
    );
    const publish = vi.fn();
    const res = await emitListing(
      {
        venue_id: 'venue-a',
        listing_id: 'l2',
        consent_state: 'granted',
        listing: { ...LISTING, headline: OFFENDING_TEXT },
        fixture_id: FIXTURE
      },
      publish
    );
    expect(res.emitted).toBe(false);
    expect(res.reason).toBe('moderation_not_allowed');
    expect(publish).not.toHaveBeenCalled();
    expect(res.payload.headline).toBe(MODERATION_PLACEHOLDER);
    expect(res.payload.photo_url).toBeNull();
    expect(res.verdict?.fixture_id).toBe(FIXTURE);
    expect(JSON.stringify(res.payload)).not.toContain('vermin');
  });
});

describe('retract budget and seeded rows', () => {
  // Two-phase contract (ADR-476 D4): begin marks the row deleting and hands back
  // the media prefix; finalize runs only after the prefix reads back empty.
  function client(options: {
    begin: { id: string; venue_id: string; media_prefix: string } | null;
    finalize?: unknown;
    objects?: string[];
  }) {
    const media = new Set(options.objects ?? ['venue-a/l3/photo.jpg']);
    const remove = vi.fn(async (paths: string[]) => {
      for (const path of paths) media.delete(path);
      return { data: paths.length, error: null };
    });
    const list = vi.fn(async (prefix: string, opts?: { offset?: number }) => {
      const keys = [...media].filter((key) => key.startsWith(`${prefix}/`)).sort();
      return {
        data: keys.slice(opts?.offset ?? 0).map((key) => ({
          name: key.slice(prefix.length + 1),
          id: `obj-${key}`,
          metadata: { size: 10 }
        })),
        error: null
      };
    });
    return {
      rpc: vi.fn(async (fn: string) =>
        fn === 'demo_retract_begin'
          ? { data: options.begin, error: null }
          : { data: options.finalize ?? true, error: null }
      ),
      storage: { from: () => ({ list, remove }) },
      remove
    };
  }

  it('deletes media, then the row, inside the 60000 ms budget', async () => {
    const db = client({ begin: { id: 'l3', venue_id: 'venue-a', media_prefix: 'venue-a/l3' } });
    const res = await retractListing(db, { venue_id: 'venue-a', id: 'l3', retract_code: '1234' });
    expect(RETRACT_BUDGET_MS).toBe(60000);
    expect(res.retracted).toBe(true);
    if (res.retracted) {
      expect(res.media_removed).toBe(1);
      expect(res.elapsed_ms).toBeLessThan(60000);
    }
    expect(db.remove).toHaveBeenCalledWith(['venue-a/l3/photo.jpg']);
    expect(db.rpc.mock.calls.map((call) => call[0])).toEqual([
      'demo_retract_begin',
      'demo_retract_finalize'
    ]);
  });

  it('refuses a seeded row because is_seed rows are not retractable', async () => {
    const db = client({ begin: null });
    const res = await retractListing(db, { venue_id: 'venue-a', id: 'seed-1', retract_code: '1234' });
    expect(res.retracted).toBe(false);
    if (!res.retracted) {
      expect(res.reason).toBe('refused');
      expect(res.message).toContain('not retractable');
    }
    expect(db.remove).not.toHaveBeenCalled();
  });
});
