// Domain verification (DNS TXT) and card-signature binding for the A2A registry
// (RAIA SPEC §7). No network: DNS goes through an injected resolver, HTTP through a
// stubbed fetch, and keys are generated per run.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import canonicalize from 'canonicalize';
import { generateKeyPair, exportJWK, FlattenedSign, type JWK } from 'jose';

vi.mock('@/lib/supabase-admin', () => ({ createSupabaseAdminClient: () => ({}) }));

const { checkDomainTxt, verificationRecord, newVerificationToken } = await import('@/lib/registry/domain');
const { verifyCardSignature } = await import('@/lib/registry/ingest');
const { probe } = await import('@/lib/registry/health');

const CARD_URL = 'https://agent.example.com/.well-known/agent-card.json';
const JKU = 'https://agent.example.com/.well-known/jwks.json';
const TOKEN = 'tok_abc123';

let signingKey: CryptoKey;
let publicJwk: JWK;
let otherJwk: JWK;

beforeAll(async () => {
  const kp = await generateKeyPair('ES256');
  signingKey = kp.privateKey as CryptoKey;
  publicJwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'ES256' };
  const other = await generateKeyPair('ES256');
  otherJwk = { ...(await exportJWK(other.publicKey)), kid: 'k0', alg: 'ES256' };
});

afterEach(() => vi.unstubAllGlobals());

async function signedCard(header: Record<string, unknown> = { kid: 'k1', jku: JKU }) {
  const card = { name: 'Example Lettings Agent', url: 'https://agent.example.com/api/a2a', skills: [{ id: 'search_properties' }] };
  const jws = await new FlattenedSign(new TextEncoder().encode(canonicalize(card)!))
    .setProtectedHeader({ alg: 'ES256', ...header })
    .sign(signingKey);
  return { ...card, signatures: [{ protected: jws.protected, signature: jws.signature }] };
}

/** fetch stub: url → JSON body (404 for anything unlisted). */
function stubFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
    const key = String(url);
    calls.push(key);
    if (!(key in routes)) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return calls;
}

describe('checkDomainTxt', () => {
  const resolver = (records: string[][] | Error) => vi.fn(async (name: string) => {
    expect(name).toBe('_raia-verify.agent.example.com');
    if (records instanceof Error) throw records;
    return records;
  });

  it('passes on an exact raia-verify=<token> record, including one split into chunks', async () => {
    expect(await checkDomainTxt(CARD_URL, TOKEN, resolver([['v=spf1 -all'], [`raia-verify=${TOKEN}`]]))).toBe(true);
    expect(await checkDomainTxt(CARD_URL, TOKEN, resolver([['raia-verify=', TOKEN]]))).toBe(true);
  });

  it('fails on a different token, a prefix match, or a DNS error', async () => {
    expect(await checkDomainTxt(CARD_URL, TOKEN, resolver([['raia-verify=someone-else']]))).toBe(false);
    expect(await checkDomainTxt(CARD_URL, TOKEN, resolver([[`raia-verify=${TOKEN}extra`]]))).toBe(false);
    expect(await checkDomainTxt(CARD_URL, TOKEN, resolver(Object.assign(new Error('NXDOMAIN'), { code: 'ENOTFOUND' })))).toBe(false);
  });

  it('fails without a token, without asking DNS', async () => {
    const r = resolver([[`raia-verify=${TOKEN}`]]);
    expect(await checkDomainTxt(CARD_URL, null, r)).toBe(false);
    expect(r).not.toHaveBeenCalled();
  });

  it('names the record on the card host', () => {
    expect(verificationRecord(CARD_URL, TOKEN)).toEqual({
      type: 'TXT', name: '_raia-verify.agent.example.com', value: `raia-verify=${TOKEN}`
    });
    expect(newVerificationToken()).not.toBe(newVerificationToken());
  });
});

describe('verifyCardSignature — bound to the card host and the header kid', () => {
  it('verifies a card signed by the kid-matched key on the same host', async () => {
    // The right key is NOT first: the old keys[0] lookup would have rejected this.
    stubFetch({ [JKU]: { keys: [otherJwk, publicJwk] } });
    expect(await verifyCardSignature(await signedCard(), CARD_URL)).toBe(true);
  });

  it('rejects a jku on another host, without fetching it', async () => {
    const elsewhere = 'https://keys.attacker.example.net/jwks.json';
    const calls = stubFetch({ [elsewhere]: { keys: [publicJwk] } });
    expect(await verifyCardSignature(await signedCard({ kid: 'k1', jku: elsewhere }), CARD_URL)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('rejects when no published key carries the header kid', async () => {
    stubFetch({ [JKU]: { keys: [otherJwk] } });
    expect(await verifyCardSignature(await signedCard(), CARD_URL)).toBe(false);
  });

  it('rejects a card altered after signing', async () => {
    stubFetch({ [JKU]: { keys: [publicJwk] } });
    const card = await signedCard();
    expect(await verifyCardSignature({ ...card, name: 'Someone Else' }, CARD_URL)).toBe(false);
  });

  it('rejects an unsigned card', async () => {
    expect(await verifyCardSignature({ name: 'x' }, CARD_URL)).toBe(false);
  });
});

describe('health probe re-verification', () => {
  const row = { id: 'a1', well_known_uri: CARD_URL, a2a_url: null, verification_token: TOKEN };

  it('re-checks signature and domain on every run', async () => {
    stubFetch({ [CARD_URL]: await signedCard(), [JKU]: { keys: [publicJwk] } });
    const result = await probe(row, async () => [[`raia-verify=${TOKEN}`]]);
    expect(result.signatureVerified).toBe(true);
    expect(result.domainVerified).toBe(true);
  });

  it('drops domain verification when the TXT record is gone', async () => {
    stubFetch({ [CARD_URL]: await signedCard(), [JKU]: { keys: [publicJwk] } });
    const result = await probe(row, async () => { throw Object.assign(new Error('no data'), { code: 'ENODATA' }); });
    expect(result.domainVerified).toBe(false);
    expect(result.signatureVerified).toBe(true);
  });

  it('leaves the signature flag unchanged (undefined) when the card cannot be fetched', async () => {
    stubFetch({});
    const result = await probe(row, async () => [[`raia-verify=${TOKEN}`]]);
    expect(result.signatureVerified).toBeUndefined();
    expect(result.ok).toBe(false);
  });
});
