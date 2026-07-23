# 監査4: dialogue UX

Status: fixed for identity continuity
最終更新: 2026-07-24

## 発見

表示上は前turnの会話が残っているため、利用者には一つの対話として見える。一方で内部では復元後のuser/assistant message IDが再び`turn:1`になり得た。

この状態は現在の配列表示では直ちに文章消失を起こさなくても、React key、重複抑止、返信参照、trace export、将来の部分更新で前turnと後turnを同一identityとして誤認する危険がある。

今回の実トレースでは、第二turnのstate snapshotが第一turnを`sourceTurns`へ保持しているのに、trace exportは別sessionとして表示された。利用者が見る会話単位と監査者が見るログ単位が一致していなかった。

## 修正

- 復元したmessage IDからcontrollerの次turn番号を決定し、同じconversation内でmessage IDを再利用しない。
- trace session、entry sequence、turn indexを同じconversationへ継続する。
- 結合テストで二つの発話が同じPlanningState、同じconversation ID、同じtrace sessionへ入り、request IDが1から2へ進むことを固定する。

## 対話内容に関する別所見

両トレースのassistant応答は同じ一般文であり、第二turnで受理した「院試」「ハードウェア」「OSnetwork」をacknowledgementへ反映していない。この問題はtrace結合とは別のdialogue grounding課題であり、本修正では意味状態を変更しない。Stable V5 dialogue policyの回帰対象として残す。
