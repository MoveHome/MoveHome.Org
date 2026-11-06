// MUST-FAIL: a fingerprint mismatch on the server side must read as NOT ok, so
// the screen refetches and raises the STALE banner. The TV-side hash has to
// cover the same bytes demo_feed_fingerprint hashes, otherwise every check
// would be a false mismatch — both directions are asserted here.
import { describe, expect, it, vi } from 'vitest';
import { fingerprintOf, md5Hex, postReconcile, refetchAll, type FeedRow } from '@/lib/demo/reconcile';

const rows: FeedRow[] = [
  { id: 'b', seq: 2, venue_id: 'v', correlation_id: 'c2' },
  { id: 'a', seq: 1, venue_id: 'v', correlation_id: null }
];

describe('fingerprint digest', () => {
  it('is md5 of the bytes the server hashes', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
  });

  it('hashes seq|id|correlation_id in seq order', () => {
    const fingerprint = fingerprintOf(rows);
    expect(fingerprint.hash).toBe(md5Hex('1|a|,2|b|c2'));
    expect(fingerprint.count).toBe(2);
    expect(fingerprint.last_id).toBe('b');
  });
});

describe('reconciliation', () => {
  it('reports a mismatch as not ok, which is what raises STALE', async () => {
    const local = fingerprintOf(rows);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: false, stale: true, server: { count: 3, last_seq: 3, hash: 'diverged' } }), {
        status: 200
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await postReconcile(local, 'venue-token', 'c2');
      expect(result.ok).toBe(false);

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(String(init?.body))).toMatchObject({
        count: 2,
        last_id: 'b',
        hash: local.hash,
        correlation_id: 'c2'
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports a matching fingerprint as ok', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true, stale: false }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await postReconcile(fingerprintOf(rows), 'venue-token');
      expect(result.ok).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('treats a failed refetch as an error, never as an empty feed', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 503 })
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(refetchAll('venue-token')).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
