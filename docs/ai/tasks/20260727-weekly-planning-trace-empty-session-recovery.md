# Stable V5 trace 空session重複の修復

Status: implementing
Priority: blocker
Issue: #89
Branch: `agent/trace-empty-session-seven-audit`
Audit: `docs/ai/audits/20260727-stable-v5-trace-empty-session-seven-audit.md`
Base: `259c50b0becda18007f76709aa81b56db4997e97`

## 目的

同一logical conversationに`turnCount=0`かつ`entryCount=0`のserver trace sessionが複数作成される不具合を修正し、Stable V5 full debug traceをWorkerへ実際に保存できるようにする。

## 根本原因

- frontendのevent catalogとWorker allowlistが不一致
- frontend debug chunk上限350KBとWorker document上限64KiBが不一致
- remote appendにentry count・request byte sizeのbatchingがない
- session start成功後、append失敗前のlocal identity cursorが未保存
- admin viewerが空sessionを未export activityとして表示

## 実装要件

1. event catalogとtransport limitsをshared contractへ統合する
2. `stable_v5_debug_stage`をWorkerで受理する
3. debug chunkをbase64/envelope込みでdocument上限未満にする
4. appendをentry数とrequest byte数でbatch化する
5. batchごとのsession.entryCountを単調増加させる
6. session作成時にzero-count cursorを先行保存する
7. append失敗・reload後も同じlocal session/server handleを使う
8. empty sessionを未export一覧から除外する
9. historical empty documentsは自動削除・自動mergeしない
10. transport、session continuity、admin UXの回帰testを追加する

## 対象外

- historical empty sessionの物理削除
- 異なるlogical conversationの統合
- cross-tab sequence coordination
- abrupt close時のdurable delivery
- dialogue grounding
- trace source semantics再設計

対象外は`20260724-weekly-planning-runtime-followups.md`で継続管理する。

## 検証

```bash
npm run test:run -- src/features/weeklyPlanning/trace
npm run test:run -- workers/ai-proxy/src/weeklyPlanningTracePrivacy.test.ts workers/ai-proxy/src/weeklyPlanningTraceApi.test.ts
npm run typecheck
npm run typecheck:build
npm run build
git diff --check origin/main...HEAD
```

実機では同じconversationへ入力後、管理者viewerで次を確認する。

```text
session件数: 1
turnCount > 0
entryCount > 0
JSON exportでstableV5DebugStagesを再構成可能
再読込・retry後もsession件数が増えない
```

## 完了条件

- 七視点監査のBLOCKERをすべて解消
- focused tests、typecheck、typecheck:build、build、diff check成功
- task本文へ検証結果とmerge SHAを記録
- 本taskを`docs/ai/tasks/closed/`へ移動
- current contract/status/docs indexを同期
- 実機確認前はIssue #89をcloseしない