# Expo demo — Phase 3 precondition & T-0 gate (measured 2026-11-06)

Gate card: `t_ec4d4f8d` (PA, owner-side verification only). Parent plan `t_8a66570c`;
drill card `t_711a71e9`; owner actions `t_df133bfe`. No drill was run to produce this
document — that is the point of it.

**Measurement window:** 2026-11-06T22:44Z → 22:57Z, from host `gb-mnc-01`.
**Every value below was observed in that window. Nothing is carried over from a rehearsal.**

## 0. Verdict

| item | verdict |
| --- | --- |
| Precondition a — demo Supabase project | **FAIL — not provisioned** |
| Precondition b — `DEMO_SUPABASE_*` in host secrets | **FAIL — all absent** |
| Precondition c — `demo.movehome.org` live | **FAIL — NXDOMAIN** |
| T-0 monitor heartbeat line (B1) | **PARTIAL / UNVERIFIED** — host monitors beat, all four booth monitors (M1–M4) are unregistered or impossible today |
| Probe freeze for `t_711a71e9` (§3) | **FAIL — not frozen** |
| **Whole card** | **NOT DISPATCHABLE** — drills D1–D8 are BLOCKED, none may run, none may be simulated |

Blunt version: the demo host does not exist in DNS, the demo data plane does not exist,
and the drill card carries no frozen ACCEPTANCE block. Nothing in Phase 3 can produce a
truthful PASS today.

---

## 1. Preconditions

### a. Demo Supabase project — FAIL (not provisioned)

Evidence (read-only, no secret values printed):

```bash
# 1. no demo credential names anywhere in the host secret store
grep -rhoE '^DEMO_[A-Z0-9_]+' /root/.hermes/secrets /root/.hermes/.env
#   -> (no output)

# 2. the only Supabase project ref pinned on this host is production
grep -E 'project_id' /root/projects/movehome/supabase/config.toml
#   -> project_id = "movehome"      (prod ref vfnpmtqxrffppqajxxpb)

# 3. the demo Vercel project carries no demo data-plane env NAMES
cd /root/projects/movehome-worktrees/t_acc9b5e1 && vercel env ls production --scope move-home
#   -> move-home/movehome-demo: DEMO_MODE, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_SUPABASE_URL
#      (absent: DEMO_SUPABASE_URL, DEMO_SUPABASE_ANON_KEY, DEMO_SESSION_SECRET, DEMO_WRITE_ENABLED)
```

There is no `supabase` CLI and no `SUPABASE_ACCESS_TOKEN` on this host (`which supabase`
→ not found, `env | grep -c '^SUPABASE_ACCESS_TOKEN'` → 0), so `project ref / region /
created_at` cannot be read from the Supabase Management API at all. Not "unverified but
probably fine": every observable says the separate project ruled by R1 does not exist.

### b. `DEMO_SUPABASE_*` in host secrets — FAIL (absent)

Presence check only; no value, prefix or length is recorded here.

```bash
for k in DEMO_SUPABASE_URL DEMO_SUPABASE_ANON_KEY DEMO_SUPABASE_SERVICE_ROLE_KEY \
         DEMO_SESSION_SECRET DEMO_WRITE_ENABLED RLF_GEMINI_API_KEY; do
  printf '%-30s ' "$k"
  grep -rlE "^${k}=" /root/.hermes/secrets /root/.hermes/.env 2>/dev/null | wc -l
done
```

| key | required by | present in host secrets |
| --- | --- | --- |
| `DEMO_SUPABASE_URL` | all drills | **no** |
| `DEMO_SUPABASE_ANON_KEY` | TV realtime join, all drills | **no** |
| `DEMO_SUPABASE_SERVICE_ROLE_KEY` | revoke/seed fixtures (D2, D8), server-side fingerprint | **no** |
| `DEMO_SESSION_SECRET` | venue session tokens (D4) | **no** |
| `DEMO_WRITE_ENABLED` | kill-switch drill D5 | **no** |
| `RLF_GEMINI_API_KEY` | LLM blackout (D6), moderation timeout (D7) | **no** |

