// Data access for the A2A registry. Mirrors src/lib/portal/db.ts: the generated
// Database type lags this migration, so we erase types on the admin client and
// restore them at call sites via the interfaces in ./types. Reads use the curated
// public view (vw_a2a_registry_public); writes hit the base table (service-role).

import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { newVerificationToken } from './domain';
import type { IngestedCard, PublicRegistryAgent } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional type erasure
type AnyBuilder = any; // eslint-disable-line @typescript-eslint/no-explicit-any

type RegistryTable = 'tbl_a2a_registry' | 'tbl_a2a_registry_health_log';

function table(name: RegistryTable | 'vw_a2a_registry_public'): AnyBuilder {
  const admin = createSupabaseAdminClient() as unknown as { from: (n: string) => AnyBuilder };
  return admin.from(name);
}

const FLAG_AUTO_HIDE_THRESHOLD = 5;

// Sanitises a free-text search term before it goes into a PostgREST `.or()` filter
// (strips the comma/paren/dot syntax PostgREST parses, so it can't inject filters).
function safeSearch(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9 \-]/g, '').trim().slice(0, 80);
}

export async function existsByWellKnownUri(uri: string): Promise<{ id: string; slug: string } | null> {
  const { data } = await table('tbl_a2a_registry')
    .select('id, slug')
    .eq('well_known_uri', uri)
    .maybeSingle();
  return (data as { id: string; slug: string } | null) ?? null;
}

export async function ensureUniqueSlug(base: string): Promise<string> {
  const root = (base || 'agent').slice(0, 60);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`.slice(0, 63);
    const { data } = await table('tbl_a2a_registry').select('id').eq('slug', candidate).maybeSingle();
    if (!data) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`.slice(0, 63);
}

export async function createAgent(
  card: IngestedCard,
  meta: { submittedByHash: string | null; discoveryMethod?: 'self_submit' | 'seed' | 'manual' }
): Promise<PublicRegistryAgent> {
  const slug = await ensureUniqueSlug(card.slug_base);
  const row = {
    slug,
    well_known_uri: card.well_known_uri,
    a2a_url: card.a2a_url,
    name: card.name,
    description: card.description,
    provider_org: card.provider_org,
    provider_url: card.provider_url,
    protocol_version: card.protocol_version,
    preferred_transport: card.preferred_transport,
    capabilities: card.capabilities,
    skills: card.skills,
    icon_url: card.icon_url,
    documentation_url: card.documentation_url,
    raw_card: card.raw_card,
    signature_verified: card.signature_verified,
    locations: card.locations,
    service_types: card.service_types,
    categories: card.categories,
    status: 'listed',
    // Staged until the agency claims it (migration 0019 gates the public view on
    // publication_status='published'). Explicit rather than relying on the DB default,
    // and never 'published' from a self-submit.
    publication_status: 'staged',
    discovery_method: meta.discoveryMethod ?? 'self_submit',
    submitted_by_hash: meta.submittedByHash,
    last_synced_at: new Date().toISOString()
  };
  const { data, error } = await table('tbl_a2a_registry').insert(row).select('id').single();
  if (error) throw new Error(`registry insert failed: ${error.message}`);
  // Read the base table, not the public view: a freshly inserted row is 'staged' and
  // therefore deliberately absent from vw_a2a_registry_public.
  const { data: inserted } = await table('tbl_a2a_registry').select('*').eq('id', (data as { id: string }).id).maybeSingle();
  const created = inserted
    ? { ...(inserted as PublicRegistryAgent), is_org: isOrganisationAgent(inserted as PublicRegistryAgent) }
    : null;
  if (!created) throw new Error('registry insert succeeded but row not readable');
  return created;
}

export interface ListFilters {
  search?: string;
  location?: string;
  serviceType?: string;
  category?: string;
  skill?: string;
  healthyOnly?: boolean;
  orgOnly?: boolean;
  limit: number;
  offset: number;
}

export function isOrganisationAgent(
  a: Pick<PublicRegistryAgent, 'categories' | 'provider_org' | 'name' | 'slug'> &
    Partial<Pick<PublicRegistryAgent, 'well_known_uri'>>
): boolean {
  if (a.categories?.includes('individual_agent') || a.categories?.includes('negotiator')) {
    return false;
  }
  // Individual negotiator cards are served at /agent/agt-<id>; the agency card is the
  // organisation, so the negotiator card never lists in the org directory.
  return !a.well_known_uri?.includes('/agent/agt-');
}

