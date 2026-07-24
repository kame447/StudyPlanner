# 監査4: dialogue UX

Status: fixed for identity continuity / grounding follow-up remains / local verification pending
最終更新: 2026-07-24
Reviewed main baseline: `a669b166db30fa3f355371c089062eb5cf4e3987`

## 発見

表示上は前turnの会話が残るため、利用者には一つの対話として見える。一方で旧実装は、再マウント後にuser/assistant message ID、turn ID、request IDを再び1から発行し得た。

`clear_conversation`はconversation IDを維持したままmessagesを空にする。message列だけをsequence復元根拠にすると、clear後のreloadで過去request IDを再利用し、trace dedupeによって新しい発話が記録されない危険があった。

この状態は配列表示で直ちに文章消失を起こさなくても、React key、重複抑止、返信参照、trace export、将来の部分更新で前turnと後turnを同一identityとして誤認させる。

## 修正

- PlanningStateへ`conversationRequestSequence`を明示保存する。
- controllerはsession memory、`conversationRequestSequence`、有効なmessage IDの最大sequenceを比較し、その最大値より後のsequenceを発行する。
- `begin_turn`は現在値より大きいsequenceだけを受理し、同じPlanningStateへ保存する。
- `clear_conversation`はmessagesを消去しても`conversationRequestSequence`を保持する。
- `reset_session`だけがsequenceを0へ戻し、新しいconversation scopeと組み合わせる。
- trace session、entry sequence、turn indexを同じconversationへ継続する。
- 30分を超えるidleを会話終了として扱わない。
- 結合testで二つの発話が同じPlanningState、conversation ID、local trace session、server handleへ入り、request IDが1から2へ進むことを固定する。

PlanningStateの一般的な`revision`からrequest sequenceを推測しない。revisionはstate mutation回数であり、request identityの専用counterではない。

## 対話内容に関する別所見

実トレースの第二turnでは「院試」「ハードウェア」「OSnetwork」を受理しているが、assistantは第一turnと同じ一般質問を返していた。identity continuityを直しても、受理内容をacknowledgementへ反映しなければ利用者には会話が進んでいないように見える。

これはtrace結合とは別のdialogue grounding課題である。accepted fact diff、acknowledgement、次の不足質問を分離し、multi-turn roleplayで回帰させる。
