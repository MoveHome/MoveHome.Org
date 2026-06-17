// Shared contract for the public A2A registry. Lane A (API), Lane B (UI), and
// Lane C (health worker) all consume these types so the row shape can't drift.
// Field names are snake_case to match tbl_a2a_registry / vw_a2a_registry_public.

export interface RegistrySkill {
  id: string;
  name?: string;
  description?: string;
  tags?: string[];
  examples?: string[];
}

// Normalised card data produced by ingest, ready to insert into tbl_a2a_registry
// (the API route adds slug uniqueness, status, submitted_by_hash, discovery_method).
export interface IngestedCard {
  well_known_uri: string;
  a2a_url: string | null;
  name: string | null;
  description: string | null;
  provider_org: string | null;
  provider_url: string | null;
  protocol_version: string | null;
  preferred_transport: string | null;
  capabilities: unknown;
  skills: RegistrySkill[];
  icon_url: string | null;
  documentation_url: string | null;
  raw_card: unknown;
  signature_verified: boolean;
  locations: string[] | null;
  service_types: string[] | null;
  categories: string[];
  slug_base: string;
}

// Curated public projection (vw_a2a_registry_public) — what the API/UI render.
export interface PublicRegistryAgent {
  id: string;
  slug: string;
  name: string | null;
  description: string | null;
  well_known_uri: string;
  a2a_url: string | null;
  provider_org: string | null;
  provider_url: string | null;
  protocol_version: string | null;
  preferred_transport: string | null;
  capabilities: unknown;
  skills: RegistrySkill[] | null;
  icon_url: string | null;
  documentation_url: string | null;
  signature_verified: boolean;
  locations: string[] | null;
  service_types: string[] | null;
  categories: string[] | null;
  domain_verified: boolean;
  is_healthy: boolean | null;
  last_health_check: string | null;
  last_response_ms: number | null;
  avg_response_ms: number | null;
  uptime_percentage: number | null;
  task_conformance: TaskConformance | null;
  created_at: string;
  updated_at: string;
  last_synced_at: string | null;
}

export interface TaskConformance {
  category: 'WORKING' | 'DEGRADED' | 'FAILING' | 'UNKNOWN';
  passed: boolean;
  checked_at: string;
  response_ms?: number;
  detail?: string;
}

export interface FieldError {
  field: string;
  message: string;
  code: string;
}

export type IngestResult =
  | { ok: true; card: IngestedCard }
  | { ok: false; status: number; error: string; validation_errors?: FieldError[] };
