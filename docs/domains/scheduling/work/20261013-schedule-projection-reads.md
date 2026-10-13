# Narrow canonical schedule projection reads

Status: locally verified candidate under Issue #542; not published

## Ownership and base

- Branch: `perf/schedule-projection-reads`; no remote branch or PR created.
- Local base: `d0b030b047e1667e4695ed6f8b50c7bf5b13faa1`.
- Verified GitHub main: `84b69b9b6a0810071e530509c5230fcc4a81d6bf`.
- Both base trees: `032bf1e5f4924e6e3cf58a447b1f35d0ad8e4749`; local and GitHub commit identities are different.
- Checked current Issue #542 comments, open/closed related PRs, and both pages of branches. Previous startup snapshot sharing (#546) is already present. No active work owns this narrow query change. Navigation lifetime and startup diagnostics are separate work.

## Scope and alternatives

1. Startup dual schedule fetch: already resolved by the combined snapshot; do not duplicate it.
2. Listener/bootstrap reuse: fewer documents, but higher freshness/authorization risk; do not change it here.
3. Narrow schedule projection: each getter currently fetches all of an owner's canonical events, then discards the other legacy provenance kind. Apply the existing projection predicate to the query, retaining owner scope and every date. This is the selected bounded improvement.

These getters are reached by targeted recovery after overlapping reads/writes, not every ordinary save or navigation. Real invocation frequency is unknown. Startup, full refresh and union repair continue using the complete snapshot, so this work must not claim to reduce their reads.

## Safety boundary

- Filter by `provenance.legacy.kind`, never `kind`, category, date, or current visibility. Non-study Plans must remain Plans.
- Canonical writers/migration and Firestore Rules require the provenance field. Raw legacy collections remain migration inputs; compatibility fallback stays untouched.
- Compare query/result document counts and projection contents on the same synthetic history; distinguish mock returned documents from actual billed reads.
- Cover old/future, recurring/excluded/multi-day rows, colliding legacy IDs, owner separation, external edits, save/delete/reload, permission errors, migration and fallback.
- Preserve full-snapshot reads and existing read-authority/reconciliation tests.
- No remote publication or production writes are authorized.

## Measured result

The same synthetic owner has 1,000 historical Plans and 20 MonthEvents. The SDK-boundary mock executes the actual query predicates and counts returned document IDs; it does not measure billing, network traffic, or production frequency.

| Operation | Baseline returned documents | Candidate returned documents |
| --- | ---: | ---: |
| MonthEvent-only query | 1,020 | 20 |
| Plan-only query | 1,020 | 1,000 |
| Complete schedule snapshot | 1,020 | 1,020 |
| Real hook recovery after MonthEvent save overlaps accepted full refresh | 1,020 | 20 |

Every row remains one query. The last row exercises the real hook, reconciliation, facade and Firebase adapter. It preserves the saved event, all 1,000 Plans and subsequent full reload. There is no persistent cache, date cutoff, added query, write replay, or authority change.

## Verification

- Baseline new suite: 2 expected read-count failures / 4 controls passed. Baseline runtime code was unmodified; only the new tests were added.
- Focused candidate: 146 passed across 7 files, including migration/rollout, combined snapshot and MonthEvent/Plan Undo recovery.
- Fresh final `DEV_LAN_HOST=127.0.0.1 WRANGLER_LOG_PATH=/tmp/schedule-projection-wrangler-logs npm run verify`: exit 0, app/Worker non-incremental typechecks, Worker runtime-type generation, 7,886 passed / 54 skipped / 1 todo in 847 passing files, production build. Before/after all 2,448 inputs, 19,305 installed files, tool/environment identity and generated Worker type hashes matched.
- The first test startup failed because the sandbox cannot enumerate network interfaces; the existing documented LAN-host override avoids this unrelated development-URL enumeration. A new test initially used `Array.at`, unsupported by the app TypeScript target; it was replaced by indexed access before final verification. Neither change weakens an assertion.
- A transient execution transport disconnect occurred after the suite started. Reconnection verified the persisted `verify.exit=0`, full test totals/build and matching before/after snapshots; no replacement run is claimed.
- Separate bundle budget: the four existing total-JS/total-CSS/largest-CSS violations remain. Against the exact-base build, this change adds 146 raw / 7 gzip JS bytes; CSS bytes are identical. No threshold was changed.

## Index, schema and operational limits

[Firestore automatic indexes and equality-index merging](https://firebase.google.com/docs/firestore/query-data/index-overview) cover nested map fields and multiple equality filters. The query retains the existing implicit document-name order, has no range/order/limit clause, and repository `fieldOverrides` is empty. No composite index or Rules change is introduced. Actual deployed index exemptions are not inspected, and mock/emulator evidence cannot certify production index configuration.

Rules require the exact `plan` / `month-event` provenance enum, canonical ID and corresponding details. Both canonical writers and migration always produce it; supported aliases do not exist. Non-study Plans, historical raw legacy records after migration, recurrence children and source identities keep the same projection. The top-level display `kind` is not used. A malformed administrative write missing the entire provenance map is outside the supported schema; this work does not scan or repair such production data. The complete snapshot and migration validation remain unchanged.

### Rules-backed emulator follow-up

The existing shared official emulator v1.22.0 was found after the initial v1.20.2-cache search. Its 136,707,194-byte size, MD5 and SHA-256 `9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c` matched Firebase CLI 15.33.0's official downloadable-emulator manifest and the prior validated asset receipt. The repository runner's v1.20.2 pin was not changed.

A separate bounded harness reused the existing SDK transport observation and loopback-only guards. It bundles the exact-base authority from Git and current authority separately, uses unchanged repository Rules, clean synthetic credentials, an isolated `demo-studyplanner-read-load` project, and no production Firebase initializer. Exit 0:

- Actual SDK query targets remain one each. Returned document-response messages on 100 Plans + 5 MonthEvents: MonthEvent-only **105 → 5**, Plan-only **105 → 100**, full snapshot **105 → 105**. Each baseline/candidate projection is deeply equal.
- Both foreign-owner narrow reads and a kind-only query without an owner constraint are denied by actual Rules. The other owner can read only their own Plan/MonthEvent.
- The Rules reject a canonical write missing `provenance.legacy.kind`.
- Save, delete and a new-context full reload retain the correct data, all 100 Plans and historical/recurring records.
- Emulator process was terminated by the harness. No Docker, CI, Rules, indexes or production settings changed.

Local reproducible runner/client, SDK counts and hashed input report are retained with the implementation's verification artifacts (`run-emulator.mjs`, `emulator-projection.ts`, `emulator-report.json`). The report records v1.22.0, Firebase SDK 12.12.0, exact baseline/candidate source hashes, Rules hash and bundled harness inputs. Production billing, security-rule-dependent billing reads, actual deployed indexes and browser WebChannel behavior remain unmeasured.

Next: an authorized publication decision. Independent source inspection confirmed that the query uses the same provenance predicate as both existing projection functions, with details validation preserved. Runtime/test files were unchanged after the exact-content full run; only this checkpoint and its domain-index link were updated. Real-world recovery frequency remains unknown; prioritize navigation/startup causes separately rather than presenting this as a global startup-read reduction.
