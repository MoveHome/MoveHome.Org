// MUST-FAIL (venue-proxy simulation): the socket is dead — nothing is ever
// broadcast — while /api/health still answers 200. Neither the socket nor the
// health endpoint is a freshness signal, so only reconciliation may decide, and
// past the threshold the banner must appear.
import { describe, expect, it, vi } from 'vitest';
import { RECONCILE_INTERVAL_MS, STALE_AFTER_MS, fingerprintOf, isStale } from '@/lib/demo/reconcile';

describe('TV freshness with a dead socket', () => {
  it('is stale past the threshold even though /api/health answers 200', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/api/health')
        ? new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
        : new Response(JSON.stringify({ error: 'socket dead: no broadcast' }), { status: 503 })
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const verifiedAt = 1_000_000;
      const screen = fingerprintOf([]);
      expect(screen.count).toBe(0);

      // Inside the budget the display is fine; past it, it is stale.
      expect(isStale(verifiedAt, verifiedAt + STALE_AFTER_MS - 1)).toBe(false);
      expect(isStale(verifiedAt, verifiedAt + STALE_AFTER_MS + 1)).toBe(true);

      // The health endpoint says 200 and changes nothing about freshness.
      const health = await fetch('/api/health');
      expect(health.status).toBe(200);

      // Two reconcile windows with no event and no successful check: stale.
      expect(isStale(verifiedAt, verifiedAt + RECONCILE_INTERVAL_MS * 2 + 1)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('treats a screen that has never verified as stale', () => {
    expect(isStale(0, 1_000_000)).toBe(true);
  });
});
