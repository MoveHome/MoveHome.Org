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

That is one `vercel alias set … --yes`. Nothing is rebuilt and no code is
touched, so recovery does not depend on CI, git or Supabase. Measured alias
write latency is ~43 s; budget one minute end to end, then re-check `/api/health`.

## Re-pinning to a new build

```bash
vercel deploy --prod --scope move-home          # note the printed dpl_… and *.vercel.app URL
vercel alias set <dpl_id> demo.movehome.org --scope move-home --yes
# update deployment_id / deployment_url / pinned_at in docs/ops/expo-demo-pin.json and merge
```

Pin only after `/api/health` on the alias returns the new `deployment_url`.

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
