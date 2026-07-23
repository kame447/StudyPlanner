# weeklyPlanning documentation index

Status: canonical / active
最終更新: 2026-07-24
Current implementation baseline: PR #77 Stable V5 runtime + PR #79 browser persistence + trace continuity fix branch

## 1. 現行判断に使用する文書

| document | role |
| --- | --- |
| [weekly-planning-stable-v5-runtime-trial-contract.md](weekly-planning-stable-v5-runtime-trial-contract.md) | Stable V5の実環境接続、runtime mode、browser persistence、conversation identity、trace continuity、rollbackの正本 |
| [weekly-planning-current-contract-v5.md](weekly-planning-current-contract-v5.md) | semantic v5とStable V5 trialの最優先contract。AI/core責務、汎用task、availability、scheduler、storage、trace、移行規則 |
| [../architecture/weekly-planning-semantic-schema-registry.md](../architecture/weekly-planning-semantic-schema-registry.md) | pre-V5、Alpha、Stable V5、Fact Graph世代、runtime依存、廃止条件の正本 |
| [strategy/weekly-planning-semantic-stable-v5-migration-plan.md](strategy/weekly-planning-semantic-stable-v5-migration-plan.md) | direct Stable V5統合済み範囲、残るmigration、shadow、rollback、cutover gate |
| [strategy/weekly-planning-semantic-stable-v5-implementation-status.md](strategy/weekly-planning-semantic-stable-v5-implementation-status.md) | 現在の実装到達点、browser persistence、trace continuity、test coverage、未完了範囲 |
| [strategy/weekly-planning-semantic-v5-roadmap.md](strategy/weekly-planning-semantic-v5-roadmap.md) | runtime integration後のactive queue、priority、依存順、default cutover禁止条件 |
| [../architecture/weekly-planning-semantic-schema-v5.md](../architecture/weekly-planning-semantic-schema-v5.md) | Stable V5意味文書とscheduler入力の構造 |
| [../architecture/weekly-planning-dialogue-architecture-v5.md](../architecture/weekly-planning-dialogue-architecture-v5.md) | SemanticDocument、Fact Graph、dialogue、generic work item architecture |
| [../architecture/weekly-planning-availability-architecture-v5.md](../architecture/weekly-planning-availability-architecture-v5.md) | availability、fixed commitment、external source、scheduler境界 |
| [../architecture/weekly-planning-conversation-trace.md](../architecture/weekly-planning-conversation-trace.md) | trace event、privacy、retention、admin exportの基礎契約。Stable V5 identityはruntime contractを優先 |
| [audits/20260724-stable-v5-trace-continuity/final-overseer.md](audits/20260724-stable-v5-trace-continuity/final-overseer.md) | 同一conversationのtrace分裂に関する七視点監査と最終gate |
| [tasks/20260724-weekly-planning-runtime-followups.md](tasks/20260724-weekly-planning-runtime-followups.md) | cross-tab、dialogue grounding、trace source semantics、expired session finalizationのactive follow-up |
| [weekly-planning-current-contract-status.md](weekly-planning-current-contract-status.md) | approval、personalization等の非競合contract |
| [strategy/weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md) | semantic v5以外のcurrent queue |
| [../testing/weekly-planning-roleplay-test-plan.md](../testing/weekly-planning-roleplay-test-plan.md) | scenario IDとstrict contract |
| [../testing/weekly-planning-roleplay-status.md](../testing/weekly-planning-roleplay-status.md) | module、production、自動検証、browser coverageのstatus |

v4以前のarchitecture、旧task、過去PR本文はhistorical sourceである。typed command、deterministic parser fallback、exam専用state、Stable V5 production未接続、Graph memory-only等の記述が現行文書と競合する場合は採用しない。

## 2. 読む順序

```text
weekly-planning-stable-v5-runtime-trial-contract.md
→ weekly-planning-current-contract-v5.md
→ weekly-planning-semantic-schema-registry.md
→ weekly-planning-semantic-stable-v5-migration-plan.md
→ weekly-planning-semantic-stable-v5-implementation-status.md
→ weekly-planning-semantic-v5-roadmap.md
→ architecture v5 documents
→ active task / audit
→ non-conflicting legacy contract
→ historical records
```

## 3. current baseline

実装済み:

```text
Stable V5 direct schema / prompt / validator / normalizer
Fact Graph V5 lifecycle and direct canonicalizer
active read view / generic scheduler input
readiness / deterministic dialogue / preview scheduler
existing preview / approval / Plan save integration
request-scoped staged Graph atomic commit
owner-week-conversation browser persistence
conversation / Graph / preview / draft restoration
Stable V5 trace repository integration
controller turn sequence recovery after reload
trace session / entry sequence continuity after reload
write failure retry without sequence consumption
```

default runtimeはlegacyである。Stable V5はfeature-flagged trialである。

未完了:

```text
branch trace continuity verification
cross-tab sequence coordination
accepted fact dialogue grounding
Stable V5 actual AI real-eval
full browser roleplay
production shadow invocation
server / cross-device Graph persistence
old state migration decoder / dry-run
default cutover
legacy runtime deletion
```

## 4. active queue

semantic v5のqueueと依存順は[weekly-planning-semantic-v5-roadmap.md](strategy/weekly-planning-semantic-v5-roadmap.md)を正とする。直近はtrace continuityのtest、typecheck、build、branch preview export verificationである。

完了済みtaskは`tasks/closed/`、契約変更で不要になったtaskは`tasks/superseded/`へ移す。root `tasks/`には実行対象だけを置く。

## 5. 主要な完了記録

- PR #77: Stable V5 feature-flagged runtime integration
- PR #79: Stable V5 conversation / Fact Graph browser persistence and staged Graph atomic commit
- PR #75: AI-only semantic boundary and seven-audit completion
- PR #69: trace server-authoritative structural IDs
- PR #68: legacy runtime responsibility boundary and final audit

## 6. 運用規則

- 実装変更後はruntime contract、current contract、implementation status、roadmap、active taskを同期する。
- `module implemented`、`runtime connected`、`browser persisted`、`automated verified`、`browser verified`、`default enabled`を区別する。
- 実行していないtest、build、real-eval、browser verificationを成功済みと書かない。
- runnerがstep開始前に失敗した場合は実行基盤failureとtest failureを区別する。
- traceを変更する場合はconversation ID、session ID、request ID、entry sequence、privacy、retention、server authorityを一つの結合境界として監査する。
- PR merge後はbaselineと文書を同じturnで更新する。
