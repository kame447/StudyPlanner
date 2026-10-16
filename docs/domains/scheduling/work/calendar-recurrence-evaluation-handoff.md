# Calendar recurrence evaluation

Status: local implementation and focused verification complete; combined integration and publication pending.
Updated: 2026-10-15 UTC.

## Ownership and scope

- Local branch: `perf/calendar-recurrence-evaluation`.
- Base: main `729d212c982bb30f4db070f4b13b6e5beb4d9923`, tree `1b1c25eafc2356e573ffd3f829b38639ce169b7f`.
- Existing open/closed performance Issues, related PRs and all current branch names were checked. Existing #542 owns Firestore reads; #483 owns small UI changes. Neither has an active recurrence-evaluation implementation. No remote Issue, branch or PR has been created for this local-only performance experiment.
- Scope: avoid evaluating the same Plan's recurrence rules twice while expanding one date. Preserve the existing rule comparator, exclusions, output order, occurrence fields, legacy fallback and fresh-result semantics. No memoization/cache, UI change, persistence or weekly-planning semantic change.
- Other implementation owners retain startup, Firestore, small issues and non-functional work. No #488/Jev/#692 changes.

## Baseline evidence

A synthetic Node 24.19.0 / Asia-Tokyo CPU benchmark measured the real day/week/month projection functions before any production edit. The three measured projection source blobs were fetched at current main and matched the saved baseline source byte-for-byte.

500 input Plans (100 active daily series with eight dated/weekday rules each), 40 Actuals, no MonthEvents. After eight warmups, 31 samples yielded medians: day 1.453 ms, week 4.728 ms, month 56.151 ms, 42-day Plan expansion 20.608 ms. CPU sampling placed recurrence date construction first; expansion evaluates matching rules once for admission and again for materializing admitted occurrences.

The baseline is a synthetic CPU workload. It is not browser interaction latency, real-device responsiveness, typical user distribution or a production service measurement. Lower-density and legacy workloads must be checked in the paired comparison before accepting the optimization.

## Initial verification plan

The implementation plan was to add a regression that counts rule applicability evaluation, confirm the old source fails it, and reuse the chosen rule within expansion. Check exact output parity across priority, exclusion, fallback, day/week/month, mutable-source and timezone boundaries, then run related regressions and fresh application types. The integration owner runs final combined verification. Supply exact commit/tree and reproducible before/after evidence; do not claim publication or native UI acceptance.

## Verified local result

The implementation reuses the selected recurrence rule when materializing a Plan occurrence; the exported direct-resolution behavior is unchanged. It adds no cross-call cache. Production diff: one file, 23 insertions and 3 deletions. A new regression file covers one applicability evaluation per eligible rule/date, excluded dates, source ordering and immutability, override fields and identity, legacy and structured recurrence kinds, expiry/leap dates, stable rule ties, source edits and direct-resolution fallback.

Paired measurements use the actual current-main baseline and candidate bundled with the same installed esbuild, in one Node process. Each query gets 10 warmups and 40 alternating before/after samples. All four query outputs in each of the four datasets compare deeply equal (including Map entries).

| Synthetic dataset | Month median before | Month median after | Difference |
| --- | ---: | ---: | ---: |
| 100 Plans; 5 repeating series × 1 rule; 40 Actuals | 1.186 ms | 1.240 ms | no demonstrated improvement |
| 500 Plans; 100 repeating series × 8 rules; 40 Actuals | 59.125 ms | 34.811 ms | 41.1% lower |
| 2,000 Plans; 40 repeating series × 3 rules; 40 Actuals | 16.088 ms | 11.801 ms | 26.6% lower |
| 500 legacy historical Plans; 40 Actuals | 1.222 ms | 1.246 ms | no demonstrated improvement |

For the recurrence-heavy dataset, day projection is 1.253 → 0.761 ms, week 4.719 → 2.788 ms and 42-day expansion 18.939 → 9.649 ms. These are synchronous CPU measurements, not application-result p95 or visible browser latency. Small workloads have negligible absolute differences and do not justify a universal speed claim. No performance threshold or capacity gate was changed.

Verification on the final code and tests:

- Before production edit: the new applicability-count regression fails (5 evaluations instead of 3); 8 behavioral cases pass. An initial unconfigured Vite launch failed because the environment disallows network-interface enumeration. The existing command-scoped `DEV_LAN_HOST=127.0.0.1` option enables the normal configuration without a product or runner change.
- Related suite: 20 files / 143 tests pass, including recurrence edits, repository mutations, schedule identity, Month/Week navigation and drag behavior, actual-record projection and calendar rendering contracts.
- America/New_York recurrence boundary suite: 3 files / 26 tests pass. Main related suite uses Asia/Tokyo.
- Fresh nonincremental app TypeScript passes; production build passes (7.81 seconds, existing chunk-size warning remains). No lint script is configured.
- 2,378 non-Markdown source inputs and 19,294 installed non-dot dependency files match before/after final related tests/build. The focused proof does not substitute for the integration owner's full verification.
- Differential before/after runs: 480 checks per timezone in UTC, Asia/Tokyo, America/New_York and Europe/Berlin, with mixed recurrence kinds, exclusions, tied rules, source identity, foreign-owner inputs, leap dates and seven-day/date/month ranges. Every output is deeply equal and every input remains unchanged; all four output digests match.
- Parent independently read the production diff and found no blocker; admission, legacy fallback, excluded dates and projection order are preserved.

Raw paired samples, output hashes, baseline/candidate bundles, CPU profile, regression logs and exact input inventory are retained in the local evidence packet `laplans-calendar-response-evidence-20261015`. This packet is a local engineering artifact, not a public deployment receipt.

## Remaining boundary

The integration owner must run full verification on the combined final content. Native-browser responsiveness, physical-device performance and production frequency/data distributions are not measured. No GitHub write, PR, merge, deployment or existing branch deletion was performed. The new local branch is the only implementation branch for this unit and can be retired after its eventual authorized integration.

## Authorized publication checkpoint — 2026-10-16

The owner approved GitHub publication and verified-in-order main integration. The existing branch is reused; current remote main remains the original base `729d212c`. Related open/closed PRs and branches were rechecked and no duplicate unit was found. The publication coordinator owns final exact-content `TZ=UTC DEV_LAN_HOST=127.0.0.1 npm run verify`, applicable CI/native checks, merge and deployed-asset verification. The existing capacity-budget failures remain a separately deferred issue without threshold changes. Local socket restrictions prevent browser execution here; existing GitHub browser CI is the supported verification path. Physical-device responsiveness remains unverified.
