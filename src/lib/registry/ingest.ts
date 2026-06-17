// Registry ingestion: fetch a submitted A2A Agent Card, validate it, confirm it's
// a real-estate agent, derive search facets, verify its signature (best-effort),
// and normalise it into an insertable row. Shared by the register API (Lane A) and
// the health worker / re-sync (Lane C).
//
// SECURITY: the submitted wellKnownURI (and any jku it references) is attacker-
// controlled, so every outbound fetch is gated by isForwardableEndpoint (public
// HTTPS only — blocks loopback/private/link-local/metadata) and size/time-capped.

import canonicalize from 'canonicalize';
import { z } from 'zod';
import { importJWK, flattenedVerify } from 'jose';
import { isForwardableEndpoint } from '@/lib/enquiry';
import type { IngestResult, IngestedCard, RegistrySkill } from './types';

const FETCH_TIMEOUT_MS = 10_000;
const CARD_MAX_BYTES = 100_000;

// Real-estate inclusion gate: a submitted agent must look like a property agent.
const REAL_ESTATE_TERMS = [
  'property', 'real-estate', 'realestate', 'real estate', 'lettings', 'letting',
  'rental', 'rentals', 'rent', 'sale', 'sales', 'housing', 'homes', 'home',
  'accommodation', 'estate', 'flat', 'apartment', 'house', 'tenancy', 'landlord'
];
const SERVICE_TYPE_TERMS: Record<string, string> = {
  long_term: 'long_term', 'long-term': 'long_term',
  short_term: 'short_term', 'short-term': 'short_term',
  sale: 'sale', sales: 'sale', buy: 'sale'
};
const UN_LOCODE_RE = /\b[A-Z]{2}[A-Z0-9]{3}\b/g;

const skillSchema = z
  .object({
    id: z.string().min(1).max(120),
    name: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    tags: z.array(z.string().max(60)).max(40).optional(),
    examples: z.array(z.string().max(500)).max(20).optional()
  })
  .passthrough();

const cardSchema = z
  .object({
    protocolVersion: z.string().max(20).optional(),
    name: z.string().max(200).optional(),
    description: z.string().max(4000).optional(),
    url: z.string().url().max(500),
    preferredTransport: z.string().max(40).optional(),
    version: z.string().max(40).optional(),
    provider: z
      .object({ organization: z.string().max(200).optional(), url: z.string().max(500).optional() })
      .passthrough()
      .optional(),
    documentationUrl: z.string().max(500).optional(),
    iconUrl: z.string().max(500).optional(),
    capabilities: z.record(z.unknown()).optional(),
    defaultInputModes: z.array(z.string()).optional(),
    defaultOutputModes: z.array(z.string()).optional(),
    skills: z.array(skillSchema).min(1).max(100),
    signatures: z
      .array(z.object({ protected: z.string(), signature: z.string(), header: z.record(z.unknown()).optional() }))
      .optional()
  })
  .passthrough();

type ParsedCard = z.infer<typeof cardSchema>;

function fail(status: number, error: string, validation_errors?: { field: string; message: string; code: string }[]): IngestResult {
  return { ok: false, status, error, validation_errors };
}

