-- MUST-FAIL: an is_demo key inside the caller payload is ignored — the row is
-- still stamped server-side. Exit 0 means the stamp was not overridden.
do $$
declare
  v_id uuid;
  v_is_demo boolean;
begin
  v_id := public.demo_ingest_listing('fixture-venue', '{"headline":"fixture","is_demo":false}'::jsonb);

  select is_demo into v_is_demo from public.demo_listings where id = v_id;
  if v_is_demo is not true then
    raise exception 'fixture 03: the caller payload set the demo stamp';
  end if;

  delete from public.demo_listings where id = v_id;
  raise notice 'fixture 03: payload demo flag ignored (expected)';
end $$;
