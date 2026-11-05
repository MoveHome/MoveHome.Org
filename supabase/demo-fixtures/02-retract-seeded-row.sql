-- MUST-FAIL: a seeded row is read-only for the demo flow and cannot be
-- retracted. Exit 0 means the refusal happened (guard held).
do $$
declare
  v_id uuid;
begin
  insert into public.demo_listings (venue_id, headline, is_seed, retract_code)
  values ('fixture-venue', 'seeded fixture row', true, '1234')
  returning id into v_id;

  if public.demo_retract_listing(v_id, '1234') then
    raise exception 'fixture 02: a seeded row was retracted';
  end if;

  delete from public.demo_listings where id = v_id;
  raise notice 'fixture 02: seeded row refused retraction (expected)';
end $$;
