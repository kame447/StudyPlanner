# 監査7: tests / merge hygiene

Status: fixed, automated execution pending CI result
最終更新: 2026-07-24

## 既存testの評価

PR #79で追加されたapplication再マウントtestは、同じconversation IDとFact Graphが復元されることを確認していた。しかし次は確認していなかった。

- controller request sequence
- turn/message IDの一意性
- trace local session ID
- trace entry sequence
- trace turn index
- remote idempotency keyの継続
- canonical server sessionの継続
- append失敗後のcounter rollback
- persisted trace cursorのowner / schema / counter validation

したがって今回の不具合に対する結合testは未追加だった。

## 追加test

- trace runtime memory消失後も同じtrace session IDへ復帰する。
- 第二writeのentry sequenceが第一writeの末尾から続く。
- turn indexが`0,1,2,3`と連続する。
- 同一requestのretryを重複記録しない。
- repository append失敗後のretryがsequence 0から始まり、失敗分を消費しない。
- controllerを同じconversation IDで作り直しても、PlanningStateのmessage IDから次turnを2として発行する。
- controller、reducer、trace runtimeを跨いだ二turn結合testで、同じstateと同じtrace sessionへ記録される。
- remote repositoryを作り直した後も同じlocal idempotency keyを再提示し、同じcanonical server sessionへappendする。
- cursorに会話本文が含まれず、unknown field、owner変更、schema変更、counter divergenceを拒否する。
- user IDとconversation IDのstorage key境界が曖昧にならない。

## merge hygiene

修正は専用branchで行い、mainへ直接書き込まない。current contract、runtime trial contract、implementation status、roadmap、docs index、七視点監査を実装差分と同期する。

GitHub Actionsは`ubuntu-latest`の`verify` jobを生成したが、step 0件、logsなしで終了した。これはtest failureではなくrunner起動前の実行基盤failureとして扱う。

CIまたは別の実行環境でfocused test、full test、typecheck、buildの結果を取得するまでは、automated verifiedまたはmerge可とは表記しない。
