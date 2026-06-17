# MoveHome.org — A2A Agent Skills (for AI agents)

> **You are an AI assistant reading this to learn how to use the MoveHome.org property agent.**
> MoveHome.org exposes a live **Agent2Agent (A2A) protocol** endpoint. After reading this
> file you can search UK & international property listings, fetch listing details, and submit
> enquiries on a user's behalf — by making plain HTTPS JSON-RPC calls. No SDK or API key is
> required for searching and reading. Copy the request shapes below verbatim.

- **A2A endpoint:** `https://movehome.org/api/a2a`  (HTTP `POST`, JSON-RPC 2.0)
- **Agent Card:** `https://movehome.org/.well-known/agent-card.json`  (machine-readable capabilities)
- **Protocol:** A2A `0.3.0`, transport `JSONRPC`. CORS is open (`*`). Auth: **none** (anonymous).
- **This doc:** `https://movehome.org/skills.md`

---

## How to call a skill

A2A messages are free-form, so MoveHome uses one simple convention: send a JSON-RPC
`message/send` request whose message contains a single **DataPart** naming the `skill`
and its `params`:

```jsonc
POST https://movehome.org/api/a2a
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/send",
  "params": {
    "message": {
      "kind": "message",
      "role": "user",
      "messageId": "<any-unique-string>",
      "parts": [
        { "kind": "data", "data": { "skill": "<skill_id>", "params": { /* ... */ } } }
      ]
    }
  }
}
```

**The reply is an A2A `Task`.** Read the result like this:

```jsonc
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "kind": "task",
    "id": "…", "contextId": "…",
    "status": {
      "state": "completed",                       // "completed" | "failed"
      "message": { "role": "agent", "parts": [ { "kind": "text", "text": "<human summary>" } ] }
    },
    "artifacts": [
      { "name": "search_results", "parts": [ { "kind": "data", "data": { /* structured result */ } } ] }
    ]
  }
}
```

- Human-readable summary → `result.status.message.parts[0].text`
- Machine-readable data → `result.artifacts[0].parts[0].data`
- A skill that fails on bad input/no result returns `status.state: "failed"` (a normal HTTP 200
  with an A2A Task), **not** a JSON-RPC error. Protocol-level problems return JSON-RPC `error`
  (see Errors).

---

## Skills

### 1. `search_properties` — search the catalogue (read-only)

All params optional; omit to browse broadly. Schema is strict (unknown keys rejected).

| Param | Type | Notes |
|---|---|---|
| `un_locode` | string | 5-char UN/LOCODE, e.g. `GBLON` (London), `GBMNC` (Manchester) |
| `service_type` | enum | `long_term` \| `short_term` \| `sale` |
| `property_type` | enum | `flat` \| `house` \| `studio` \| `commercial` \| `land` \| `other` |
| `bedrooms_min` / `bedrooms_max` | int | 0–50 |
| `rent_pcm_max` | number | max monthly rent (for rentals) |
| `asking_price_max` | number | max price (for sales) |
| `features` | string[] | up to 20 feature tags |
| `limit` | int | 1–50 (default 24) |
| `offset` | int | for pagination |

**Example — 2-bed long-term rentals in London under £3000 pcm:**
```json
{ "jsonrpc": "2.0", "id": 1, "method": "message/send", "params": { "message": {
  "kind": "message", "role": "user", "messageId": "s1",
  "parts": [ { "kind": "data", "data": { "skill": "search_properties",
    "params": { "un_locode": "GBLON", "service_type": "long_term", "bedrooms_min": 2, "rent_pcm_max": 3000, "limit": 5 } } } ]
} } }
```

**Result** — artifact `search_results`, `data`:
```jsonc
{
  "total": 128, "count": 5, "offset": 0, "limit": 5,
  "listings": [
    {
      "raia_id": "prop-gb-rlf-000031",
      "url": "https://movehome.org/property/prop-gb-rlf-000031",
      "headline": "Latymer Court",
      "property_type": "flat", "service_type": "long_term", "status": "available",
      "bedrooms": 2, "bathrooms": 1,
      "price": { "rent_pcm": 2750, "asking_price": null, "currency": "GBP" },
      "location": { "un_locode": "GBLON", "postcode_district": "W6", "latitude": 51.49, "longitude": -0.22 },
      "features": ["balcony", "lift"],
      "media": { "photo_url": "https://…", "photos": ["https://…"] }
    }
    // … more
  ]
}
```

### 2. `get_property` — full details of one listing (read-only)

