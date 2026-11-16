// Contract tests for the dark A2A push receiver (ADR-472 §C): detached ES256
// JWS over the JCS body, fixed RAIA jku, 300s freshness, (kid, nonce) replay
// rejection. Network is faked; keys are generated per run.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import canonicalize from 'canonicalize';
import { CompactSign, exportJWK, generateKeyPair, type CryptoKey, type JWK } from 'jose';

const JKU = 'https://raia.test/.well-known/jwks.json';
const KID = 'raia-a2a-notify-test';
process.env.A2A_PUSH_JKU = JKU;

let signingKey: CryptoKey;
let publicJwk: JWK;

// Durable replay store stand-in. Rows live on globalThis, so they survive
// `vi.resetModules()` exactly as Postgres survives a cold lambda; the fake
// enforces the same PRIMARY KEY (kid, nonce) collision as tbl_a2a_push_nonces.
type NonceRow = { kid: string; nonce: string; expires_at: string };
vi.mock('@/lib/supabase-admin', () => {
  const store = globalThis as unknown as { __nonceRows?: Map<string, NonceRow>; __nonceDbDown?: boolean };
  const rows = (store.__nonceRows ??= new Map<string, NonceRow>());
  const rowKey = (r: NonceRow) => `${r.kid}:${r.nonce}`;

  function table() {
    let mode: 'select' | 'delete' = 'select';
    let head = false;
    let limit = Infinity;
    let ordered = false;
    const filters: Array<(r: NonceRow) => boolean> = [];

    const run = async () => {
      const matched = [...rows.values()].filter((r) => filters.every((f) => f(r)));
      if (mode === 'delete') {
        for (const r of matched) rows.delete(rowKey(r));
        return { data: null, count: matched.length, error: null };
      }
      const sorted = ordered
        ? [...matched].sort((a, b) => a.expires_at.localeCompare(b.expires_at))
        : matched;
      return {
        data: head ? null : sorted.slice(0, limit),
        count: matched.length,
        error: null
      };
    };

    const builder: Record<string, unknown> = {
      lt: (col: keyof NonceRow, v: string) => (filters.push((r) => r[col] < v), builder),
      lte: (col: keyof NonceRow, v: string) => (filters.push((r) => r[col] <= v), builder),
      order: () => ((ordered = true), builder),
      limit: (n: number) => ((limit = n), builder),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej)
    };

    return {
      select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
        head = Boolean(opts?.head);
        return builder;
      },
      delete: () => {
        mode = 'delete';
        return builder;
      },
      insert: async (row: NonceRow) => {
        if (rows.has(rowKey(row))) return { error: { code: '23505' } };
        rows.set(rowKey(row), row);
        return { error: null };
      }
    };
  }

  return {
    createSupabaseAdminClient: () => {
      if (store.__nonceDbDown) throw new Error('db down');
      return { from: table };
    }
  };
});

// Controls for the JWKS authority: __jwksKeys swaps the trusted key set,
// __jwksDown fails the fetch.
const net = globalThis as unknown as { __jwksKeys?: JWK[]; __jwksDown?: boolean };

vi.stubGlobal(
  'fetch',
  vi.fn(async (url: unknown) => {
    if (String(url) !== JKU) return new Response('not found', { status: 404 });
    if (net.__jwksDown) return new Response('boom', { status: 500 });
    return new Response(JSON.stringify({ keys: net.__jwksKeys ?? [publicJwk] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  })
);

const { POST } = await import('@/app/api/a2a/push-receiver/route');

const TASK_03 = { kind: 'task', id: 'task-1', status: { state: 'completed' } };
const STREAM_10 = { task: { id: 'task-1', status: { state: 'TASK_STATE_COMPLETED' } } };

type SignOpts = { kid?: string; iat?: number; nonce?: string };

async function sign(body: unknown, opts: SignOpts = {}) {
  const jcs = canonicalize(body as Record<string, unknown>);
  if (!jcs) throw new Error('fixture is not canonicalizable');
  const jws = await new CompactSign(new TextEncoder().encode(jcs))
    .setProtectedHeader({
      alg: 'ES256',
      typ: 'JOSE',
      kid: opts.kid ?? KID,
      jku: JKU,
      iat: opts.iat ?? Math.floor(Date.now() / 1000),
      nonce: opts.nonce ?? randomUUID()
    })
    .sign(signingKey);
  const [protectedHeader, , signature] = jws.split('.');
  return `${protectedHeader}..${signature}`;
}

// The wire body is the exact signed bytes: objects are canonicalized (a string
// is sent verbatim, for raw-body controls).
function post(signature: string, body: unknown, version: string, contentType?: string) {
  const raw = typeof body === 'string' ? body : canonicalize(body as Record<string, unknown>)!;
  return new Request('https://movehome.org/api/a2a/push-receiver', {
    method: 'POST',
    headers: {
      'content-type': contentType ?? (version === '1.0' ? 'application/a2a+json' : 'application/json'),
      'a2a-version': version,
      'x-a2a-signature': signature
    },
    body: raw
  });
}

// A detached JWS whose protected header is an arbitrary JSON value (for
// malformed-header controls); the signature segment is never reached.
function rawHeaderSignature(headerJson: string) {
  return `${Buffer.from(headerJson, 'utf8').toString('base64url')}..AAAA`;
}

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'ES256', use: 'sig' };
});

