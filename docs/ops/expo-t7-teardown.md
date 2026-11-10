# EXPO T+7 teardown — operator railroad (ADR-476)

Companion to `docs/ops/expo-demo-runbook.md` (the event itself). This page is the
**after** the event: media-first retention, whole-project deletion, channel
revocation, DNS retirement and the evidence bundle.

T+7 means **`event_closed_at` + 168 h**. It is not a calendar date and it is not
scheduled in the database.

**Nothing on this page may run without Eugin's written approval of the dated
manifest.** The scripts refuse to start without `--live` and the acknowledgement
string, and they never touch the production MoveHome project
(`vfnpmtqxrffppqajxxpb`), any RAIA project, `@`, `www`, NS, SOA or MX records.

## What the code guarantees (synthetic proof)

```bash
npm run typecheck
npm test
npm run demo:teardown:verify        # node scripts/demo/teardown/verify.mjs --fixture latest
```

Expected final line: `TEARDOWN_CONTRACT_PASS fixtures=11`. That green is
synthetic proof only — it is never live proof.

## Roles and inputs

| field | rule |
| --- | --- |
| executor | one named human (DevOps role), different from the verifier |
| verifier | PA, working from a separate operator context |
| approval | Eugin approval reference, quoted in the manifest |
| acknowledgement | a live acknowledgement typed at run time: `<teardown_run_id> <project_ref> <event_closed_at>` (point-blank equality — `YES` or an env var alone is not enough) |
| register | `docs/ops/expo-asset-register.example.json` is the synthetic shape; the real register is created at provisioning and kept mode-600 |
| code SHA | the deployment SHA the run is executed from |

## Stage order (fail-closed)

| # | stage | command | blocks |
| --- | --- | --- | --- |
| 1 | PREFLIGHT | `npm run demo:teardown:preflight -- --register <register> --manifest <manifest> --ack "<ack>" --live` | everything (no mutation happens) |
| 2 | FREEZE_RECHECK | `npm run demo:teardown:freeze -- … --live` | MEDIA |
| 3 | MEDIA | `npm run demo:teardown:media -- … --live` | **DATABASE** (hard) |
| 4 | DATABASE | `npm run demo:teardown:database -- … --live` | CHANNELS |
| 5 | CHANNELS | `npm run demo:teardown:channels -- … --live` | DNS_HOSTING |
| 6 | DNS_HOSTING | `npm run demo:teardown:dns -- … --live` | SECRETS |
| 7 | SECRETS_MONITORS_LOCAL | named-human steps; `verify.mjs` re-reads them | closure |
| 8 | VERIFY_CLOSE | `node scripts/demo/teardown/verify.mjs --live artifacts/expo-t7/<event>/<run>` | closure |

A media FAIL blocks project deletion outright: deleting the project would destroy
the remaining inventory evidence. After DATABASE, a later failure does not stop
independent exposure-reducing cleanup; it marks the run `FAILED`, keeps the card
open and pages both operators. Blind retries of irreversible steps are forbidden —
every retry begins with a fresh provider readback.

## Retention worker (media first, row second)

`npm run demo:retention -- --live` (cron: at least every 10 minutes, service
credential, `/artifacts/expo-t7/retention/` receipts).

* Rows older than 24 h are marked `deleting` first, so they leave the broadcast
  view, the TV feed and the fingerprint.
* Media under `<venue_id>/<listing_id>/` is enumerated **recursively and
  paginated**, deleted, and must read back zero before `demo_retract_finalize`.
* A media failure leaves a non-public `deleting` row with a `pending` receipt.
  It is retried; it is never reported as deleted.
* A backlog older than 24 h 10 m pages both named operators.
* A storage lifecycle policy is defence in depth only. Its JSON is not a receipt.

Migration `0015_demo_retention_lifecycle.sql` retires the 0010 row-only TTL, the
0010 `demo_teardown()` and the old `demo_retract_listing` RPC. It does not run a
teardown: DDL is applied separately, after DDL verification against the live demo
project and Eugin's approval.

## Channel revocation

Telegram is a sequence, not one call:

1. bot identity matches the register (old token, never logged);
2. `deleteWebhook(drop_pending_updates=true)` at T0;
3. token revoked in BotFather at T+7 — **webhook deletion alone is not
   revocation**;
4. old token `getMe` must return unauthorised (`telegram_old_token_unauthorised`);
5. secret **names** removed from Vercel, GitHub and the host store; printed QR
   stock destroyed.

Telegram's own servers and a user's Telegram client are outside our deletion
control. The bot only ever held `photo_file_id`; that is recorded as
`VENDOR_CONTROLLED`, never as zero-byte proof.

WhatsApp is conditional. `NOT_PROVISIONED` needs a fresh provider readback, not a
sentence. If provisioned:

| branch | what must happen |
| --- | --- |
| `temporary_release` | disable subscription, revoke app/system-user tokens, verify the old credential fails, **release** the dedicated leased number and verify it is absent |
| `owned_restore` | disable subscription, revoke tokens, remove demo routing and restore the pre-demo configuration — **never release the owned number** |

Meta/vendor-held message media follows the same honesty rule as Telegram.

## DNS and hosting

1. remove `demo.movehome.org` from `move-home/movehome-demo` (Vercel domain
   inventory readback);
2. delete **only** the `demo` CNAME in the existing GoDaddy `movehome.org` zone;
3. wait `max(previous CNAME TTL, SOA negative-cache TTL) + 15 min`;
4. verify no `demo` CNAME at the authoritative servers and `NXDOMAIN` from two
   independent resolvers;
5. `@`, `www`, NS, SOA and MX are compared before/after — any change is `FAIL`.
   HTTP `000` or a failed `/health` is **not** DNS proof.

## Evidence bundle

`artifacts/expo-t7/<event_id>/<teardown_run_id>/` (gitignored) must contain:

`manifest.json`, `asset-register.redacted.json`, `preflight.json`,
`media-summary.json`, `database.json`, `channels.json`, `dns-hosting.json`,
`secrets-monitors.json`, `verify.json`, `summary.json`, `sha256sums.txt`.

Rules the verifier enforces:

* SHA-256 is recomputed from the bytes on disk; a mismatch is `FAIL`;
* no token, phone number, chat/user id, caption, object key, secret value or IP
  may appear (only `secret_names` may);
* `objects_after = 0` and `incomplete_after = 0` are required before
  `readback = NOT_FOUND`;
* an interrupted run is `INCOMPLETE`, never `PASS`;
* provider backups are reported as `PROVIDER_RETAINED` / `EXPIRED` / `UNKNOWN`.
  `UNKNOWN` blocks any claim that all provider copies were physically erased.

## Closure checklist (all required)

- [ ] every required register row `DELETED`; every conditional row has fresh
      `NOT_PROVISIONED` proof; no unregistered provider asset remains;
- [ ] media zero readback recorded **before** project deletion, backup retention
      stated without overclaim;
- [ ] demo project not found; production MoveHome and RAIA probes still healthy;
- [ ] old Telegram credential fails; WhatsApp/number disposition passes when it
      applies; webhook/subscription absence proved;
- [ ] Vercel has no demo domain; authoritative DNS has no demo CNAME; two
      resolvers `NXDOMAIN`;
- [ ] demo secret names, local temporary media and demo monitors absent; source
      and synthetic fixtures retained;
- [ ] evidence JSON validates, hashes match, no forbidden field, PA's independent
      re-verification is `PASS`.
