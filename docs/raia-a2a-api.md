# MoveHome.org A2A (Agent-to-Agent) API — Integrator Guide

> **Audience:** AI agents (and the developers building them) that want to
> **discover, inspect, and enquire on MoveHome.org listings** programmatically,
> agent-to-agent, over the open [Google A2A protocol](https://a2a-protocol.org).
>
> This is the *outbound* counterpart to the [Portal Feed API](./raia-portal-feed-api.md)
> (which lets CRMs push listings *into* MoveHome). Here, **your agent is the
> client** and MoveHome.org is the remote agent.
>
> <!-- Keep in sync with src/app/api/a2a/** + src/lib/a2a/** -->

---

## 1. Discovery — the Agent Card

Fetch the Agent Card to learn the endpoint, capabilities, and skills:

```bash
curl -s https://movehome.org/.well-known/agent.json
# (alias) https://movehome.org/.well-known/agent-card.json
```

The card declares `url` (the JSON-RPC endpoint, `https://movehome.org/api/a2a`),
`preferredTransport: "JSONRPC"`, and three `skills`: `search_properties`,
`get_property`, `create_enquiry`. CORS is open (`Access-Control-Allow-Origin: *`)
so browser-based agents can read it from any origin.

Capabilities in v1: **no streaming, no push notifications, no task persistence.**
Every call is answered synchronously with a terminal (`completed`) Task.

---

## 2. Transport — JSON-RPC 2.0

All calls are `POST https://movehome.org/api/a2a` with a JSON-RPC 2.0 envelope:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "message/send", "params": { … } }
```

`GET /api/a2a` returns the Agent Card too (convenience). Supported methods:

| Method | Purpose |
|---|---|
| `message/send` | Invoke a skill, get a completed Task back |
| `tasks/get` | Always returns error `-32001` (tasks are not persisted in v1) |

---

## 3. Invoking a skill

A2A messages are free-form, so MoveHome uses an explicit, deterministic
convention: include a **DataPart** naming the skill and its params.

```jsonc
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/send",
  "params": {
    "message": {
      "kind": "message",
      "role": "user",
      "messageId": "client-generated-uuid",
      "parts": [
        { "kind": "data", "data": { "skill": "search_properties", "params": { /* … */ } } }
      ]
    }
  }
}
```

The response is a JSON-RPC result containing a **Task**:

```jsonc
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "kind": "task",
    "id": "…",
    "contextId": "…",
    "status": {
      "state": "completed",
      "message": { "kind": "message", "role": "agent",
                   "parts": [ { "kind": "text", "text": "Found 12 listings; returning 12." } ], … },
      "timestamp": "2026-06-08T10:00:00Z"
    },
    "artifacts": [
      { "artifactId": "…", "name": "search_results",
        "parts": [ { "kind": "data", "data": { /* structured result */ } } ] }
    ]
  }
}
```

Read the structured result from `result.artifacts[].parts[].data`; the
human-readable one-liner is in `result.status.message`.

---

## 4. Skills

### `search_properties`
All params optional. Returns up to `limit` public listing cards.

| Param | Type | Notes |
|---|---|---|
| `un_locode` | string | 5-char UN/LOCODE, e.g. `GBLON` |
| `service_type` | `long_term` \| `short_term` \| `sale` | |
| `property_type` | `flat` \| `house` \| `studio` \| `commercial` \| `land` \| `other` | |
| `bedrooms_min` / `bedrooms_max` | int 0–50 | |
| `rent_pcm_max` | number | per calendar month |
| `asking_price_max` | number | |
| `features` | string[] (≤20) | listing must contain all |
| `limit` | int 1–50 | default 24 |
| `offset` | int ≥0 | pagination |

Artifact `search_results` → `{ total, count, offset, limit, listings: [ … ] }`.

### `get_property`
| Param | Type | Notes |
|---|---|---|
| `raia_id` | string | e.g. `prop-gb-rlf-04827193` |

Artifact `property` → `{ listing: { … } }`. If no public listing matches, the
Task comes back **`failed`** (not a JSON-RPC error) — see §5.

### `create_enquiry`
Records an enquiry and forwards it to the source agent (SSRF-guarded; HTTPS
public hosts only — same pipeline as `POST /api/enquire`).

| Param | Type | Notes |
|---|---|---|
| `raia_id` | string | target listing |
| `enquirer.name` | string ≤200 | required |
| `enquirer.email` | email | required |
| `enquirer.phone` | string ≤40 | optional |
| `enquirer.preferred_contact` | `email` \| `phone` \| `whatsapp` | optional |
| `message` | string 1–2000 | required |
| `viewing_request.preferred_dates` | string[] 1–3 | optional |
| `viewing_request.party_size` | int 1–50 | optional |

Artifact `enquiry_receipt` → `{ enquiry_id, status: "received" }`.

Because this is a write that reaches a real estate agent, it is rate-limited
more tightly than the read skills (≈5 requests/min per IP) and is subject to
anti-spam checks: a duplicate enquiry (same email + listing within ~10 minutes)
or too many enquiries from one email in an hour come back as a **`failed`** Task
or HTTP `429`. Treat those as terminal — do not blindly retry.

---

## 5. Errors — two distinct failure modes

This is the most important thing to get right when integrating. Failures come
back in **one of two ways**, and you handle them differently:

**(a) Application failures → a `failed` Task (HTTP 200, JSON-RPC `result`).**
A request that is well-formed but can't be fulfilled — unknown skill, invalid
skill params, listing not found, enquiry rejected/rate-limited — returns a
*successful JSON-RPC response* whose `result` is a Task with
`status.state: "failed"` and a human-readable reason in `status.message`. There
is **no** `error` object. Check `result.status.state` before trusting a result.

```jsonc
{ "jsonrpc": "2.0", "id": 1, "result": {
    "kind": "task", "status": {
      "state": "failed",
      "message": { "role": "agent", "parts": [ { "kind": "text",
        "text": "Invalid parameters: un_locode must be a 5-char UN/LOCODE, e.g. GBLON" } ] } } } }
