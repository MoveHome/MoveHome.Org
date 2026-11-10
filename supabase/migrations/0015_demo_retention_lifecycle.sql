-- 0015_demo_retention_lifecycle.sql
--
-- EXPO demo project only. Replaces the 0010 row-only retention behaviour with
-- the ADR-476 (D4/D5) media-first contract. 0010-0014 are history: nothing here
-- edits them, and nothing here drops the whole plane (that is the T+7
-- management-API project deletion, scripts/demo/teardown/project-delete.mjs).
--
-- Contract:
--   * retract / expiry marks the row `deleting` FIRST, so it leaves every read
--     projection before any media call. Media is deleted recursively; only an
--     empty readback may finalize the row.
--   * a media failure leaves a non-public `deleting` row for retry. It never
--     un-deletes and never reports success.
--   * a 24 h wall clock governs expiry; T+7 (event_closed_at + 168 h) governs
--     the project teardown, and is not scheduled in the database.

-- ── deletion state ─────────────────────────────────────────────────────────
alter table public.demo_listings
    add column if not exists deletion_state text not null default 'live'
        check (deletion_state in ('live', 'deleting')),
    add column if not exists deletion_requested_at timestamptz null,
    add column if not exists media_prefix text null;

create index if not exists ix_demo_listings_deleting
    on public.demo_listings (created_at)
    where deletion_state = 'deleting';

-- ── restricted media manifest (D3) ─────────────────────────────────────────
-- Opaque keys, byte counts and digests only: no original filename, caption,
-- phone number, chat id or EXIF text may be stored in a key or here.
create table if not exists public.demo_media_manifest (
    object_key  text        primary key,
    bucket      text        not null default 'demo-media',
    venue_id    text        not null,
    listing_id  uuid        null references public.demo_listings(id) on delete set null,
    bytes       bigint      not null check (bytes >= 0),
    sha256      text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
    kind        text        not null check (kind in ('original', 'derivative', 'thumbnail', 'moderation', 'staging', 'synthetic_retained')),
    created_at  timestamptz not null default now()
);

revoke all on table public.demo_media_manifest from public;
revoke all on table public.demo_media_manifest from anon, authenticated;
alter table public.demo_media_manifest enable row level security;
-- No policy: the media manifest is worker/operator-only.

-- ── projections exclude deleting rows ──────────────────────────────────────
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
   and l.is_seed = false
   and l.deletion_state = 'live';

revoke all on public.demo_broadcastable from public;
revoke all on public.demo_broadcastable from anon, authenticated;

create or replace function public.demo_tv_feed(
    p_venue_id text,
    p_after_seq bigint,
    p_limit integer default 200
) returns table (
    id             uuid,
    venue_id       text,
    headline       text,
    property_type  text,
    service_type   text,
    bedrooms       integer,
    rent_pcm       integer,
    currency       char(3),
    un_locode      varchar(5),
    latitude       numeric(10,7),
    longitude      numeric(10,7),
    source         text,
    photo_url      text,
    correlation_id text,
    created_at     timestamptz,
    seq            bigint
)
language sql
security definer
set search_path = public, pg_temp
as $$
    select l.id, l.venue_id, l.headline, l.property_type, l.service_type,
           l.bedrooms, l.rent_pcm, l.currency, l.un_locode, l.latitude, l.longitude,
           l.source, l.photo_url, l.correlation_id, l.created_at, l.seq
      from public.demo_listings l
     where l.venue_id = p_venue_id
       and l.deletion_state = 'live'
       and l.seq > coalesce(p_after_seq, 0)
     order by l.seq
     limit least(coalesce(p_limit, 200), 200);
$$;

create or replace function public.demo_feed_fingerprint(p_venue_id text)
returns table (count bigint, last_seq bigint, hash text)
language sql
security definer
set search_path = public, pg_temp
as $$
    select count(*)::bigint,
           coalesce(max(l.seq), 0)::bigint,
           md5(coalesce(
               string_agg(l.seq::text || '|' || l.id::text || '|' || coalesce(l.correlation_id, ''),
                          ',' order by l.seq),
               ''))
      from public.demo_listings l
     where l.venue_id = p_venue_id
       and l.deletion_state = 'live';
$$;