export async function listAgents(f: ListFilters): Promise<{ agents: PublicRegistryAgent[]; total: number }> {
  let q = table('vw_a2a_registry_public').select('*', { count: 'exact' });
  if (f.location) q = q.contains('locations', [f.location]);
  if (f.serviceType) q = q.contains('service_types', [f.serviceType]);
  if (f.category) q = q.contains('categories', [f.category]);
  // skills is jsonb (not text[]), so pass a JSON string → PostgREST `cs` = jsonb @>.
  // (A JS array would be serialized as a Postgres array literal and never match.)
  if (f.skill) q = q.contains('skills', JSON.stringify([{ id: f.skill }]));
  if (f.healthyOnly) q = q.eq('is_healthy', true);
  if (f.search) {
    const s = safeSearch(f.search);
    if (s) q = q.or(`name.ilike.%${s}%,description.ilike.%${s}%,provider_org.ilike.%${s}%`);
  }
  const { data, count } = await q.order('created_at', { ascending: false }).range(f.offset, f.offset + f.limit - 1);
  let agents = ((data as PublicRegistryAgent[]) ?? []).map(a => ({ ...a, is_org: isOrganisationAgent(a) }));
  if (f.orgOnly) {
    agents = agents.filter((a) => a.is_org);
    // Dedupe orgs by provider_org / company identity to prevent duplicate cards for the same agency (e.g. org-gb-rlf vs org-gb-07798821)
    const seenOrgs = new Set<string>();
    agents = agents.filter((a) => {
      const orgKey = (a.provider_org || a.name || a.slug).toLowerCase().trim();
      if (seenOrgs.has(orgKey)) return false;
      seenOrgs.add(orgKey);
      return true;
    });
  }
  return { agents, total: f.orgOnly ? agents.length : (count ?? 0) };
}

export async function getAgent(idOrSlug: string): Promise<PublicRegistryAgent | null> {
  const col = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(idOrSlug) ? 'id' : 'slug';
  const { data } = await table('vw_a2a_registry_public').select('*').eq(col, idOrSlug).maybeSingle();
  if (!data) return null;
  const agent = data as PublicRegistryAgent;
  return { ...agent, is_org: isOrganisationAgent(agent) };
}

export async function getAffiliatedAgents(org: PublicRegistryAgent): Promise<PublicRegistryAgent[]> {
  const orgName = org.provider_org || org.name || org.slug;
  const { data } = await table('vw_a2a_registry_public')
    .select('*')
    .or(`provider_org.eq.${orgName},provider_org.eq.${org.slug}`);
  const all = (data as PublicRegistryAgent[]) ?? [];
  return all
    .filter((a) => a.id !== org.id && !isOrganisationAgent(a))
    .map((a) => ({ ...a, is_org: false }));
}

// Full machine-readable export — every listed agent, no pagination (bulk index).
export async function listAllAgents(max = 1000): Promise<PublicRegistryAgent[]> {
  const { data } = await table('vw_a2a_registry_public')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(max);
  return (data as PublicRegistryAgent[]) ?? [];
}

export interface RegistryStats {
  total: number;
  healthy: number;
  signed: number;
  categories: { name: string; count: number }[];
  service_types: { name: string; count: number }[];
  locations: { name: string; count: number }[];
}

interface StatsRow {
  is_healthy: boolean | null;
  signature_verified: boolean;
  categories: string[] | null;
  service_types: string[] | null;
  locations: string[] | null;
}

export async function getStats(): Promise<RegistryStats> {
  const { data } = await table('vw_a2a_registry_public')
    .select('is_healthy, signature_verified, categories, service_types, locations')
    .limit(5000);
  const rows = (data as StatsRow[]) ?? [];

  const tally = (pick: (r: StatsRow) => string[] | null): { name: string; count: number }[] => {
    const m = new Map<string, number>();
    for (const r of rows) for (const v of pick(r) ?? []) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  };

  return {
    total: rows.length,
    healthy: rows.filter((r) => r.is_healthy === true).length,
    signed: rows.filter((r) => r.signature_verified).length,
    categories: tally((r) => r.categories).slice(0, 20),
    service_types: tally((r) => r.service_types),
    locations: tally((r) => r.locations).slice(0, 30)
  };
}