describe('POST /api/a2a/push-receiver', () => {
  it('accepts a valid A2A 0.3 delivery', async () => {
    const res = await POST(post(await sign(TASK_03), TASK_03, '0.3'));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('accepts a valid A2A 1.0 delivery', async () => {
    const res = await POST(post(await sign(STREAM_10), STREAM_10, '1.0'));
    expect(res.status).toBe(200);
  });

  it('rejects a tampered body', async () => {
    const signature = await sign(TASK_03);
    const tampered = { ...TASK_03, status: { state: 'failed' } };
    const res = await POST(post(signature, tampered, '0.3'));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('signature_mismatch');
  });

  it('rejects a stale timestamp', async () => {
    const stale = Math.floor(Date.now() / 1000) - 301;
    const res = await POST(post(await sign(TASK_03, { iat: stale }), TASK_03, '0.3'));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('stale_timestamp');
  });

  it('rejects an exact (kid, nonce) replay', async () => {
    const signature = await sign(TASK_03, { nonce: randomUUID() });
    expect((await POST(post(signature, TASK_03, '0.3'))).status).toBe(200);
    const replayed = await POST(post(signature, TASK_03, '0.3'));
    expect(replayed.status).toBe(401);
    expect((await replayed.json()).error).toBe('replayed_nonce');
  });

  // Cross-instance / cold start: on Vercel the replay may land on a lambda whose
  // module state is empty. The guard must live in the durable store, so this
  // re-imports the route as a fresh module instance between the two deliveries.
  it('rejects the same (kid, nonce) from a fresh module instance (cross-instance replay)', async () => {
    const signature = await sign(TASK_03, { nonce: randomUUID() });
    expect((await POST(post(signature, TASK_03, '0.3'))).status).toBe(200);

    vi.resetModules(); // drops every in-process Map; only the durable store survives
    const fresh = await import('@/app/api/a2a/push-receiver/route');
    expect(fresh.POST).not.toBe(POST);

    const replayed = await fresh.POST(post(signature, TASK_03, '0.3'));
    expect(replayed.status).toBe(401);
    expect((await replayed.json()).error).toBe('replayed_nonce');
  });

  it('fails closed when the replay store is unreachable', async () => {
    (globalThis as unknown as { __nonceDbDown?: boolean }).__nonceDbDown = true;
    try {
      const res = await POST(post(await sign(TASK_03), TASK_03, '0.3'));
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe('replay_store_unavailable');
    } finally {
      (globalThis as unknown as { __nonceDbDown?: boolean }).__nonceDbDown = false;
    }
  });

  it('accepts a genuine retry with a fresh nonce', async () => {
    const first = await POST(post(await sign(TASK_03), TASK_03, '0.3'));
    const retry = await POST(post(await sign(TASK_03), TASK_03, '0.3'));
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
  });

  it('rejects an unknown kid', async () => {
    const res = await POST(post(await sign(TASK_03, { kid: 'not-a-raia-key' }), TASK_03, '0.3'));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('unknown_kid');
  });

  // F2: the version selects exactly one media type AND one body variant, so a
  // 0.3 Task and a 1.0 StreamResponse are actually discriminated.
  it('rejects a cross-version content-type pairing or wrong body shape (version/media type/payload binding)', async () => {
    const taskSig = await sign(TASK_03);

    const wrongMedia03 = await POST(post(taskSig, TASK_03, '0.3', 'application/a2a+json'));
    expect(wrongMedia03.status).toBe(400);
    expect((await wrongMedia03.json()).error).toBe('unsupported_content_type');

    const wrongMedia10 = await POST(post(await sign(STREAM_10), STREAM_10, '1.0', 'application/json'));
    expect(wrongMedia10.status).toBe(400);
    expect((await wrongMedia10.json()).error).toBe('unsupported_content_type');

    const cases: Array<[unknown, string]> = [
      [STREAM_10, '0.3'], // StreamResponse labelled 0.3
      [TASK_03, '1.0'], // bare Task labelled 1.0
      [{}, '1.0'] // empty object labelled 1.0
    ];
    for (const [body, version] of cases) {
      const res = await POST(post(await sign(body), body, version));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_body');
    }

    const patched = await POST(post(taskSig, TASK_03, '0.3.1'));
    expect(patched.status).toBe(400);
    expect((await patched.json()).error).toBe('unsupported_version');
  });

  // F3: verification must authenticate the exact received bytes. A duplicate
  // earlier member parses to the signed object, so a re-canonicalizing
  // verifier accepts it; the raw body here is not its own canonical form.
  it('rejects a mutated body by verifying the exact raw bytes (duplicate kind member, re-ordered members)', async () => {
    const sig = await sign(TASK_03);
    const canonical = canonicalize(TASK_03 as Record<string, unknown>)!;

    const duped = canonical.replace('"kind":"task"', '"kind":"evil","kind":"task"');
    expect(JSON.parse(duped)).toEqual(TASK_03);
    const dupRes = await POST(post(sig, duped, '0.3'));
    expect(dupRes.status).toBe(400);
    expect((await dupRes.json()).error).toBe('non_canonical_body');

    const reordered = '{"status":{"state":"completed"},"id":"task-1","kind":"task"}';
    const ordRes = await POST(post(sig, reordered, '0.3'));
    expect(ordRes.status).toBe(400);
    expect((await ordRes.json()).error).toBe('non_canonical_body');

    // control: the exact signed bytes still pass
    expect((await POST(post(sig, canonical, '0.3'))).status).toBe(200);
  });

  // F4: a JSON null (or scalar/array) protected header must be a typed 401, not
  // a TypeError.
  it('rejects a null protected header (and scalar/array/missing header) with a typed 401', async () => {
    for (const headerJson of ['null', '42', '"ES256"', '[]']) {
      const res = await POST(post(rawHeaderSignature(headerJson), TASK_03, '0.3'));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('malformed_signature');
    }

    const missing = await POST(post('', TASK_03, '0.3'));
    expect(missing.status).toBe(401);
    expect((await missing.json()).error).toBe('missing_signature');
  });

  // F5: the unauthenticated endpoint bounds size and depth before parse/JCS.
  it('rejects a body over the max size bound with 413 and a too-deep body before parsing work', async () => {
    const huge = { ...TASK_03, filler: 'x'.repeat(300 * 1024) };
    const res = await POST(post(await sign(huge), huge, '0.3'));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('body_too_large');

    let nested: Record<string, unknown> = { state: 'completed' };
    for (let i = 0; i < 40; i++) nested = { nested };
    const bomb = { kind: 'task', id: 'task-1', status: nested };
    const deepRes = await POST(post(await sign(bomb), bomb, '0.3'));
    expect(deepRes.status).toBe(400);
    expect((await deepRes.json()).error).toBe('invalid_body');
  });

  // F6: an ambiguous kid in the trusted JWKS fails closed instead of picking one.
  it('rejects an ambiguous kid when the trusted JWKS has duplicate kid entries', async () => {
    net.__jwksKeys = [publicJwk, { ...publicJwk }];
    try {
      vi.resetModules(); // empty JWKS cache, so the duplicate set is fetched
      const fresh = await import('@/app/api/a2a/push-receiver/route');
      const res = await fresh.POST(post(await sign(TASK_03), TASK_03, '0.3'));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('ambiguous_kid');
    } finally {
      net.__jwksKeys = undefined;
    }
  });

  // F7: the principal fail-closed controls — unknown alg, JWKS fetch error, and
  // an expired key cache that cannot be refreshed.
  it('fails closed on an unknown alg, a JWKS fetch error and an expired key cache', async () => {
    const header = {
      alg: 'HS256',
      typ: 'JOSE',
      kid: KID,
      jku: JKU,
      iat: Math.floor(Date.now() / 1000),
      nonce: randomUUID()
    };
    const algRes = await POST(post(rawHeaderSignature(JSON.stringify(header)), TASK_03, '0.3'));
    expect(algRes.status).toBe(401);
    expect((await algRes.json()).error).toBe('unsupported_alg');

    net.__jwksDown = true;
    try {
      vi.resetModules();
      const down = await import('@/app/api/a2a/push-receiver/route');
      const fetchErr = await down.POST(post(await sign(TASK_03), TASK_03, '0.3'));
      expect(fetchErr.status).toBe(503);
      expect((await fetchErr.json()).error).toBe('jwks_unavailable');
    } finally {
      net.__jwksDown = false;
    }

    vi.resetModules();
    const warm = await import('@/app/api/a2a/push-receiver/route');
    expect((await warm.POST(post(await sign(TASK_03), TASK_03, '0.3'))).status).toBe(200);

    // past the 5-minute cache: a failed refresh must reject, never verify
    // against the expired (stale) key set
    const later = Date.now() + 6 * 60_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    net.__jwksDown = true;
    try {
      const expired = await warm.POST(
        post(await sign(TASK_03, { iat: Math.floor(later / 1000) }), TASK_03, '0.3')
      );
      expect(expired.status).toBe(503);
      expect((await expired.json()).error).toBe('jwks_unavailable');
    } finally {
      clock.mockRestore();
      net.__jwksDown = false;
    }
  });

  it('publishes only public JWK members', async () => {
    vi.stubEnv('A2A_CARD_SIGNING_JWK', JSON.stringify({ ...(await exportJWK(signingKey)), kid: KID }));
    const { publicJwks } = await import('@/lib/a2a/card-signing');
    const [key] = publicJwks().keys as Record<string, unknown>[];
    expect(Object.keys(key).sort()).toEqual(['alg', 'crv', 'kid', 'kty', 'use', 'x', 'y']);
    expect(key).not.toHaveProperty('d');
    vi.unstubAllEnvs();
  });
});
