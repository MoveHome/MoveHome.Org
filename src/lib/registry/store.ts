// Data access for the A2A registry. Mirrors src/lib/portal/db.ts: the generated
// Database type lags this migration, so we erase types on the admin client and
// restore them at call sites via the interfaces in ./types. Reads use the curated
// public view (vw_a2a_registry_public); writes hit the base table (service-role).

import { createSupabaseAdminClient } from '@/lib/supabase-admin';
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
    discovery_method: meta.discoveryMethod ?? 'self_submit',
    submitted_by_hash: meta.submittedByHash,
    last_synced_at: new Date().toISOString()
  };
  const { data, error } = await table('tbl_a2a_registry').insert(row).select('id').single();
  if (error) throw new Error(`registry insert failed: ${error.message}`);
  const created = await getAgent((data as { id: string }).id);
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
  limit: number;
  offset: number;
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
  return { agents: (data as PublicRegistryAgent[]) ?? [], total: count ?? 0 };
}

export async function getAgent(idOrSlug: string): Promise<PublicRegistryAgent | null> {
  const col = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(idOrSlug) ? 'id' : 'slug';
  const { data } = await table('vw_a2a_registry_public').select('*').eq(col, idOrSlug).maybeSingle();
  return (data as PublicRegistryAgent | null) ?? null;
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

// ── health worker support (Lane C) ──────────────────────────────────────────
export interface HealthDueRow {
  id: string;
  well_known_uri: string;
  a2a_url: string | null;
}

export async function agentsDueForHealthCheck(limit: number): Promise<HealthDueRow[]> {
  const { data } = await table('tbl_a2a_registry')
    .select('id, well_known_uri, a2a_url')
    .eq('status', 'listed')
    .order('last_health_check', { ascending: true, nullsFirst: true })
    .limit(limit);
  return (data as HealthDueRow[]) ?? [];
}

export async function recordHealth(
  id: string,
  result: { ok: boolean; responseMs: number | null; conformance: unknown; detail?: unknown }
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
      task_conformance: result.conformance
    })
    .eq('id', id);
}
