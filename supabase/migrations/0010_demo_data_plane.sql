-- 0010_demo_data_plane.sql
--
-- EXPO demo data plane. Applied to the SEPARATE demo Supabase project only
-- (Fook R1: physical credential boundary — the demo project has its own anon
-- key and its own Realtime plane, so nothing here can reach production data).
--
-- Shape, defence in depth (identical if the projects are ever consolidated):
--   * public.demo_listings — anon/authenticated hold NO table grants at all.
--   * reads                — venue-scoped SELECT policy only.
--   * writes               — ONE security-definer RPC. The demo stamp is set
--                            server-side; there is no client-supplied flag.
--   * retract              — 4-digit code, seeded rows cannot be retracted.
--   * TTL                  — pg_cron deletes live rows after 24 hours, and a
--                            T+7 teardown drops the whole demo plane.

create table if not exists public.demo_listings (
    id              uuid        primary key default gen_random_uuid(),

    -- Venue that owns the row. Comes from the signed session token, never from
    -- the request body alone.
    venue_id        text        not null,

    raia_id         text        null,
    headline        text        null,
    property_type   text        null,
    service_type    text        null,
    bedrooms        integer     null,
    rent_pcm        integer     null,
    currency        char(3)     null,
    un_locode       varchar(5)  null,
    latitude        numeric(10,7) null,
    longitude       numeric(10,7) null,

    -- Server-stamped inside the ingest RPC. Never read from the caller payload.
    is_demo         boolean     not null default true,

    -- true = seeded from the public catalogue: read-only for the demo flow,
    -- not retractable and not expirable by the demo TTL worker.
    is_seed         boolean     not null default false,

    -- 4-digit retract code, generated server-side.
    retract_code    text        null
                      check (retract_code is null or retract_code ~ '^[0-9]{4}$'),

    created_at      timestamptz not null default now()
);

create index if not exists ix_demo_listings_venue  on public.demo_listings (venue_id, created_at desc);
create index if not exists ix_demo_listings_expiry on public.demo_listings (created_at) where is_seed = false;

-- ── grants: none ───────────────────────────────────────────────────────────
-- The base table is unreadable and unwritable for the API roles. Every write
-- goes through the RPCs below, every read through the venue policy.
revoke all on table public.demo_listings from public;
revoke all on table public.demo_listings from anon, authenticated;

alter table public.demo_listings enable row level security;

-- Rows are scoped by the venue claim in the session JWT. Deliberately no demo
-- flag in this predicate: the demo project itself is the demo boundary, and a
-- row-level flag used as a tenancy boundary is the silent-fanout failure mode.
create policy demo_listings_venue_read on public.demo_listings
    for select to authenticated
    using (venue_id = coalesce(auth.jwt() ->> 'venue_id', ''));

-- ── ingest ─────────────────────────────────────────────────────────────────
-- The only write path for demo listings. Takes the venue and the listing; the
-- demo stamp and the retract code are produced here, not by the caller.
create or replace function public.demo_ingest_listing(p_venue_id text, p_listing jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_id   uuid;
    v_code text;
begin
    if coalesce(btrim(p_venue_id), '') = '' then
        raise exception 'demo_ingest_listing: venue_id is required' using errcode = '22023';
    end if;

    if p_listing is null or jsonb_typeof(p_listing) <> 'object' then
        raise exception 'demo_ingest_listing: listing must be a JSON object' using errcode = '22023';
    end if;

    if coalesce(p_listing ->> 'headline', '') = '' then
        raise exception 'demo_ingest_listing: headline is required' using errcode = '22023';
    end if;

    v_code := to_char(floor(random() * 10000)::integer, 'FM0000');

    insert into public.demo_listings (
        venue_id, raia_id, headline, property_type, service_type,
        bedrooms, rent_pcm, currency, un_locode, latitude, longitude,
        is_demo, is_seed, retract_code
    ) values (
        p_venue_id,
        p_listing ->> 'raia_id',
        p_listing ->> 'headline',
        p_listing ->> 'property_type',
        p_listing ->> 'service_type',
        (p_listing ->> 'bedrooms')::integer,
        (p_listing ->> 'rent_pcm')::integer,
        (p_listing ->> 'currency')::char(3),
        (p_listing ->> 'un_locode')::varchar(5),
        (p_listing ->> 'latitude')::numeric(10,7),
        (p_listing ->> 'longitude')::numeric(10,7),
        true,   -- demo stamp, server-side only
        false,  -- caller rows are retractable
        v_code
    )
    returning id into v_id;

    return v_id;
end;
$$;

-- ── retract ────────────────────────────────────────────────────────────────
-- Deletes the row when the code matches. Returns false otherwise, including
-- for seeded rows — those are read-only for the demo flow.
create or replace function public.demo_retract_listing(p_id uuid, p_retract_code text)
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
       and retract_code = p_retract_code
       and is_seed = false;

    get diagnostics v_deleted = row_count;
    return v_deleted = 1;
end;
$$;

revoke all on function public.demo_ingest_listing(text, jsonb)  from public;
revoke all on function public.demo_retract_listing(uuid, text)  from public;
grant execute on function public.demo_ingest_listing(text, jsonb) to anon, authenticated;
grant execute on function public.demo_retract_listing(uuid, text) to anon, authenticated;

-- ── TTL: live demo rows expire after 24 hours ──────────────────────────────
create extension if not exists pg_cron;

select cron.schedule('demo-listings-ttl', '*/10 * * * *', $$
    delete from public.demo_listings
     where is_seed = false
       and created_at < now() - interval '24 hours';
$$);

-- ── T+7 teardown ───────────────────────────────────────────────────────────
-- 7 days after the expo window the demo plane is dropped entirely.
create or replace function public.demo_teardown()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    -- shortcut: teardown date hardcoded to the Nov 12-13 expo window; move it
    -- to a config row if this demo plane is ever reused for a second event.
    if now() < timestamptz '2026-11-20 03:00:00+00' then
        return;
    end if;

    perform cron.unschedule('demo-listings-ttl');
    perform cron.unschedule('demo-teardown-t7');

    drop table if exists public.demo_listings;
    drop function if exists public.demo_ingest_listing(text, jsonb);
    drop function if exists public.demo_retract_listing(uuid, text);
end;
$$;

select cron.schedule('demo-teardown-t7', '0 3 * * *', $$ select public.demo_teardown(); $$);
