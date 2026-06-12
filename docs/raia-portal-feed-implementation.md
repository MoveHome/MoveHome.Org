# RAIA Portal Feed API — MoveHome implementation notes

This is the **server-side implementation** of the RAIA Portal Feed API spec
(see the [Implementer's Build Guide](raia-portal-feed-build-guide.md)). Providers (CRMs,
agencies, partners) push listings into MoveHome via these endpoints; once
ingested, listings are mirrored into `tbl_external_raia_listings` and surface
on the public site at `https://movehome.org/property/{raia_id}` alongside
crawled federated listings.

## Routes

| Method | Path | Auth | Scope |
|---|---|---|---|
| `GET`  | `/api/raia/portal/v1/healthz` | none | — |
| `POST` | `/oauth/token` | Basic | — |
| `PUT`  | `/api/raia/portal/v1/listings/{reference}` | Bearer | `feed.write` |
| `GET`  | `/api/raia/portal/v1/listings/{reference}` | Bearer | `feed.read` |
| `DEL`  | `/api/raia/portal/v1/listings/{reference}` | Bearer | `feed.write` |
| `GET`  | `/api/raia/portal/v1/branches/{branch_id}/listings` | Bearer | `feed.read` |
| `GET`  | `/api/raia/portal/v1/branches/{branch_id}/performance` | Bearer | `feed.read` |
| `GET`  | `/api/raia/portal/v1/branches/{branch_id}/enquiries` | Bearer | `feed.read` |
| `GET`  | `/api/raia/portal/v1/products/premium-listings` | Bearer | `feed.read` |
| `POST` | `/api/raia/portal/v1/products/premium-listings` | Bearer | `products.write` |
| `GET`  | `/api/raia/portal/v1/products/premium-listings/{id}` | Bearer | `feed.read` |
| `GET`  | `/api/raia/portal/v1/products/featured-properties` | Bearer | `feed.read` |
| `POST` | `/api/raia/portal/v1/products/featured-properties` | Bearer | `products.write` |
| `GET`  | `/api/raia/portal/v1/products/featured-properties/{id}` | Bearer | `feed.read` |

## Security model

| Concern | Choice |
|---|---|
| Token signing | **HS256** with `RAIA_PORTAL_JWT_SECRET` (≥32 bytes). Spec recommends RS256; HS256 is equivalent here because MoveHome is the sole issuer/validator. |
| Token TTL | 1 hour (`expires_in: 3600`) |
| Client secret hashing | `scrypt` (N=16384, r=8, p=1, 16-byte salt, 32-byte key) — Node built-in, memory-hard |
| Constant-time compare | `crypto.timingSafeEqual` for hash and Basic-header decode |
| Scope enforcement | Per-route check against `claims.scope` |
| Rate limit | Postgres sliding minute window — 60 req/min/credential/endpoint group (token endpoint capped at 10/min) |
| Body size cap | 1 MB on `PUT` / `DELETE` (rejects with 400) |
| Audit log | `tbl_portal_audit_log` for token issuance, listing writes, activation requests |
| TLS | Enforced by Vercel (TLS 1.2+) |
| Error format | RFC 7807 `application/problem+json` on every 4xx / 5xx |
| Trace IDs | UUID4 hex, included in body and `X-Trace-Id` header |

## Environment

`.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon>
SUPABASE_SERVICE_ROLE_KEY=<service-role>
NEXT_PUBLIC_SITE_URL=https://movehome.org

# Generate with: openssl rand -base64 48
RAIA_PORTAL_JWT_SECRET=<≥32-byte random string>
```

## Provisioning a credential

The integrator needs a `client_id` and `client_secret`. Run:

```bash
npm run portal:create-credential -- \
  --agent-id org-gb-acme \
  --label "Acme CRM staging" \
  --scopes feed.write,feed.read,products.write \
  --branch-id BRANCH_LON_01
```

Pre-conditions:

1. The `agent_id` row already exists in `tbl_raia_agent_registry` (operator
   inserts this manually after vetting; ideally `verification_status='approved'`).
2. The Supabase env vars are in `.env.local`.

The script prints `client_id` + `client_secret` **once**. Store them in your
secrets vault and share with the integrator over an out-of-band secure channel.
Rotation = issue a new credential and revoke the old by setting `revoked_at`.

## Quick test

```bash
TOKEN=$(curl -s -X POST https://yourdomain.com/oauth/token \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d "grant_type=client_credentials&scope=feed.write feed.read" \
  | jq -r .access_token)

curl -i -X PUT https://yourdomain.com/api/raia/portal/v1/listings/TEST_001 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "residential",
    "transaction_type": "LETTINGS",
    "status": "AVAILABLE",
    "property_type": "FLAT",
    "headline": "2-bed flat, test",
    "asking_rent_pcm": 2000,
    "currency": "GBP",
    "address": {
      "display_address": "1 Test Street, London",
      "postcode": "SW1A 1AA",
      "country": "GB"
    }
  }'

# Response: 201
# {
#   "reference": "TEST_001",
#   "action": "CREATED",
#   "updated_at": "2026-...",
#   "version": 1,
#   "public_card_url": "https://yourdomain.com/property/prop-gb-acme-12345678"
# }
```

Re-PUT identical body → `200 NO_CHANGE`. Change `asking_rent_pcm` → `200 UPDATED`.

```bash
curl -X DELETE https://yourdomain.com/api/raia/portal/v1/listings/TEST_001 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "removal_reason": "REMOVED" }'
```

## Database schema (migration `0006_raia_portal_feed.sql`)

| Table | Purpose |
|---|---|
| `tbl_portal_credentials` | OAuth client_id + scrypt secret hash, allowed scopes, agent linkage |
| `tbl_portal_branches` | Logical branches (optional; references are unique per branch_id) |
| `tbl_portal_listings` | Provider-pushed listings; full payload JSONB, `payload_hash` for NO_CHANGE |
| `tbl_portal_enquiries` | Lead inbox surfaced via cursor polling |
| `tbl_portal_performance` | Daily impression / view / click counters |
| `tbl_portal_product_activations` | Premium / Featured activations |
| `tbl_portal_rate_limits` | Sliding-window counters |
| `tbl_portal_audit_log` | Append-only audit trail |

All have RLS enabled with no public policies — service-role only.

## Public card derivation

When `payload.public_card.publish !== false`, every successful PUT also
upserts a row into `tbl_external_raia_listings` so the listing appears on
`/search` and `/property/[raia_id]` alongside crawled federated listings.
A stable `raia_id` is derived as `prop-{cc}-{slug}-{8-digit-hash}` if the
provider didn't supply one. DELETE marks the public card `withdrawn_at = now()`.

## What's intentionally minimal

- The `/branches/{id}/performance` endpoint reads `tbl_portal_performance` —
  the table starts empty until analytics writes are wired up. Callers get a
  stable zero-totals shape rather than a 404.
- `tbl_portal_enquiries` is populated via an internal mechanism (out of scope
  for the spec); a future change can fan out leads from `tbl_enquiries` here.
- Activation status is `PENDING` on creation; an internal workflow promotes
  rows to `ACTIVE` / `EXPIRED` / `REJECTED`.
