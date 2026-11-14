// Registry ingest accepts an A2A 1.0 agent card (ADR-472 V7, a2a-v1-upgrade-design
// §3.5 option A): no top-level url/protocolVersion/preferredTransport, those live
// in supportedInterfaces[]. No network: fetch is stubbed, keys generated per run.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import canonicalize from 'canonicalize';
import { generateKeyPair, exportJWK, FlattenedSign, type JWK } from 'jose';

vi.mock('@/lib/supabase-admin', () => ({ createSupabaseAdminClient: () => ({}) }));

const { fetchAndValidateCard, resolveCardEndpoint } = await import('@/lib/registry/ingest');

const CARD_URL = 'https://agent.example.com/.well-known/agent-card.json';
const JKU = 'https://agent.example.com/.well-known/jwks.json';
const A2A = 'https://agent.example.com/api/a2a';

let signingKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  const kp = await generateKeyPair('ES256');
  signingKey = kp.privateKey as CryptoKey;
  publicJwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'ES256' };
});

afterEach(() => vi.unstubAllGlobals());

// The exact §1.2 target shape, trimmed to what ingest reads.
const V1_CARD = {
  name: 'Example Lettings Agent',
  version: '1.0.0',
  supportedInterfaces: [
    { url: A2A, protocolBinding: 'JSONRPC', tenant: '', protocolVersion: '1.0' },
    { url: A2A, protocolBinding: 'JSONRPC', tenant: '', protocolVersion: '0.3' },
  ],
  capabilities: { streaming: false, pushNotifications: false, extensions: [], extendedAgentCard: false },
  securitySchemes: { consentToken: { httpAuthSecurityScheme: { scheme: 'Bearer', bearerFormat: 'JWT' } } },
  securityRequirements: [],
  skills: [
    {
      id: 'search_properties',
      description: 'Search property lettings in GBLON',
      tags: ['property', 'real-estate'],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
      securityRequirements: [],
    },
  ],
};

async function sign(card: Record<string, unknown>) {
  const jws = await new FlattenedSign(new TextEncoder().encode(canonicalize(card)!))
    .setProtectedHeader({ alg: 'ES256', kid: 'k1', jku: JKU })
    .sign(signingKey);
  return { ...card, signatures: [{ protected: jws.protected, signature: jws.signature }] };
}

function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
    const key = String(url);
    if (!(key in routes)) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
}

describe('registry ingest — A2A 1.0 card', () => {
  it('ingests a signed 1.0 card: endpoint and version come from supportedInterfaces, signature survives parsing', async () => {
    stubFetch({ [CARD_URL]: await sign(V1_CARD), [JKU]: { keys: [publicJwk] } });
    const res = await fetchAndValidateCard(CARD_URL);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.card.a2a_url).toBe(A2A);
    expect(res.card.protocol_version).toBe('1.0');
    expect(res.card.preferred_transport).toBe('JSONRPC');
    // passthrough on interfaces keeps `tenant` etc. in the verified payload.
    expect(res.card.signature_verified).toBe(true);
  });

  it('still ingests a 0.3 card exactly as before', async () => {
    const v03 = { name: 'Old Agent', protocolVersion: '0.3.0', url: A2A, preferredTransport: 'JSONRPC', skills: V1_CARD.skills };
    stubFetch({ [CARD_URL]: v03 });
    const res = await fetchAndValidateCard(CARD_URL);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.card.a2a_url).toBe(A2A);
    expect(res.card.protocol_version).toBe('0.3.0');
    expect(res.card.signature_verified).toBe(false); // unsigned
  });

  it('rejects a card with neither url nor supportedInterfaces', async () => {
    stubFetch({ [CARD_URL]: { name: 'No Endpoint', skills: V1_CARD.skills } });
    const res = await fetchAndValidateCard(CARD_URL);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(422);
  });

  it('rejects an interface whose url is not a URL', async () => {
    stubFetch({ [CARD_URL]: { ...V1_CARD, supportedInterfaces: [{ url: 'not a url', protocolBinding: 'JSONRPC' }] } });
    const res = await fetchAndValidateCard(CARD_URL);
    expect(res.ok).toBe(false);
  });
});

describe('resolveCardEndpoint', () => {
  it('prefers the top-level 0.3 fields when both shapes are present (dual-shape card)', () => {
    expect(resolveCardEndpoint({ url: 'https://a.example/x', protocolVersion: '0.3.0', preferredTransport: 'JSONRPC', supportedInterfaces: V1_CARD.supportedInterfaces })).toEqual({
      a2a_url: 'https://a.example/x', protocol_version: '0.3.0', preferred_transport: 'JSONRPC',
    });
  });

  it('picks the first JSONRPC interface over an earlier non-JSONRPC one', () => {
    expect(resolveCardEndpoint({
      supportedInterfaces: [
        { url: 'https://a.example/grpc', protocolBinding: 'GRPC', protocolVersion: '1.0' },
        { url: 'https://a.example/rpc', protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
      ],
    })).toEqual({ a2a_url: 'https://a.example/rpc', protocol_version: '1.0', preferred_transport: 'JSONRPC' });
  });
});
