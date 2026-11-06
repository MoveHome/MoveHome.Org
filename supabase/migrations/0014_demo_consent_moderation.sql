-- 0014_demo_consent_moderation.sql
--
-- EXPO demo Phase 2: consent, moderation and the broadcastable projection.
-- Demo Supabase project only (0010 owns the data plane; this file adds the two
-- states that decide whether a row may ever reach the big screen).
--
-- Data controller is MoveHome Organisation CIC; EstateAigents is a processor
-- only where engaged. Retention is separate from consent: consent governs
-- display, the 24 h TTL in 0010 governs deletion.
--
-- Ordering rule enforced here: a row is created 'pending' and stays unreadable
-- to the broadcast projection until an explicit opt-in sets consent_state =
-- 'granted' AND pre-display moderation returns 'allow'. A row without both is
-- a draft: it may persist, it is never broadcastable.

alter table public.demo_listings
    add column if not exists consent_state text not null default 'pending'
        check (consent_state in ('pending', 'granted', 'declined')),
    add column if not exists consent_at timestamptz null,
    add column if not exists moderation_state text not null default 'pending'
        check (moderation_state in ('pending', 'allow', 'block', 'unavailable')),
    add column if not exists moderation_verdict jsonb null,
    add column if not exists moderation_fixture_id text null;

-- ── consent write path ─────────────────────────────────────────────────────
-- One-way transitions from 'pending'. Seeded rows are read-only, the same
-- guard retract uses in 0010. The timestamp is server-side.
create or replace function public.demo_grant_consent(p_id uuid, p_consent_state text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_updated integer;
begin
    if p_consent_state not in ('granted', 'declined') then
        raise exception 'demo_grant_consent: consent_state must be granted or declined'
            using errcode = '22023';
    end if;

    update public.demo_listings
       set consent_state = p_consent_state,
           consent_at    = now()
     where id = p_id
       and is_seed = false
       and consent_state = 'pending';

    get diagnostics v_updated = row_count;
    return v_updated = 1;
end;
$$;

-- ── moderation write path ──────────────────────────────────────────────────
-- The verdict and the golden fixture id that produced it are stored, so a
-- human can review the redacted output later: a green tick alone is not review.
create or replace function public.demo_set_moderation(
    p_id uuid,
    p_state text,
    p_verdict jsonb default null,
    p_fixture_id text default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_updated integer;
begin
    if p_state not in ('allow', 'block', 'unavailable') then
        raise exception 'demo_set_moderation: unknown state %', p_state using errcode = '22023';
    end if;

    update public.demo_listings
       set moderation_state      = p_state,
           moderation_verdict    = p_verdict,
           moderation_fixture_id = p_fixture_id
     where id = p_id
       and is_seed = false;

    get diagnostics v_updated = row_count;
    return v_updated = 1;
end;
$$;

revoke all on function public.demo_grant_consent(uuid, text) from public;
revoke all on function public.demo_set_moderation(uuid, text, jsonb, text) from public;
grant execute on function public.demo_grant_consent(uuid, text) to anon, authenticated;
grant execute on function public.demo_set_moderation(uuid, text, jsonb, text) to anon, authenticated;

-- ── broadcastable projection ───────────────────────────────────────────────
-- The screen reads this and nothing else. Three gates, all required: explicit
-- consent, an allowing moderation verdict, and a non-seeded row. No grants to
-- anon/authenticated: the broadcast worker reads it with its own credential.
create or replace view public.demo_broadcastable as
select l.id               as listing_id,
       l.venue_id,
       l.headline,
       l.bedrooms,
       l.rent_pcm,
       l.currency,
       l.consent_state,
       l.consent_at,
       l.moderation_state,
       l.created_at
  from public.demo_listings l
 where l.consent_state = 'granted'
   and l.moderation_state = 'allow'
   and l.is_seed = false;

revoke all on public.demo_broadcastable from public;
revoke all on public.demo_broadcastable from anon, authenticated;
