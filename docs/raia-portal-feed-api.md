# RAIA Portal Feed API — Integrator Guide

> **Audience:** CRMs, agencies, and partners who **push property listings into
> MoveHome.org** by calling this API. (If you are *implementing* the server, see
> the [Implementer's Build Guide](./raia-portal-feed-build-guide.md).)
>
> <!-- AUTO-GENERATED from src/app/api/raia/portal/v1/** + src/app/oauth/token + src/lib/portal/** — keep in sync with the routes. -->

You are the **client**. You authenticate with OAuth2 client credentials, get a
bearer token, then `PUT` listings, read them back, poll enquiries, and request
product activations. Listings you push surface publicly on
`https://movehome.org/property/{raia_id}` alongside crawled listings.

---

## 1. Base URLs

| | URL |
|---|---|
| API base | `https://movehome.org/api/raia/portal/v1` |
| Token endpoint | `https://movehome.org/oauth/token` |
| Health (no auth) | `https://movehome.org/api/raia/portal/v1/healthz` |

Use a staging host for testing. All traffic is HTTPS (TLS 1.2+).

---

## 2. Getting credentials

The MoveHome operator issues you a **`client_id`** and **`client_secret`** (the
secret is shown once — store it in your secrets vault). Your credential is bound
to a single **agent** and a set of **scopes**:

| Scope | Grants |
|---|---|
| `feed.write` | `PUT` / `DELETE /listings/{reference}` |
| `feed.read` | `GET /listings/{reference}`, all `GET /branches/*`, all `GET /products/*` |
| `products.write` | `POST /products/premium-listings`, `POST /products/featured-properties` |

---

## 3. Authentication

### Get a token
```bash
curl -s -X POST https://movehome.org/oauth/token \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d "grant_type=client_credentials&scope=feed.read feed.write products.write"
```
Response:
```json
{ "access_token": "eyJhbGciOi...", "token_type": "Bearer", "expires_in": 3600, "scope": "feed.read feed.write products.write" }
```
- `grant_type` **must** be `client_credentials`.
- Requested `scope` is intersected with what your credential is allowed; omit it to get all your allowed scopes.
- Tokens last **1 hour**. Cache and reuse them; don't mint one per request (the token endpoint is limited to **10 req/min**).

Send the token on every other call:
```
Authorization: Bearer <access_token>
```

---

## 4. Endpoints

All paths below are relative to `https://movehome.org/api/raia/portal/v1`.

| Method | Path | Scope | Purpose |
|---|---|---|---|
| `GET` | `/healthz` | none | Liveness probe |
| `PUT` | `/listings/{reference}` | `feed.write` | Create or update a listing |
| `GET` | `/listings/{reference}` | `feed.read` | Read a listing back |
| `DELETE` | `/listings/{reference}` | `feed.write` | Remove a listing |
| `GET` | `/branches/{branch_id}/listings` | `feed.read` | Paginated inventory (reconciliation) |
| `GET` | `/branches/{branch_id}/performance` | `feed.read` | Daily stats (≤28-day window) |
| `GET` | `/branches/{branch_id}/enquiries` | `feed.read` | Lead polling (cursor) |
| `GET`/`POST` | `/products/premium-listings` (`/{id}`) | `feed.read` / `products.write` | Premium activations |
| `GET`/`POST` | `/products/featured-properties` (`/{id}`) | `feed.read` / `products.write` | Featured activations |

Optional header **`X-RAIA-Branch-Id: <branch>`** scopes listing writes/reads to a
branch (otherwise your credential's default branch is used).

---

## 5. `PUT /listings/{reference}` — the core endpoint

`{reference}` is **your** stable id for the property — pattern `^[A-Za-z0-9_-]{1,100}$`,
unique per branch. Same reference again → update. Max body **1 MB**.

### Residential — minimal
```bash
curl -i -X PUT https://movehome.org/api/raia/portal/v1/listings/REF_001 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "residential",
    "transaction_type": "LETTINGS",
    "status": "AVAILABLE",
    "property_type": "FLAT",
    "headline": "2-bed flat, Hammersmith W6",
    "asking_rent_pcm": 2400,
    "currency": "GBP",
    "address": { "display_address": "42 King Street, London", "postcode": "W6 9TA", "country": "GB" }
  }'
```

Response — **`201 Created`** (new) or **`200 OK`** (update / no-change):
```json
{ "reference": "REF_001", "action": "CREATED", "updated_at": "2026-06-07T10:00:00Z", "version": 1,
  "public_card_url": "https://movehome.org/property/prop-gb-acme-12345678" }
```
`action` is `CREATED` (201), `UPDATED` (200), or `NO_CHANGE` (200, body identical to what's stored — safe to re-send, **idempotent**).

### Residential — field reference
| Field | Type | Required | Notes |
|---|---|---|---|
| `kind` | `"residential"` | yes | discriminator |
| `transaction_type` | `SALES` \| `LETTINGS` | yes | |
| `status` | status enum | yes | |
| `property_type` | property-type enum | yes | |
| `headline` | string ≤200 | yes | |
| `address.display_address` | string ≤120 | yes | |
| `address.postcode` | string ≤12 | yes | |
| `address.country` | ISO-3166 alpha-2 | yes | `GB`, `TH`, … |
| `asking_price` | number ≥0 | if `SALES` | |
| `asking_rent_pcm` | number ≥0 | if `LETTINGS` | per calendar month |
| `description` | string ≤10000 | no | |
| `bedrooms`/`bathrooms`/`reception_rooms` | int ≥0 | no | |
| `floor_area_sqm` | number ≥0 | no | |
| `available_from` | `YYYY-MM-DD` | no | |
| `rent_frequency` | `MONTHLY`\|`YEARLY`\|`WEEKLY` | no | |
| `deposit` | number ≥0 | no | |
| `currency` | ISO-4217 | no | `GBP`, `THB` |
| `tenure` | tenure enum | no | **SALES only** |
| `furnishing` | furnishing enum | no | **LETTINGS only** |
| `epc_rating` | `A`–`G` | no | |
| `features` | string[] (≤20) | no | |
| `parking` | parking enum[] | no | |
| `outside_space` | outside-space enum[] | no | |
| `address.latitude`/`longitude` | float | no | |
| `media.photos[]` / `floor_plans[]` / `epcs[]` / `brochures[]` / `virtual_tours[]` | MediaAsset[] | no | `brochures` URLs must end `.pdf` |
| `public_card.publish` | boolean | no | default `true` — set `false` to ingest without showing publicly |
| `public_card.suppress_address` | boolean | no | default `true` — hides exact address on the public card |

**MediaAsset:** `{ "url": "https://… (≤1024)", "description"?: "…", "order"?: 0, "etag"?: "…" }`

### Enums
```
status:         AVAILABLE UNDER_OFFER SOLD_STC SOLD_STCM RESERVED LET_AGREED OFF_MARKET WITHDRAWN
property_type:  FLAT APARTMENT STUDIO MAISONETTE TERRACED END_TERRACE SEMI_DETACHED DETACHED BUNGALOW COTTAGE TOWNHOUSE LAND OTHER
tenure:         FREEHOLD LEASEHOLD SHARE_OF_FREEHOLD COMMONHOLD
furnishing:     FURNISHED PART_FURNISHED UNFURNISHED FURNISHED_OR_UNFURNISHED
parking:        OFF_STREET GARAGE ALLOCATED RESIDENT_PERMIT NONE
outside_space:  GARDEN BALCONY TERRACE PATIO COURTYARD ROOF_TERRACE
```

### Commercial
Set `kind: "commercial"` with a `building` object:
```json
{
  "kind": "commercial",
  "transaction_type": "LETTINGS",
  "building": {
    "reference": "REF_001",
    "status": "AVAILABLE",
    "primary_classification": { "classification": "OFFICE", "sub_type": "SERVICED_OFFICE" },
    "address": { "display_address": "33 Soho Square, London", "postcode": "W1D 3QU", "country": "GB" },
    "pricing": { "asking_rent_pa": 60000, "currency": "GBP" },
    "spaces": [ { "reference": "UNIT_1", "primary_classification": { "classification": "OFFICE" } } ]
  }
}
```
Rules: `building.reference` **must equal** the path `{reference}`; each `spaces[].reference`
must be unique and **differ** from the building reference; **max 50 spaces**; if no
space carries pricing, building-level `pricing` is required.
Classifications: `OFFICE INDUSTRIAL_AND_LOGISTICS RETAIL LEISURE_AND_HOSPITALITY LAND_AND_DEVELOPMENT OTHER`.

---

## 6. `GET` / `DELETE /listings/{reference}`

```bash
# Read back
curl -H "Authorization: Bearer $TOKEN" \
  https://movehome.org/api/raia/portal/v1/listings/REF_001
# → 200 { reference, branch_id, transaction_type, status, kind, residential|commercial:{…},
#         public_card_url, created_at, updated_at, version }   (404 if not found / no access)

# Remove (DELETE requires a body)
curl -X DELETE https://movehome.org/api/raia/portal/v1/listings/REF_001 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "removal_reason": "LET_BY_US", "note": "Tenant signed 6 Jun" }'
# → 200 { reference, removed_at, removal_reason }
```
`removal_reason` (required): `SOLD_BY_US SOLD_BY_ANOTHER_AGENT LET_BY_US LET_BY_ANOTHER_AGENT WITHDRAWN_FROM_MARKET LOST_INSTRUCTION REMOVED`.
Deleting an already-removed listing still returns `200` (idempotent); the public card is withdrawn.

---

## 7. Branch endpoints

```bash
# Inventory snapshot (diff against your CRM)
GET /branches/{branch_id}/listings?transaction_type=LETTINGS&status=AVAILABLE&updated_since=2026-06-01T00:00:00Z&page=1&per_page=50
# → { "meta": { "page": 1, "per_page": 50, "total": 127 }, "listings": [ { reference, transaction_type, status, kind, public_card_url, updated_at, version } ] }

# Performance — `from` & `to` required, window ≤ 28 days; optional `portal`
GET /branches/{branch_id}/performance?from=2026-05-01&to=2026-05-28
# → { branch_id, portal, range:{from,to}, totals:{ impressions, detail_views, click_throughs, phone_reveals, brochure_downloads, enquiries }, by_day:[ { date, metrics:{…} } ] }

# Enquiries — cursor polling
GET /branches/{branch_id}/enquiries?since_enquiry_id=<next_cursor>&limit=100
# → { "enquiries": [ { enquiry_id, listing_reference, received_at, source, … } ], "next_cursor": "…" }
```
Poll enquiries by passing the previous response's `next_cursor` as `since_enquiry_id`.

---

## 8. Product activations

```bash
# Request a premium listing (needs products.write)
curl -X POST https://movehome.org/api/raia/portal/v1/products/premium-listings \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "customer_listing_id": "REF_001", "highlights": [ { "id": 1 } ] }'
# → 201 { id, product:"PREMIUM_LISTING", status:"PENDING", customer_listing_id, created_at, … }

# Featured property (same shape, no highlights)
POST /products/featured-properties   { "customer_listing_id": "REF_001" }

# Poll status until terminal
GET /products/premium-listings/{id}        # or /products/featured-properties/{id}
GET /products/premium-listings             # list yours → { "activations": [ … ] }
```
At least one of `customer_listing_id` (your reference) or `listing_id` is required.
Status lifecycle: `PENDING → ACTIVE | EXPIRED | REJECTED | CANCELLED`.

---

## 9. Errors (RFC 7807)

Every 4xx/5xx is `application/problem+json` and carries a `trace_id` (also in the
`X-Trace-Id` header — quote it in support requests):
```json
{ "type": "https://movehome.org/errors/validation", "title": "Validation failed", "status": 400,
  "detail": "Listing payload failed validation.", "instance": "/api/raia/portal/v1/listings/REF_001",
  "trace_id": "01HZ…", "timestamp": "2026-06-07T10:01:23Z",
  "validation_errors": [ { "field": "address.postcode", "message": "Postcode is required.", "code": "INVALID" } ] }
```
| Status | Meaning |
|---|---|
| `400` | Validation failed (see `validation_errors[]`) |
| `401` | Missing/expired/invalid token |
| `403` | Token lacks the required scope |
| `404` | Listing not found / not yours |
| `409` | Reference already exists under a different branch for your agent |
| `429` | Rate limit hit — see headers below |

---

## 10. Rate limits

**60 requests/min per credential per endpoint group** (the token endpoint is
**10/min**). Every response carries:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 41
X-RateLimit-Reset: 1717754460
```
On `429` you also get `Retry-After: <seconds>` — back off and retry after it.

---

## 11. Quick start checklist

1. Get `client_id` + `client_secret` from the operator.
2. `POST /oauth/token` → cache the bearer token (1 h).
3. `PUT /listings/{your_ref}` → expect `201 CREATED`; note `public_card_url`.
4. Re-`PUT` the same body → `200 NO_CHANGE` (proves idempotency); change a field → `200 UPDATED`.
5. `GET /listings/{your_ref}` to read it back; `DELETE` with a `removal_reason` to withdraw.
6. Nightly: `GET /branches/{branch_id}/listings` to reconcile, and poll `/enquiries` for leads.

Questions / credentials: contact the MoveHome operator.