Consistent with the frozen conditional drills, which already refuse to run for exactly
these names (`t_35c3bbe7` / `t_1c4bb6ab` / `t_8f5a84f9` conditional drills → `rc=2`,
one SKIP line each, evidence: `t_2958b5ee_probe_freeze_evidence.txt` lines 41–44).

### c. `demo.movehome.org` CNAME — FAIL (NXDOMAIN)

```bash
dig demo.movehome.org +noall +comments | grep -E 'status|ANSWER'
#   -> status: NXDOMAIN, ANSWER: 0, AUTHORITY: movehome.org SOA pdns09.domaincontrol.com

curl -s -H 'accept: application/dns-json' \
  'https://cloudflare-dns.com/dns-query?name=demo.movehome.org&type=A'
#   -> {"Status":3, ...}                       (3 = NXDOMAIN, independent resolver)

# control: the zone itself is healthy
curl -s -H 'accept: application/dns-json' \
  'https://cloudflare-dns.com/dns-query?name=movehome.org&type=A'
#   -> {"Status":0, "Answer":[{"data":"76.76.21.21"}]}

# the probe's no-new-zone leg: authoritative parent, recursion cannot follow a CNAME
dig +short NS demo.movehome.org @pdns09.domaincontrol.com
#   -> (empty)  = no delegation, no record at all

curl -sS -o /dev/null -w '%{http_code}' https://demo.movehome.org/api/health
#   -> curl: (6) Could not resolve host        (http_code 000)

curl -sS -o /dev/null -w '%{http_code}' https://movehome-demo-czchvcy3t-move-home.vercel.app/api/health
#   -> 302   (Vercel Authentication wall: the pinned build is reachable only via the alias)
```

So the host probe's last leg (`demo-dns`) stays red and the alias has nowhere to point.
Fix is a registrar record in the existing zone, no NS change:

```
CNAME  demo  ->  b325cf8404325006.vercel-dns-016.com   TTL 600   @ GoDaddy, zone movehome.org
```

---

## 2. T-0 morning-of monitor line (B1 dormancy trap)

Rule applied: a monitor is GREEN only if a heartbeat for **that monitor** was observed
within the last 10 minutes at the moment of the check, and the timestamp + source are
recorded. An unregistered monitor is RED — it can never alarm. A verifier's opinion that
a monitor "should be running" is not a heartbeat.

Measured 2026-11-06T22:52:4xZ.

| monitor | last heartbeat (UTC) | source | age at check | verdict |
| --- | --- | --- | --- | --- |
| `monitor-deadman-check` (deadman, `*/15`) | 2026-11-06T22:45:02Z | `/root/.hermes/state/monitor-heartbeats/monitor-deadman-check.json` (`last_beat_epoch` 1794005102, pid 3211663) | 7m 40s | **GREEN — with a caveat, see note 1** |
| `mom-deadman` (monitor-of-monitors, `*/15`) | 2026-11-06T22:45:05Z | `.../mom-deadman.json` (pid 3211651) | 7m 37s | **GREEN as a heartbeat; reports 2 silent monitors → note 2** |
| `delivery-pulse-v2` tick (deadman, `*/3`) | 2026-11-06T22:50:17Z | `/var/lib/raia/delivery-pulse-v2/last-tick-epoch` = 1794005417 | 47s | **GREEN** |
| gateway / cron scheduler | 2026-11-06T22:52:18Z | `/root/.hermes/state/gateway.heartbeat` (`updated_at`) | 9s | **GREEN** |
| `cron` daemon | — | `systemctl is-active cron` → `active`; `/usr/sbin/cron -f -P` pid 512433 | — | **GREEN** (liveness, not a heartbeat) |
| `dispatch-deadman` sweep (`*/10`) | 2026-11-06T22:50:03Z | `/var/log/dispatch-deadman.log` → `ready=6 running=7 heartbeats_30m=172` | 2m 39s | **GREEN** |
| dispatch tick (`/var/lib/raia/.dispatch-tick-last-run`) | 2026-09-11T14:32Z (epoch 1789196528) | state file | 55 days | **DEAD BY DESIGN — never tick as green**: the cron line was disabled 2026-09-22 (`dispatch_in_gateway=true`). It is not a monitor any more; anything that greps this file for freshness measures a removed job. |
| **M1 external uptime on `demo.movehome.org/api/health`** | none | not in `monitor-registry.json`, no crontab entry, no external pinger configured on this host | — | **UNVERIFIED — NOT REGISTERED (RED by definition)** |
| **M2 TV reconciliation (`last verified Ns ago`, STALE banner)** | none | TV feed build (`t_35c3bbe7`) still running; nothing deployed | — | **UNVERIFIED** |
| **M3 demo Supabase `pg_cron` TTL job** | none | demo project does not exist (§1a) — the job has nowhere to run | — | **UNVERIFIED — IMPOSSIBLE TODAY** |
| **M4 alert path to BOTH phones** | host Telegram path alive (`raia-status-telegram.sh` `*/5`, `/var/log/raia-telegram.log` written 22:46:33Z) | crontab + log | ~6m | **UNVERIFIED** — "both phones" has no registered subscriber list; a host-wide log line is not a per-phone delivery receipt |

