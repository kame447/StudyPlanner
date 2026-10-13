# Durable weekly-planning turns

Status: active, [Draft PR #637](https://github.com/kame447/StudyPlanner/pull/637); production activation is not authorized by this record.

## Ownership and source

- Implementation owner: `resume_durable_ai_turns` (resumed from `implement_resumable_ai_turns` at 2026-10-13 20:44 UTC), coordinated by the parent release owner.
- Current branch: `feat/durable-ai-turns-20261013`, including main `c1f10455323f7d1a4834a7ece18fd3eb073f8820`. The original export from `782f3559` is preserved as historical evidence.
- Scope: continue one complete accepted weekly-planning turn when the phone suspends the browser; recover the same result without resubmitting AI work. Approval and saving remain the existing client application responsibility.
- #305 owns Jev/semantic selection and #488 owns conversation behavior. Their current branches and PRs remain untouched. The C5 controller hook in this source is dormant; #616's forthcoming production adapter is an integration dependency, not permission to duplicate it.
- Viewport-return work is a separate owner.

## Execution choice

1. A dedicated per-owner/per-conversation SQLite Durable Object stores a bounded accepted turn and runs it from an alarm. This combines acceptance serialization, recovery records and retention in one new resource. An alarm has a 15-minute wall limit and at-least-once delivery.
2. A Queue would also outlive the browser, but would need a separate durable ownership/result store and duplicate-delivery fencing. It adds infrastructure without removing this responsibility.
3. Workflows provide durable steps but add another execution/checkpoint system and still need explicit ownership/result acceptance and provider-side uncertain-call handling.

Selected: the first option, with a strict finite execution deadline below the alarm limit. A new binding/migration is prepared only for isolated local validation. Production configuration stays unchanged until explicit resource approval.

Sources: [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [alarm delivery](https://developers.cloudflare.com/durable-objects/api/alarms/), [Queue limits](https://developers.cloudflare.com/queues/platform/limits/), [Workflow API](https://developers.cloudflare.com/workflows/build/workers-api/).

## Required invariants

- Firebase verification precedes every public acceptance/status/result operation. Client-supplied owner fields cannot grant authority. No bearer token or provider credential is persisted with a turn.
- One accepted input for each owner/conversation/request identity, bound to revision and payload fingerprint. Reconnect/status polling cannot start a new paid call.
- A durable dispatch journal records a call before dispatch and records its response before continuation. Replay uses the saved response. A crash leaving an uncertain in-flight call fails closed; it does not silently retry a potentially charged call.
- The same semantic, validation/repair, scheduling and rendering implementation is reused through invocation-local ports. No alternate parser, fixed reply templates, semantic policy or new AI retry loop.
- Commit once: terminal output is durable before it is exposed. Redelivery, restart, repeated result reads and lost acceptance responses return the same identity/result.
- Browser recovery checks owner/conversation/revision and preserves the manual approval/save boundary. Stale output cannot replace a newer conversation.
- Job input, dispatch responses and output are bounded and deleted on expiry; a bounded non-content guard prevents an expired request from becoming fresh work.

## Verified local behavior — 2026-10-13 21:14 UTC

- Durable job/storage: 24 failure-injection tests passed, including parallel journal writes, alarm redelivery, uncertain provider completion, commit-then-throw, lost acceptance, expiry and independent bounded SQLite values. Input <= 1 MiB, output <= 1.5 MiB, each stored value <= 1800 KiB; input/output/each dispatch are separate keys committed in one transaction, below the documented 2 MB SQLite row/string limit.
- Shared semantic/runtime/renderer regression: 61 tests; application/controller/gateway regression: 48 tests. Logic was moved into shared cores, not copied into a second semantic implementation.
- Real local workerd/SQLite alarm: POST completes, browser connection ends, semantic and renderer still run and the saved result is returned. Duplicate POST and repeated GET add zero provider calls. The synthetic provider is called twice. All outbound requests are intercepted; no paid model was used.
- Real DO RPC testing showed custom exception identity is not retained. Acceptance conflicts now cross RPC as a typed result; changed input returns HTTP 409 rather than HTTP 500.
- React application/controller/gateway integration: unmount during execution, finish server work, remount with GET-only recovery, exactly one assistant result, third reload retains it, and zero plan saves. This exposed and fixed a stale chat checkpoint overwriting the recovered result on the next reload.
- Existing source architecture tests now inspect the moved implementation while retaining their original invariants; 13 tests pass. The Worker bundle also rejects browser Firebase/config/transport/context-store dependencies.
- New admission counters are separately named from existing model-call counters. Actual dispatch goes through the existing authenticated proxy, including IP/owner quotas, model allowlist, payload/token limits, timeout and usage observation. Polling/replay never enter this boundary. Each dispatch timeout is capped by the remaining 14-minute execution deadline.
- Production frontend flag defaults off. Production Worker binding, migration and flag configuration are unchanged. No new resource or production activation is authorized here.

Evidence is retained in the sibling `ai-durable-turns-evidence-20261013` directory: `job-storage.log`, `core-refactor-focused.log`, `application-focused.log`, `architecture.log`, `sqlite-runtime-final.log`, and `reload-third.log`. These are local exact-scope checks, not a final combined release receipt.

## Remaining verification and exit

The first full run passed fresh types and 8092 tests but failed source-move architecture checks, one historical Git archive test (export had no Git history), two fingerprint checks (source changed during the run), and the reload regression subsequently fixed above. Do not count that run as release-ready.

Next: finish native browser acceptance on the combined branch, then the small live synthetic semantic/renderer check through the existing workflow below. Physical iPhone suspension/return remains unverified. The real-model path is not yet verified.

Exit requires a reviewed commit/PR, all applicable CI and browser gates on the combined source, and separate explicit approval before any production Durable Object binding/migration/resource activation. Main integration is owned by the release coordinator.

## Explicit cancellation and final local candidate — 2026-10-13 21:25 UTC

- Explicit Cancel sends an authenticated identity-bound DELETE; suspension, navigation and visibility events do not. A cancellation arriving before POST creates a bounded fence against delayed acceptance. An already sent provider request may finish, but later semantic repair/renderer dispatches stop. Offline cancellation is retained locally and never resumed as new work; it cannot stop remote work until delivery is acknowledged.
- Cancellation-focused checks: 6 files / 47 tests passed. The actual SQLite/DO RPC probe confirms a completed semantic+renderer turn (2 synthetic provider calls), then cancellation of one in-flight semantic request with no renderer (1 additional call). Polling/replay still add no calls.
- Browser cases are registered in Browser Regression (Chromium) and UI Regression Matrix mobile WebKit. The dedicated synthetic-auth harness preserves the real UI/controller/gateway and shared runtime. Physical iPhone suspension remains a separate unverified acceptance.
- Local implementation branch: `feat/durable-ai-turns-20261013`, based on main `814b086bb344bd57e3eae5c9838ed5bd417b6b68`. Fresh full verification and native CI follow this checkpoint.

### Minimal live-model check pending an existing workflow dispatch

Use the existing [Completion-Based Evaluation workflow](https://github.com/kame447/StudyPlanner/actions/workflows/weekly-planning-resumable-conversation-turn.yml) on `feat/durable-ai-turns-20261013` with:

- `execute_action`: true
- `action`: submit_turn
- `user_text`: 学習計画の相談をしたいです。
- `previous_run_id`: empty
- `conversation_id`: durable-turn-semantic-renderer-20261013
- `owner_id`: durable-turn-synthetic-20261013
- `week_start_date`: 2026-10-12
- `selected_date`: 2026-10-14

This is one synthetic utterance, using the workflow's existing secret and four-call ceiling. It verifies the extracted shared semantic/renderer implementation, not DO transport. The available connector cannot dispatch workflows; no new trigger or secret access was added. Existing checkpoint mode was rejected for this acceptance because its four broad multi-conversation observations allow up to 180 calls. No live model check has run for this candidate yet.

## Frozen full verification and current-main integration — 2026-10-13 21:31 UTC

- `72e73c892473b397fe8a420d811bed0e24933cd1`, tree `2dd55cfe9354f40a978b2d72edbe32c30abeddad`: fresh app/Worker types, 864 passing test files, 8175 passing tests (54 skipped, 1 todo), and production build all passed. Log: `verify-frozen.log`. Existing skip/todo tests are not counted as evidence.
- Latest main `c1f10455` was then merged cleanly. The only overlap was Playwright suite routing; both main's admin-harness exclusion and this branch's dedicated durable harness are preserved. Native CI and Chromium/mobile WebKit on the published combined tree remain required.
- `sqlite-cancel.log` records real SQLite/alarm/RPC disconnect, replay and explicit cancellation checks. `cancellation-final.log` records 47 focused tests. No physical iPhone or live-model run has been performed.


## Pre-publication cancellation race correction — 2026-10-13 21:37 UTC

Review of explicit cancellation exposed two additional short state transitions requiring serialization: claiming a queued job, and committing terminal success/failure. They now share the existing mutation boundary with acceptance/cancellation, rechecking owner, conversation, request, input revision, timestamp and fingerprint. Provider work remains outside the lock. Regression cases pause the actual claim and terminal storage read/write to prove cancellation cannot be overwritten and an old result/failure cannot corrupt the next accepted turn. The prior full result remains valid only for its earlier snapshot; final full/native gates must cover this correction.

## Published verification — 2026-10-13 21:58 UTC

- Published `c5e7d9893bae260cbacd98e3a046bed9d9cdf57e` and local `cc85121bba46f201743b503a99c3660d564fe54f` share tree `73eec5f7847fa844668ad1332dbca828895f2177`. GitHub ref/tree and all 81 uploaded blobs were read back. `publication.receipt.json` records exact identity.
- The frozen local full passed fresh types, 866 files / 8224 tests and production build. `verify-locked.receipt.json` records exit 0 and equal before/after source, executable installed dependencies, generated Worker types, lockfile and toolchain fingerprints. Vitest/Vite cache directories are explicitly excluded. The preceding raw cache-inclusive installed fingerprint mismatch is retained separately; it is not claimed as a matched receipt.
- [Native CI](https://github.com/kame447/StudyPlanner/actions/runs/38472647505) independently passed 8224 tests, fresh types/build and the actual SQLite/alarm/RPC probe. Synthetic disconnect/replay yields one result with two provider calls; explicit cancellation of an in-flight semantic call prevents a subsequent renderer dispatch. Actual SQLite round-trip also passed mixed Unicode input/output at the configured size bounds.
- Admin render, visual, desktop Chromium/Firefox/WebKit and browser-quality passed. Browser Regression and mobile WebKit are still running. Bundle-budget failed: same-toolchain main comparison has zero CSS increase and only 1556 raw / 465 gzip JavaScript bytes added by this branch. The inherited main budget failure remains a release gate; thresholds were not raised.
- Additional response-boundary regression proved that JSON null could be misclassified as a transport TypeError and poll again. Explicit object guards now reject null/scalar state and completion payloads immediately. Twelve focused client/reload tests passed; this final small correction still needs exact-source full/native verification.
- No real-model workflow or physical iPhone acceptance has run. Production Durable Object binding/migration/flags remain unchanged and require separate resource/cost approval.

### Native transport correction — 2026-10-13 22:03 UTC

The null-response correction passed a new frozen full at local `dc1fe643` (8225 tests, fresh types/build, matching before/after receipt). The initial native mobile run then finished with 249 successes and two durable-return failures before any POST. Its trace showed the real gateway and synthetic authentication loaded, and the UI had accepted the user message. Native fetch had been stored directly as a ports method, supplying the wrong receiver when called; the default port now forwards with a thin arrow function. A receiver regression failed before this change and all 13 client/reload checks pass afterward. The same browser fixture retains the real transport and records the browser's receiver behavior; native acceptance and exact-source full for this correction remain required.
