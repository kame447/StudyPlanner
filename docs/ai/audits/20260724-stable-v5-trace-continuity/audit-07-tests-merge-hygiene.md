# 監査7: tests / merge hygiene

Status: implementation fixed / branch consolidation archived / local execution pending
最終更新: 2026-07-24
Reviewed main baseline: `a669b166db30fa3f355371c089062eb5cf4e3987`

## 既存testの評価

PR #79で追加されたapplication再マウントtestは、同じconversation IDとFact Graphが復元されることを確認していた。しかし次の結合境界を確認していなかった。

```text
controller request sequence
clear conversation後のsequence下限
turn / request / message IDの一意性
trace local session ID
30分を超えるidle後のidentity
trace entry sequence
trace turn index
remote repository再生成後のserver handle
30日secret epoch境界
append失敗後のcounter rollback
persisted trace cursorのowner / schema / counter validation
```

したがって今回の不具合に対する結合testは不足していた。

## 追加test

概念レベルで並列な検証項目として、次を追加した。

```text
runtime memory消失後も同じtrace session IDへ復帰
第二writeのentry sequenceが第一write末尾から継続
turn indexが0,1,2,3と連続
同一request retryの重複記録防止
repository append失敗後のretryがsequenceを消費しない
同じconversation IDでcontrollerを作り直しても次turnを復元
clear conversationでmessagesを消去後、reloadしてもrequest IDを再利用しない
controller、reducer、trace runtimeを跨ぐ二turn結合
1時間idle後も同じphysical trace sessionへ継続
remote repository再生成後もserver-issued handleを再発行しない
stale handleだけを再発行しappendを一度retry
transient append failureでは同じcanonical payloadをretry
cursorに会話本文を保存しない
unknown field、owner変更、schema変更、counter divergenceを拒否
user IDとconversation IDのstorage key境界を分離
```

Vitestのdefault environmentはNodeであり、`window`は自動提供されない。remote repository unit testにはmemory Storageを明示的にinstallし、localStorage persistenceを実際に通すよう修正した。これを行わない場合、repository再生成testは保存経路を通らず、`startSession`回数の期待だけが不正になる。

## branch / PR hygiene

同一目的の修正、診断、再検証はDraft PR #83と`agent/stable-v5-trace-conversation-continuity`だけで行う。検証失敗またはrunner障害を理由に新しいbranchやPRを作らない。

PR #84とPR #85はduplicateとしてclosedであり、mainへmergeしない。PR #82、#84、#85の固有資産は次へ退避した。

```text
docs/ai/audits/20260724-pr83-branch-consolidation/archive-manifest.md
docs/ai/audits/20260724-pr83-branch-consolidation/archive/
```

退避対象にはPR #82の旧workflowと旧七視点監査、PR #84とPR #85の診断script、PR #83に残っていた一時Cloudflare検証scriptを含む。archive scriptは`.txt`として保存し、自動実行されない。

`package.json`の`build`は通常の`vite build --config vite.config.mjs`へ戻した。rootの一時Cloudflare検証scriptは削除した。archive、設定復元、文書同期、最終SHA比較、ローカル検証が終わるまで旧branchを削除しない。

## verification source

GitHub Actionsは現在利用できないため、本PRの成功証跡として使用しない。過去のstep 0件、logsなしのfailureもコード合否には使用しない。

検証の正本は、PR #83の固定headをcheckoutしたローカル環境で実行する次の結果である。

```text
focused trace / controller / integration tests
full Vitest
typecheck
Vite production build
git diff --check
branch previewでreload・1時間idle・clear後再送
admin exportが一つのsessionへ継続
```

結果は実行したcommit SHAとともにPR本文および本監査へ記録する。

## branch削除禁止条件

```text
archive元とarchive内容の照合が完了していない
PR #83のheadが照合中に変化した
旧branchに未移植のproduction code、test、文書、診断資産が残る
package.jsonまたはroot scriptsに一時検証設定が残る
focused tests、full Vitest、typecheck、Vite build、diff checkの成功結果がない
旧branch headと検証済みPR #83 headの最終比較が終わっていない
```

## merge禁止条件

```text
focused trace testsの成功結果がない
full Vitestの成功結果がない
typecheckの成功結果がない
production buildの成功結果がない
branch previewでreload・1時間idle・clear後再送を確認していない
admin exportが一つのsessionになることを確認していない
unresolved review threadが残る
PRがDraft解除またはmergeされている
```

上記が残る間は、implementation completeとautomated verifiedを区別し、採用可またはmerge可と表記しない。
