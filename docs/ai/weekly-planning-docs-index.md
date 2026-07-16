# weeklyPlanning documentation index

Status: **canonical / active**
最終更新: 2026-07-16

## Active documents

週間計画の現行判断には、次の文書を使用する。

| document | role |
| --- | --- |
| [weekly-planning-spec.md](../weekly-planning/weekly-planning-spec.md) | product goal、UX、planning principles |
| [weekly-planning-dialogue-architecture-v4.md](../architecture/weekly-planning-dialogue-architecture-v4.md) | current architecture、safety boundary、module ownership |
| [weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md) | current implementation status、decision gates、verification queue |
| [weekly-planning-roleplay-test-plan.md](../testing/weekly-planning-roleplay-test-plan.md) | strict contract、roleplay、requirement traceability |
| [weekly-planning-pipeline-guide.md](weekly-planning-pipeline-guide.md) | task作成・実装・検証の運用 |

conversation traceを扱う作業では、下位設計として[weekly-planning-conversation-trace.md](../architecture/weekly-planning-conversation-trace.md)も参照する。ただし、dialogue architectureのprivacy boundaryを上書きする文書として扱わない。

上記文書と、`docs/ai/tasks/`直下の未完了task以外をcurrent instructionとして扱わない。

## Current queue

現在のroot taskは次の2件である。

1. [20260714-weekly-planning-dialogue-stack-verification.md](tasks/20260714-weekly-planning-dialogue-stack-verification.md)
   - `main`上のmodule、自動検証、production entrypoint、browser behaviorを区別して確認する。

2. [20260715-weekly-planning-cross-cutting-risks.md](tasks/20260715-weekly-planning-cross-cutting-risks.md)
   - entrypoint ownership、trace privacy/lifecycle、approval persistence、trace scalability、controller責務を独立taskへ分割する。

設計判断が必要なAI/rules統合方式、「来週」の意味論、trace privacyはroadmapのDecision gatesを正とする。

## Implemented records

- [20260714-weekly-planning-behavior-aware-vertical-slice-completion.md](tasks/closed/20260714-weekly-planning-behavior-aware-vertical-slice-completion.md)
- [20260714-weekly-planning-dialogue-stack-implementation.md](tasks/closed/20260714-weekly-planning-dialogue-stack-implementation.md)
- [20260715-weekly-planning-dialogue-path-fix-completion.md](tasks/closed/20260715-weekly-planning-dialogue-path-fix-completion.md)
- [20260715-weekly-planning-conversation-trace-completion.md](tasks/closed/20260715-weekly-planning-conversation-trace-completion.md)

## Audit records

- [20260716-weekly-planning-markdown-audit.md](tasks/closed/20260716-weekly-planning-markdown-audit.md)

## Closed records

- [weekly-planning-document-archive.md](closed/weekly-planning-document-archive.md)
- `docs/ai/tasks/closed/` — 過去の実装task・completion record
- `docs/ai/tasks/superseded/` — 採用されなかった旧task

## Rules

- 古いphase名、stage名、D1〜D7、P4〜P9をcurrent queueとして再利用しない。
- historical documentから直接taskを実行しない。
- 新しい設計判断はarchitectureへ、順序はroadmapへ、strict assertionはroleplay test planへ統合する。
- task完了時は、必要な結果だけcompletion recordへ残し、元taskはrootから閉じる。
- `implemented`、`production connected`、`automated verified`、`browser verified`を区別する。
- 同じ内容を複数のstrategy / architecture / testing文書へ重複記載しない。
- ローカル検証前にfully completeと記載しない。
