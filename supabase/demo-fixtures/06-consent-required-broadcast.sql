-- MUST-FAIL: a row without explicit consent is never broadcastable, even when
-- moderation allowed it. Exit 0 means the projection returned zero rows.
do $$
declare
  v_id      uuid;
  v_visible integer;
begin
  insert into public.demo_listings (venue_id, headline, is_seed)
  values ('fixture-venue', 'consent fixture draft', false)
  returning id into v_id;

  -- moderation allowed, consent never granted: still a draft
  perform public.demo_set_moderation(v_id, 'allow');

  select count(*) into v_visible from public.demo_broadcastable where listing_id = v_id;
  if v_visible <> 0 then
    raise exception 'fixture 06: a row without consent was broadcastable';
  end if;

  -- the same row becomes broadcastable once consent is granted
  perform public.demo_grant_consent(v_id, 'granted');
  select count(*) into v_visible from public.demo_broadcastable where listing_id = v_id;
  if v_visible <> 1 then
    raise exception 'fixture 06: a consented, moderated row was not broadcastable';
  end if;

  delete from public.demo_listings where id = v_id;
  raise notice 'fixture 06: consent gated the broadcast (expected)';
end $$;
