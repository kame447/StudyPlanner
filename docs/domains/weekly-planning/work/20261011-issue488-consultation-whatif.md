# Issue #488: bounded consultation and proposed-day evaluation

Status: local verification passed; unpublished; actual-model and App acceptance pending

- Owner: `extract_consultation_whatif`; branch `fix/issue488-consultation-whatif`.
- Base: `62579b32034850f18a75af759040cf1ce1e153e0` (tree `5cf9d5fbce604fc338a14eb665dbad2fd10479f3`).
- Protected source: Draft PR #563, `e901fa843371d6a313b77f007bcf274a88d96da5`.
- Scope: additive consultation meaning, bounded proposed-day parser, cloned compiled-input evaluation using the existing scheduler, typed feasibility evidence through the current result/renderer/trace contract.
- Excluded: general #246 AdviceProposal lifecycle, fixed response appenders, allocation display, preview-condition explanation, session ownership, all-day busy/free policy.
- Preflight: root verified all 13 open PRs at 19:49 UTC; no dedicated consultation PR. Local refs/worktrees contain no duplicate consultation owner. Existing #488 and original #563 are reused as provenance; no remote writes are authorized for this unit.
- Design alternatives: copying original commits would overwrite unrelated current owners; copying only pure owners would leave an unconnected feature; selected approach is the smallest complete typed closure into current owners. A changed API/ownership dependency that cannot fit that closure must be reported before expansion.
- Required controls: no accepted graph/input mutation; existing hard constraints and other tasks retained; current-turn quote and bounded dates required; malformed/unknown/multiple alternatives remain unevaluated; retained previews are not fresh feasibility evidence; consultation alone creates/saves no preview; valid independent planning deltas retain normal processing; proposed dates never authorize promotion of a different preview.
- Verification: the exact implementation snapshot `fe586f65ab7634b06e52e9bb6aaaa6a92d7dfd52` / tree `07bfbaadb0361ab8eea066e56232b433861bda2e` passed normal `npm run verify`: fresh app/Worker types, 7,043 tests across 801 files, and production build. The existing 10 skipped files, 45 skipped tests, and one todo remain unmeasured; no skip was added or relaxed. Focused/static, baseline and trace outbox/retry/Worker evidence are recorded below. Actual-model/UI evidence remains a separate gate; local verification is not evidence of shipped behavior.
- Next: obtain the separately authorized actual-model and App acceptance on the release candidate, including explicit Save/reload; reconcile any changed main base before publication. Root owns any publication decision after the remaining gates and current authorization are reconciled.


## Initial verification checkpoint

Initial implementation commit `fde9bc0d` / tree `733d4a3a` had no unstaged source differences. Main-base controls ran the two new integration/renderer suites without production changes: all 19 tests reached assertions and failed for absent consultation evidence/guards, with no import/setup failure. Candidate 18 whole suites ran 215 tests: 214 passed, one architecture audit rejected the two newly connected owners. Fresh types were not run after that failure.

The failure is a missing explicit architecture audit, not a runtime failure: the preserved source already permits both owners, and independent review verified that evaluation calls the current scheduler on a clone while communication consumes only the preview-result type. The corrective audit registers only those two importers and fixes their entire direct dependency sets plus the type-only runtime boundaries. No folder exclusion or general guard is relaxed. The failed run remains evidence for the initial snapshot; a new run is required for this content.

The tests establish bounded scripted semantics, cloned scheduling, unchanged accepted graph/retained preview, typed renderer evidence, explicit normal-planning adoption, and actual request/outbox/retry/Worker transport. They do not establish real-model meaning quality, free-text truthfulness beyond the finite claim contract, or App Save/reload acceptance. Those remain separate gates.

Audited snapshot `0c6702da` / tree `e2d2ffdc` passed all 217 tests in 18 whole suites. Fresh app types then identified three uses of `Array.at` in the new integration fixture, unsupported by the repository's existing target library. Worker types had not yet run. The fixture now uses equivalent indexed access; the TypeScript target/library and production code are unchanged. Re-run the changed whole suite and fresh app/Worker types on the corrected snapshot; retain the earlier 17 unchanged-suite proofs and all initial failures.

Independent source review accepted the audited dependency closure. Dedicated what-if rows for hard clock bounds, an unrelated task's fixed reservation, and timetable input have not been measured here; their same-input/clone forwarding is statically verified, and the ordinary scheduler tests/full gate remain necessary. Do not claim these as newly measured what-if acceptance.


Snapshot `c6aa60c0` / tree `cbef4e59` passed the changed 14-case integration suite and fresh app/Worker types. Source/dependency/cache checks were unchanged at each terminal boundary. The earlier 17 whole-suite proofs remain tied to their identical content; no full verification has run yet.

The final local candidate adds one captured pre-hypothesis I response (run 38157847619, semantic ordinal 1) as an immutable model-output/request-payload fixture, with SHA-256 provenance. The regression compares its original omitted field with an explicit-null variant at the same semantic response validator. This is compatibility replay of a historical actual response, not a new-model acceptance result. The original capture/request/envelope remains untouched. The canonical contract documents only this bounded read-only feature, separately from general Issue #246 advice lifecycle, and limits the promotion guard claim to its actual exact-label boundary.


Final-content attempt `659b9354` / tree `2d70b584` passed the captured-response whole suite (12/12) and full fresh app/Worker types. Its full suite reached 7,042 passes and one failure; build did not run. The sole failure was the existing meaning-policy inventory's exact historical phrase `does not recover semantic meaning`, changed during same-meaning compaction to `cannot recover omitted/guessed meaning`. The inventory assertion remains unchanged. Restore its explicit semantic-meaning phrase while retaining the omitted/guessed boundary; shorten only `unitLabel may preserve wording` to `unitLabel may keep wording` to stay within the unchanged 5,150-byte ceiling (new static size 5,148 bytes). A new focused inventory/budget check and full exact-content verification are required; the failed full attempt remains preserved.


## Final local verification

The ownership-wording snapshot `fe586f65` / tree `07bfbaad` passed the two changed inventory/prompt-budget whole suites (19/19), then the normal full verification on the same frozen source. Fresh app/Worker types, all 7,043 runnable tests in 801 files, and production build (6.72 seconds) succeeded. The process and wrapper terminated naturally with exit 0 at 2026-10-11 20:41:40 UTC. Before/after and phase-boundary source, dependency, installed-input and environment identities matched. Full receipt: `consultation-whatif-final-full-v2-verification/full-terminal-receipt.json`, SHA-256 `9054954691edf9edd32c87ff4c943ed94375ddf518c3284cfd5745ac1c227bd7`. Earlier assertion-red, architecture-audit, target-library, and historical-literal failures remain preserved at their original snapshots.

This work-checkpoint update is documentation-only after that exact-content run. It does not add actual-model, browser/App, Save/reload, or dedicated hard-clock/unrelated-fixed-reservation/timetable what-if evidence. Finite feasibility metadata and exact promotion-label validation do not guarantee the truth of arbitrary free text. The bounded clone evaluation and normal explicit-change/adoption path retain existing SSOT responsibilities; general #246 advice lifecycle and all-day busy/free policy remain outside this change.
