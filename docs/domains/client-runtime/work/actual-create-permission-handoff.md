# Actual first-save permission failure

Status: approved publication and integration verification. Current base: `da462379b2ef57d5028762da36a11e8976b5d9b6`. Branch: `fix/actual-create-permission`. Refs #437; limited to the new-Actual existence-query permission failure. This change does not close the broader Issue #437 or authorize production data changes.

## Evidence and decision

The reported Day-view major-event record has a valid date, a positive same-day time range, and an optional empty memo. Regression fixtures use synthetic event names, dates and times. The observed error is `permission-denied`, not editor validation. Existing related PRs #673/#683 are merged; publication owner checked current Issues/PRs and found no active owner for this exact failure. Publication preflight on 2026-10-16 11:08 UTC found no competing active Issue/PR or remote branch for this limited bug; existing Issue #437 remains the related umbrella. Previous source-preservation work is not reopened as a competing branch.

Compared hypotheses:

1. Major-event/recurrence/source schema rejected by Rules. Current Actual Rules validate only owner identity; this hypothesis is contradicted by successful direct creation of the same sample payload.
2. New-record existence query is rejected before creation. Confirmed by Firebase SDK 12.12.0 + official Firestore Emulator 1.22.0 with exact current Rules: owner + `documentId() == missingId` fails at Actual list rule; a full owner query and an inclusive equal-bound ID range return empty; direct owner transaction create and existing-ID edit succeed.
3. Deployed Rules/version mismatch or owner/session mismatch. Historical production Rules read-back hashes match current source; no live user-session credential/payload evidence is available. These remain possible additional incidents but are not needed to reproduce this defect.

Preferred correction: retain owner predicate and document identity, use an inclusive ID range whose lower/upper bounds are the same exact ID. Do not weaken Rules, query stored `id` (legacy rows may omit it), or read all owner's records unnecessarily. Confirm foreign-owner lookup/write isolation and real repository first-save, edit, dedupe, unlink, and no-stored-id preservation.

## Checkpoint

- Reproduction artifact: `/workspace/shared/laplans-actual-save-permission-evidence-20261016/query-probe-server.jsonl` (local-only evidence; source base above).
- Emulator JAR SHA-256: `9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c`; Rules SHA-256: `1842acb385effb9996f8d214ae2d237b5bf32a0184a0e6ac07dbaee3629a0c28`.
- First separate-process attempt was unreachable and is not evidence; the decisive probe runs server/client together and requires server reads.
- Applied the minimal client-only range query; no Rules/index change.
- Corrected emulator suite: before fix, 4 creation failures / 4 passes; after fix, 8/8 pass. Covers both Actual APIs, canonical single/weekly major-event saves, edit/occurrence-ID reuse/unlink, missing stored-id rows, foreign-ID collision, wrong-owner query, and unauthenticated denial.
- Existing mock preservation suite gained the actual missing equality-target behavior and deleted-after-enumeration cases. Initial focused 5 files / 128 tests passed; the two added deletion-race cases also passed in the full suite.
- Full Auth/Firestore Rules regression plus the new repository suite passed with terminal exit 0 using Firebase CLI 15.33.0 / Emulator 1.22.0. Initial wrapper exit 2 was its read-only home update-config write after inner success; isolated writable XDG_CONFIG_HOME corrected the runner without changing tests.
- First full verify: non-incremental app/Worker typechecks passed; 9397 tests passed, 1 failed, 62 skipped, 1 todo. The failure was the existing C5 exact-byte sentinel under the machine's implicit Asia/Tokyo timezone. Its 69 tests pass unchanged under explicit TZ=UTC. The subsequent initial-stage full verification used the repository's recorded UTC convention and passed; no assertion or runtime semantics changed.
- Next: publication owner refreshes main/PR state, publishes this approved fix, waits for required exact-head CI, and verifies main deployment before calling the production bug fixed.
- Exit criteria: approved fix integrated on latest main; final combined verification and independent review pass; required CI and deployed assets are verified. Actual iPhone production behavior remains a separate validation boundary.

## Safety and verification limits

Owner predicates and all create/update/delete Rules are unchanged. A positively enumerated record disappearing before the transaction still aborts; a foreign-ID collision cannot be overwritten. Existing same-owner concurrent creation/merge and cross-client observation limitations are unchanged. The interval returns only its exact ID, including older documents missing the redundant stored id field. This is an implementation/Rules emulator proof, not a live iPhone test or a new production Rules read-back.

Independent review found no blocker in the range/query security boundary or real-repository matrix. Empty-preflight same-owner/same-ID concurrent creation remains the existing blind-merge/returned-provenance limitation; this repair does not introduce a global uniqueness guarantee.

## Initial local verification receipt

Initial checked code/test/package content was based on `56a8e52212b72074e99f092d91b1bef488bc365f` plus the six-file repair diff. Subsequent checkpoint/index documentation edits do not change verified runtime inputs.