-- ── phase 1: mark deleting, hand back the opaque media prefix ──────────────
-- Returns null for a wrong code, a seeded row, an unknown id or a row already
-- deleting. The caller cannot distinguish those: same refusal, same silence.
create or replace function public.demo_retract_begin(p_id uuid, p_retract_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_prefix text;
    v_venue  text;
begin
    update public.demo_listings l
       set deletion_state        = 'deleting',
           deletion_requested_at = now(),
           media_prefix          = coalesce(l.media_prefix, l.venue_id || '/' || l.id::text)
     where l.id = p_id
       and l.retract_code = p_retract_code
       and l.is_seed = false
       and l.deletion_state = 'live'
    returning l.media_prefix, l.venue_id into v_prefix, v_venue;

    if v_prefix is null then
        return null;
    end if;

    return jsonb_build_object('id', p_id, 'venue_id', v_venue, 'media_prefix', v_prefix);
end;
$$;

-- ── phase 2: finalize only after an empty recursive media readback ─────────
create or replace function public.demo_retract_finalize(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_deleted integer;
begin
    delete from public.demo_listings
     where id = p_id
       and deletion_state = 'deleting';

    get diagnostics v_deleted = row_count;
    return v_deleted = 1;
end;
$$;

-- ── expiry worker paths (24 h wall clock) ─────────────────────────────────
create or replace function public.demo_expired_listings(p_limit integer default 50)
returns table (
    id             uuid,
    venue_id       text,
    media_prefix   text,
    created_at     timestamptz,
    deletion_state text,
    age_seconds    bigint
)
language sql
security definer
set search_path = public, pg_temp
as $$
    select l.id,
           l.venue_id,
           coalesce(l.media_prefix, l.venue_id || '/' || l.id::text),
           l.created_at,
           l.deletion_state,
           extract(epoch from (now() - l.created_at))::bigint
      from public.demo_listings l
     where l.is_seed = false
       and l.deletion_state in ('live', 'deleting')
       and l.created_at < now() - interval '24 hours'
     order by l.created_at
     limit least(coalesce(p_limit, 50), 200);
$$;

create or replace function public.demo_retention_begin(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_prefix text;
    v_venue  text;
begin
    update public.demo_listings l
       set deletion_state        = 'deleting',
           deletion_requested_at = coalesce(l.deletion_requested_at, now()),
           media_prefix          = coalesce(l.media_prefix, l.venue_id || '/' || l.id::text)
     where l.id = p_id
       and l.is_seed = false
       and l.created_at < now() - interval '24 hours'
    returning l.media_prefix, l.venue_id into v_prefix, v_venue;

    if v_prefix is null then
        return null;
    end if;

    return jsonb_build_object('id', p_id, 'venue_id', v_venue, 'media_prefix', v_prefix);
end;
$$;

-- ── ingest guard: no writes into a deleting or expired listing context ────
create or replace function public.demo_ingest_blocked(p_venue_id text, p_raia_id text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1
          from public.demo_listings l
         where coalesce(p_raia_id, '') <> ''
           and l.venue_id = p_venue_id
           and coalesce(l.raia_id, '') = coalesce(p_raia_id, '')
           and (
                l.deletion_state = 'deleting'
                or (l.is_seed = false and l.created_at < now() - interval '24 hours')
           )
    );
$$;

revoke all on function public.demo_retract_begin(uuid, text)   from public;
revoke all on function public.demo_retract_finalize(uuid)      from public;
revoke all on function public.demo_ingest_blocked(text, text)  from public;
revoke all on function public.demo_expired_listings(integer)   from public;
revoke all on function public.demo_retention_begin(uuid)       from public;

grant execute on function public.demo_retract_begin(uuid, text)  to anon, authenticated;
grant execute on function public.demo_retract_finalize(uuid)     to anon, authenticated;
grant execute on function public.demo_ingest_blocked(text, text) to anon, authenticated;
-- Expiry sweep runs with the worker's service credential only.

-- ── retire the 0010 row-only machinery ────────────────────────────────────
-- The 0010 TTL deleted rows without touching media and the 0010 teardown dropped
-- only two tables and two functions, leaving storage, channels and DNS live.
select cron.unschedule('demo-listings-ttl')
 where exists (select 1 from cron.job where jobname = 'demo-listings-ttl');

select cron.unschedule('demo-teardown-t7')
 where exists (select 1 from cron.job where jobname = 'demo-teardown-t7');

drop function if exists public.demo_teardown();
drop function if exists public.demo_retract_listing(uuid, text);
