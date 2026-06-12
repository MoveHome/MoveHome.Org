# MoveHome A2A Protocol Tester

A tiny, dependency-free console for exercising the MoveHome.org **Agent2Agent (A2A)**
endpoint end-to-end — discovery, every skill, the protocol error paths, and the raw
JSON-RPC wire traffic. It's a self-contained static page; it does **not** import or build
against the Next.js app, so it can't break the site.

It's an MVP test harness, not part of the product.

## What it checks

The tester drives the real A2A surface defined in [`src/lib/a2a/`](../src/lib/a2a) and
[`src/app/api/a2a/route.ts`](../src/app/api/a2a/route.ts):

| Surface | Tester does |
| --- | --- |
| `GET /api/a2a` + `/.well-known/agent-card.json` | Discovers and validates the Agent Card |
| `message/send` → `search_properties` | Search form → results table |
| `message/send` → `get_property` | Fetch one listing (chains from a search row) |
| `message/send` → `create_enquiry` | Submit an enquiry — **gated behind a confirm; real write** |
| Protocol error paths | Unknown skill, bad params, missing DataPart, unknown method, `message/stream` rejection, malformed JSON, `tasks/get` |

The **Conformance suite** tab runs all of the above (except the write) as automated
pass/fail checks — the quickest "is everything working?" answer. It never calls
`create_enquiry`.

## Run it

From the repo root, start the app in one terminal:

```bash
npm run dev          # Next.js on http://localhost:3000
```

…and the tester in another:

```bash
node a2a-tester/serve.mjs        # → http://localhost:4400
# node a2a-tester/serve.mjs 5000 # pick a different port
```

Open <http://localhost:4400>. It auto-discovers `http://localhost:3000` on load; click
**Run all checks** on the Conformance tab.

> The page talks to the endpoint cross-origin and relies on the A2A route's open CORS
> (`Access-Control-Allow-Origin: *`), so no proxy is needed.

## Testing production

Type `https://movehome.org` in the **Target** box (or click the **prod** preset). A red
banner appears because:

- searches hit the live catalogue (real reads, subject to per-IP rate limiting), and
- **`create_enquiry` against prod inserts a real lead and emails the source agent.** The
  automated suite never writes; only the Enquiry tab does, and only after you confirm.

## Notes

- `search_properties` / `get_property` need `NEXT_PUBLIC_SUPABASE_URL` +
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`; `create_enquiry` also needs `SUPABASE_SERVICE_ROLE_KEY`.
  Without Supabase env the data layer returns empty results (search passes with `total=0`,
  the chained `get_property` check is skipped).
- App-level failures (not found, bad params, unknown skill) come back as a **failed A2A
  Task**, not a JSON-RPC error — the tester surfaces that distinction so you can tell a
  graceful rejection from a transport fault.

## Files

```
a2a-tester/
  index.html   UI shell
  styles.css   styling (single dark theme)
  app.js       A2A client + conformance suite
  serve.mjs    zero-dependency static server (Node built-ins only)
```
