# Provider fallback recovery regression

Status: active; local focused verification complete, draft publication/CI pending

- Owner: current maintenance task for existing Issue #344.
- Branch: `test/provider-fallback-recovery`; implementation base `ffeabd56bdd1827ba0d142b9ed7af368fd47aab6`. Publication base `7c8b566ccd379ee2e35e19a0b446eb006c027bad` has the identical tree `231d0ab11e99b8cd965bcea2857db5baab5f58af`; intervening temporary publisher cleanup left no content change.
- Existing Issues, current open PRs, provider/fallback/344 remote branches and local worktrees were checked. The prior Jev503 → Luna success path belongs to merged PR #419. No active implementation owner for the both-provider failure slice was found.
- Scope: deterministic real application → proxy client → real Worker → failed Jev/focused Luna → generic semantic fallback → state recovery tests. Preserve the existing preview/explicit-approval/save boundaries. No paid/live API use, provider deployment, #305 canary change, #488 normalization/clarification work, or new production abstraction.
- Approach: add an independent focused integration test file using fake external HTTP/auth/quota and memory persistence only. Keep client, Worker routing, normalizer, application, scheduler and approval production boundaries real.
- Verification targets: exact provider/fallback ordering and request/revision correlation; no durable plan writes before explicit approval; successful generic fallback; exhausted generic fallback preserves accepted graph/intake/preview and releases the pending turn; a later healthy turn recovers without duplicate writes. Classify any failure before considering production changes.
- Alternatives considered: duplicate the Worker-only fault matrix (does not establish application behavior), add cases to the already broad provider suite (couples fixture change), or an independent real-boundary slice (chosen). No test wording is used as semantic authority.
- Implemented three independent integration cases: both focused providers fail and generic semantics succeeds through preview/explicit approval; generic HTTP failure retains accepted state and allows a later healthy retry; generic repair exhaustion retains state, permits only the existing one repair, and later recovers.
- External fake boundaries are HTTP responses, authentication/quota bindings, best-effort telemetry acknowledgement and the existing memory approval repository. All semantic/application/provider-routing code is real. Unknown HTTP/schema requests fail the fixture and are asserted outside provider catch blocks; no paid or live calls occur.
- Scope limit: these cases do not establish model semantic accuracy, production canary behavior or the whole Issue #344 acceptance matrix. No trace field, prompt, schema or production output changed, so no new trace-persistence contract is introduced.
- Next: publish the bounded test-only draft and follow exact-head CI to terminal; the published full suite remains required. Any new merge/main change requires confirmation and is outside this task.

## Verified local evidence — 2026-10-07

- New test file: 3/3 passed. Together with the existing provider-boundary suite: 9/9 passed (3.85 seconds).
- Fault control: temporarily make the focused-provider exception route authorize directly instead of reaching generic semantics. The 6 existing cases still pass, while all 3 new cases fail on missing generic dispatch/unexpected preview promotion. This confirms distinct fault-detection value rather than duplicating Worker unit coverage.
- The production file was restored in a `finally` block and verified byte-identical: SHA-256 `8d6da04f3012faf7875aad65e0731d83ef3df19c99fdbe27b321bd555de5db10`. Restored combined focused run: 9/9 passed.
- Final development typecheck: exit 0 for app and Worker, including regenerated Worker runtime types. Wrangler's optional log path was placed under local artifacts to avoid the environment's missing home-log directory; no repository configuration changed.
- This patch adds only the independent `.test.tsx` file and this checkpoint. All tracked production, shared fixture, clock, runner, build and dependency inputs remain byte-identical to verified main `ffeabd56` / tree `231d0ab11e99b8cd965bcea2857db5baab5f58af`.
- The base's final verification at 19:42 UTC passed 5,924 unit/integration tests, fresh app/Worker types, build, Firestore rules and every applicable browser/visual/quality gate. Following the authorized batch cadence, that production evidence is reused with focused tests, fault controls, types and exact source/dependency provenance; no gratuitous full local rerun is claimed for the new test file. Its final full-suite result will come from exact-head CI.

## Environment and provenance

Node `v24.19.0`; 236 installed package manifests checked against the lockfile, zero missing/version mismatches. Identity manifest SHA-256: `85c98eb5deff89dc7cf342109bb9998b4feab01706579d592a9bb9e7067bd0e1`.

- Test SHA-256: `40a3566c8c14d6e7876527ebe609a607336ba88673194769e95d37d7989c41d7`
- `package.json`: `3d7fbfe21dc41203eb06fcbe65a516952eff70142f5a284346288107d59dc922`
- `package-lock.json`: `9798272985b44196122e7335b3ea8f18b9b7ffc8aa79047264008b7ce59198bf`
- Installed `.package-lock.json`: `593797f473dce774cc442224b802d76e641d1bf118f183785e45ef21e8667eb1`

Local evidence is under `artifacts/provider-fallback/`: `focused-restored.log`, `fault-injection.log`, `fault-injection.json`, `typecheck-final.log`, `provenance.json`, and `installed-identities.json`. The owning PR/Issue will hold the current published head and terminal CI receipt without inventing local full-suite results.
