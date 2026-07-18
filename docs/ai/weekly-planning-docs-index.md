# weeklyPlanning documentation index

Status: canonical / active
最終更新: 2026-07-18
Current implementation baseline: `fe0dc86af264ab339e81b2191b333b4ef2a779b0`

## Active documents

週間計画の現行判断には、次の文書を使用する。

| document | role |
| --- | --- |
| [weekly-planning-current-contract-status.md](weekly-planning-current-contract-status.md) | active文書間の優先順位、確定済みproduct decision、current contract |
| [weekly-planning-pr5-post-merge-status.md](weekly-planning-pr5-post-merge-status.md) | PR #5で実装された機能、known bug、検証不足、構造課題のpost-merge status |
| [weekly-planning-spec.md](../weekly-planning/weekly-planning-spec.md) | product goal、UX、planning principles。旧single-interpreter/旧queueはcurrent contractで上書き |
| [weekly-planning-dialogue-architecture-v4.md](../architecture/weekly-planning-dialogue-architecture-v4.md) | architecture、safety boundary、module ownership。旧status/旧queueはcurrent contractで上書き |
| [weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md) | current implementation status、decision records、current queue |
| [weekly-planning-roleplay-test-plan.md](../testing/weekly-planning-roleplay-test-plan.md) | scenario IDとstrict contract |
| [weekly-planning-roleplay-status.md](../testing/weekly-planning-roleplay-status.md) | module、production、自動検証、browser coverageの現行status |
| [weekly-planning-pipeline-guide.md](weekly-planning-pipeline-guide.md) | task作成・実装・検証の運用 |

conversation traceを扱う作業では、[weekly-planning-conversation-trace.md](../architecture/weekly-planning-conversation-trace.md)も参照する。ただしcurrent contract statusのprivacy boundaryを上書きしない。

active文書間でstatus、queue、contractが競合する場合は、次の順で読む。

```text
weekly-planning-current-contract-status.md
→ weekly-planning-pr5-post-merge-status.md
→ weekly-planning-roadmap.md
→ weekly-planning-roleplay-status.md
→ spec / architecture / roleplay test planの非競合部分
→ active tasks
```

`docs/ai/tasks/`直下の未完了task以外をcurrent instructionとして扱わない。

## Current queue

`docs/ai/tasks/`直下のroot taskは6件である。完了済みtaskはrootに含めない。

### P1

1. [20260716-weekly-planning-entrypoint-request-ownership.md](tasks/20260716-weekly-planning-entrypoint-request-ownership.md)
   - request ownership実装後のbrowser close-resume、週変更、reset、cancel、IME、focusを確認する。

2. [20260716-weekly-planning-trace-privacy-and-lifecycle.md](tasks/20260716-weekly-planning-trace-privacy-and-lifecycle.md)
   - code実装後の本番secret、TTL、rules/Worker deploy、削除、限定閲覧、privacy/legal reviewを完了する。

3. [20260716-weekly-planning-longitudinal-personalization-data-governance.md](tasks/20260716-weekly-planning-longitudinal-personalization-data-governance.md)
   - active draft PR #48を現行application境界へ統合し、検証・merge・運用確認を完了する。

4. [20260718-weekly-planning-approval-operational-rollout.md](tasks/20260718-weekly-planning-approval-operational-rollout.md)
   - 本番Firestore rules、operation/item TTL、Emulator rules/transaction、multi-client実環境確認を完了する。

### P2

5. [20260716-weekly-planning-trace-scalability-and-schema-migration.md](tasks/20260716-weekly-planning-trace-scalability-and-schema-migration.md)
   - pagination、query cost、index、archive、versioned decoderを設計する。

6. [20260716-weekly-planning-controller-ui-responsibility-split.md](tasks/20260716-weekly-planning-controller-ui-responsibility-split.md)
   - conversation controller、preview controller、view componentの責務を分離する。

## Approval stream status

次の実装taskは完了し、rootからclosedへ移行した。

- [application behavior tests](tasks/closed/20260718-weekly-planning-application-behavior-tests.md) — PR #54
- [validation session binding](tasks/closed/20260718-weekly-planning-approval-validation-session-binding.md) — PR #55
- [save side-effect isolation](tasks/closed/20260718-weekly-planning-approval-save-side-effect-isolation.md) — PR #56
- [in-flight interruption](tasks/closed/20260718-weekly-planning-approval-inflight-interruption.md) — PR #57
- [restored draft lifecycle](tasks/closed/20260718-weekly-planning-restored-draft-approval-lifecycle.md) — PR #58
- [user-boundary storage guard](tasks/closed/20260718-weekly-planning-user-boundary-storage-guard.md) — PR #59
- [persistent idempotency](tasks/closed/20260716-weekly-planning-approval-persistence-and-idempotency.md) — PR #60、#62、#63

承認streamのactive taskはoperational rolloutだけである。closed taskを再実装指示として使用しない。

## Other implemented records

- [20260718-weekly-planning-app-orchestration-extraction-completion.md](tasks/closed/20260718-weekly-planning-app-orchestration-extraction-completion.md)
- [20260717-weekly-planning-kanji-absolute-date-guard.md](tasks/closed/20260717-weekly-planning-kanji-absolute-date-guard.md)
- [20260714-weekly-planning-dialogue-stack-verification.md](tasks/closed/20260714-weekly-planning-dialogue-stack-verification.md)
- [20260714-weekly-planning-behavior-aware-vertical-slice-completion.md](tasks/closed/20260714-weekly-planning-behavior-aware-vertical-slice-completion.md)
- [20260714-weekly-planning-dialogue-stack-implementation.md](tasks/closed/20260714-weekly-planning-dialogue-stack-implementation.md)
- [20260715-weekly-planning-dialogue-path-fix-completion.md](tasks/closed/20260715-weekly-planning-dialogue-path-fix-completion.md)
- [20260715-weekly-planning-conversation-trace-completion.md](tasks/closed/20260715-weekly-planning-conversation-trace-completion.md)

## Audit and migration records

- [20260717-codebase-maintainability-review.md](tasks/closed/20260717-codebase-maintainability-review.md)
- [20260716-weekly-planning-markdown-audit.md](tasks/closed/20260716-weekly-planning-markdown-audit.md)
- [20260715-weekly-planning-cross-cutting-risks-split.md](tasks/closed/20260715-weekly-planning-cross-cutting-risks-split.md)
- [20260716-weekly-planning-historical-contract-migrations.md](tasks/closed/20260716-weekly-planning-historical-contract-migrations.md)
- [20260716-weekly-planning-mutation-testing-deferred.md](tasks/closed/20260716-weekly-planning-mutation-testing-deferred.md)
- [weekly-planning-branch-archive-20260716.md](closed/weekly-planning-branch-archive-20260716.md)

## Known documentation conflicts

active長大文書には旧single-interpreter、no-merge、close/unmount cancel、旧queue等のhistorical記述が残る。current contract status、roadmap、roleplay statusで上書きする。

## Rules

- queueはroadmapだけを正とする。
- historical documentから直接taskを実行しない。
- task完了時はcompletion recordへ残し、元taskはrootから閉じる。
- `implemented`、`production connected`、`automated verified`、`browser verified`、`operationally deployed`を区別する。
- PR merge後はbranch/head/merge statusをcurrent overlayとqueueへ同期する。
- 一つの作業streamで不要なbranchを増やさず、既存の作業branchを再利用する。