// Re-sync an existing agent's card fields from its well-known URI. Returns the
// refreshed public row, or null if the agent id is unknown.
export async function updateAgentCard(id: string, card: IngestedCard): Promise<PublicRegistryAgent | null> {
  const { error } = await table('tbl_a2a_registry')
    .update({
      a2a_url: card.a2a_url,
      name: card.name,
      description: card.description,
      provider_org: card.provider_org,
      provider_url: card.provider_url,
      protocol_version: card.protocol_version,
      preferred_transport: card.preferred_transport,
      capabilities: card.capabilities,
      skills: card.skills,
      icon_url: card.icon_url,
      documentation_url: card.documentation_url,
      raw_card: card.raw_card,
      signature_verified: card.signature_verified,
      locations: card.locations,
      service_types: card.service_types,
      categories: card.categories,
      last_synced_at: new Date().toISOString()
    })
    .eq('id', id);
  if (error) throw new Error(`registry update failed: ${error.message}`);
  return getAgent(id);
}

export async function flagAgent(id: string): Promise<boolean> {
  const { data } = await table('tbl_a2a_registry').select('flag_count').eq('id', id).maybeSingle();
  if (!data) return false;
  const next = ((data as { flag_count: number }).flag_count ?? 0) + 1;
  await table('tbl_a2a_registry')
    .update({ flag_count: next, ...(next >= FLAG_AUTO_HIDE_THRESHOLD ? { hidden: true, status: 'pending' } : {}) })
    .eq('id', id);
  return true;
}

// ── claim lifecycle (migration 0019) ────────────────────────────────────────
// A card is public only once its agency claims it: vw_a2a_registry_public serves
// publication_status='published', new rows are 'staged'. Base-table reads only.

export const CLAIM_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;
const CLAIM_ATTEMPT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const CLAIM_MAX_ATTEMPTS = 5;

export interface ClaimRow {
  id: string;
  slug: string;
  name: string | null;
  publication_status: string;
  claimed_at: string | null;
  claim_token: string | null;
  claim_token_expires_at: string | null;
  claim_attempts: number;
  claim_token_sent_at: string | null;
}

const CLAIM_COLUMNS =
  'id, slug, name, publication_status, claimed_at, claim_token, claim_token_expires_at, claim_attempts, claim_token_sent_at';

export async function getClaimRow(slug: string): Promise<ClaimRow | null> {
  const { data } = await table('tbl_a2a_registry').select(CLAIM_COLUMNS).eq('slug', slug).maybeSingle();
  return (data as ClaimRow | null) ?? null;
}

// Attempts that count toward the 24h cap. The window starts at the last token send:
// shortcut: no per-attempt history table, so a burst older than 24h resets the
// counter — upgrade to an attempt log if abuse needs auditing.
export function claimAttemptsInWindow(row: ClaimRow): number {
  const sentAt = row.claim_token_sent_at ? Date.parse(row.claim_token_sent_at) : NaN;
  if (!sentAt || Date.now() - sentAt > CLAIM_ATTEMPT_WINDOW_MS) return 0;
  return row.claim_attempts;
}

/** Store the one-time token, the offered website, and bump the attempt counter. */
export async function issueClaimToken(
  id: string,
  token: string,
  opts: { websiteUrl: string | null; attempts: number }
): Promise<void> {
  const now = Date.now();
  const { error } = await table('tbl_a2a_registry')
    .update({
      claim_token: token,
      claim_token_sent_at: new Date(now).toISOString(),
      claim_token_expires_at: new Date(now + CLAIM_TOKEN_TTL_MS).toISOString(),
      claim_attempts: opts.attempts + 1,
      // Held off-public until publish; the row is 'staged' meanwhile.
      verified_website_url: opts.websiteUrl
    })
    .eq('id', id);
  if (error) throw new Error(`claim token issue failed: ${error.message}`);
}

/** Undo a token write when the email could not be sent (card must stay claimable). */
export async function clearClaimToken(id: string): Promise<void> {
  await table('tbl_a2a_registry')
    .update({ claim_token: null, claim_token_sent_at: null, claim_token_expires_at: null })
    .eq('id', id);
}

/** Verified claim → the card goes live and the token is burned. */
export async function publishClaimedCard(id: string, contactEmail: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await table('tbl_a2a_registry')
    .update({
      publication_status: 'published',
      status: 'listed',
      hidden: false,
      claimed_at: now,
      claimed_by_email: contactEmail,
      claim_token: null,
      claim_token_sent_at: null,
      claim_token_expires_at: null,
      last_synced_at: now
    })
    .eq('id', id);
  if (error) throw new Error(`claim publish failed: ${error.message}`);
}

