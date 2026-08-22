# weeklyPlanning closed document archive

Status: closed / historical index
Updated: 2026-07-16

この文書は、現行canonical文書へ統合した旧architecture、strategy、testing、UX資料と、整理時に閉じたroot文書の索引である。本文の詳細はgit historyとcompletion recordで参照する。ここから直接実装taskを開始しない。

## Closed architecture

| former path | retained value | consolidated into |
| --- | --- | --- |
| `docs/architecture/planning-pipelines-overview.md` | 旧normal/weekly path、scheduler二系統の調査 | v4 architecture / roadmap deferred backlog |
| `docs/architecture/weekly-planning-responsibility-separation.md` | parser、command、reducer、scheduler、UIの基礎境界 | v4 architecture §2〜§3 |
| `docs/architecture/weekly-planning-nl-capability-model.md` | capability inventory、自然言語層の診断 | v4 architecture / roadmap deferred backlog |
| `docs/architecture/weekly-planning-dialogue-architecture.md` | v3 single interpreter / draft-first移行根拠 | v4 architecture / historical migration record |

## Closed strategy

| former path | retained value | consolidated into |
| --- | --- | --- |
| `docs/ai/strategy/weekly-planning-r2-ai-interpreter-design.md` | interpreter、validator、renderer導入記録 | v4 architecture / closed task history |
| `docs/ai/strategy/weekly-planning-dialogue-design-review.md` | 2026-07-10 production trace、W1〜W7 | v4 architecture / roleplay regression |
| `docs/ai/strategy/weekly-planning-deferred-backlog.md` | legacy fallback、dead state、scheduler二系統等 | roadmap deferred backlog |
| `docs/ai/strategy/weekly-planning-review-20260710-index.md` | 旧レビュー索引 | このclosed index |

## Closed testing / UX design

| former path | retained value | consolidated into |
| --- | --- | --- |
| `docs/testing/weekly-planning-ai-intake-design.md` | 初期会話型intake思想 | product spec / v4 architecture |
| `docs/testing/weekly-planning-persona-test-plan.md` | 曖昧入力、順不同、誤字、再計画のQA観点 | roleplay test plan |
| `docs/weekly-planning/weekly-planning-natural-dialogue.md` | 旧regex中心の自然対話改善案 | v4 architecture / rules fallback history |
| `docs/weekly-planning/weekly-mutation-testing.md` | Stryker限定導入候補 | `20260716-weekly-planning-mutation-testing-deferred.md` |

## Closed completed task sets

### Behavior-aware vertical slice

次のtaskは2026-07-14のbehavior-aware vertical sliceへ統合され、実装・自動検証済みである。

- `docs/ai/tasks/20260713-weekly-planning-da0a-assumption-proposal-foundation.md`
- `docs/ai/tasks/20260713-weekly-planning-da0-non-exam-preview-bridge.md`
- `docs/ai/tasks/20260713-weekly-planning-da1-dialogue-action-contract.md`
- `docs/ai/tasks/20260714-weekly-planning-behavior-aware-planning-architecture.md`
- `docs/ai/tasks/20260714-weekly-planning-behavior-aware-dialogue-preview-vertical-slice.md`
- `docs/ai/tasks/20260714-weekly-planning-test-architecture-refactor.md`

結果は[completion record](../tasks/closed/20260714-weekly-planning-behavior-aware-vertical-slice-completion.md)を参照する。

### PR #3 dialogue path fix

PR #3に属したclosed root task 6件は、[dialogue path completion record](../tasks/closed/20260715-weekly-planning-dialogue-path-fix-completion.md)へ統合した。

### Conversation trace

実装本体は[trace completion record](../tasks/closed/20260715-weekly-planning-conversation-trace-completion.md)へ移した。privacy、lifecycle、scalabilityは独立active taskとして管理する。

### Cross-cutting risks

9論点を5責務へ分割し、[split completion record](../tasks/closed/20260715-weekly-planning-cross-cutting-risks-split.md)へ閉じた。

## Historical contract migration

single-interpreter、preview-first、superseded goal acceptance、multi-slot regressionの現在の所有先は[historical migration record](../tasks/closed/20260716-weekly-planning-historical-contract-migrations.md)を参照する。

## Archive policy

- closed文書はcurrent instructionとして直接実行しない。
- historical detailが必要な場合だけgit historyとcompletion recordを参照する。
- 再利用する課題は最新コードを再調査し、新しいtask mdとして起こす。
- 旧phase名や旧task順序を復活させない。
- queue、coverage status、decision pendingの現在値はdocs index、roadmap、current contract statusを正とする。
