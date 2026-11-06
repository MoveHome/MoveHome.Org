-- MUST-FAIL: demo_telegram_ingest for a chat with no session row raises
-- insufficient_privilege (42501) and writes nothing. Exit 0 = guard held.
do $$
declare
  v_before integer;
  v_after  integer;
begin
  select count(*) into v_before from public.demo_listings;

  begin
    perform public.demo_telegram_ingest(
      999999001, 999999001, 99001, 'fixture-04',
      '{"headline":"fixture","property_type":"flat","service_type":"long_term"}'::jsonb
    );
  exception
    when insufficient_privilege then
      select count(*) into v_after from public.demo_listings;
      if v_after <> v_before then
        raise exception 'fixture 04: the refused ingest wrote a row';
      end if;
      raise notice 'fixture 04: ingest without a venue session rejected (expected)';
      return;
  end;

  raise exception 'fixture 04: demo_telegram_ingest accepted a chat with no session';
end $$;
