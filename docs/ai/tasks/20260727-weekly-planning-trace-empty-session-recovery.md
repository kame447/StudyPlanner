# Stable V5 trace 空session重複の修復

Status: implementation complete / first verification failed / fixes applied / rerun required
Priority: blocker
Issue: #89
Branch: `agent/trace-empty-session-seven-audit`
Audit: `docs/ai/audits/20260727-stable-v5-trace-empty-session-seven-audit.md`
Task inventory: `docs/ai/audits/20260728-weekly-planning-active-task-inventory.md`
Base: `259c50b0becda18007f76709aa81b56db4997e97`

## 1. 目的

同一logical conversationに`turnCount=0`かつ`entryCount=0`のserver trace sessionが複数作成される不具合を修正し、Stable V5 full debug traceをWorkerへ実際に保存できるようにする。

## 2. 根本原因

- frontendのevent catalogとWorker allowlistが不一致
- frontend debug chunk上限350KBとWorker document上限64KiBが不一致
- Workerの4,000文字上限・token redactionが通常base64 chunkを破壊
- remote appendにentry count・request byte sizeのbatchingがない
- session start成功後、append失敗前のlocal identity cursorが未保存
- admin viewerが空sessionを未export activityとして表示

## 3. 実装済み

1. event catalogとtransport limitsをshared contractへ統合
2. `stable_v5_debug_stage`をWorkerで受理
3. raw debug chunkを2,700 bytesへ縮小
4. base64を20文字runへ分割するtransport-safe encodingを導入
5. export時に区切りを除去してUTF-8 JSONを再構成
6. appendを100 entriesとserialized request bytesでbatch化
7. batchごとのsession.entryCountを単調増加
8. session作成時にzero-count cursorを先行保存
9. append失敗・reload後も同じlocal session/server handleを使用
10. empty sessionを未export一覧から除外
11. runtime、remote repository、Worker API、admin list、exportの結合testを追加
12. historical empty documentsは自動削除・自動mergeしない

## 4. 初回automated verification結果

2026-07-28に利用者環境で実行。

成功:

- focused trace: 9 files / 65 tests passed
- `npm run typecheck:build`: passed
- `npm run build`: passed
- build warningは既存のdynamic/static importとchunk size warning

失敗:

- trace directory full: 18 files中1 file failure、79 tests中1 test failure
- `npm run typecheck`: 1 error

### Failure F1: old test decoder

```text
weeklyPlanningStableV5TraceRuntimeDebugStages.test.ts
InvalidCharacterError: Invalid character
```

production encodingを`base64-utf8-json-dotted-20`へ変更したが、既存test helperが`.`を除去せず直接`atob()`していた。

修正:

- 独自decoderを共通`decodeWeeklyPlanningTraceDebugChunkBase64`へ接続
- production exportとtestが同じdecode contractを使用

### Failure F2: fixture union typing

```text
weeklyPlanningTraceRemoteRepository.test.ts
TS2322: eventType does not exist in WeeklyPlanningTraceTurnEntry
```

`entry()`が`WeeklyPlanningTraceEntry` unionを返し、それをspreadしたdebug fixtureをTypeScriptがturnの可能性ありと判定した。

修正:

- `entry()`と`debugEntry()`の戻り値を`WeeklyPlanningTraceInternalEventEntry`へ固定
- production型を緩めずtest fixtureを正しくnarrow

両修正はbranchへ反映済み。再実行結果が得られるまで本taskをclosedへ移さない。

## 5. 再検証コマンド

```bash
npm run test:run -- \
  src/features/weeklyPlanning/trace/weeklyPlanningTraceArchive.test.ts \
  src/features/weeklyPlanning/trace/weeklyPlanningTraceRemoteRepository.test.ts \
  src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceRuntime.test.ts \
  src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceRuntimeDebugStages.test.ts \
  src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceRemoteContinuity.integration.test.ts \
  src/features/weeklyPlanning/trace/weeklyPlanningTraceExport.test.ts \
  src/features/weeklyPlanning/trace/weeklyPlanningTraceExportStableV5Debug.test.ts \
  workers/ai-proxy/src/weeklyPlanningTracePrivacy.test.ts \
  workers/ai-proxy/src/weeklyPlanningTraceStableV5Debug.integration.test.ts \
  workers/ai-proxy/src/weeklyPlanningTraceServerAuthority.integration.test.ts

npm run test:run -- src/features/weeklyPlanning/trace
npm run typecheck
npm run typecheck:build
npm run build
git diff --check origin/main...HEAD
```

## 6. 実機verification

mainへ統合・deploy後、同じconversationへ入力して管理者viewerで次を確認する。

```text
session件数: 1
turnCount > 0
entryCount > 0
JSON exportでstableV5DebugStagesを再構成可能
再読込・retry後もsession件数が増えない
```

## 7. 対象外

- historical empty sessionの物理削除
- 異なるlogical conversationの統合
- cross-tab sequence coordination
- abrupt close時のdurable delivery
- dialogue grounding
- trace source semantics再設計

対象外は`20260724-weekly-planning-runtime-followups.md`で継続管理する。

## 8. 完了条件

- [x] 七視点監査を作成
- [x] code implementation
- [x] focused trace 65 tests success at first verification
- [ ] rerun後のfocused tests success
- [ ] trace full tests success
- [ ] `npm run typecheck` success
- [x] first verificationで`typecheck:build` success
- [x] first verificationでbuild success
- [ ] final headでtypecheck:build/buildを再確認
- [ ] final headでdiff check success
- [ ] task本文へ最終検証結果を記録
- [ ] 本taskを`docs/ai/tasks/closed/`へ移動
- [ ] current contract/status/docs indexを同期
- [ ] main deploy後のadmin実機確認

実機確認前はIssue #89をcloseしない。automated verificationがredの間はPRをready/mergeしない。