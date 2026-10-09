# Firestore logical read-load evidence

These files are observed results from real application/data hooks and real Firebase repository implementations, with a fail-closed synthetic Firestore SDK transport. They are **not server read counts or billing measurements**.

## Repeat

From the repository root with the lockfile's dependencies installed:

```sh
node scripts/performance/measure-firestore-read-load.mjs 22847120386987329e2f034d6062d59694ef1180 /tmp/firestore-read-load-measurement
```

The runner archives the exact base commit and copies the current candidate into isolated temporary directories before either test run. Both use the same fixture/harness. It does not check out a branch, load `.env`, connect a Firebase project, contact an AI service, or modify the source tree. Vite environment-file loading is disabled. Each run uses one worker. Explicit network and empty-query controls must pass. The temporary trees are removed; full source SHA-256 manifests and result/log JSON remain at the output path.

To run only the current focused harness:

```sh
node node_modules/vitest/vitest.mjs run --config scripts/performance/vitest.firestore-read-load.config.mjs
```

## Definitions and coverage

- `readCalls`: observed `getDocs`, `getDoc`, `getDocFromServer`, and transaction `.get` invocations. A query returning 3,200 documents is one call. `byOperation` and `byCollection` retain the breakdown.
- `returnedDocuments`: sum of document instances delivered to those logical calls. Concurrent duplicate calls may share one server request in the real SDK. Do not use this metric directly as billed reads.
- `missingDocumentCalls` and `emptyQueries`: calls that returned no document. They are separate from returned-document count; this is necessary for any later minimum-charge model. The synthetic transport does not implement billable empty-query minimums.
- `transactionAttempts` and `writtenDocuments`: observed transaction callback attempts and document mutations in this single-attempt mock. They do not predict contention retries or billing.
- Cold planner launch means a new repository migration gate after authentication. Warm launch means a fresh hook mount with the same repository. Cold reload recreates both after saves. Real SDK persistent caches are not simulated.
- Authentication/profile reads, natural-language catalog reads, telemetry, startup observers, index-entry reads, Rules-dependent reads, AI calls and background Worker/cron work are outside this measurement.
- Fixtures cover 24/240/2,400 plans, 8/80/800 month events, 12/120/1,200 actuals, historical dates, a still-active old daily series, an excluded occurrence, a cross-month multi-day event, a yearly event, all other hydrated collections, and a foreign-owner sentinel.
- K is 5. Each approval phase includes durable operation completion and its reads. The single approval runs after one manual save; K approval runs after that single approval. Reloads therefore include seven additional plans.
- Each of 39 before/after phases compares full normalized collection data, day/week-range recurrence projections, multi-day event projections and calendar navigation. Full persisted database digests also match for all three datasets, and both explicit refresh and cold reload preserve saved state. Plan comparison uses the application's existing `normalizePlanRecord` to reconcile optional defaults (`sourceId` absent versus null); undefined properties are omitted. No substantive plan values are excluded.

## Files

- `comparison.json`: all 39 comparisons, counts and equivalence assertions
- `before.json`, `after.json`: collection and operation breakdowns, fixture/data/projection/persistence digests
- `provenance.json`: base/head, frozen source hashes, exact relevant runtime and fixture/harness hashes, tool versions, command and full-manifest hash
- `before.log`, `after.log`: earlier-run terminal test evidence (5 tests each). The final frozen run's full logs are embedded under `provenance.json` → `currentRunLogs`; do not identify these older separate log files as the final run

The complete source manifest is regenerated as `inputs.json` by the command. The compact checked-in provenance includes its hash rather than duplicating hundreds of kilobytes of unrelated source filenames.

## Independent server check

The separate Emulator probe confirmed that cold concurrent schedule queries already deduplicate: old and new each deliver one server Listen target and N schedule documents. Thus the launch logical-call improvement alone is not evidence of reduced billed reads. The elimination of repeated post-approval collection reloads must be evaluated separately using the independent Emulator evidence and an explicit usage model.

Additional evidence is kept distinct:

- [Schedule/migration Emulator report](emulator-report.json): final 11-scenario security/transport probe
- [First-save baseline](emulator-approval-new-before.json) and [candidate](emulator-approval-new-after.json): an earlier matching harness snapshot, both blocked by the unchanged Rules and returning exit 2; these are not successful approval measurements or a claim of a final-harness rerun
- [Successful replay comparison](emulator-approval-replay-comparison.json), with [before](emulator-approval-replay-before.json) and [after](emulator-approval-replay-after.json): already-saved five-item replay with ordinary owner authorization and unchanged Rules
- [Conditional partial-cost model](cost-model.md), [exact values](cost-model.json) and [calculator](calculate-replay-costs.py): the separate cold-start plus replay scenario; never a conversion of mock totals or a whole-app billing upper bound
- [Browser capability probe](browser-probe.json): environment failure before app execution; no browser or visual pass
- [Final local full verification](full-verification/summary.json): fresh app/Worker checks, 6,204 passing tests, production build and all eight bundle budgets, with exact input/dependency manifests and scope
- [Isolated cross-feature manifest](cross-projection-manifest.json) and [57-test log](cross-projection-tests.log): an isolated Day/approval candidate, not a merge or a full/browser/Firestore integration pass

The [owning checkpoint](../../20261008-firestore-read-load-and-startup.md) records current integration status, unresolved boundaries and the separately tracked first-save Rules defect.
