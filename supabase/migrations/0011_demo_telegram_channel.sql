-- 0011_demo_telegram_channel.sql
--
-- Telegram channel on top of the 0010 demo data plane. Applied to the demo
-- Supabase project only (Fook R1: the demo project is its own credential
-- boundary).
--
--   * demo_telegram_sessions — chat -> venue binding, written only by the
--                              webhook after it verifies the QR session code.
--   * demo_telegram_ingest   — ONE security-definer write path. The venue comes
--                              from the session row, the identity from the
--                              verified token, the rate ledger is the row set.
--   * demo_get_listing       — public projection for /demo/l/[id].
--   * demo_telegram_read_allowed — read throttle, deliberately fail-OPEN.

create table if not exists public.demo_telegram_sessions (
    chat_id           bigint      primary key,
    telegram_user_id  bigint      not null,
    venue_id          text        not null,
    session_exp       timestamptz not null,
    -- rolling read window, used by demo_telegram_read_allowed
    read_window_start timestamptz null,
    read_count        integer     not null default 0,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

revoke all on table public.demo_telegram_sessions from public;
revoke all on table public.demo_telegram_sessions from anon, authenticated;
alter table public.demo_telegram_sessions enable row level security;

-- ── session binding ────────────────────────────────────────────────────────
-- No table grant and no policy exists for the API roles, so the webhook reads
-- and writes the binding through these two definer functions and nothing else.
create or replace function public.demo_telegram_bind_session(
    p_chat_id           bigint,
    p_telegram_user_id  bigint,
    p_venue_id          text,
    p_session_exp       timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if coalesce(btrim(p_venue_id), '') = '' or p_session_exp is null then
        raise exception 'demo_telegram_bind_session: venue_id and session_exp are required' using errcode = '22023';
    end if;

    insert into public.demo_telegram_sessions (
        chat_id, telegram_user_id, venue_id, session_exp, created_at, updated_at
    ) values (
        p_chat_id, p_telegram_user_id, p_venue_id, p_session_exp, now(), now()
    )
    on conflict (chat_id) do update
       set telegram_user_id  = excluded.telegram_user_id,
           venue_id          = excluded.venue_id,
           session_exp       = excluded.session_exp,
           read_count        = 0,
           read_window_start = null,
           updated_at        = now();

    return true;
end;
$$;

-- The live session for a chat, or null. Expiry is decided here: a caller
-- never sees a stale venue.
create or replace function public.demo_telegram_session_for(p_chat_id bigint)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
    select jsonb_build_object(
               'venue_id',         s.venue_id,
               'telegram_user_id', s.telegram_user_id,
               'session_exp',      s.session_exp
           )
      from public.demo_telegram_sessions s
     where s.chat_id = p_chat_id
       and s.session_exp > now();
$$;

-- ── idempotency columns on the listing table ───────────────────────────────
alter table public.demo_listings
    add column if not exists telegram_user_id   bigint,
    add column if not exists telegram_update_id bigint,
    add column if not exists correlation_id     text,
    -- Telegram's only durable handle on the booth photo. The TV lane owns the
    -- rendered photo_url; this column just keeps the file_id from being lost.
    add column if not exists photo_file_id      text;

-- One row per Telegram update: webhook retries replay the same update_id.
create unique index if not exists ux_demo_listings_telegram_update
    on public.demo_listings (telegram_user_id, telegram_update_id)
    where telegram_update_id is not null;

-- ── telegram ingest ────────────────────────────────────────────────────────
-- The only Telegram write path. A chat with no live session row raises
-- insufficient_privilege (42501) and writes nothing. Replays return the
-- existing row id without a second insert. Rate limits are counted from the
-- rows themselves, never from client state.
create or replace function public.demo_telegram_ingest(
    p_chat_id           bigint,
    p_telegram_user_id  bigint,
    p_telegram_update_id bigint,
    p_correlation_id    text,
    p_listing           jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_venue   text;
    v_exp     timestamptz;
    v_recent  integer;
    v_active  integer;
    v_code    text;
    v_row     public.demo_listings;
begin
    select venue_id, session_exp into v_venue, v_exp
      from public.demo_telegram_sessions
     where chat_id = p_chat_id
       and telegram_user_id = p_telegram_user_id;

    if v_venue is null or v_exp < now() then
        raise exception 'demo_telegram_ingest: no venue session for this chat' using errcode = '42501';
    end if;

    if p_listing is null or jsonb_typeof(p_listing) <> 'object'
       or coalesce(p_listing ->> 'headline', '') = '' then
        raise exception 'demo_telegram_ingest: headline is required' using errcode = '22023';
    end if;

    -- Replay first: a retried update must never be throttled or double-counted.
    select * into v_row
      from public.demo_listings
     where telegram_user_id = p_telegram_user_id
       and telegram_update_id = p_telegram_update_id;
    if v_row.id is not null then
        return jsonb_build_object('id', v_row.id, 'duplicate', true);
    end if;

    -- 3 listings per rolling 10 minutes per telegram_user_id.
    select count(*) into v_recent
      from public.demo_listings
     where telegram_user_id = p_telegram_user_id
       and created_at > now() - interval '10 minutes';
    if v_recent >= 3 then
        raise exception 'demo_telegram_ingest: rate limit is 3 listings per 10 minutes' using errcode = 'PT429';
    end if;

    -- Global cap: at most 100 active (non-seed) demo listings.
    select count(*) into v_active
      from public.demo_listings
     where is_seed = false;
    if v_active >= 100 then
        raise exception 'demo_telegram_ingest: demo listing cap of 100 active listings reached' using errcode = 'PT429';
    end if;

    v_code := to_char(floor(random() * 10000)::integer, 'FM0000');

    insert into public.demo_listings (
        venue_id, raia_id, headline, property_type, service_type,
        bedrooms, rent_pcm, currency, un_locode, latitude, longitude,
        is_demo, is_seed, retract_code,
        telegram_user_id, telegram_update_id, correlation_id, photo_file_id
    ) values (
        v_venue,
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
        v_code,
        p_telegram_user_id,
        p_telegram_update_id,
        p_correlation_id,
        p_listing ->> 'photo_file_id'
    )
    on conflict (telegram_user_id, telegram_update_id) where telegram_update_id is not null
    do nothing
    returning * into v_row;

    if v_row.id is null then
        select * into v_row
          from public.demo_listings
         where telegram_user_id = p_telegram_user_id
           and telegram_update_id = p_telegram_update_id;
        return jsonb_build_object('id', v_row.id, 'duplicate', true);
    end if;

    return jsonb_build_object(
        'id',            v_row.id,
        'duplicate',     false,
        'headline',      v_row.headline,
        'bedrooms',      v_row.bedrooms,
        'rent_pcm',      v_row.rent_pcm,
        'currency',      v_row.currency,
        'un_locode',     v_row.un_locode,
        'created_at',    v_row.created_at
    );
end;
$$;

-- ── read throttle (fail OPEN by design) ────────────────────────────────────
-- 30 search replies per rolling 10 minutes per chat. Callers treat any error
-- from this function as "allowed": a broken read ledger must never block a
-- search answer.
create or replace function public.demo_telegram_read_allowed(p_chat_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_count integer;
begin
    update public.demo_telegram_sessions
       set read_count        = case
                                 when read_window_start is null
                                      or read_window_start < now() - interval '10 minutes'
                                 then 1 else read_count + 1 end,
           read_window_start = case
                                 when read_window_start is null
                                      or read_window_start < now() - interval '10 minutes'
                                 then now() else read_window_start end,
           updated_at        = now()
     where chat_id = p_chat_id
       and session_exp > now()
    returning read_count into v_count;

    if v_count is null then
        return true;
    end if;

    return v_count <= 30;
end;
$$;

-- ── public read projection for /demo/l/[id] ────────────────────────────────
-- No retract_code, no telegram_user_id, no correlation_id.
create or replace function public.demo_get_listing(p_id uuid)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
    select to_jsonb(t)
      from (
        select id, venue_id, headline, property_type, service_type,
               bedrooms, rent_pcm, currency, un_locode, latitude, longitude,
               photo_file_id, created_at
          from public.demo_listings
         where id = p_id
      ) t;
$$;

revoke all on function public.demo_telegram_ingest(bigint, bigint, bigint, text, jsonb) from public;
revoke all on function public.demo_telegram_read_allowed(bigint) from public;
revoke all on function public.demo_get_listing(uuid) from public;
revoke all on function public.demo_telegram_bind_session(bigint, bigint, text, timestamptz) from public;
revoke all on function public.demo_telegram_session_for(bigint) from public;

grant execute on function public.demo_telegram_ingest(bigint, bigint, bigint, text, jsonb) to anon, authenticated;
grant execute on function public.demo_telegram_read_allowed(bigint) to anon, authenticated;
grant execute on function public.demo_get_listing(uuid) to anon, authenticated;
grant execute on function public.demo_telegram_bind_session(bigint, bigint, text, timestamptz) to anon, authenticated;
grant execute on function public.demo_telegram_session_for(bigint) to anon, authenticated;
