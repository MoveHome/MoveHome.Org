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

vi.stubGlobal(
  'fetch',
  vi.fn(async (url: unknown) =>
    String(url) === JKU
      ? new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      : new Response('not found', { status: 404 })
  )
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

function post(signature: string, body: unknown, version: '0.3' | '1.0', contentType?: string) {
  return new Request('https://movehome.org/api/a2a/push-receiver', {
    method: 'POST',
    headers: {
      'content-type': contentType ?? (version === '1.0' ? 'application/a2a+json' : 'application/json'),
      'a2a-version': version,
      'x-a2a-signature': signature
    },
    body: JSON.stringify(body)
  });
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

  it('publishes only public JWK members', async () => {
    vi.stubEnv('A2A_CARD_SIGNING_JWK', JSON.stringify({ ...(await exportJWK(signingKey)), kid: KID }));
    const { publicJwks } = await import('@/lib/a2a/card-signing');
    const [key] = publicJwks().keys as Record<string, unknown>[];
    expect(Object.keys(key).sort()).toEqual(['alg', 'crv', 'kid', 'kty', 'use', 'x', 'y']);
    expect(key).not.toHaveProperty('d');
    vi.unstubAllEnvs();
  });
});
