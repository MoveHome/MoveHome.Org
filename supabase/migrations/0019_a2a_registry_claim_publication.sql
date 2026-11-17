-- 0019_a2a_registry_claim_publication.sql
-- MoveHome public registry: claim lifecycle + publication gate.
--
-- Problem: tbl_a2a_registry auto-lists every scraped/seed card (status='listed',
-- hidden=false), and vw_a2a_registry_public serves anything in that state. There is
-- no "unclaimed" state, so an agency cannot be staged until it claims its card.
--
-- Model:
--   staged    — visible only to operators; NOT in vw_a2a_registry_public.
--   claimed   — agency proved control of contact_email; awaiting/published.
--   published — live in the public registry.
--   suspended — operator takedown; NOT public.
--
-- New rows default to 'staged'. Existing live rows are backfilled to 'published'
-- so this migration does not take the current catalogue down; the three known
-- unclaimed seed cards stay staged (they are already staged via status='pending',
-- hidden=true in the live data as of 2026-11-17).

ALTER TABLE public.tbl_a2a_registry
    ADD COLUMN IF NOT EXISTS publication_status     TEXT NOT NULL DEFAULT 'staged',
    ADD COLUMN IF NOT EXISTS claim_token            TEXT NULL,
    ADD COLUMN IF NOT EXISTS claim_token_sent_at    TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS claim_token_expires_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS claimed_at             TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS claimed_by_email       TEXT NULL,
    ADD COLUMN IF NOT EXISTS verified_website_url   TEXT NULL,
    ADD COLUMN IF NOT EXISTS claim_attempts         INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tbl_a2a_registry'::regclass
      AND conname  = 'tbl_a2a_registry_publication_status_check'
  ) THEN
    ALTER TABLE public.tbl_a2a_registry
      ADD CONSTRAINT tbl_a2a_registry_publication_status_check
      CHECK (publication_status IN ('staged', 'claimed', 'published', 'suspended'));
  END IF;
END $$;

-- Backfill: keep the existing catalogue live, but never promote the unclaimed
-- seed cards. (slug list is deliberate: these three were inserted by the 2026-11-16
-- seed run and are the cards the claim-onboarding test targets.)
UPDATE public.tbl_a2a_registry
SET publication_status = 'published'
WHERE publication_status = 'staged'
  AND status = 'listed'
  AND hidden = false
  AND slug NOT IN ('rentlondonflat-com-ltd', 'shannon', 'throne');

-- Keep takedowns truthful.
UPDATE public.tbl_a2a_registry
SET publication_status = 'suspended'
WHERE status = 'suspended'
  AND publication_status <> 'suspended';

CREATE UNIQUE INDEX IF NOT EXISTS idx_a2a_registry_claim_token
    ON public.tbl_a2a_registry (claim_token)
    WHERE claim_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_a2a_registry_staged
    ON public.tbl_a2a_registry (created_at DESC)
    WHERE publication_status = 'staged';

COMMENT ON COLUMN public.tbl_a2a_registry.publication_status IS
    'staged (operator-only) | claimed (contact email proved) | published (public) | suspended (takedown). Public view serves published only.';
COMMENT ON COLUMN public.tbl_a2a_registry.claim_token IS
    'One-time UUID emailed to the agency; NULLed on successful claim.';
COMMENT ON COLUMN public.tbl_a2a_registry.claimed_by_email IS
    'Email address that completed the claim flow.';

-- Public view: only published, listed, non-hidden rows.
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
WHERE status = 'listed'
  AND hidden = false
  AND publication_status = 'published';

COMMENT ON VIEW public.vw_a2a_registry_public IS
    'Curated public view over tbl_a2a_registry. Only listed + non-hidden + published agents.';

GRANT SELECT ON public.vw_a2a_registry_public TO anon, authenticated;

-- ROLLBACK (run only to unwind the gate; claim columns are additive and safe to keep):
--   DROP VIEW IF EXISTS public.vw_a2a_registry_public;
--   CREATE VIEW public.vw_a2a_registry_public WITH (security_invoker = true) AS
--     SELECT ... FROM public.tbl_a2a_registry WHERE status = 'listed' AND hidden = false;
