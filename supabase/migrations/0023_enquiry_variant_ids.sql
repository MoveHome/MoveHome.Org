-- 0022 let tbl_external_raia_listings hold `-sale` / `-stay` variant ids, but
-- tbl_enquiries kept the old check, so an enquiry on a variant listing failed
-- at insert. Widen it to the same pattern. Pure loosening: every existing row
-- still matches.
ALTER TABLE public.tbl_enquiries
  DROP CONSTRAINT IF EXISTS tbl_enquiries_raia_id_check;

ALTER TABLE public.tbl_enquiries
  ADD CONSTRAINT tbl_enquiries_raia_id_check
  CHECK (raia_id ~ '^prop-[a-z]{2}-[a-z0-9-]{2,32}-[0-9]{4,}(-sale|-stay)?$');
