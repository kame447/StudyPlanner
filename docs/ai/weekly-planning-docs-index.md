# weeklyPlanning documentation index

Status: canonical / active
最終更新: 2026-07-16

## Active documents

週間計画の現行判断には、次の文書を使用する。

| document | role |
| --- | --- |
| [weekly-planning-current-contract-status.md](weekly-planning-current-contract-status.md) | active文書間のstatus、確定済みproduct decision、実装待ちcontractの読み方 |
| [weekly-planning-spec.md](../weekly-planning/weekly-planning-spec.md) | product goal、UX、planning principles |
| [weekly-planning-dialogue-architecture-v4.md](../architecture/weekly-planning-dialogue-architecture-v4.md) | current architecture、safety boundary、module ownership |
| [weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md) | current implementation status、decision records、current queue |
| [weekly-planning-roleplay-test-plan.md](../testing/weekly-planning-roleplay-test-plan.md) | scenarioとstrict contract |
| [weekly-planning-roleplay-status.md](../testing/weekly-planning-roleplay-status.md) | module、production、自動検証、browser coverageの現行status |
| [weekly-planning-pipeline-guide.md](weekly-planning-pipeline-guide.md) | task作成・実装・検証の運用 |

conversation traceを扱う作業では、下位設計として[weekly-planning-conversation-trace.md](../architecture/weekly-planning-conversation-trace.md)も参照する。ただし、dialogue architectureとcurrent contract statusのprivacy boundaryを上書きする文書として扱わない。

active文書間でstatus、queue、contractが競合する場合は、`weekly-planning-current-contract-status.md`とroadmapのdecision recordsを先に確認する。

上記文書と、`docs/ai/tasks/`直下の未完了task以外をcurrent instructionとして扱わない。

## Current queue

現在のroot taskは次の7件である。

1. [20260714-weekly-planning-dialogue-stack-verification.md](tasks/20260714-weekly-planning-dialogue-stack-verification.md)
   - `main`上のmodule、自動検証、production entrypoint、browser behaviorを区別して確認する。
2. [20260716-weekly-planning-entrypoint-request-ownership.md](tasks/20260716-weekly-planning-entrypoint-request-ownership.md)
   - conversation、turn、request、revision、selected week、reset/close/unmountのownershipを統一する。
3. [20260716-weekly-planning-trace-privacy-and-lifecycle.md](tasks/20260716-weekly-planning-trace-privacy-and-lifecycle.md)
   - trace subject token、全session本文のredaction、180日TTL、account deletion、限定admin accessを実装する。
4. [20260716-weekly-planning-longitudinal-personalization-data-governance.md](tasks/20260716-weekly-planning-longitudinal-personalization-data-governance.md)
   - account-linked profile、原履歴180日、profile訂正、account deletion、初回利用条件を実装する。
5. [20260716-weekly-planning-approval-persistence-and-idempotency.md](tasks/20260716-weekly-planning-approval-persistence-and-idempotency.md)
   - localStorageを越えたmulti-device、multi-tab、partial retryの重複保存防止を設計する。
6. [20260716-weekly-planning-trace-scalability-and-schema-migration.md](tasks/20260716-weekly-planning-trace-scalability-and-schema-migration.md)
   - pagination、query cost、index、archive、versioned decoderを設計する。
7. [20260716-weekly-planning-controller-ui-responsibility-split.md](tasks/20260716-weekly-planning-controller-ui-responsibility-split.md)
   - conversation controller、preview controller、view componentの責務を分離する。

AI/rules統合方式、「来週」と週の始まり、trace privacy、長期個別最適化データはproduct decision済みである。実装契約はcurrent contract status、roadmap、対応するroot taskを正とする。

## Implemented records

- [20260714-weekly-planning-behavior-aware-vertical-slice-completion.md](tasks/closed/20260714-weekly-planning-behavior-aware-vertical-slice-completion.md)
- [20260714-weekly-planning-dialogue-stack-implementation.md](tasks/closed/20260714-weekly-planning-dialogue-stack-implementation.md)
- [20260715-weekly-planning-dialogue-path-fix-completion.md](tasks/closed/20260715-weekly-planning-dialogue-path-fix-completion.md)
- [20260715-weekly-planning-conversation-trace-completion.md](tasks/closed/20260715-weekly-planning-conversation-trace-completion.md)

## Audit and migration records

- [20260716-weekly-planning-markdown-audit.md](tasks/closed/20260716-weekly-planning-markdown-audit.md)
- [20260715-weekly-planning-cross-cutting-risks-split.md](tasks/closed/20260715-weekly-planning-cross-cutting-risks-split.md)
- [20260716-weekly-planning-historical-contract-migrations.md](tasks/closed/20260716-weekly-planning-historical-contract-migrations.md)
- [20260716-weekly-planning-mutation-testing-deferred.md](tasks/closed/20260716-weekly-planning-mutation-testing-deferred.md)
- [weekly-planning-branch-archive-20260716.md](closed/weekly-planning-branch-archive-20260716.md)

## Closed records

- [weekly-planning-document-archive.md](closed/weekly-planning-document-archive.md)
- `docs/ai/tasks/closed/` — 過去の実装task・completion record
- `docs/ai/tasks/superseded/` — 採用されなかった旧task

## Rules

- queueはroadmapだけを正とし、spec、architecture、roleplay内の古いqueueを使用しない。
- roleplayのscenario contractとcoverage statusを別文書で管理する。
- 古いphase名、stage名、D1〜D7、P4〜P9をcurrent queueとして再利用しない。
- historical documentから直接taskを実行しない。
- 新しい設計判断はarchitectureへ、順序はroadmapへ、strict assertionはroleplay test planへ統合する。
- task完了時は、必要な結果だけcompletion recordへ残し、元taskはrootから閉じる。
- `implemented`、`production connected`、`automated verified`、`browser verified`、`operationally deployed`を区別する。
- 同じ内容を複数のstrategy / architecture / testing文書へ重複記載しない。
- ローカル検証前にfully completeと記載しない。
