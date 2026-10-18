# Existing linked-Actual write read

Status: active, locally verified and independently source-reviewed; publication pending
Issue: #542 (read-load umbrella); no new Issue or PR
Branch: `perf/actual-existing-write-read`
Base: `522004730f57f726c95b25c412cdaba672128bc3`

## Finding and bounded change

A linked Actual save enumerated matching occurrences, then queried the resolved target ID again merely to decide whether to read it transactionally. For an already enumerated target this duplicated existence evidence. If that target disappeared between the two queries, the old path treated it as new and could recreate it without a transactional reread.

Reuse only the existence of the same owner-qualified resolved target in this save attempt's occurrence query. Keep the transaction reread, duplicate resolution/deletion checks, provenance handling and atomic material update. A disappeared or now-foreign target is rejected by the unchanged owner-only Rules during that reread. No cached/preparation rows are reused, no time window is truncated, and no query shape/index/Rules/schema is added.

New, standalone, changed-occurrence and legacy date-only targets still use the owner-qualified ID-range lookup. Missing stored ID is resolved from document identity. Same-Plan history normalization and the previously rejected date-only narrowing remain unchanged.

## Decision

Compared three choices: retain the redundant query; borrow preparation/cache rows (rejected because their older scope and identity may differ); use only this save query's selected target and reread it transactionally. The third has the narrowest verifiable boundary. The race change is intentional fail-closed behavior, not claimed byte-for-byte equivalence for all concurrent writes.

## Verification on this local snapshot

- Baseline: added cases on unchanged main produced 8 failures and 30 passes. Six failures detect redundant existence queries (ordinary/material saves, canonical winner and missing stored ID); two detect deleted-target recreation.
- Candidate: 149 tests passed across four directly related repository files: `firebaseActualProgressSourceSave.test.ts` (42), `firebasePlannerRepository.actualWriteReads.test.ts`, `firebaseActualSourceReads.test.ts`, `firebaseActualSourcePreservation.test.ts`. Existing ordinary/material provenance, source deletion/relink, history receipt and duplicate checks are retained.
- Fresh nonincremental app typecheck passed. The first typecheck's exit receipt was lost by its output wrapper; one subsequent run durably recorded exit 0. No full suite, browser or production experiment.
- Measurements retain 1,000 irrelevant historical rows in each case. Existing linked ID and canonical duplicate winner: SDK queries **2 → 1**, returned documents **2 → 1**, transaction reads **1 → 1**, for both save APIs. New linked remains 2/0/0; new standalone 1/0/0; existing standalone 1/1/1; changed occurrence 2/1/1 (queries/returned/transaction reads).

These are synthetic SDK operation counts through the real repository, not production billed reads, latency or cost measurements. Rules behavior is modeled, not freshly Emulator-verified. Missing/foreign target rejection depends on the current owner-only Web SDK Rules; admin/backend bypass or a future Rules change allowing missing-document reads is outside this guarantee. The test command also named a nonexistent `repositoryUtils.test.ts`; it collected only the four files listed above, not five.

## Remaining boundaries and next action

Independent source review found no blocker on the frozen runtime/tests (receipt SHA `4ec00d89c960dd3d7591f83336bd1c464489a5419e5b8374b104b7fe55f6b86a`). Any approved publication/integration checks remain. No local production build was run for this repository-only change; integration owner owns the combined build. Same-ID delete/recreate, concurrent writes after enumeration, stale editors and cross-client conflicts are not solved by a revision/CAS protocol here. Callback completion and SDK-enqueued commits are not cancelled. This does not replace the old-client recurrence fence design.

The existing whole-history/source preparation and new-ID ID-range paths are untouched. Historical/canonical/local adapter data formats and auth ownership rules stay intact. Stop at a reviewed local candidate until publication is separately approved.