- `TZ=UTC DEV_LAN_HOST=127.0.0.1 XDG_CONFIG_HOME=<isolated writable config> WRANGLER_SEND_METRICS=false CLOUDFLARE_CF_FETCH_ENABLED=false npm run verify`: exit 0; fresh app/Worker typechecks, 984 test files passed / 12 skipped; 9,398 tests passed / 62 skipped / 1 todo; production build succeeded. Emulator-gated tests are intentionally skipped here and executed separately below.
- Existing Firebase CLI Auth/Firestore Rules regression command, followed inside the same emulator session by `node node_modules/vitest/vitest.mjs --config vite.config.mjs run tests/firestore/actualSavePermissions.emulator.test.ts`: exit 0; existing Rules checks plus new 8/8 repository cases passed.
- `git diff --check`: clean.
- Node 24.19.0; Firebase 12.12.0; Vitest 3.2.7; Firebase CLI 15.33.0; Java 21.0.12.1; Firestore Emulator 1.22.0. Installed dependency-manifest fingerprint: `59f015de95f3fb4d90e686ddc72e76e5679a1e0df40e4d07c0267ee12c23a5bd` (362 manifests). Lockfile SHA-256: `af5b37bbcc990a528621a18f545142430f8b9506460dde03f3f9be80fbb4b9ab`.
- Exact SHA-256: production adapter `9ac3bec1725b61117b7ffdb83ad41ef82cd38676cfe4ba5c469f34be280827c3`; mock regression `d81231dd49358129bcb607c54f023617448a5140ac59ba5e8e9196a184dd9e25`; real emulator regression `4ec9c5b0225632919bd55fba36e74172bd9b9ce9ec56e612e0fb1c0489858d61`; package scripts `f5fbd83b423801f9a55a21b5632118a17e96777fb9e2f0e436a585f16a3ad97a`.
- Logs and dependency identity are held in `/workspace/shared/laplans-actual-save-permission-evidence-20261016/`: `before-unit.log`, `before-real-repository.log`, `after-real-repository.log`, `final-rules-isolated-config.log`, `final-verify-utc.log`, `dependency-identity.json`.
- Rules and indices remain byte-identical to base. The initial repair stage performed no external Issue/PR/write, production database write, or Codex task. Publication is now approved and owned by the publication coordinator; native iPhone/production acceptance remains separate.

## Approved latest-main integration (2026-10-16)

Current main was re-read by the publication owner as `da462379b2ef57d5028762da36a11e8976b5d9b6` / tree `f2218050f6950e20fa847c2d4df31f6fab002de8`. Only the six-file Actual repair from `cab103a276883a70c2bf07107a583745a3198457` is applied on top. The intervening #711 change touches seven Worker OCR model/observability files and is preserved byte-for-byte; it has no overlap with Actual persistence, Rules, auth principal resolution, or transaction semantics.

The original Actual production/mock/package hashes, Rules/index hashes, lockfile, and all 362 installed package manifests match the initial verified inputs. Before publication, the real Emulator test fixtures were anonymized with a synthetic event title and date/time values while preserving the Thursday/weekly relationship and 210-minute same-day duration; the initial original-fixture hash is historical evidence only. The prior full Rules regression is reusable for that identical boundary. Because the overall integration tree has changed, one final combined `npm run verify` and a short real-repository Emulator rerun are required on this current snapshot. No second worker repeats those checks. The first integration verification was interrupted before completion to anonymize those fixtures; it is not a final pass. Final anonymized-content verification is complete:

- `TZ=UTC DEV_LAN_HOST=127.0.0.1 XDG_CONFIG_HOME=<isolated writable config> WRANGLER_SEND_METRICS=false CLOUDFLARE_CF_FETCH_ENABLED=false npm run verify`: exit 0; fresh app/Worker typechecks, 984 files passed / 12 skipped, 9,399 tests passed / 62 skipped / 1 todo, and production build passed.
- The actual Firebase SDK/repository suite was rerun against the current worktree's Rules with the anonymized fixtures: 8/8 passed, exit 0. The separate prior full Auth/Firestore Rules regression is reused only because its source scripts, Rules/index inputs, Firebase/CLI/Emulator versions, and installed dependencies are unchanged.
- Independent review confirmed the original query/owner/transaction boundary and the anonymized fixtures' semantic equivalence; no blocking findings.
- New real-emulator fixture SHA-256: `65218feccbbfaf12fb10a45e048a69ec9abc6e4bfef823ba909ef430cceacf11`. Production/mock/package hashes remain as recorded in the initial receipt. Full installed-package fingerprint remains `59f015de95f3fb4d90e686ddc72e76e5679a1e0df40e4d07c0267ee12c23a5bd`.
- Exact current-main Worker files, Rules, indexes, and lockfile are unchanged by this patch. `git diff --check` passed.
- Current logs: `/workspace/shared/laplans-actual-save-permission-evidence-20261016/publication/final-anonymized-verify.log` and `final-anonymized-real-repository.log`. Final commit/tree/file manifest is recorded in the same directory's `verification-receipt.json` after the documentation-only checkpoint is committed.
- Remaining release gates: publish the approved branch/PR, exact-head CI, main integration, deployed-asset verification. No claim of physical-iPhone production validation.