Notes that matter more than the ticks:

1. **`monitor-deadman-check` cannot satisfy the 10-minute rule all the time.** It runs
   `*/15`. Its beat is between 0 and 15 minutes old, so for roughly 5 minutes of every
   15 it is stale against the T-0 rule through no fault of its own. Either the T-0 line
   says "<=15 min for `*/15` monitors" or the cadence changes — do not paper over it by
   ticking on a lucky moment.
2. **Two wired host monitors are already dormant**, reported by the monitor-of-monitors
   (`/var/log/mom-deadman.log`, 2026-11-06T22:45Z):
   - `acceptance-gate-watch` — `no heartbeat artifact/process ever found` (episode wired
     1793915641);
   - `raia-filter-health-monitor` — `silent 122226s` (~34 h) `> 93600s` budget.
   Both are recorded **UNVERIFIED**, not green, even though the MOM sweep itself is
   healthy. Three more are wired-but-not-paged (`e3-budget-watcher`,
   `kill-criteria-watcher`, `weekly-model-eval`) — out of scope for the booth, listed so
   nobody mistakes `MOM ok=4/6` for "everything is fine".

Consequence for the T-0 sheet (`t_8368a620`): line 2 is **RED today on all four M-rows**.
The sheet already says an unregistered monitor is RED; this document is the evidence that
all four are unregistered.

---

## 3. Probe freeze for the drill card — FAIL, card NOT DISPATCHABLE

The drill card `t_711a71e9` (and its child `t_470cb1b2`, the rehearsal run) still carry
the placeholder block verbatim:

> `## ACCEPTANCE`
> `NOT YET FROZEN — PA freezes this block (criterion / evidence_cmd / expected / scope_paths / frozen_at + arm block) on card t_2958b5ee before dispatch.`

Freeze card `t_2958b5ee` is **done**, and it froze probes for the four Phase-2 build lanes
only (`t_35c3bbe7` TV, `t_8e16e607` Telegram, `t_1c4bb6ab` intent, `t_8f5a84f9`
consent/moderation, plus the `t_acc9b5e1` host leg). It did **not** freeze a drill probe.

```bash
bash /root/.hermes/scripts/verify/acceptance-gate.sh t_711a71e9
# -> FAIL t_711a71e9: ACCEPTANCE block missing field(s): criterion: evidence_cmd: expected:
#    rc=1

bash /root/.hermes/scripts/verify/acceptance-gate.sh t_470cb1b2
# -> FAIL t_470cb1b2: ACCEPTANCE block missing field(s): criterion: evidence_cmd: expected:
#    rc=1

ls -1 /root/.hermes/scripts/verify/probes/ | grep -E '711a71e9|470cb1b2'
# -> (no output)   no aggregate drill probe exists for either card
```

**Verdict: NOT DISPATCHABLE.** Per this card's own instruction, the gate stops here: no
drill was run, no partial run was attempted, and nothing downstream may treat Phase 3 as
green.

Honest note about this card itself: `t_ec4d4f8d` was dispatched carrying the same
"NOT YET FROZEN" ACCEPTANCE block it is here to check for on `t_711a71e9`. It was a
verification card, so it could run safely and produce this record — but the freeze gap is
systemic, not specific to the drill card.

