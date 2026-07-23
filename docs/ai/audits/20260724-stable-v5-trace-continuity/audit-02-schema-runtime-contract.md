# 監査2: schema / runtime contract

Status: fixed
最終更新: 2026-07-24

## 発見

`logicalConversationId`は会話相関ID、`session.id`は連続したtrace entry列のIDである。しかし実装は、同じconversationを復元しながらtrace sessionだけを再発行していた。さらにcontrollerが`request:1`を再発行するため、同一conversation内でrequest IDの一意性も破っていた。

既存のStable V5 session envelopeはconversation、Graph、PlanningStateを保存するが、traceのentry cursorを保存していない。remote trace APIはlocal session IDをidempotency keyとしてserver sessionを発行するため、local session IDを復元できればserver schema変更は不要である。

## 修正

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

raw user text、assistant本文、Graph、semantic documentはcursorへ保存しない。cursorはstrict validationし、owner、conversation、count、timestamp、size、retentionの不整合時に全体を破棄する。

controllerはmessage IDのclosed formだけを読む。

```text
<conversationId>:turn:<positive integer>:user
<conversationId>:turn:<positive integer>:assistant
```

他conversation、不正role、不正sequenceは連番復元へ使用しない。
