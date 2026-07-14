# weeklyPlanning documentation index

Status: **canonical / active**
最終更新: 2026-07-14

## Active documents

週間計画の現行判断には、次の文書だけを使用する。

| document | role |
| --- | --- |
| [weekly-planning-spec.md](../weekly-planning/weekly-planning-spec.md) | product goal、UX、planning principles |
| [weekly-planning-dialogue-architecture-v4.md](../architecture/weekly-planning-dialogue-architecture-v4.md) | current architecture、safety boundary、module ownership |
| [weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md) | current implementation status、verification queue |
| [weekly-planning-roleplay-test-plan.md](../testing/weekly-planning-roleplay-test-plan.md) | strict contract、roleplay、requirement traceability |
| [weekly-planning-pipeline-guide.md](weekly-planning-pipeline-guide.md) | task作成・実装・検証の運用 |

この5文書と、`docs/ai/tasks/`直下の未完了task以外をcurrent instructionとして扱わない。

## Current queue

production implementation taskは残っていない。現在のroot taskは次の検証専用task1件だけである。

1. `20260714-weekly-planning-dialogue-stack-verification.md`

検証成功後にこのtaskをclosedへ移し、architectureとroadmapをfully verifiedへ更新する。

## Implemented records

- [20260714-weekly-planning-behavior-aware-vertical-slice-completion.md](tasks/closed/20260714-weekly-planning-behavior-aware-vertical-slice-completion.md)
- [20260714-weekly-planning-dialogue-stack-implementation.md](tasks/closed/20260714-weekly-planning-dialogue-stack-implementation.md)

## Closed records

- [weekly-planning-document-archive.md](closed/weekly-planning-document-archive.md)
- `docs/ai/tasks/closed/` — 過去の実装task・completion record
- `docs/ai/tasks/superseded/` — 採用されなかった旧task

## Rules

- 古いphase名、stage名、D1〜D7、P4〜P9をcurrent queueとして再利用しない。
- historical documentから直接taskを実行しない。
- 新しい設計判断はarchitectureへ、順序はroadmapへ、strict assertionはroleplay test planへ統合する。
- task完了時は、必要な結果だけcompletion recordへ残し、元taskはrootから閉じる。
- 同じ内容を複数のstrategy / architecture / testing文書へ重複記載しない。
- ローカル検証前にfully completeと記載しない。
