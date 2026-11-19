-- 0021_hide_duplicate_rlf_a2a_row.sql
-- Retire duplicate RentLondonFlat card in tbl_a2a_registry (rentlondonflat-com-ltd-07798821)
-- by setting status='pending', hidden=true, publication_status='staged'
-- while preserving org-gb-rlf (rentlondonflat-com-ltd) as the canonical public A2A entry,
-- AND keeping org-gb-07798821 as approved in tbl_raia_agent_registry.

UPDATE tbl_a2a_registry
SET status = 'pending',
    hidden = true,
    publication_status = 'staged'
WHERE slug = 'rentlondonflat-com-ltd-07798821';
