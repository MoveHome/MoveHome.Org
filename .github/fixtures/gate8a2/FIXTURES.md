# Gate 8 A2 — merge-provenance fixtures

Spec: `estateaigents/raia` `03_technology/architecture/briefs/gate8-a2-merge-provenance-spec.md`.

`main` requires one approving review from a **code owner** (`@ftteh` or `@eugin-song`),
the approval must be pinned to the current head (`dismiss_stale_reviews_on_push` +
`require_last_push_approval`), and `unit`, `must-fail`, `Vercel` must be green.
`raia-one` holds role `write` but is not a code owner, so its approval cannot satisfy
the rule (the PR #122/#123 shape).

| # | Fixture | Expected |
|---|---|---|
| MUST-PASS | code-owner APPROVED on head `H`, checks green | merge allowed |
| F1 | no review, checks green | blocked — required approving review |
| F2 | approved on `H`, new commit `H+1` | approval dismissed, merge blocked |
| F3 | only `raia-one` approved | blocked — not a code owner |
| F4 | admin token, no human approval | blocked, `current_user_can_bypass: none` |
| F5 | approved but `must-fail` red | blocked — required status checks |

Rollback restores `/root/.hermes/state/ruleset-27368324-pre-gate8a2.json` via `PUT`
(`enforcement` stays `active`; never `disabled`).