```

**(b) Transport / protocol errors → a JSON-RPC `error` object.**

| Code | Meaning | HTTP |
|---|---|---|
| `-32700` | Parse error (invalid JSON) | 400 |
| `-32600` | Invalid JSON-RPC request | 400 |
| `-32601` | Unknown method | 200 |
| `-32004` | Streaming requested (`message/stream`) — unsupported, use `message/send` | 200 |
| `-32001` | Task not found (`tasks/get` — tasks aren't persisted) | 200 |
| `-32603` | Internal error / rate limit | 200 or 429 |

Rate-limit breaches return HTTP **429** with a `-32603` body, `Retry-After`, and
`X-RateLimit-*` headers. Read skills: **60 requests/min per IP**; `create_enquiry`
is tighter (≈5/min per IP) — see §4.

---

## 6. Quick start

```bash
# 1. Discover
curl -s https://movehome.org/.well-known/agent.json | jq .skills

# 2. Search
curl -s -X POST https://movehome.org/api/a2a -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"message/send",
  "params":{"message":{"kind":"message","role":"user","messageId":"m1",
    "parts":[{"kind":"data","data":{"skill":"search_properties",
      "params":{"un_locode":"GBLON","service_type":"long_term","bedrooms_min":2,"rent_pcm_max":3000}}}]}}
}' | jq '.result.artifacts[0].parts[0].data'

# 3. Get one
curl -s -X POST https://movehome.org/api/a2a -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":2,"method":"message/send",
  "params":{"message":{"kind":"message","role":"user","messageId":"m2",
    "parts":[{"kind":"data","data":{"skill":"get_property","params":{"raia_id":"prop-gb-rlf-04827193"}}}]}}
}' | jq '.result.artifacts[0].parts[0].data.listing'
```

### Interactive test console

The repo ships a zero-dependency web console for exploring this API — discovery,
every skill, and an automated conformance suite covering the error paths above.
From a checkout:

```bash
node a2a-tester/serve.mjs   # → http://localhost:4400
```

Point it at `https://movehome.org` or your own deployment. See
[`a2a-tester/README.md`](../a2a-tester/README.md).

> **Coming next:** an MCP server exposing the same property-discovery skills as
> MCP tools, for agents that speak the Model Context Protocol.
