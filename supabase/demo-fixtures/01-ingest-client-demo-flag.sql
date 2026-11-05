-- MUST-FAIL: a caller cannot supply the demo flag — the ingest RPC has no such
-- parameter. Exit 0 means the write was rejected (guard held).
do $$
begin
  begin
    perform public.demo_ingest_listing(
      p_venue_id => 'fixture-venue',
      p_listing  => '{"headline":"fixture","is_demo":false}'::jsonb,
      p_is_demo  => false
    );
  exception when others then
    raise notice 'fixture 01: client demo flag rejected: %', sqlerrm;
    return;
  end;
  raise exception 'fixture 01: the RPC accepted a client-supplied demo flag';
end $$;