function slugFromHost(host: string): string {
  return host
    .replace(/^www\./, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

// Lower-cased haystack of all the human-readable text in the card, for term matching.
function cardText(card: ParsedCard): string {
  const parts: string[] = [card.name ?? '', card.description ?? ''];
  for (const s of card.skills) {
    parts.push(s.id, s.name ?? '', s.description ?? '', ...(s.tags ?? []), ...(s.examples ?? []));
  }
  return parts.join(' ').toLowerCase();
}

function deriveCategories(haystack: string): string[] {
  const hits = REAL_ESTATE_TERMS.filter((t) => haystack.includes(t));
  return Array.from(new Set(hits)).slice(0, 12);
}

function deriveServiceTypes(haystack: string): string[] | null {
  const found = new Set<string>();
  for (const [term, canon] of Object.entries(SERVICE_TYPE_TERMS)) {
    if (haystack.includes(term)) found.add(canon);
  }
  return found.size ? Array.from(found) : null;
}

function deriveLocations(card: ParsedCard): string[] | null {
  const blob = [
    card.description ?? '',
    ...card.skills.flatMap((s) => [...(s.tags ?? []), ...(s.examples ?? []), s.description ?? ''])
  ].join(' ');
  const found = new Set<string>();
  for (const m of blob.matchAll(UN_LOCODE_RE)) found.add(m[0]);
  return found.size ? Array.from(found).slice(0, 50) : null;
}

// Best-effort JWS verification of a signed card against its jku JWKS. Returns false
// on any problem (no signature, unreachable/unsafe jku, mismatch). Never throws.
async function verifySignature(card: ParsedCard): Promise<boolean> {
  const sigs = card.signatures;
  if (!Array.isArray(sigs) || sigs.length === 0) return false;
  try {
    const { signatures: _omit, ...unsigned } = card as Record<string, unknown> & { signatures?: unknown };
    const jcs = canonicalize(unsigned);
    if (!jcs) return false;
    const payloadB64 = Buffer.from(jcs, 'utf8').toString('base64url');
    for (const sig of sigs) {
      const hdr = JSON.parse(Buffer.from(sig.protected, 'base64url').toString('utf8')) as { jku?: string; alg?: string };
      if (!hdr.jku || !isForwardableEndpoint(hdr.jku)) return false; // SSRF guard on jku
      const res = await fetch(hdr.jku, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) return false;
      const jwks = (await res.json()) as { keys?: Record<string, unknown>[] };
      if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) return false;
      const key = await importJWK(jwks.keys[0], hdr.alg || 'ES256');
      await flattenedVerify({ protected: sig.protected, payload: payloadB64, signature: sig.signature }, key);
    }
    return true;
  } catch {
    return false;
  }
}

// Fetch, validate, gate, and normalise a card from its discovery URL.
export async function fetchAndValidateCard(wellKnownURI: string): Promise<IngestResult> {
  let uri: URL;
  try {
    uri = new URL(wellKnownURI);
  } catch {
    return fail(400, 'wellKnownURI is not a valid URL.');
  }
  if (!isForwardableEndpoint(wellKnownURI)) {
    return fail(400, 'wellKnownURI must be a public https URL (private/loopback hosts are rejected).');
  }

  let res: Response;
  try {
    res = await fetch(uri, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow'
    });
  } catch {
    return fail(502, 'Could not fetch the agent card from wellKnownURI.');
  }
  if (!res.ok) return fail(502, `Agent card fetch returned HTTP ${res.status}.`);

  const text = await res.text();
  if (text.length > CARD_MAX_BYTES) return fail(413, 'Agent card exceeds the 100 KB limit.');

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail(422, 'Agent card is not valid JSON.');
  }

  const parsed = cardSchema.safeParse(json);
  if (!parsed.success) {
    return fail(
      422,
      'Agent card failed A2A validation.',
      parsed.error.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message, code: i.code }))
    );
  }
  const card = parsed.data;

  const haystack = cardText(card);
  const categories = deriveCategories(haystack);
  if (categories.length === 0) {
    return fail(422, 'This registry is for real-estate agents; the card has no property/real-estate skills.');
  }

  const slugBase =
    slugFromHost(card.provider?.organization ? card.provider.organization : uri.hostname) || slugFromHost(uri.hostname);

  const ingested: IngestedCard = {
    well_known_uri: uri.toString(),
    a2a_url: card.url,
    name: card.name ?? null,
    description: card.description ?? null,
    provider_org: card.provider?.organization ?? null,
    provider_url: card.provider?.url ?? null,
    protocol_version: card.protocolVersion ?? null,
    preferred_transport: card.preferredTransport ?? null,
    capabilities: card.capabilities ?? null,
    skills: card.skills as RegistrySkill[],
    icon_url: card.iconUrl ?? null,
    documentation_url: card.documentationUrl ?? null,
    raw_card: card,
    signature_verified: await verifySignature(card),
    locations: deriveLocations(card),
    service_types: deriveServiceTypes(haystack),
    categories,
    slug_base: slugBase || 'agent'
  };
  return { ok: true, card: ingested };
}
