-- 0012_demo_tv_feed.sql
--
-- TV lane on top of the 0010 data plane. Applied to the demo project only.
--
--   * seq        — monotonic cursor. The TV backfills with `since=<seq>` and can
--                  never lose or duplicate a row across a reconnect.
--   * source / photo_url — the second phase of a listing: the wake-up ping
--                  carries neither, so the TV hydrates them from this row.
--   * demo_tv_feed          — the ONLY read path for the TV. Venue-scoped,
--                  SECURITY DEFINER, ordered by seq. anon holds no table grant,
--                  so a client table read is impossible by construction.
--   * demo_feed_fingerprint — (count, last_seq, hash) over seq|id|correlation_id
--                  in seq order. The TV hashes the rows it holds with the same
--                  bytes, so a divergence is a real divergence.
--
-- correlation_id is NOT added here: the Telegram migration 0011 owns that
-- column, and this lane only carries the value through.

alter table public.demo_listings
    add column if not exists seq bigint generated always as identity,
    add column if not exists source text,
    add column if not exists photo_url text;

create unique index if not exists ux_demo_listings_seq on public.demo_listings (seq);

-- Explicit projection: no retract_code, no telegram identity. The booth screen
-- must not be able to retract a listing off the back of a read token.
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
       and l.seq > coalesce(p_after_seq, 0)
     order by seq
     limit least(coalesce(p_limit, 200), 200);
$$;

-- md5 over "seq|id|correlation_id" joined by ',' in seq order. The TV builds the
-- identical string from the rows it holds; one changed row changes the hash.
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
     where l.venue_id = p_venue_id;
$$;
