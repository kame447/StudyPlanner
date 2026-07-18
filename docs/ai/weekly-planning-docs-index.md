# weeklyPlanning documentation index

Status: canonical / active
最終更新: 2026-07-17
Current main baseline: `55f8e32c68cfd057494fadec0ed208cba267db12`

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

現在のroot taskは14件である(うち1件はcompleted record化待ち)。2026-07-18の全体監査(main 37b1146)で20260718系taskを追加した。

### P0

1. [20260717-weekly-planning-kanji-absolute-date-guard.md](tasks/20260717-weekly-planning-kanji-absolute-date-guard.md)
   - 漢数字を含む絶対日付を曜日として誤解釈しない。
2. [20260714-weekly-planning-dialogue-stack-verification.md](tasks/20260714-weekly-planning-dialogue-stack-verification.md)
   - `main`上のmodule、自動検証、production entrypoint、browser behaviorを区別して確認する。

### P1

3. [20260716-weekly-planning-entrypoint-request-ownership.md](tasks/20260716-weekly-planning-entrypoint-request-ownership.md)
   - conversation、turn、request、revision、selected week、reset、explicit cancel、retryのownershipを統一する。
4. [20260716-weekly-planning-trace-privacy-and-lifecycle.md](tasks/20260716-weekly-planning-trace-privacy-and-lifecycle.md)
   - trace subject token、全session本文のredaction、180日TTL、account deletion、限定admin accessを実装する。
5. [20260716-weekly-planning-longitudinal-personalization-data-governance.md](tasks/20260716-weekly-planning-longitudinal-personalization-data-governance.md)
   - account-linked profile、原履歴180日、profile訂正、account deletion、初回利用条件を実装する。
6. [20260716-weekly-planning-approval-persistence-and-idempotency.md](tasks/20260716-weekly-planning-approval-persistence-and-idempotency.md)
   - localStorageを越えたmulti-device、multi-tab、partial retryの重複保存防止を設計する。単一端末クラッシュ変種とdedupe脆弱性を2026-07-18に追加。
7. [20260718-weekly-planning-application-behavior-tests.md](tasks/20260718-weekly-planning-application-behavior-tests.md)
   - application層の結合挙動テストharnessを整備する。20260718系修正taskの受け皿として先行推奨。
8. [20260718-weekly-planning-approval-save-side-effect-isolation.md](tasks/20260718-weekly-planning-approval-save-side-effect-isolation.md)
   - 承認保存を画面副作用から分離し、週外日付承認での状態自壊を解消する。
9. [20260718-weekly-planning-approval-validation-session-binding.md](tasks/20260718-weekly-planning-approval-validation-session-binding.md)
   - 承認前検証をフォールバック定数・捏造値から実セッション値へ接続する。
10. [20260718-weekly-planning-approval-inflight-interruption.md](tasks/20260718-weekly-planning-approval-inflight-interruption.md)
    - 承認実行中のreset・週変更で未保存itemの保存を中断する。
11. [20260718-weekly-planning-restored-draft-approval-lifecycle.md](tasks/20260718-weekly-planning-restored-draft-approval-lifecycle.md)
    - リロード後に復元した仮予定の承認lifecycleを確定する。

### P2

12. [20260716-weekly-planning-trace-scalability-and-schema-migration.md](tasks/20260716-weekly-planning-trace-scalability-and-schema-migration.md)
    - pagination、query cost、index、archive、versioned decoderを設計する。
13. [20260716-weekly-planning-controller-ui-responsibility-split.md](tasks/20260716-weekly-planning-controller-ui-responsibility-split.md)
    - conversation controller、preview controller、view componentの責務を分離する。
14. [20260718-weekly-planning-user-boundary-storage-guard.md](tasks/20260718-weekly-planning-user-boundary-storage-guard.md)
    - userId切替時のstorage書き込み窓と承認ledgerのユーザー別key化。

### Completed record化待ち

- [20260718-weekly-planning-app-orchestration-extraction.md](tasks/20260718-weekly-planning-app-orchestration-extraction.md)
  - Status: completed。運用規則に従い`tasks/closed/`のcompletion recordへ統合してrootから閉じる。

AI/rules統合方式、「来週」と週の始まり、trace privacy、長期個別最適化データはproduct decision済みである。実装契約はcurrent contract status、post-merge status、roadmap、対応するroot taskを正とする。

## Implemented records

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
