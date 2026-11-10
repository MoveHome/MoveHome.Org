# Expo demo host — runbook (demo.movehome.org)

The expo demo runs on `demo.movehome.org`, a subdomain of the already-proven
`movehome.org` zone (GoDaddy DNS, Vercel TLS). No extra DNS zone exists for the
demo; the only record is a CNAME for the `demo` host at the registrar.

## What is pinned

`docs/ops/expo-demo-pin.json` records the build the alias must serve:

| field | meaning |
| --- | --- |
| `deployment_id` | Vercel build id (`dpl_…`) the alias is flipped to |
| `deployment_url` | immutable `*.vercel.app` host of that build — `/api/health` echoes it as `deployment_url`, so payload equality proves the alias points at the pin, not at prod |
| `pinned_at` | when the pin was taken |
| `production_alias` | always `demo.movehome.org` |

Verify the host is serving the pin:

```bash
curl -s https://demo.movehome.org/api/health | jq '{status, demo, deployment_url}'
jq -r .deployment_url docs/ops/expo-demo-pin.json
```

Both `deployment_url` values must match.

## Rollback / restart (single command)

```bash
scripts/demo/rollback-demo.sh              # re-point demo.movehome.org at the committed pin
scripts/demo/rollback-demo.sh dpl_previous # flip to a specific earlier build
```

That is one `vercel alias set …`. Nothing is rebuilt and no code is
touched, so recovery does not depend on CI, git or Supabase. Measured alias
write latency is ~43 s; budget one minute end to end, then re-check `/api/health`.

## Re-pinning to a new build

```bash
vercel deploy --prod --scope move-home          # note the printed dpl_… and *.vercel.app URL
vercel alias set <dpl_id> demo.movehome.org --scope move-home
# update deployment_id / deployment_url / pinned_at in docs/ops/expo-demo-pin.json and merge
```

Pin only after `/api/health` on the alias returns the new `deployment_url`.

## Host wiring

| item | value |
| --- | --- |
| Vercel project | `movehome-demo` (team `move-home`) |
| DNS | `CNAME demo` → `b325cf8404325006.vercel-dns-016.com` at GoDaddy, the existing `movehome.org` zone — no new zone, no NS change |
| TLS | issued by Vercel once the CNAME resolves |

## Demo build env

| var | purpose |
| --- | --- |
| `DEMO_MODE=true` | marks the build as the demo; `/api/health` reports `demo: true` |
| `VERCEL_URL` | supplied by Vercel; the build identity echoed by `/api/health` |
| `DEMO_SUPABASE_URL`, `DEMO_SUPABASE_ANON_KEY` | demo data plane (see `src/app/api/demo/*`) |

## Reachability facts worth knowing before the booth

- Inbound traffic arrives from vendor clouds (Telegram, Meta, Anthropic, OpenAI
  egress), so the host must stay public HTTPS on the stable DNS name — never a
  preview URL, never a tunnel.
- Vercel cannot host a long-lived WebSocket server; realtime is Supabase Realtime.
- Check from a phone hotspot at T-1, not from the booth network only.
- PR deploy previews on this repo need the Vercel team Git integration authorised;
  CLI `vercel deploy` is unaffected by that gap, which is why pinning is done from
  the CLI.


## Telegram channel (@MoveHomeDemoBot)

A QR scan at the booth opens `@MoveHomeDemoBot`; a photo plus a caption becomes a
live listing at `https://demo.movehome.org/l/<id>`. The bot is a thin Next route
(`src/app/api/telegram/webhook/route.ts`) — no side service, no bot SDK.

### Env (demo build)

| var | purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Bot API token from @BotFather — used to send replies |
| `TELEGRAM_WEBHOOK_SECRET` | random string; Telegram echoes it in the `x-telegram-bot-api-secret-token` header on every call. Missing or different → 401, nothing written |
| `DEMO_PUBLIC_ORIGIN` | optional override of the origin the webhook POSTs to (defaults to the incoming request origin); set it to `https://demo.movehome.org` |
| `DEMO_SESSION_SECRET` | signs both the QR venue session code and the 120 s venue token |

### Register the webhook

```bash
curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://demo.movehome.org/api/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | jq '{url, last_error_message, pending_update_count}'
```

`setWebhook` must carry the same `secret_token` the build holds in
`TELEGRAM_WEBHOOK_SECRET`; a mismatch makes every update a 401.

### Mint the booth QR

```bash
DEMO_SESSION_SECRET=… node scripts/demo/mint-venue-session.mjs booth-a 480
```

It prints `https://t.me/MoveHomeDemoBot?start=v1.…` — encode that URL in the QR.
The code is capped at 64 chars because Telegram limits deep-link `start` payloads;
the script exits non-zero if a venue id would overflow it. TTL is in minutes.

### Session expiry and limits

A venue session expires (default 480 minutes ≈ one expo day, and the QR code's own
expiry is inside the code). After that the bot replies "scan the booth QR" and
writes nothing — the booth must re-mint and re-print the QR for the next day.

Writes are rate-limited in `demo_telegram_ingest` (3 listings per rolling 10
minutes per Telegram user, 100 active demo listings overall); the 4th comes back as
a 429 reply. Replayed Telegram updates (`update_id`) are idempotent — one row, one
broadcast.

## Retention, T0 freeze and T+7 teardown (ADR-476)

24-hour retention is **media first, row second**: a retracted or expired listing
is marked `deleting` (gone from the broadcast view, TV feed and fingerprint), its
media under `<venue_id>/<listing_id>/` is deleted recursively, and only a
zero-object readback finalizes the row. A media failure leaves a non-public
`deleting` row and returns `deletion_pending` — never a completed retraction.
The worker runs from `npm run demo:retention -- --live` at least every 10 minutes;
migration `0015_demo_retention_lifecycle.sql` replaces the 0010 row-only TTL.

The 0010 `demo_teardown()` function is **not** teardown: it dropped two tables and
two functions and left storage, channels, DNS and secrets live. It is retired by
0015. Whole-project deletion, channel revocation, DNS retirement and the evidence
bundle live in `docs/ops/expo-t7-teardown.md` and run only with Eugin's written
approval of the dated manifest.

### T0 freeze (public close)

1. `DEMO_WRITE_ENABLED=false` and Vercel redeploy — the write plane fails closed.
2. `deleteWebhook(drop_pending_updates=true)` for `@MoveHomeDemoBot`; disable any
   WhatsApp subscription if it was provisioned.
3. Stop booth session minting and broadcast/seed writers (the retention worker
   keeps running).
4. Record the actual `event_closed_at`; `delete_after = event_closed_at + 168 h`.
5. 60 seconds later, prove a negative canary: an attendee write fails and no new
   row or storage object appears.

### T+7

See `docs/ops/expo-t7-teardown.md` (preflight → freeze recheck → media → database
→ channels → DNS → secrets/monitors → independent verify). Media proof is a hard
dependency of project deletion.
