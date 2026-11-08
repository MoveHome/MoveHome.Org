// Reconciliation is the TV's only liveness signal.
//
// Every 30 s the screen posts a fingerprint of the rows it is showing
// ({count, last_id, hash}); the server diffs it against the authoritative DB
// and answers. A mismatch means the screen is lying, so it refetches everything
// and raises the STALE banner. Socket state (JOINED/SUBSCRIBED) is never read:
// a live socket proves nothing, and neither does /api/health.

export const RECONCILE_INTERVAL_MS = 30000;

// One missed window plus slack: a single slow round trip must not flash the
// banner, but two dead windows must.
export const STALE_AFTER_MS = RECONCILE_INTERVAL_MS + 10000;

export interface FeedRow {
  id: string;
  seq: number;
  venue_id: string;
  headline?: string | null;
  property_type?: string | null;
  service_type?: string | null;
  bedrooms?: number | null;
  rent_pcm?: number | null;
  currency?: string | null;
  un_locode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  source?: string | null;
  photo_url?: string | null;
  correlation_id?: string | null;
  created_at?: string | null;
}

export interface Fingerprint {
  count: number;
  last_id: string;
  hash: string;
}

const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
];
const SINE = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
const rotl = (x: number, c: number) => ((x << c) | (x >>> (32 - c))) >>> 0;

// md5 of the UTF-8 bytes. demo_feed_fingerprint hashes exactly
// "seq|id|correlation_id" joined by ',' in seq order, so the two sides digest
// identical bytes. (WebCrypto has no md5, hence the local implementation.)
export function md5Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const n = bytes.length;
  const words = new Uint32Array((((n + 8) >>> 6) + 1) * 16);
  for (let i = 0; i < n; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  words[n >> 2] |= 0x80 << ((n % 4) * 8);
  words[words.length - 2] = (n * 8) >>> 0;

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < words.length; offset += 16) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const carried = d;
      d = c;
      c = b;
      b = (b + rotl((a + f + SINE[i] + words[offset + g]) >>> 0, SHIFTS[i])) >>> 0;
      a = carried;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0]
    .map((word) => [0, 8, 16, 24].map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, '0')).join(''))
    .join('');
}

export function fingerprintOf(rows: FeedRow[]): Fingerprint {
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  return {
    count: ordered.length,
    last_id: ordered.length > 0 ? ordered[ordered.length - 1].id : '',
    hash: md5Hex(ordered.map((row) => `${row.seq}|${row.id}|${row.correlation_id ?? ''}`).join(','))
  };
}

/** Highest seq on screen: the `since` cursor a reconnect backfills from. */
export function cursorOf(rows: FeedRow[]): number {
  return rows.reduce((max, row) => (row.seq > max ? row.seq : max), 0);
}

// Backfill merge, keyed by id: a row delivered both live and by the cursor page
// lands once, and nothing that arrived during the drop is lost.
export function mergeRows(existing: FeedRow[], page: FeedRow[]): FeedRow[] {
  const byId = new Map(existing.map((row) => [row.id, row]));
  for (const row of page) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** Full read of the venue's feed, or the page after `since`. */
export async function refetchAll(token: string, since = 0): Promise<FeedRow[]> {
  const res = await fetch(`/api/demo/feed?since=${since}&limit=200`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`feed refetch failed: ${res.status}`);
  const body = (await res.json()) as { rows?: FeedRow[] };
  return body.rows ?? [];
}

/** Post the on-screen fingerprint; the server answers with its own. */
export async function postReconcile(
  fingerprint: Fingerprint,
  token: string,
  correlation_id = ''
): Promise<{ ok: boolean }> {
  const res = await fetch('/api/demo/feed', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    cache: 'no-store',
    body: JSON.stringify({ ...fingerprint, correlation_id })
  });
  if (!res.ok) return { ok: false };
  const body = (await res.json()) as { ok?: boolean };
  return { ok: body.ok === true };
}

/** No verification yet is stale: unknown freshness is never "fresh". */
export function isStale(lastVerifiedAt: number, now = Date.now()): boolean {
  return lastVerifiedAt <= 0 || now - lastVerifiedAt > STALE_AFTER_MS;
}
