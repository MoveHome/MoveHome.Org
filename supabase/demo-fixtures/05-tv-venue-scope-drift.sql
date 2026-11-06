-- MUST-FAIL (M4): removing the venue scope from the TV read path MUST make the
-- rows the TV receives disagree with demo_feed_fingerprint for that venue, so
-- reconciliation reports a mismatch and the screen raises the STALE banner.
-- Exit 0 = the drift was detected. Everything happens in one transaction that
-- is rolled back, so the real demo_tv_feed is restored either way.
begin;

do $$
declare
  v_tv_count bigint;
  v_tv_hash  text;
  v_fp_count bigint;
  v_fp_hash  text;
begin
  -- A second venue, so an unscoped read is genuinely wider than the scoped one.
  insert into public.demo_listings (venue_id, headline, correlation_id)
  values ('fixture-m4-other-venue', 'fixture: other venue', 'fixture-m4-correlation');

  -- The drift under test: same name and arguments, venue filter removed.
  drop function public.demo_tv_feed(text, bigint, integer);
  create function public.demo_tv_feed(
      p_venue_id text, p_after_seq bigint, p_limit integer default 200
  ) returns setof public.demo_listings
  language sql security definer set search_path = public, pg_temp
  as $$
      select * from public.demo_listings
       where seq > coalesce(p_after_seq, 0)
       order by seq
       limit 200;
  $$;

  -- What the TV now holds for its own venue — the same bytes reconcile.ts hashes.
  select count(*),
         md5(coalesce(string_agg(seq::text || '|' || id::text || '|' || coalesce(correlation_id, ''),
                                 ',' order by seq), ''))
    into v_tv_count, v_tv_hash
    from public.demo_tv_feed('fixture-m4-venue', 0, 200);

  -- What the server attests for that venue.
  select count, hash into v_fp_count, v_fp_hash
    from public.demo_feed_fingerprint('fixture-m4-venue');

  if v_tv_count = v_fp_count and v_tv_hash = v_fp_hash then
    raise exception 'fixture 05: venue scope drift was NOT detected — the unscoped read still matched the fingerprint';
  end if;

  raise notice 'fixture 05: venue scope drift produced a fingerprint mismatch (expected)';
end $$;

rollback;
