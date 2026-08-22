# 監査2: schema / runtime contract

Status: implementation fixed / local verification pending
最終更新: 2026-07-24
Reviewed main baseline: `a669b166db30fa3f355371c089062eb5cf4e3987`

## 発見

`logicalConversationId`は会話系列、local `session.id`はbrowser側の連続trace entry列、server-issued handleはremote repository上のcanonical identityである。旧実装は同じconversationを復元しながらlocal sessionとserver handleを再発行し、controllerも`request:1`を再利用し得た。

Stable V5 application envelopeはconversation、Graph、PlanningStateを保存するが、trace cursorとserver handleは別schemaである。これらをapplication stateへ混ぜると、会話本文のretention、Graph transaction、trace deliveryの責務が曖昧になるため、別のclosed envelopeを維持する。

## local trace cursor

metadata-only cursorへ次を保存する。

```text
version
userId
conversationId
session metadata
nextSequence
nextTurnIndex
lastActivityMs
recent requestIds
savedAt
```

raw user text、assistant本文、Graph、semantic documentはcursorへ保存しない。owner、conversation、count、timestamp、size、retention、unknown fieldの不整合時に全体を破棄する。30分idleを失効条件にせず、cursor自体のretentionは90日とする。

## controller sequence

controllerは次の三値を単調下限として使用する。

```text
controller session memoryのrequestSequence
PlanningState.conversationRequestSequence
有効なmessage IDから復元した最大sequence
```

message IDは次のclosed formだけを使用する。

```text
<conversationId>:turn:<positive integer>:user
<conversationId>:turn:<positive integer>:assistant
```

次request sequenceは三値の最大値に1を加えた値である。`begin_turn`は現在の`conversationRequestSequence`より大きい安全な整数だけを受理し、PlanningStateへ保存する。他conversation、不正role、不正sequenceは使用しない。

`clear_conversation`はmessagesを空にするが`conversationRequestSequence`を保持する。このため、clear後にreloadしても過去のturn、request、message IDへ戻らない。`reset_session`だけが`conversationRequestSequence`を0へ戻し、新しいconversation scopeの開始と組み合わせる。PlanningStateの一般的な`revision`からrequest sequenceを推測しない。

## remote server handle

server-issued handleは次だけをowner・local sessionに拘束して保存する。

```text
sessionId
logicalConversationId
```

server UUID形式とunknown fieldを検証する。repository instanceを作り直しても同じhandleを使用し、30日secret epoch境界で`startSession`を再実行しない。stored handleはowner認証の正本ではなく、append APIのFirebase認証とserver-side owner token検証を維持する。

serverがsession不存在、ownership conflict、legacy read-only、conversation conflictを明示した場合だけhandleを再発行する。一時的network failureは同じcanonical payloadを再送する。
