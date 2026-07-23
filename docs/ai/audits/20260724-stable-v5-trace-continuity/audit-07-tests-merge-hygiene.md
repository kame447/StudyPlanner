# 監査7: tests / merge hygiene

Status: implementation fixed / automated execution pending
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

## merge hygiene

修正は専用branchとDraft PR #83で行い、mainへ直接書き込まない。current contract、runtime trial contract、current status、implementation status、migration plan、semantic roadmap、general roadmap、docs index、七視点監査を実装差分と同期する。

GitHub Actionsは`ubuntu-latest`の`verify` jobを生成したが、step 0件、logsなしで終了した。これはcode test failureではなくrunner起動前の実行基盤failureとして扱う。一方で、focused test、full test、typecheck、buildの成功証跡でもない。

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
