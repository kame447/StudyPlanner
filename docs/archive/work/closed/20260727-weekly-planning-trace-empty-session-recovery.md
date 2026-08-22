# Stable V5 trace 空session重複の修復

Status: closed / implementation and automated verification complete
Closed: 2026-07-28
Issue: #89
Branch: `agent/trace-empty-session-seven-audit`
Audit: `docs/ai/audits/20260727-stable-v5-trace-empty-session-seven-audit.md`
Task inventory: `docs/ai/audits/20260728-weekly-planning-active-task-inventory.md`

## 完了内容

- frontend/Workerのevent catalogとtransport limitsをshared contractへ統合
- `stable_v5_debug_stage`をWorkerで受理
- debug JSONをdocument/string/token-redaction境界内のdotted base64 chunkへ変換
- appendをentry countとserialized request bytesでbatch化
- batchごとのsession entryCountを単調増加
- session start直後にzero-count identity cursorを保存
- append失敗・reload後も同じlocal session/server handleを再利用
- empty sessionを標準未export一覧から除外
- runtime、remote repository、Worker API、admin list、exportの結合testを追加
- historical empty documentsを自動mergeしない

## 最終automated verification

2026-07-28、利用者環境でfinal branch headを検証した。

```text
focused verification:
  5 files passed
  46 tests passed

trace directory full:
  18 files passed
  79 tests passed

npm run typecheck:
  passed

npm run typecheck:build:
  passed

npm run build:
  passed

git diff --check origin/main...HEAD:
  passed (no output)
```

Build時に次のwarningがあるが、今回の変更によるfailureではない。

- dynamic importとstatic importの併用によりchunk分離されないmoduleが2件
- minified chunkが500KBを超える既存bundle warning

Test中の`cursor persistence failed`およびinjected write failureは、storage未導入harnessまたは失敗回復scenarioで意図的に発生させているstderrであり、全assertionは成功した。

## post-merge verificationの移管

main merge/deploy後に次を確認する作業は、implementation taskの未完了としてrootへ残さず、production trace operations taskとIssue #89へ移管する。

- `../20260716-weekly-planning-trace-privacy-and-lifecycle.md`

確認項目:

```text
same logical conversationのsession件数 = 1
turnCount > 0
entryCount > 0
JSON exportでstableV5DebugStagesを再構成可能
reload/retry後もsession件数が増えない
```

Issue #89は上記実環境確認が完了するまでopenを維持する。

## 対象外

- historical empty sessionの物理削除
- 異なるlogical conversationの統合
- cross-tab sequence coordination
- abrupt close時のdurable delivery
- dialogue grounding
- trace source semantics再設計

対象外は`../20260724-weekly-planning-runtime-followups.md`で継続管理する。