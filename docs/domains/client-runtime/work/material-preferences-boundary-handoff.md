# Material preferences boundary

## Current repository status (2026-10-24)

[PR #812](https://github.com/kame447/StudyPlanner/pull/812) merged into `main` on 2026-10-23 UTC as `672c6622a2e0eda497b4a5662a13841c626309a0`. The merge is present in the inspected main snapshot `382fdff2a5ee98850aea2eb369eeaeee420d636d`.

The checkpoints below retain their original source, verification and authorization limits; their pending publication/merge statements are historical, not the current queue. This status correction claims no new test, device or deployment verification. Paths are retained; archive relocation and invariant transfer are outside this change.

## Preserved implementation and verification checkpoints

Status: PR #812 current-main integration verified locally; native CI pending
Updated: 2026-10-23
Branch: `refactor/material-persistence-boundary`
Base: `22e42203a4df82b5432d4290b7b5ea3a4246b8c9`
PR: https://github.com/kame447/StudyPlanner/pull/812

## Scope and decision

The material detail domain module combines activity/progress calculation with browser storage selection, persisted decoding and writes. Pure domain consumers transitively depend on the storage implementation. Separate the existing storage responsibility into a concrete repository facade, without introducing a generic service framework or another write path. UI keeps the same two-function read/save API. Domain types/defaults remain with the pure model.

Alternatives: extract a larger Bookshelf UI hook (more UI lifecycle risk, not needed for this boundary); change read/write failure behavior (separate defect/policy decision, excluded); isolate existing persistence responsibility (selected, directly verifiable through source dependency and original component/persistence contracts). A current active implementation of this same split or unchanged domain-to-storage imports would invalidate this choice.

Preflight: current open PR list, closed/open material-preferences PR and bookshelf-persistence issue searches, and material/bookshelf branches inspected. No active duplicate separation found. Existing material observation/readability branches and Issue805 are different scopes; do not change their tests or fixes. AGENTS architecture rules and client-runtime local storage/admission contracts reviewed. This auxiliary per-material preference store is not the canonical planner repository and must not be presented as a transaction or cross-client authority.

## Invariants and next action

Preserve owner-qualified v1 keys, serialized bytes, recursive read normalization/defaults, synchronous write acknowledgement, all existing error/SSR behavior and component flows. In particular, the existing read-side localStorage getter guard can throw before its try block; characterize but do not silently fix that behavior in a refactor. Keep the save-side denied getter returning false.

Next: characterize storage boundary on original code, move the persistence implementation, migrate both production consumers and test imports, add a pure-domain dependency guard, then run focused tests and types/build. Parent owns combined full verify/publication. No browser timing or assertions are changed. Completion requires exact diff, local tests, dependency boundary proof, and a reviewable local commit; no publication is authorized.

## Verified local candidate

- Existing key, decoding and read/write implementation preserved; repository now imports domain types/defaults, while domain activity/progress rules import no persistence facade. Only production UI import wiring changes. No second write path or storage migration introduced.
- Original six persistence cases retained at the repository owner, plus three characterization cases for missing storage, malformed/raw normalized bytes, getItem failure and the existing getter-denial asymmetry. Pre-refactor characterization: 9/9 pass. Post-extraction related component/domain cases: 59/59 pass. Final moved tests and narrow direct-source boundary guard: 10/10 pass. The source guard is not a full transitive import-graph proof.
- Independent domain review: no blocking findings; moved implementation and remaining domain/default functions compared with the base, production consumers contain only import changes.
- Final local `DEV_LAN_HOST=127.0.0.1 npm run verify`: exit 0. Fresh app/Worker types pass; 1,055 test files pass, 12 skipped; 10,532 tests pass, 67 skipped, 1 todo; production build passes with existing large-chunk warning. Skips are not new passing coverage. No lint command is configured.
- Verification input: base above plus the staged 13-file candidate; staged diff SHA256 `d38ef4894cf2485fd1b4e0a72fbce497dc241b6372415d0ee9a71e321bfbfdb8`. Only this documentation checkpoint changed after verification.
- Environment: Node24.19.0, Vitest3.2.7, Vite6.4.3, TypeScript5.9.3, Wrangler4.151.0. Final dependency installation checked against all242 installed manifest versions in lockfile (no required package missing), separate from the initial focused-only install using Wrangler4.151.1. Historical test fixture commit `070d25cbe14796aebb8168ac5425c93e3506df1c` fetched before full verification. Supported DEV_LAN_HOST overrides only dev URL discovery in the constrained shell, not test assertions or browser timing.
- Browser/native CI, publication and merge not performed. This is behavior-preserving storage responsibility separation, not a fix for Issue805's native frame delays or the existing read-denial asymmetry. Parent owns publication and applicable external gates.


## Current closure-readiness checkpoint (2026-10-23)

- Reused PR #812 and its remote branch `refactor/material-persistence-boundary`; remote head `580ca45cb2ca2cba26eb4c5f0a91b67f63ae6e67`. No new remote branch/PR, publication, CI trigger, merge, or deletion. Current-main integration parent is `2ea267f41ba62c154ac83c260e19ad1fff4578a1`.
- Fresh PR metadata, comments, review threads and actual diff inspected. No unresolved review threads or new human ownership claim; the PR has 13 changed files and preserves the original extraction. Only merge conflict was the client-runtime domain index: retain both the material-preferences link and main's mobile-retry link. No production implementation adjustment was needed.
- Current native Browser Regression run 39848133871 has shard 2 success and shard 1 cancelled. Aggregate job 120084118094 fails because `SHARD_RESULT=cancelled`; shard 1 job 120066803651 reports cancellation after test 450, with no observed assertion failure. This is missing Chromium acceptance, not proof of an inventory defect or success.
- UI Regression Matrix run 39848133872 fails three WebKit-mobile 1920x1080 material long-text cases: save/reload at 100%, cancel at 200%, save/reload at 200%, each exceeding 30s. Current main already contains the exact three-case 60s functional-budget decision; it is retained unchanged, not a rendering-performance fix. Exact integrated native rerun is still required.
- Bundle job 120066801885 reports JavaScript totalGzip 695.2 KiB greater than 695.2 KiB (rounded log values). Current main's fixed reviewed baseline/growth policy is retained. A new build and gate on the integrated tree remain required; source policy inspection does not prove a new green build.
- Local focused command: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/lib/bookshelfMaterialDetails.boundary.test.ts src/lib/bookshelfMaterialDetails.test.ts src/repositories/materialDetailPreferencesRepository.test.ts src/components/BookshelfDialogs.test.tsx src/components/BookshelfView.nestedStructure.test.tsx src/components/BookshelfView.structureEditor.test.tsx src/components/BookshelfView.structurePersistence.test.tsx`. Exit 0: 7 files / 36 tests passed. Node 24.19.0 and Vitest 3.2.7; existing sibling dependency installation reused read-only through a node_modules symlink. No dependency-install or final aggregate proof is claimed.
- PR #845's separate Month changes are not needed to address these observed failures and were not imported. Next integration owner action: exact-content review, dependency identity check and full `npm run verify`, then authorized publication/native gates. Full suite/build and native reruns were deliberately not launched in this scoped local preparation. Completion is not claimed.

## Minimal merge continuation (2026-10-23)

- Existing PR/branch resumed under explicit merge authorization. Current base `355b870a07dc06360f4f3b5418b150629a6dfad1` merged without conflicts; integration HEAD `1a0a7dd06ef5ea883e40cadbe48c95aa23428bad`, tree `e5826a5cd5418cd4d8678f9ea74d26746ecb1b30`. No new feature, PR or branch. Historical authorization/status statements above describe earlier checkpoints.
- Original extraction retained. Persistence function bodies and remaining pure domain are byte-identical to the corresponding current-main code; component changes remain imports only. No unresolved review threads.
- Focused seven files / 36 tests pass. Final `DEV_LAN_HOST=127.0.0.1 CLOUDFLARE_CF_FETCH_ENABLED=false npm run verify` exits 0: fresh app/Worker types, 1,072 files and 11,225 tests pass; 12 files/67 tests skipped and one todo; production build 15.67s. No lint script configured. Only this documentation checkpoint changes afterward.
- Node 22.23.4; shared fresh dependency installation from the month-budget integration, with all 242 installed locked manifest versions matching and no missing required package. Lock SHA256 `01cc6c380a2797653d6e9a9dca8e5afe835a2278cb990d21dc6b220ca8aa466f`; installed lock SHA256 `e39a9cc4979b9c10b158be8d619db1c52645b8844b74016152d4514ff6241997`. No tracked/generated source drift after verification; untracked `.cache/` is tooling output and excluded.
- Next: normal non-force publication to this existing branch, exact-head native CI, serialized merge and post-merge verification. Old failed/cancelled native results are not reused as acceptance.
