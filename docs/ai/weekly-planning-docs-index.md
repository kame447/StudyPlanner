# weeklyPlanning documentation index

Status: canonical / active
最終更新: 2026-07-18
Current code audit baseline: `37b1146a56139c28b52624b11ff0e705a69a5544`
Task docs audit input: `2d6b482e5610a91895dd7f57c33aa967214c84cb`

## Active documents

週間計画の現行判断には、次の文書を使用する。

| document | role |
| --- | --- |
| [weekly-planning-current-contract-status.md](weekly-planning-current-contract-status.md) | active文書間の優先順位、確定済みproduct decision、current contract |
| [weekly-planning-pr5-post-merge-status.md](weekly-planning-pr5-post-merge-status.md) | PR #5で実装された機能、known bug、検証不足、構造課題のpost-merge status |
| [weekly-planning-spec.md](../weekly-planning/weekly-planning-spec.md) | product goal、UX、planning principles。§12–13の旧single-interpreter/旧queueはcurrent contractで上書き |
| [weekly-planning-dialogue-architecture-v4.md](../architecture/weekly-planning-dialogue-architecture-v4.md) | architecture、safety boundary、module ownership。旧no-merge/旧status/旧queueはcurrent contractで上書き |
| [weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md) | current implementation status、decision records、current queue |
| [weekly-planning-roleplay-test-plan.md](../testing/weekly-planning-roleplay-test-plan.md) | scenario IDとstrict contract。旧status列、no-merge、close=cancelはcoverage/current contractで上書き |
| [weekly-planning-roleplay-status.md](../testing/weekly-planning-roleplay-status.md) | module、production、自動検証、browser coverageの現行status |
| [weekly-planning-pipeline-guide.md](weekly-planning-pipeline-guide.md) | task作成・実装・検証の運用 |

conversation traceを扱う作業では、下位設計として[weekly-planning-conversation-trace.md](../architecture/weekly-planning-conversation-trace.md)も参照する。ただし、dialogue architectureとcurrent contract statusのprivacy boundaryを上書きする文書として扱わない。

active文書間でstatus、queue、contractが競合する場合は、次の順で読む。

```text
weekly-planning-current-contract-status.md
→ weekly-planning-pr5-post-merge-status.md
→ weekly-planning-roadmap.md
→ weekly-planning-roleplay-status.md
→ spec / architecture / roleplay test planの非競合部分
→ active tasks
```

上記文書と、`docs/ai/tasks/`直下の未完了task以外をcurrent instructionとして扱わない。

## Current queue

`docs/ai/tasks/`直下のroot taskは12件である。完了済みtaskはrootに含めない。2026-07-18の承認application監査で追加・再設計したtaskを含む。

### P1

1. [20260716-weekly-planning-entrypoint-request-ownership.md](tasks/20260716-weekly-planning-entrypoint-request-ownership.md)
   - controller/envelopeの実装は完了し、browser verificationが残る。
2. [20260716-weekly-planning-trace-privacy-and-lifecycle.md](tasks/20260716-weekly-planning-trace-privacy-and-lifecycle.md)
   - trace subject token、全session本文のredaction、180日TTL、account deletion、限定admin accessを実装する。
3. [20260716-weekly-planning-longitudinal-personalization-data-governance.md](tasks/20260716-weekly-planning-longitudinal-personalization-data-governance.md)
   - account-linked profile、原履歴180日、profile訂正、account deletion、初回利用条件を実装する。
4. [20260716-weekly-planning-approval-persistence-and-idempotency.md](tasks/20260716-weekly-planning-approval-persistence-and-idempotency.md)
   - server-side claim、item単位progress、実Plan ID、構造化provenanceによりmulti-tab・multi-device・crash retryを一意化する。
5. [20260718-weekly-planning-application-behavior-tests.md](tasks/20260718-weekly-planning-application-behavior-tests.md)
   - application層の実reducer・storage・非同期競合を検証する共通harnessを整備する。
6. [20260718-weekly-planning-approval-save-side-effect-isolation.md](tasks/20260718-weekly-planning-approval-save-side-effect-isolation.md)
   - 週間承認をeditor・画面遷移・notice副作用のない保存関数へ分離し、実Plan IDを返す。
7. [20260718-weekly-planning-approval-validation-session-binding.md](tasks/20260718-weekly-planning-approval-validation-session-binding.md)
   - pending conversationId、intake revision、実proposal recordsをpreview/runtime/approvalへ接続する。
8. [20260718-weekly-planning-approval-inflight-interruption.md](tasks/20260718-weekly-planning-approval-inflight-interruption.md)
   - ownership喪失後に次itemのlookup・保存を開始せず、古いstateへ完了messageを適用しない。
9. [20260718-weekly-planning-restored-draft-approval-lifecycle.md](tasks/20260718-weekly-planning-restored-draft-approval-lifecycle.md)
   - browser reload後のbehavior-aware仮予定は再計算必須とし、承認導線と表示を一致させる。

### P2

10. [20260716-weekly-planning-trace-scalability-and-schema-migration.md](tasks/20260716-weekly-planning-trace-scalability-and-schema-migration.md)
    - pagination、query cost、index、archive、versioned decoderを設計する。
