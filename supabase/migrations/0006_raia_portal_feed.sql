-- 0006_raia_portal_feed.sql
--
-- RAIA Portal Feed API — server-side schema. MoveHome acts as the *server*
-- exposed at /api/raia/portal/v1/* per docs/raia-portal-feed-build-guide.md
-- (draft v0.1.0). Providers (CRMs, agencies, partners)
-- push listings via PUT /listings/{reference} using OAuth2 client_credentials
-- bearer tokens.
--
-- Tables:
--   tbl_portal_credentials      — OAuth client credentials (id, hashed secret,
--                                  allowed scopes, branch/agent linkage).
--   tbl_portal_branches         — Logical branches per credential / agent.
--   tbl_portal_listings         — Provider-pushed listings, full payload JSONB
--                                  + indexed scalar columns. Reference unique
--                                  per branch.
--   tbl_portal_enquiries        — Leads polled via GET enquiries; cursor_seq
--                                  drives `next_cursor` pagination.
--   tbl_portal_performance      — Daily per-portal stats (impressions etc.).
--   tbl_portal_product_activations — Premium / Featured activations.
--   tbl_portal_rate_limits      — Sliding-window counters (60 req/min default
--                                  per credential per endpoint group).
--   tbl_portal_audit_log        — Append-only audit trail for writes / token
--                                  issuance.
--
-- All tables are service-role write only (RLS enabled, no policies). The
-- Next.js API routes use SUPABASE_SERVICE_ROLE_KEY exclusively — clients
-- never talk to Supabase directly here.

SET search_path TO public, extensions;

-- ── Credentials ─────────────────────────────────────────────────────────────

CREATE TABLE public.tbl_portal_credentials (
    client_id            TEXT          PRIMARY KEY
                            CHECK (client_id ~ '^pcid_[A-Za-z0-9_-]{16,64}$'),
    -- scrypt(N=16384,r=8,p=1) hash of client_secret. Format:
    --   scrypt$<saltB64>$<hashB64>
    -- Plaintext secret is shown to the integrator ONCE at creation time.
    secret_hash          TEXT          NOT NULL,
    label                TEXT          NULL,
    -- Allowed scopes; subset of {feed.read, feed.write, products.write}.
    allowed_scopes       TEXT[]        NOT NULL
                            CHECK (allowed_scopes <@ ARRAY['feed.read','feed.write','products.write']::TEXT[]),
    -- The agent_id this credential pushes listings as. Listings flow into
    -- tbl_external_raia_listings under this agent for public surfacing.
    agent_id             TEXT          NOT NULL
                            REFERENCES public.tbl_raia_agent_registry(agent_id),
    -- Optional default branch for a single-branch integrator.
    default_branch_id    TEXT          NULL,
    revoked_at           TIMESTAMPTZ   NULL,
    last_used_at         TIMESTAMPTZ   NULL,
    -- Independent rate limit override (req/min/endpoint-group).
    rate_limit_per_min   INTEGER       NOT NULL DEFAULT 60
                            CHECK (rate_limit_per_min BETWEEN 1 AND 10000),
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tbl_portal_credentials IS
    'OAuth2 client_credentials grants for the RAIA Portal Feed API. One row '
    'per integrator. secret_hash is scrypt; plaintext secret is returned only '
    'at creation. agent_id ties pushed listings to a registered RAIA agent.';

CREATE INDEX idx_portal_credentials_agent
    ON public.tbl_portal_credentials (agent_id) WHERE revoked_at IS NULL;

CREATE TRIGGER trg_portal_credentials_updated_at
    BEFORE UPDATE ON public.tbl_portal_credentials
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tbl_portal_credentials ENABLE ROW LEVEL SECURITY;

-- ── Branches ────────────────────────────────────────────────────────────────

CREATE TABLE public.tbl_portal_branches (
    branch_id            TEXT          PRIMARY KEY,
    agent_id             TEXT          NOT NULL
                            REFERENCES public.tbl_raia_agent_registry(agent_id),
    name                 TEXT          NULL,
    address_summary      TEXT          NULL,
    timezone             TEXT          NULL DEFAULT 'Europe/London',
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_portal_branches_agent
    ON public.tbl_portal_branches (agent_id);

CREATE TRIGGER trg_portal_branches_updated_at
    BEFORE UPDATE ON public.tbl_portal_branches
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tbl_portal_branches ENABLE ROW LEVEL SECURITY;

-- ── Listings ────────────────────────────────────────────────────────────────

CREATE TABLE public.tbl_portal_listings (
    -- Surrogate so we can have stable joins; (branch_id, reference) is unique.
    listing_pk           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

    reference            TEXT          NOT NULL
                            CHECK (reference ~ '^[A-Za-z0-9_-]{1,100}$'),
    branch_id            TEXT          NOT NULL,
    agent_id             TEXT          NOT NULL
                            REFERENCES public.tbl_raia_agent_registry(agent_id),
    client_id            TEXT          NULL
                            REFERENCES public.tbl_portal_credentials(client_id)
                            ON DELETE SET NULL,

    kind                 TEXT          NOT NULL
                            CHECK (kind IN ('residential','commercial')),
    transaction_type     TEXT          NOT NULL
                            CHECK (transaction_type IN ('SALES','LETTINGS')),
    status               TEXT          NULL
                            CHECK (status IS NULL OR status IN (
                                'AVAILABLE','UNDER_OFFER','SOLD_STC','SOLD_STCM',
                                'RESERVED','LET_AGREED','OFF_MARKET','WITHDRAWN')),

    -- Verbatim request body (residential or commercial discriminated union).
    payload              JSONB         NOT NULL,

    -- SHA-256 hex of canonicalised payload for NO_CHANGE detection.
    payload_hash         TEXT          NOT NULL,

    public_card_raia_id  TEXT          NULL
                            CHECK (public_card_raia_id IS NULL OR
                                   public_card_raia_id ~ '^prop-[a-z]{2}-[a-z0-9-]{2,32}-[0-9]{4,}$'),
    public_card_url      TEXT          NULL,

    version              INTEGER       NOT NULL DEFAULT 1
                            CHECK (version >= 1),

    created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    removed_at           TIMESTAMPTZ   NULL,
    removal_reason       TEXT          NULL
                            CHECK (removal_reason IS NULL OR removal_reason IN (
                                'SOLD_BY_US','SOLD_BY_ANOTHER_AGENT','LET_BY_US',
                                'LET_BY_ANOTHER_AGENT','WITHDRAWN_FROM_MARKET',
                                'LOST_INSTRUCTION','REMOVED')),
    removal_note         TEXT          NULL,

    CONSTRAINT uq_portal_listings_branch_reference UNIQUE (branch_id, reference)
);

COMMENT ON TABLE public.tbl_portal_listings IS
    'Provider-pushed listings via RAIA Portal Feed API. Reference is unique '
    'per branch. payload_hash drives NO_CHANGE detection on idempotent re-PUT.';

CREATE INDEX idx_portal_listings_branch_updated
    ON public.tbl_portal_listings (branch_id, updated_at DESC)
    WHERE removed_at IS NULL;

CREATE INDEX idx_portal_listings_agent
    ON public.tbl_portal_listings (agent_id)
    WHERE removed_at IS NULL;

CREATE INDEX idx_portal_listings_status
    ON public.tbl_portal_listings (branch_id, transaction_type, status)
    WHERE removed_at IS NULL;

CREATE INDEX idx_portal_listings_public_card_raia_id
    ON public.tbl_portal_listings (public_card_raia_id)
    WHERE public_card_raia_id IS NOT NULL;

CREATE TRIGGER trg_portal_listings_updated_at
    BEFORE UPDATE ON public.tbl_portal_listings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tbl_portal_listings ENABLE ROW LEVEL SECURITY;

-- ── Enquiries (provider-side polling cursor) ────────────────────────────────

CREATE TABLE public.tbl_portal_enquiries (
    enquiry_id           TEXT          PRIMARY KEY,
    cursor_seq           BIGSERIAL     NOT NULL,
    branch_id            TEXT          NOT NULL,
    agent_id             TEXT          NOT NULL,
    listing_reference    TEXT          NULL,
    received_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    source               TEXT          NULL,
    -- Verbatim wire payload to be returned to caller.
    payload              JSONB         NOT NULL
);

CREATE INDEX idx_portal_enquiries_branch_cursor
    ON public.tbl_portal_enquiries (branch_id, cursor_seq);

CREATE INDEX idx_portal_enquiries_branch_received
    ON public.tbl_portal_enquiries (branch_id, received_at DESC);

ALTER TABLE public.tbl_portal_enquiries ENABLE ROW LEVEL SECURITY;

-- ── Performance (daily per-portal counters) ─────────────────────────────────

CREATE TABLE public.tbl_portal_performance (
    branch_id            TEXT          NOT NULL,
    portal               TEXT          NOT NULL DEFAULT 'MOVEHOME',
    metric_date          DATE          NOT NULL,
    impressions          INTEGER       NOT NULL DEFAULT 0,
    detail_views         INTEGER       NOT NULL DEFAULT 0,
    click_throughs       INTEGER       NOT NULL DEFAULT 0,
    phone_reveals        INTEGER       NOT NULL DEFAULT 0,
    brochure_downloads   INTEGER       NOT NULL DEFAULT 0,
    enquiries            INTEGER       NOT NULL DEFAULT 0,
    PRIMARY KEY (branch_id, portal, metric_date)
);

ALTER TABLE public.tbl_portal_performance ENABLE ROW LEVEL SECURITY;

-- ── Product activations ────────────────────────────────────────────────────

CREATE TABLE public.tbl_portal_product_activations (
    id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    product              TEXT          NOT NULL
                            CHECK (product IN ('PREMIUM_LISTING','FEATURED_PROPERTY')),
    status               TEXT          NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING','ACTIVE','EXPIRED','REJECTED','CANCELLED')),
    client_id            TEXT          NOT NULL
                            REFERENCES public.tbl_portal_credentials(client_id),
    branch_id            TEXT          NULL,
    customer_listing_id  TEXT          NULL,
    listing_id           TEXT          NULL,
    request              JSONB         NOT NULL,
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    starts_at            TIMESTAMPTZ   NULL,
    ends_at              TIMESTAMPTZ   NULL,
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_portal_activations_client_product
    ON public.tbl_portal_product_activations (client_id, product, created_at DESC);

CREATE TRIGGER trg_portal_activations_updated_at
    BEFORE UPDATE ON public.tbl_portal_product_activations
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tbl_portal_product_activations ENABLE ROW LEVEL SECURITY;

-- ── Rate limit (sliding minute window) ─────────────────────────────────────

CREATE TABLE public.tbl_portal_rate_limits (
    client_id            TEXT          NOT NULL,
    endpoint_group       TEXT          NOT NULL,
    window_start         TIMESTAMPTZ   NOT NULL,
    request_count        INTEGER       NOT NULL DEFAULT 0,
    PRIMARY KEY (client_id, endpoint_group, window_start)
);

CREATE INDEX idx_portal_rate_limits_window
    ON public.tbl_portal_rate_limits (window_start);

ALTER TABLE public.tbl_portal_rate_limits ENABLE ROW LEVEL SECURITY;

-- ── Audit log ───────────────────────────────────────────────────────────────

CREATE TABLE public.tbl_portal_audit_log (
    audit_id             BIGSERIAL     PRIMARY KEY,
    occurred_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    client_id            TEXT          NULL,
    action               TEXT          NOT NULL,
    target               TEXT          NULL,
    trace_id             TEXT          NULL,
    ip                   TEXT          NULL,
    detail               JSONB         NULL
);

CREATE INDEX idx_portal_audit_log_client_time
    ON public.tbl_portal_audit_log (client_id, occurred_at DESC);

ALTER TABLE public.tbl_portal_audit_log ENABLE ROW LEVEL SECURITY;
