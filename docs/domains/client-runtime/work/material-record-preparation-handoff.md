# Material record preparation

Status: verified local candidate; no publication
Branch: refactor/material-record-preparation
Base: 22e42203a4df82b5432d4290b7b5ea3a4246b8c9

## Boundary and decision

Separate pure material record preparation from the planner hook's authorization,
immutable edit evidence, admission, ID/time acquisition, persistence and notices.
The factory receives the admitted subject/current record and explicit owner/ID/time.
Keep serialization, fallback rules and all existing numeric behavior unchanged,
including a negative current unit when the total is absent.

Alternatives: keeping preparation inline preserves behavior but retains mixed
responsibilities; moving the whole save command would also move admission and
lifetime policy and is unnecessarily risky; extract only pure preparation (chosen).
Existing material admission regressions remain the integration oracle. No new
repository/service framework, transaction changes or performance claims.

Preflight: current main is the base above; searches for saveStudyMaterial and
material factory found no matching active implementation. Existing material
branches concern timer readability and WPE diagnostics, not this scope. The
concurrent schedule projection owner explicitly reserves separate functions;
this unit changes only saveStudyMaterial record preparation in the shared hook.

## Verification and next step

First characterize the existing hook output, then extract the same expressions
and run pure plus retained admission regressions. Independent review and final
integration verification are required before publication. No public writes.

## Focused checkpoint

Original hook with two new characterization tests: 91/91 pass before extraction.
After extraction: pure factory 16, material admission 91, actual admission 32,
subject read recovery 30 (169/169 total) pass. Fresh app typecheck passes.
Original preparation expressions are identical after removing indentation and
changing the local result binding to return. The hook retains name validation,
subject/baseline admission, projection lease, ID generation, claim acquisition,
time capture, repository dispatch, publication and notices in their original order.

Full verify/build completed successfully on the exact runtime snapshot below.
No browser/CI/publication was performed. No UI rendering or storage schema changed.

## Final local verification

Verified runtime HEAD: `3f1363120de5def03b713418f4aa430206b3cbcf`
Tree: `c49ce418fd43c7736152f5dc4e60f4e32278ee67`
Independent review: pass; normalized extraction matches original expressions and
hook policy ordering is unchanged. `npm run verify` exit 0: fresh app/Worker
typechecks, 1,055 test files and 10,546 tests passed (12 files / 67 tests skipped,
1 todo), production build passed in 14.52 seconds. Existing >500 kB chunk warning
remains; no bundle threshold or test assertions were weakened.

Node 24.19.0, Vitest 3.2.7, TypeScript 5.9.3, Vite 6.4.3, Wrangler 4.151.0.
All 242 installed manifests matched the lock, no required packages missing.
Lock SHA-256: `ea546daa78b887f737da4cfb1884b8f14f7b39ce4baa639e7baa04d5bfb6c693`.
Installed lock SHA-256: `8723ba5cfaf3e7aee4f8490dc7bb2edd56aedda4035944664531204a5d03b000`.
Historical fixture commit `070d25cbe14796aebb8168ac5425c93e3506df1c` was present.
Verification used DEV_LAN_HOST=127.0.0.1, DO_NOT_TRACK=1 and Wrangler telemetry,
error reporting, CF fetch and skills-update prompts disabled. No runner/config,
dependency, assertion, CI or application behavior changes were needed.

This final update changes documentation only. Integration/publication remains
owned by the parent; this candidate is not merged and browser/CI was not run.

## Authorized merge continuation (2026-10-23)

- Reused existing PR #813 and branch under the user's explicit merge authorization. Earlier no-publication/no-merge statements above describe historical scope only. Remote head `ef98a57837de09a543cbe54fcb7c4d7df29d2506` and current-main `672c6622a2e0eda497b4a5662a13841c626309a0` inspected; no competing record-preparation implementation or unresolved review threads found. Integration HEAD `98536efca7e0158d094985c4ed13aef7d0ce2131`, tree `cf96b567029703565e838bded7040aafab4445a5`.
- Current main's #812 auxiliary material-preference persistence separation is independent of this admitted canonical-record preparation. Production merge is clean; the sole conflict is the domain index, resolved by retaining all links. The original preparation expressions exactly match current main after whitespace/result-binding normalization. Admission, identity/time acquisition, persistence, projection publication and failure settlement remain in their original order.
- Focused four-file command covers pure preparation, material admission, Actual admission and subject read recovery: 169/169 tests pass, exit 0. No timeout/assertion/configuration changes. Exact six-file PR scope retained.
- Node 22.23.4; shared installation checked against lock: all 242 installed manifest versions match, no required package missing. Lock SHA256 `01cc6c380a2797653d6e9a9dca8e5afe835a2278cb990d21dc6b220ca8aa466f`; installed lock SHA256 `e39a9cc4979b9c10b158be8d619db1c52645b8844b74016152d4514ff6241997`.
- Next: final serialized integration verification, normal non-force existing-branch publication, exact-head native gates, serialized merge and post-merge readback. Historical failed/cancelled CI is not acceptance. No new Issue/PR/remote branch or deletion.
- Final `DEV_LAN_HOST=127.0.0.1 CLOUDFLARE_CF_FETCH_ENABLED=false WRANGLER_SEND_METRICS=false DO_NOT_TRACK=1 npm run verify` exits 0 on the integration runtime above: fresh non-incremental app/Worker types, 1,073 files / 11,243 tests pass, 12 files / 67 tests skipped and one todo; production build 16.69s. Existing large-chunk warning remains. No lint script configured. Independent bounded review found no blocker. Only this checkpoint documentation differs from verified runtime; no tracked generated-source drift.
