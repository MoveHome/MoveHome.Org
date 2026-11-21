-- Sale and short-stay variants of a listing reuse the parent raia_id with a
-- `-sale` / `-stay` suffix, so the id check must allow that tail.
ALTER TABLE public.tbl_external_raia_listings
  DROP CONSTRAINT IF EXISTS tbl_external_raia_listings_raia_id_check;

ALTER TABLE public.tbl_external_raia_listings
  ADD CONSTRAINT tbl_external_raia_listings_raia_id_check
  CHECK (raia_id ~ '^prop-[a-z]{2}-[a-z0-9-]{2,32}-[0-9]{4,}(-sale|-stay)?$');
