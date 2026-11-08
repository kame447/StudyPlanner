# 週間計画 personalization rollout

Status: active / foundation implemented, observation rollout pending
Priority: P2 after session authority
Updated: 2026-08-22
Tracking: Issue #47
Depends on:
- [20260731-synced-conversation-session-store.md](20260731-synced-conversation-session-store.md)
- Issue #164 client-first storage / authority decisions

## Implemented foundation

- account-linked profile schema
- week-start setting
- origin / confidence / scope / confirmedAt / expiresAt
- explicit setting persistence / reset
- bounded placement parameter schema
- trace / conversation / approval repository separation
- current-only acceptance を durable preference へ無断昇格しない境界

## Current observation wiring (2026-11-08, checked against main)

| Remaining item | State | Where |
| --- | --- | --- |
| 1 observation repository | No separate store. Plan `weeklyPlanningEstimate` / `weeklyPlanningObservationSource` and Actual `weeklyPlanningObservationResult` are the observations, written through the approval path | `weeklyPlanningApprovalApplication.ts`, `weeklyPlanningEstimateCalibration.ts` |
| 2 invalidation | Deleting a plan or actual removes it from the next recomputation. An actual marked `isAlignedToPlan: false` is not an observation of the plan (pace and estimate calibration both exclude it) | `weeklyPlanningMemoryPaceObservationsV5.ts`, `weeklyPlanningEstimateCalibration.ts` |
| 3 recomputable aggregate | One global multiplier recomputed from active plan/actual pairs on every compile; no stored aggregate. Observations decay with a 56-day half-life (weighted median; the weights lower the effective count in the n/(n+3) shrinkage, so stale evidence returns toward 1; clamp 0.75-1.75 unchanged). `subjectEstimateMultipliers` in the profile is unused | `deriveWeeklyPlanningEstimateCalibration`, VNext `compilePreviewInput` |
| 4 time decay / effective sample | Implemented (56-day half-life; shrinkage uses the effective count `n_eff/(n_eff+3)`) | `deriveWeeklyPlanningEstimateCalibration` |
| 5 safe ordering | Not implemented | — |
| 6 consent / TTL / audit | Not implemented | — |

## Remaining work

1. versioned planning / outcome observation repository
2. reset / invalidation propagation
3. active observation だけから再計算可能な aggregate
4. time decay / confidence / effective sample information
5. hard constraints 通過後の safe candidate ordering
6. consent / TTL / correction / account deletion / audit
7. offline evaluation と browser / multi-client verification

## Safety boundary

- hard constraint を学習対象にしない
- explicit user preference を推定値で上書きしない
- invalidated / superseded observation を集計しない
- score unavailable / failed の場合は non-personalized deterministic result を維持する
- current session state、durable preference、observed profile を別 state として扱う

cloud/local truth と offline queue の設計は Issue #164 と競合する独立 authority を作らない。
