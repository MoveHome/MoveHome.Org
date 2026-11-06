// MUST-PASS: after a dropped connection the TV backfills from its cursor, so no
// row that arrived during the gap is lost and no row is shown twice.
import { describe, expect, it, vi } from 'vitest';
import { cursorOf, mergeRows, refetchAll, type FeedRow } from '@/lib/demo/reconcile';

function row(seq: number): FeedRow {
  return {
    id: `00000000-0000-0000-0000-00000000000${seq}`,
    seq,
    venue_id: 'venue-a',
    headline: `listing ${seq}`,
    correlation_id: `corr-${seq}`
  };
}

describe('reconnect backfill', () => {
  it('asks for the page after the cursor and merges with no loss and no duplicate', async () => {
    const onScreen = [row(1), row(2)];
    // Row 2 is replayed by the transport; 3 and 4 arrived while the socket was down.
    const afterDrop = [row(2), row(3), row(4)];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('since=2');
      return new Response(JSON.stringify({ rows: afterDrop }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const page = await refetchAll('venue-token', cursorOf(onScreen));
      const merged = mergeRows(onScreen, page);

      expect(merged.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
      expect(new Set(merged.map((r) => r.id)).size).toBe(merged.length);
      expect(cursorOf(merged)).toBe(4);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the live row when the page has not caught up with it yet', () => {
    const live = [row(1), row(2), row(3)];
    expect(mergeRows(live, [row(1)])).toHaveLength(3);
  });
});
