# Backend read-load evidence

All datasets are synthetic. The real scheduled Worker, phase services and REST client run with intercepted HTTP and fake OAuth/crypto. No native network fetch, production credentials, Firestore, AI or deployment was used. These are request/document observations at a mock transport boundary, not billing measurements.

- `before.json` / `after.json`: all 32 phase scenarios, source file hashes, installed esbuild/Node identity, document/missing/query counts, exact successful mutation hashes and modeled daily totals.
- `before.tsv` / `after.tsv`: concise scenario counts.
- `comparison.json`: 32 matching successful write/delete payload hashes and mock progress states. Transaction IDs are transport bookkeeping and are excluded from the payload hash. This does not establish real transaction or index behavior.
- `focused-tests.log`: 56 tests / 6 files passed. `snapshot-red.log` and `retention-red.log` preserve the preceding failing tests, rather than treating baseline failures as fixed behavior.
- `snapshot-review.md`, `snapshot-races.log`: independent snapshot race review and four additional executed cases.
- `review.md`, `retention-candidate-review.md`, `retention-candidate.log`: conservative retention design review; 33 actual-service/REST-client comparisons, four positive-gate races and three failure paths.
- `full-verification/`: final fresh full verification exit0, 6,163 passed / 45 skipped / 1 todo, production build and all eight budget guards; exact input/package manifests match before/after. `environment-notes.md` documents shared result-order cache and executor load. Focused results alone are not a full pass.

Public evidence omits ephemeral absolute checkout, runtime and measurement-output locations. `path-normalization.json` records the original and public file SHA-256 values and placeholder rules. The original evidence remains local. Source/package identities, versions, missing-package classification, measurements, assertions, outcomes and relative stack locations are preserved. Report `sourceFingerprint` values identify the original measurement inputs; the public serialization is identified separately in the normalization record.

Terminal logs first had trailing whitespace/blank lines normalized for repository checks, followed by the same path-only normalization. `log-normalization.json` retains the raw, intermediate and current SHA-256 values. No test output or outcome was removed and no new test run is claimed.

## Reproduction

Use an existing offline installation matching the repository lockfile. Set `BASE` to a read-only checkout of `22847120386987329e2f034d6062d59694ef1180` and `CANDIDATE` to this implementation checkout. Both checkouts must have their existing dependencies available. The script only writes to the explicit output directory and does not edit either checkout.

```sh
node docs/domains/product-observability/work/evidence/20261008-backend-idle-read-load/measure-backend-reads.mjs "$BASE" /tmp/backend-before
node docs/domains/product-observability/work/evidence/20261008-backend-idle-read-load/measure-backend-reads.mjs "$CANDIDATE" /tmp/backend-after --snapshot-fast-path --retention-gate
```

The harness derives its frozen synthetic helper from `traceWorker.scheduledSubrequestBudget.test.ts` and imports the actual Worker. It uses the same Cloudflare runtime stub as the normal unit suite. Expiry wire fields use `timestampValue`, matching the actual client encoder. The first input baseline was the clean client read-load branch `713852e4`; its Worker sources are byte-identical to the above main baseline.

The fixture intentionally models individual phases, not a stateful whole-project day. Rollup projection lookups are absent; snapshot commit results are counted but do not update the fixture's job store; enrichment aggregation count is the synthetic value 2. Use the separate stateful unit and independent-review fixtures for preservation of committed state, resumption and races. Empty and missing counts must not silently be converted into zero billable work, nor must missing-key billing be presented as measured here.

## Daily-model boundaries

Each phase runs once per five-minute cycle, 288 times per 24 hours. `idleDailyAssumingEveryRunStaysSteady` assumes clean snapshot controls, completed backfills and no events; `retained100DailyAssumingEveryRunStaysSteady` additionally assumes at least 100 retained, unexpired documents in each of the four retention collections. The cutoff does not pass these documents during the modeled day. Actual daily rollover, new events, actor-day rebuilds, backfill progress, conflicts, index-entry reads, aggregation billing and other application traffic are outside these steady scenarios.

`documentReadEquivalentExcludingMissing` adds returned documents and one per empty query. `documentReadEquivalentIfEveryMissingCostsOne` additionally assigns one equivalent per missing document key, explicitly as an assumption. OAuth and transaction begin/commit HTTP calls are not document reads. Explicit verify writes are counted separately and were zero in all 32 backend scenarios on both revisions. The empty rollup still writes its checkpoint once per run, or 288 modeled writes/day, unchanged.

Official references checked on 2026-10-08:

- [Firestore pricing](https://firebase.google.com/docs/firestore/pricing): empty-query minimum, document versus index-entry reads and aggregation charging. The model does not establish the deployed edition or query index scan cost.
- [Firestore quotas](https://firebase.google.com/docs/firestore/quotas): the eligible daily free allowance is 50,000 document reads; actual database eligibility was not checked.
- [REST authentication](https://firebase.google.com/docs/firestore/use-rest-api#authentication_and_authorization): service-account OAuth requests use IAM rather than client Security Rules. No permission changes are required by this patch.
- [Index ordering](https://firebase.google.com/docs/firestore/query-data/index-overview): limit-1 retains the existing field/name order. No new filter, index definition or type selection is introduced.
