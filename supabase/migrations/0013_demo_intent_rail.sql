-- 0013_demo_intent_rail.sql
--
-- EXPO demo intent rail. 0010 is the data plane, 0011 the Telegram channel, 0012
-- the TV feed; this migration adds ONLY the honest-location marker.
--
-- latitude / longitude stay NULLABLE with no zero default: a capture with no
-- honest location stores NULL, never 0,0. A pin is never invented, so the TV can
-- tell "no location" from "a location" and draw an unavailable rail instead.

alter table public.demo_listings
    add column if not exists location_unavailable boolean not null default false;

comment on column public.demo_listings.location_unavailable is
    'No honest location for this capture: latitude/longitude are NULL and the TV shows the unavailable rail.';

-- The write path is the ingest RPC of 0010/0011 (payload field of the same
-- name); the flag is never derived from a fabricated coordinate.
