-- 0020_partner_registry_backfill.sql
-- Owner ruling (Eugin, 2026-11-18): the live partner cards must be public in the
-- registry BEFORE the 404 publication gate ships, otherwise the gate takes the
-- partners down with the unclaimed test cards.
--
-- Partners (GB + TH), and the entity id each one is served under at /agent/<id>:
--   org-gb-rlf               RentLondonFlat.com Ltd (A2A card id, slug rentlondonflat-com-ltd)
--   org-gb-07798821          RentLondonFlat.com Ltd (Companies House 07798821, separate card path)
--   org-th-0105561135324     Beyond 360 Co., Ltd. (TH partner, slug beyond360)
-- The a2a row's raw_card->>'agent_id' carries the entity id the gate resolves on,
-- matching how the seeded rows (shannon/throne) were written.
--
-- Idempotent: re-running changes nothing. Touches only the rows named below.

-- 1. A2A registry -- partners become listed + public + owned by us.
--    org-gb-rlf's row already exists (staged since the 0019 backfill excluded it).
UPDATE public.tbl_a2a_registry
SET status             = 'listed',
    hidden             = false,
    publication_status = 'published',
    claimed_at         = COALESCE(claimed_at, now()),
    claimed_by_email   = COALESCE(claimed_by_email, 'lettings@rentlondonflat.com'),
    updated_at         = now()
WHERE slug = 'rentlondonflat-com-ltd'
  AND (status <> 'listed' OR hidden
       OR publication_status <> 'published' OR claimed_at IS NULL);

-- org-gb-07798821 is the same agency under its Companies House id and is served
-- at its own /agent/org-gb-07798821/card.json, so the gate needs a row keyed to
-- that id as well. discovery_method='manual' = owner backfill, not self-submit.
INSERT INTO public.tbl_a2a_registry
    (slug, well_known_uri, a2a_url, name, provider_org, provider_url,
     protocol_version, categories, service_types, locations, discovery_method,
     status, hidden, publication_status, claimed_at, claimed_by_email, raw_card)
VALUES
    ('rentlondonflat-com-ltd-07798821',
     'https://movehome.org/agent/org-gb-07798821/agent.json',
     'https://movehome.org/api/a2a',
     'RentLondonFlat.com Ltd Agent (Companies House card)',
     'RentLondonFlat.com Ltd',
     'https://www.rentlondonflat.com',
     '0.3.0',
     ARRAY['property','real-estate','letting','rental','rent','estate','flat','house'],
     ARRAY['long_term'],
     ARRAY['GBLON'],
     'manual',
     'listed', false, 'published', now(), 'lettings@rentlondonflat.com',
     jsonb_build_object('agent_id', 'org-gb-07798821', 'source', 'owner_backfill'))
ON CONFLICT (slug) DO UPDATE
SET status             = 'listed',
    hidden             = false,
    publication_status = 'published',
    claimed_at         = COALESCE(tbl_a2a_registry.claimed_at, now()),
    updated_at         = now()
WHERE tbl_a2a_registry.publication_status <> 'published'
   OR tbl_a2a_registry.status <> 'listed'
   OR tbl_a2a_registry.hidden
   OR tbl_a2a_registry.claimed_at IS NULL;

-- TH partner. Its own row was never seeded; slug 'beyond360' matches the slug
-- published by src/lib/agent-directory.ts.
INSERT INTO public.tbl_a2a_registry
    (slug, well_known_uri, a2a_url, name, provider_org, provider_url,
     protocol_version, categories, service_types, locations, discovery_method,
     status, hidden, publication_status, claimed_at, claimed_by_email, raw_card)
VALUES
    ('beyond360',
     'https://movehome.org/agent/org-th-0105561135324/agent.json',
     'https://movehome.org/api/a2a',
     'Beyond 360 Co., Ltd. Agent',
     'Beyond 360 Co., Ltd.',
     'https://www.beyond360group.com',
     '0.3.0',
     ARRAY['property','real-estate','letting','rental','thailand'],
     ARRAY['long_term','sale'],
     ARRAY['THBKK'],
     'manual',
     'listed', false, 'published', now(), 'concierge@buythai.com',
     jsonb_build_object('agent_id', 'org-th-0105561135324', 'source', 'owner_backfill'))
ON CONFLICT (slug) DO UPDATE
SET status             = 'listed',
    hidden             = false,
    publication_status = 'published',
    claimed_at         = COALESCE(tbl_a2a_registry.claimed_at, now()),
    updated_at         = now()
WHERE tbl_a2a_registry.publication_status <> 'published'
   OR tbl_a2a_registry.status <> 'listed'
   OR tbl_a2a_registry.hidden
   OR tbl_a2a_registry.claimed_at IS NULL;

-- 2. RAIA agent registry -- partners are owner-approved (verification, not publication).
--    org-th-0105561135324 carries revoked_at from the 2026-11-01 test sweep; a live
--    partner must not stay revoked. agent_card_url is left as-is (out of scope here).
UPDATE public.tbl_raia_agent_registry
SET verification_status = 'approved',
    trust_tier          = 'manually_verified',
    revoked_at          = NULL,
    updated_at          = now()
WHERE agent_id IN ('org-gb-07798821', 'org-th-0105561135324')
  AND (verification_status <> 'approved'
       OR trust_tier <> 'manually_verified'
       OR revoked_at IS NOT NULL);

-- Fail loudly instead of silently backfilling nothing if a partner row is absent.
DO $$
DECLARE missing TEXT;
BEGIN
    SELECT string_agg(v.agent_id, ', ') INTO missing
    FROM (VALUES ('org-gb-07798821'), ('org-th-0105561135324')) AS v(agent_id)
    WHERE NOT EXISTS (
        SELECT 1 FROM public.tbl_raia_agent_registry r WHERE r.agent_id = v.agent_id
    );
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION '0020: RAIA partner rows missing from tbl_raia_agent_registry: %', missing;
    END IF;
END $$;

-- 3. Guard: the unclaimed third-party test cards stay operator-only. Never public.
UPDATE public.tbl_a2a_registry
SET status             = 'pending',
    hidden             = true,
    publication_status = 'staged',
    updated_at         = now()
WHERE slug IN ('throne', 'shannon')
  AND (status <> 'pending' OR hidden = false OR publication_status <> 'staged');

-- ROLLBACK (restores the 2026-11-17 state; claim columns stay, they are additive):
--   UPDATE public.tbl_a2a_registry SET status='pending', hidden=true, publication_status='staged', claimed_at=NULL, claimed_by_email=NULL WHERE slug IN ('rentlondonflat-com-ltd','rentlondonflat-com-ltd-07798821','beyond360');
--   DELETE FROM public.tbl_a2a_registry WHERE slug IN ('rentlondonflat-com-ltd-07798821','beyond360');
--   UPDATE public.tbl_raia_agent_registry SET verification_status='pending', trust_tier='unverified' WHERE agent_id='org-gb-07798821';
--   UPDATE public.tbl_raia_agent_registry SET revoked_at='2026-11-01 22:52:24+00' WHERE agent_id='org-th-0105561135324';