11. [20260716-weekly-planning-controller-ui-responsibility-split.md](tasks/20260716-weekly-planning-controller-ui-responsibility-split.md)
    - conversation controller、preview controller、view componentの責務を分離する。
12. [20260718-weekly-planning-user-boundary-storage-guard.md](tasks/20260718-weekly-planning-user-boundary-storage-guard.md)
    - stateとowner identityを同一snapshotとして保存し、ledgerをuser別keyへ安全にmigrationする。

### Approval stream execution order

roadmapの番号はpriority内の一覧であり、承認系taskの着手順は各taskのDependenciesを正とする。推奨順は次である。

```text
application behavior test harness
→ validation session binding / save side-effect isolation
→ in-flight interruption
→ reload-restored draft lifecycle
→ server-side persistence and idempotency
```

`validation session binding`と`save side-effect isolation`は独立した主原因を持つが、同じapplication fileを変更するため並行実装しない。user-boundary storage guardはledger API変更と競合する場合、server-side persistenceより先に統合する。

AI/rules統合方式、「来週」と週の始まり、trace privacy、長期個別最適化データはproduct decision済みである。browser reload後のbehavior-aware仮予定は、server-sideで信頼できるruntime snapshotを導入するまでは再計算必須とする。

## Implemented records

- [20260718-weekly-planning-app-orchestration-extraction-completion.md](tasks/closed/20260718-weekly-planning-app-orchestration-extraction-completion.md)
- [20260717-weekly-planning-kanji-absolute-date-guard.md](tasks/closed/20260717-weekly-planning-kanji-absolute-date-guard.md)
- [20260714-weekly-planning-dialogue-stack-verification.md](tasks/closed/20260714-weekly-planning-dialogue-stack-verification.md)
- [20260714-weekly-planning-behavior-aware-vertical-slice-completion.md](tasks/closed/20260714-weekly-planning-behavior-aware-vertical-slice-completion.md)
- [20260714-weekly-planning-dialogue-stack-implementation.md](tasks/closed/20260714-weekly-planning-dialogue-stack-implementation.md)
- [20260715-weekly-planning-dialogue-path-fix-completion.md](tasks/closed/20260715-weekly-planning-dialogue-path-fix-completion.md)
- [20260715-weekly-planning-conversation-trace-completion.md](tasks/closed/20260715-weekly-planning-conversation-trace-completion.md)
- PR #5 merge commit `55f8e32`: conversation/session hardening、preview lifecycle、storage boundary、pending range、dialogue repair

## Audit and migration records

- [20260717-codebase-maintainability-review.md](tasks/closed/20260717-codebase-maintainability-review.md)
- [20260716-weekly-planning-markdown-audit.md](tasks/closed/20260716-weekly-planning-markdown-audit.md)
- [20260715-weekly-planning-cross-cutting-risks-split.md](tasks/closed/20260715-weekly-planning-cross-cutting-risks-split.md)
- [20260716-weekly-planning-historical-contract-migrations.md](tasks/closed/20260716-weekly-planning-historical-contract-migrations.md)
- [20260716-weekly-planning-mutation-testing-deferred.md](tasks/closed/20260716-weekly-planning-mutation-testing-deferred.md)
- [weekly-planning-branch-archive-20260716.md](closed/weekly-planning-branch-archive-20260716.md)

## Closed records

- [weekly-planning-document-archive.md](closed/weekly-planning-document-archive.md)
- `docs/ai/tasks/closed/` — 過去の実装task・completion record・audit record
- `docs/ai/tasks/superseded/` — 採用されなかった旧task

## Known documentation conflicts

2026-07-17の整合性監査で、長大なactive文書に次のhistorical記述が残ることを確認した。

- product spec §12–13: single AI interpreter、rules/AI no-merge、旧queue
- dialogue architecture §1–2、§11–12: single AI interpreter、no-merge、旧branch status、旧queue
- roleplay test plan: no-merge assertion、close/unmount cancel、旧status列

これらは削除済みproduct decisionではなく履歴的記述であり、current contract statusとpost-merge statusで明示的に上書きする。機能bug修正と長大文書の全面書換えを同じPRへ混ぜない。

## Rules

- queueはroadmapだけを正とし、spec、architecture、roleplay内の古いqueueを使用しない。
- roleplayのscenario contractとcoverage statusを別文書で管理する。
- 古いphase名、stage名、D1〜D7、P4〜P9をcurrent queueとして再利用しない。
- historical documentから直接taskを実行しない。
- 新しい設計判断はcurrent contract/architectureへ、順序はroadmapへ、strict assertionはroleplay test planへ統合する。
- task完了時は、必要な結果だけcompletion recordへ残し、元taskはrootから閉じる。
- `implemented`、`production connected`、`automated verified`、`browser verified`、`operationally deployed`を区別する。
- 同じ内容を複数のstrategy / architecture / testing文書へ無制限に重複記載しない。
- ローカル検証前にfully completeと記載しない。
- PR merge後はbranch/head/merge statusをcurrent overlayとqueueへ同期する。