| Param | Type | Notes |
|---|---|---|
| `raia_id` | string | required, e.g. `prop-gb-rlf-000031` (get it from a search result) |

**Example:**
```json
{ "jsonrpc": "2.0", "id": 2, "method": "message/send", "params": { "message": {
  "kind": "message", "role": "user", "messageId": "g1",
  "parts": [ { "kind": "data", "data": { "skill": "get_property", "params": { "raia_id": "prop-gb-rlf-000031" } } } ]
} } }
```
**Result** — artifact `property`, `data`: `{ "listing": { … same shape as a search listing … } }`.

### 3. `create_enquiry` — submit an enquiry (WRITE — sends a real lead) ⚠️

This **records an enquiry and forwards it to the source estate agent** (a real human gets it).
Only call it with the user's explicit consent and their real contact details. Note the
**nested `enquirer` object**.

| Param | Type | Notes |
|---|---|---|
| `raia_id` | string | required |
| `enquirer.name` | string | required, 1–200 chars |
| `enquirer.email` | string | required, valid email |
| `enquirer.phone` | string | optional |
| `enquirer.preferred_contact` | enum | optional: `email` \| `phone` \| `whatsapp` |
| `message` | string | required, 1–2000 chars |
| `viewing_request.preferred_dates` | string[] | optional, 1–3 ISO-8601 dates |
| `viewing_request.party_size` | int | optional, 1–50 |

**Example:**
```json
{ "jsonrpc": "2.0", "id": 3, "method": "message/send", "params": { "message": {
  "kind": "message", "role": "user", "messageId": "e1",
  "parts": [ { "kind": "data", "data": { "skill": "create_enquiry", "params": {
    "raia_id": "prop-gb-rlf-000031",
    "enquirer": { "name": "Jane Doe", "email": "jane@example.com", "preferred_contact": "email" },
    "message": "Is this still available? Could we view it on Saturday?",
    "viewing_request": { "preferred_dates": ["2026-06-20"], "party_size": 2 }
  } } } ]
} } }
```
**Result** — artifact `enquiry_receipt`, `data`: `{ "enquiry_id": "…", "status": "received" }`.

---

## Errors

- **Skill-level** (bad params, listing not found, unknown skill, rate limited) → HTTP 200 with
  a Task whose `status.state` is `"failed"`; the reason is in `status.message.parts[0].text`.
- **Protocol-level** → JSON-RPC `error` object:
  | code | meaning |
  |---|---|
  | `-32700` | malformed JSON |
  | `-32601` | unknown method |
  | `-32004` | streaming not supported (use `message/send`, not `message/stream`) |
  | `-32001` | task not found (`tasks/get`) |
  | `-32603` | rate limit exceeded / internal error |

## Rate limits

- ~60 requests/min per IP across all skills.
- `create_enquiry` is additionally capped (≈5/min per IP) with duplicate suppression
  (same email+listing within ~10 min) and a per-email hourly cap. All read skills are unaffected.

## Trust (optional)

The Agent Card may carry a JWS signature (`signatures[]`). Verify it against the JWKS at
`https://movehome.org/.well-known/jwks.json` (ES256) to confirm the card is authentically
MoveHome's. Verification is optional for use.

---

## Add MoveHome to your agent — quick start

**Try it now (shell):**
```bash
curl -s https://movehome.org/api/a2a -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{
    "kind":"message","role":"user","messageId":"q1",
    "parts":[{"kind":"data","data":{"skill":"search_properties","params":{"un_locode":"GBLON","limit":3}}}]}}}'
```

**Register as a tool in your agent** — define one tool, e.g. `movehome_property`, that POSTs to
`https://movehome.org/api/a2a` using the `message/send` + DataPart shape above, passing the
chosen `skill` and `params`. Parse `result.artifacts[0].parts[0].data` for the answer.

## Are you a real-estate agent? List your A2A agent

MoveHome runs a **public real-estate A2A registry** — a property-focused directory of agents
that speak A2A. Submit your agent card and it's validated, listed, and health-checked:

- **Browse:** https://movehome.org/registry
- **Register (API):** `POST https://movehome.org/api/registry/v1/agents/register` with `{"wellKnownURI":"https://your-domain/.well-known/agent-card.json"}`
- **List/search (API):** `GET https://movehome.org/api/registry/v1/agents?location=GBLON&service_type=long_term`

This agent is also listed in the public A2A directory **a2aregistry.org** and the Google Cloud
Agent Registry. Operated by Move Home Organisation CIC · https://movehome.org
