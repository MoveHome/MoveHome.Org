-- 0008_a2a_registry.sql
--
-- Public real-estate A2A agent registry — a domain-specific, a2aregistry.org-style
-- directory of property/real-estate agents that expose an A2A Agent Card
-- (/.well-known/agent-card.json). Distinct from tbl_raia_agent_registry (0002),
-- which governs INTERNAL listing-federation trust; this table is a PUBLIC discovery
-- directory with health/conformance telemetry.
--
-- Anyone can submit an agent by its wellKnownURI; the app fetches + validates the
-- card and inserts a row (status 'listed' = auto-listed). Moderation is by exception:
-- flag/takedown drops a row to 'pending'/'suspended' or sets hidden = true.
--
-- Service-role write only (RLS, no base-table policies). Anonymous reads go through
-- vw_a2a_registry_public, which exposes only listed + non-hidden rows and a curated
-- column subset.

CREATE TABLE public.tbl_a2a_registry (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- URL-safe public identifier, e.g. "movehome-org" or "acme-lettings".
    slug                    TEXT        NOT NULL UNIQUE
                              CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),

    -- The submitted discovery URL and the A2A endpoint advertised inside the card.
    well_known_uri          TEXT        NOT NULL UNIQUE,
    a2a_url                 TEXT        NULL,

    -- Card metadata (mirrors A2A AgentCard fields).
    name                    TEXT        NULL,
    description             TEXT        NULL,
    provider_org            TEXT        NULL,
    provider_url            TEXT        NULL,
    protocol_version        TEXT        NULL,
    preferred_transport     TEXT        NULL,
    capabilities            JSONB       NULL,
    skills                  JSONB       NULL,   -- array of { id, name, description, tags }
    icon_url                TEXT        NULL,
    documentation_url       TEXT        NULL,
    raw_card                JSONB       NULL,   -- last fetched card, for audit/redisplay

    -- Whether the card carried a valid JWS signature (verified against its jku JWKS).
    signature_verified      BOOLEAN     NOT NULL DEFAULT false,

    -- Derived facets for search (from skills/card).
    locations               TEXT[]      NULL,   -- UN/LOCODEs, e.g. {GBLON, GBMNC}
    service_types           TEXT[]      NULL,   -- {long_term, short_term, sale}
    categories              TEXT[]      NULL,   -- real-estate tags, e.g. {property, lettings}

    -- Moderation. Auto-listed on submit; flag/takedown moves off 'listed' or hides.
    status                  TEXT        NOT NULL DEFAULT 'listed'
                              CHECK (status IN ('pending', 'listed', 'rejected', 'suspended')),
    hidden                  BOOLEAN     NOT NULL DEFAULT false,
    flag_count              INTEGER     NOT NULL DEFAULT 0,
    moderation_notes        TEXT        NULL,

    -- Optional domain-control verification (DNS TXT or well-known challenge).
    domain_verified         BOOLEAN     NOT NULL DEFAULT false,
    verification_token      TEXT        NULL,
    verified_at             TIMESTAMPTZ NULL,
    verification_method     TEXT        NULL CHECK (verification_method IN ('dns', 'well_known')),

    -- Health / A2A conformance telemetry (updated by the health worker).
    is_healthy              BOOLEAN     NULL,
    last_health_check       TIMESTAMPTZ NULL,
    last_response_ms        INTEGER     NULL,
    avg_response_ms         INTEGER     NULL,
    uptime_percentage       NUMERIC(5,2) NULL,
    consecutive_failures    INTEGER     NOT NULL DEFAULT 0,
    task_conformance        JSONB       NULL,   -- { category, passed, checked_at, response_ms }

    -- Provenance.
    discovery_method        TEXT        NOT NULL DEFAULT 'self_submit'
                              CHECK (discovery_method IN ('self_submit', 'seed', 'manual')),
    submitted_by_hash       TEXT        NULL,   -- sha256(ip) prefix; never store raw IP
    raia_agent_id           TEXT        NULL    -- cross-link to tbl_raia_agent_registry
                              REFERENCES public.tbl_raia_agent_registry(agent_id) ON DELETE SET NULL,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_synced_at          TIMESTAMPTZ NULL
);

COMMENT ON TABLE public.tbl_a2a_registry IS
    'Public real-estate A2A agent registry (a2aregistry.org-style). Self-submitted '
    'agents are auto-listed; flag/takedown handles abuse. Service-role write; '
    'anonymous read via vw_a2a_registry_public.';

CREATE INDEX idx_a2a_registry_public
    ON public.tbl_a2a_registry (created_at DESC)
    WHERE status = 'listed' AND hidden = false;
CREATE INDEX idx_a2a_registry_status      ON public.tbl_a2a_registry (status);
CREATE INDEX idx_a2a_registry_healthy     ON public.tbl_a2a_registry (is_healthy);
CREATE INDEX idx_a2a_registry_health_due  ON public.tbl_a2a_registry (last_health_check NULLS FIRST);
CREATE INDEX idx_a2a_registry_locations   ON public.tbl_a2a_registry USING GIN (locations);
CREATE INDEX idx_a2a_registry_categories  ON public.tbl_a2a_registry USING GIN (categories);
CREATE INDEX idx_a2a_registry_skills      ON public.tbl_a2a_registry USING GIN (skills jsonb_path_ops);

CREATE TRIGGER trg_a2a_registry_updated_at
    BEFORE UPDATE ON public.tbl_a2a_registry
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Append-only health history, used to compute uptime_percentage.
CREATE TABLE public.tbl_a2a_registry_health_log (
    id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    agent_id      UUID        NOT NULL REFERENCES public.tbl_a2a_registry(id) ON DELETE CASCADE,
    checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    ok            BOOLEAN     NOT NULL,
    response_ms   INTEGER     NULL,
    detail        JSONB       NULL
);
CREATE INDEX idx_a2a_health_log_agent ON public.tbl_a2a_registry_health_log (agent_id, checked_at DESC);

ALTER TABLE public.tbl_a2a_registry             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tbl_a2a_registry_health_log  ENABLE ROW LEVEL SECURITY;
-- No policies → service-role only. Anonymous reads go through the view below.

CREATE OR REPLACE VIEW public.vw_a2a_registry_public
WITH (security_invoker = true) AS
SELECT
    id, slug, name, description, well_known_uri, a2a_url,
    provider_org, provider_url, protocol_version, preferred_transport,
    capabilities, skills, icon_url, documentation_url, signature_verified,
    locations, service_types, categories, domain_verified,
    is_healthy, last_health_check, last_response_ms, avg_response_ms,
    uptime_percentage, task_conformance,
    created_at, updated_at, last_synced_at
FROM public.tbl_a2a_registry
WHERE status = 'listed' AND hidden = false;

COMMENT ON VIEW public.vw_a2a_registry_public IS
    'Curated public view over tbl_a2a_registry. Only listed + non-hidden agents; '
    'hides moderation_notes, flag_count, verification_token, submitted_by_hash.';

GRANT SELECT ON public.vw_a2a_registry_public TO anon, authenticated;
