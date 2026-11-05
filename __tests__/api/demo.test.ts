// Must-fail checks for the expo demo routes: the demo flag cannot come from the
// caller, writes are gated on the kill switch and on a venue token, and a
// refused retract (seeded row / wrong code) surfaces as 404.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';

const rpc = vi.fn();
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc }) }));

const { POST: ingest } = await import('@/app/api/demo/ingest/route');
const { POST: retract } = await import('@/app/api/demo/retract/route');

const SECRET = 'test-secret-test-secret-test-secret';
const VENUE = 'venue-a';

function token(venue = VENUE) {
  return new SignJWT({ venue_id: venue })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(SECRET));
}

function req(path: string, body: unknown, bearer?: string) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {})
    },
    body: JSON.stringify(body)
  });
}

const LISTING = {
  raia_id: 'raia-demo-1',
  headline: 'Demo flat',
  property_type: 'flat',
  service_type: 'long_term'
};

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: 'uuid-1', error: null });
  process.env.DEMO_SESSION_SECRET = SECRET;
  process.env.DEMO_WRITE_ENABLED = 'true';
  process.env.DEMO_SUPABASE_URL = 'https://demo.example.supabase.co';
  process.env.DEMO_SUPABASE_ANON_KEY = 'demo-anon';
});

describe('POST /api/demo/ingest', () => {
  it('403s when the kill switch is off', async () => {
    process.env.DEMO_WRITE_ENABLED = 'false';
    const res = await ingest(req('/api/demo/ingest', { venue_id: VENUE, listing: LISTING }, await token()));
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('401s without a venue token', async () => {
    const res = await ingest(req('/api/demo/ingest', { venue_id: VENUE, listing: LISTING }));
    expect(res.status).toBe(401);
  });

  it('400s on a caller-supplied demo flag', async () => {
    const res = await ingest(
      req('/api/demo/ingest', { venue_id: VENUE, listing: { ...LISTING, is_demo: false } }, await token())
    );
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('403s when the body venue does not match the token', async () => {
    const res = await ingest(req('/api/demo/ingest', { venue_id: 'venue-b', listing: LISTING }, await token()));
    expect(res.status).toBe(403);
  });

  it('201s and calls the RPC without any demo flag', async () => {
    const res = await ingest(req('/api/demo/ingest', { venue_id: VENUE, listing: LISTING }, await token()));
    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('demo_ingest_listing', { p_venue_id: VENUE, p_listing: LISTING });
  });
});

describe('POST /api/demo/retract', () => {
  const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

  it('404s when the RPC refuses (seeded row or wrong code)', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const res = await retract(
      req('/api/demo/retract', { venue_id: VENUE, id: ID, retract_code: '1234' }, await token())
    );
    expect(res.status).toBe(404);
  });

  it('200s on a successful retract', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const res = await retract(
      req('/api/demo/retract', { venue_id: VENUE, id: ID, retract_code: '1234' }, await token())
    );
    expect(res.status).toBe(200);
  });
});
