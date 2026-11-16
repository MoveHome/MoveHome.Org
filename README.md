# MoveHome.org

A free, not-for-profit property marketplace. Reference open-source
consumer of the [RAIA Protocol](https://github.com/estateaigents/raia-protocol).

Operated by [Move Home Organisation CIC](https://movehome.org)
(Company No. 17202438, England and Wales).

---

## What this repo is

- The Next.js app that powers [movehome.org](https://movehome.org).
- A reference implementation showing how any organisation can build a RAIA Protocol consumer.
- Read-only. Anonymous. No PII. No proprietary logic.
- Implements RAIA Protocol v0.1.

## What this repo is **not**

- Not the RAIA platform itself — that's a separate private commercial codebase ([EstateAigents.com](https://estateaigents.com)).
- Not where listings are created or edited — listings flow in from the `raia-public` Supabase mirror, populated by the RAIA platform from agencies who federate via the Protocol.
- Not where credentials, AI, or business logic live.

---

## How it works

```
   ┌───────────────────────┐         ┌───────────────────────────┐
   │  RAIA platform        │ syncs   │  raia-public Supabase     │
   │  (private)            ├────────▶│  mirror (anon-readable)   │
   │  + federated agencies │         └───────────┬───────────────┘
   └───────────────────────┘                     │ anon key
                                                 │
                                ┌────────────────▼───────────────┐
                                │  movehome.org (this repo)      │
                                │  Next.js + Supabase client     │
                                └────────────────────────────────┘
```

Listings originate from estate agents using [EstateAigents.com](https://estateaigents.com).
Agents federate their properties to the RAIA Protocol. MoveHome.org reads the public
mirror — no direct database access, no credentials.

---

## Run locally

```bash
cp .env.local.example .env.local
# Fill in: raia-public Supabase project URL + anon key + Google Maps key
npm install
npm run dev
```

Open `http://localhost:3000`. With an empty mirror you'll see no listings — that's expected.

---

## Fork it

That's the whole point.

Fork this repo, point it at any Supabase project that exposes a `tbl_listings` matching
the RAIA Protocol [`schemas/listing.json`](https://github.com/estateaigents/raia-protocol/blob/main/schemas/listing.json),
customise the UI, and you have your own RAIA Protocol aggregator.

**Who should fork this:**
- An estate agent building their own branded search portal
- A council surfacing affordable housing inventory
- A charity surfacing supported living options
- A relocation firm building a curated destination guide
- A developer experimenting with AI agent-to-agent property search

The RAIA Protocol is open. The data is yours. The portal is free to build.

---

## Why not-for-profit?

Property portals charge estate agents significant listing fees regardless of
whether a property lets or sells. Those costs are ultimately passed on to
tenants and home movers — increasing the cost of renting and moving home for
everyone.

MoveHome.org exists to change that. Free to list, with £0 referral fee, £0 deal
commission and £0 client money held. The mission: remove the toll booth from
housing and return that value to the people who need it most.

Move Home Organisation CIC is constituted to serve this mission permanently —
profits cannot be extracted, assets are locked to the community benefit purpose.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All welcome.

---

## License

[Apache 2.0](LICENSE) — free to use, fork and build on.
Commercial use permitted. Attribution required.

Copyright 2026 Move Home Organisation CIC

---

## Maintainer

[Move Home Organisation CIC](https://movehome.org) ·
admin@movehome.org ·
[github.com/MoveHome](https://github.com/MoveHome)