---

## 4. Drill status — all BLOCKED, with the exact missing item

| # | drill | named detection / budget | status | exact missing item |
| --- | --- | --- | --- | --- |
| D1 | TV socket kill (venue-proxy idle timeout) | red STALE banner within threshold while `/api/health` 200 | **BLOCKED** | `demo.movehome.org` NXDOMAIN (§1c) **and** no demo project (§1a) — no live TV exists to kill |
| D2 | RLS/claim fan-out change excluding the TV anon JWT (M4) | reconciliation mismatch fires; no silent zero-subscriber delivery | **BLOCKED** | `DEMO_SUPABASE_SERVICE_ROLE_KEY` absent (§1b) — the claim/RLS fixture cannot be applied |
| D3 | Realtime reconnect after a drop | cursor backfill, zero lost, zero duplicate markers | **BLOCKED** | `DEMO_SUPABASE_URL` + `DEMO_SUPABASE_ANON_KEY` absent (§1b) — no Realtime endpoint |
| D4 | Webhook retry storm (Telegram) | replayed `update_id` → 1 row; 4th/10 min throttled; no venue token → 403, 0 rows | **BLOCKED** | `DEMO_SESSION_SECRET` absent and the webhook `/api/telegram/webhook` has no public host (§1b, §1c) |
| D5 | `DEMO_WRITE_ENABLED=false` kill switch, at deployment time | ingest 403, search + map stay 200 | **BLOCKED** | the flag is **absent** on `movehome-demo` production (§1a) — it cannot be flipped until it is first set, and that is a deployment-time change, not a drill |
| D6 | LLM blackout (`gemini-3.6-flash` disabled / 429) | deterministic fallback parser still pins and lists inside the latency budget | **BLOCKED** | `RLF_GEMINI_API_KEY` absent (§1b) and no live ingest path (§1a) |
| D7 | Moderation timeout (vision call times out) | publication BLOCKED, never published unmoderated | **BLOCKED** | `RLF_GEMINI_API_KEY` absent (§1b) — nothing to make time out |
| D8 | TTL retract | deletion <60 s; retract against a SEEDED row refused | **BLOCKED** | no demo project, hence no `pg_cron` TTL job and no seed fixtures (§1a) |

No drill is recorded as PASS. No drill is recorded as FAIL — none could run. The
distinction matters: BLOCKED means "the precondition does not exist", FAIL means "the
detection did not fire", and collapsing the two is how a booth ends up lying.

---

## 5. What unblocks this gate (ordered, owner actions first)

1. **Demo Supabase project** (`t_df133bfe` STEP 2) — project under the MoveHome CIC org,
   region eu-west-2; write `DEMO_SUPABASE_URL`, `DEMO_SUPABASE_ANON_KEY`,
   `DEMO_SUPABASE_SERVICE_ROLE_KEY` (and `DEMO_SESSION_SECRET`) to a mode-600 file under
   `/root/.hermes/secrets/raia/`, then say "demo project provisioned" on the card. Nothing
   else in Phase 3 can move first.
2. **Registrar CNAME** (`t_df133bfe` STEP 0/3) — `CNAME demo →
   b325cf8404325006.vercel-dns-016.com` in the existing `movehome.org` zone, TTL 600. Then
   re-pin and re-run the host probe; `demo-dns` is its only red leg.
3. **Freeze the drill ACCEPTANCE block** — an aggregate drill probe
   (`scripts/verify/probes/t_711a71e9_drill_probe.sh`) birth-verified both directions, with
   `criterion / evidence_cmd / expected / scope_paths / frozen_at` + arm block written into
   `t_711a71e9` (and `t_470cb1b2`). Until then both cards fail `acceptance-gate.sh` and must
   not be dispatched.
4. **Register M1–M4** — external uptime on `/api/health`, TV reconciliation freshness, the
   `pg_cron` TTL job, and a per-phone alert receipt. An unregistered monitor is RED on the
   T-0 sheet by definition; today that is the literal state of all four.

Re-run this document's commands (they are all read-only) the morning of 2026-11-10 before
declaring any precondition PASS; a status here is a status at 2026-11-06T22:57Z only.