// ── health worker support (Lane C) ──────────────────────────────────────────
export interface HealthDueRow {
  id: string;
  well_known_uri: string;
  a2a_url: string | null;
  verification_token: string | null;
}

export async function agentsDueForHealthCheck(limit: number): Promise<HealthDueRow[]> {
  const { data } = await table('tbl_a2a_registry')
    .select('id, well_known_uri, a2a_url, verification_token')
    .eq('status', 'listed')
    .order('last_health_check', { ascending: true, nullsFirst: true })
    .limit(limit);
  return (data as HealthDueRow[]) ?? [];
}

export async function recordHealth(
  id: string,
  result: {
    ok: boolean;
    responseMs: number | null;
    conformance: unknown;
    detail?: unknown;
    /** Re-verified this run; omitted when the card could not be fetched (state kept). */
    signatureVerified?: boolean;
    /** Re-verified this run against the agent's DNS TXT token. */
    domainVerified?: boolean;
  }
): Promise<void> {
  await table('tbl_a2a_registry_health_log').insert({
    agent_id: id,
    ok: result.ok,
    response_ms: result.responseMs,
    detail: result.detail ?? null
  });

  // Uptime over the last 100 logged checks.
  const { data: logs } = await table('tbl_a2a_registry_health_log')
    .select('ok')
    .eq('agent_id', id)
    .order('checked_at', { ascending: false })
    .limit(100);
  const rows = (logs as { ok: boolean }[]) ?? [];
  const uptime = rows.length ? (rows.filter((r) => r.ok).length / rows.length) * 100 : result.ok ? 100 : 0;

  const { data: cur } = await table('tbl_a2a_registry').select('consecutive_failures').eq('id', id).maybeSingle();
  const prevFails = (cur as { consecutive_failures: number } | null)?.consecutive_failures ?? 0;

  await table('tbl_a2a_registry')
    .update({
      is_healthy: result.ok,
      last_health_check: new Date().toISOString(),
      last_response_ms: result.responseMs,
      avg_response_ms: result.responseMs,
      uptime_percentage: Math.round(uptime * 100) / 100,
      consecutive_failures: result.ok ? 0 : prevFails + 1,
      task_conformance: result.conformance,
      ...verificationUpdate(result)
    })
    .eq('id', id);
}

// Column updates for a verification re-check. Failing either check clears the flag
// (the agent drops out of the verified tier) but never deletes or delists it.
function verificationUpdate(r: { signatureVerified?: boolean; domainVerified?: boolean }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (r.signatureVerified !== undefined) out.signature_verified = r.signatureVerified;
  if (r.domainVerified !== undefined) {
    out.domain_verified = r.domainVerified;
    if (r.domainVerified) {
      out.verified_at = new Date().toISOString();
      out.verification_method = 'dns';
    }
  }
  return out;
}

// ── domain verification (RAIA SPEC §7) ─────────────────────────────────────
export interface VerificationTarget {
  id: string;
  slug: string;
  well_known_uri: string;
  verification_token: string;
}

/**
 * The agent's DNS TXT token, issuing one if it has none. Never replaces an existing
 * token (a second caller cannot invalidate a record the operator already published);
 * the conditional update makes concurrent first calls converge on one token.
 */
export async function ensureVerificationToken(idOrSlug: string): Promise<VerificationTarget | null> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const read = async () => {
    const { data } = await table('tbl_a2a_registry')
      .select('id, slug, well_known_uri, verification_token')
      .eq(isUuid ? 'id' : 'slug', idOrSlug)
      .eq('status', 'listed')
      .maybeSingle();
    return data as (Omit<VerificationTarget, 'verification_token'> & { verification_token: string | null }) | null;
  };
  const row = await read();
  if (!row) return null;
  if (row.verification_token) return row as VerificationTarget;
  const { error } = await table('tbl_a2a_registry')
    .update({ verification_token: newVerificationToken() })
    .eq('id', row.id)
    .is('verification_token', null);
  if (error) throw new Error(`verification token issue failed: ${error.message}`);
  const issued = await read();
  return issued?.verification_token ? (issued as VerificationTarget) : null;
}

export async function recordDomainCheck(id: string, domainVerified: boolean): Promise<void> {
  const { error } = await table('tbl_a2a_registry').update(verificationUpdate({ domainVerified })).eq('id', id);
  if (error) throw new Error(`domain verification update failed: ${error.message}`);
}
