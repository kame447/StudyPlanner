# 週間計画の会話ログ・時系列行動基盤

Status: implementing
Priority: high
Repository: `kame447/StudyPlannner`
Base branch: `main`
Branch: `feat/weekly-planning-conversation-trace`
前提コミット: `00969de feat: proposal訂正時のunion narrowingを固定`

## 1. 目的

週間計画の実利用について、ユーザー発話、アプリ応答、解釈結果、状態遷移、readiness、feasibility、preview、approvalを、後から時系列で追跡できる構造化traceとして保存する。

計画ロジックの結果は変更しない。trace保存はbest effortとし、保存失敗によって会話処理、preview生成、approvalを失敗させない。

## 2. 採用アーキテクチャ

現行DBはCloud Firestoreであるため、SQL tableとmigrationを前提にせず、次の2 collectionを用いる。

```text
weekly_planning_trace_sessions
weekly_planning_trace_entries
```

`weekly_planning_trace_sessions`はsessionの一覧表示に必要なsummaryを持つ。

`weekly_planning_trace_entries`はappend-only journalとし、`kind`で次を判別する。

```text
turn
internal_event
state_snapshot
```

turn、internal event、snapshotは同じpayloadへ混在させず、TypeScriptのdiscriminated unionで別契約として管理する。一方、保存先を単一journalへ統合することで、session詳細、JSON export、retention、時系列sortのquery経路を一つにする。

session配下のsubcollectionは採用しない。理由は、親session削除時にsubcollectionが自動削除されず、user削除とretentionで孤児データを残しやすいためである。

## 3. 保存契約

### Session

```text
id
logicalConversationId
userId
status
startedAt
lastActivityAt
endedAt
planningRangeStart
planningRangeEnd
turnCount
entryCount
hasPreview
hasApprovalFailure
hasFallback
hasError
appVersion
schemaVersion
expireAt
```

status:

```text
active
completed
abandoned
failed
```

### Trace entry共通

```text
id
sessionId
logicalConversationId
userId
sequence
kind
requestId
stateRevision
occurredAt
observedAt
schemaVersion
expireAt
```

`sequence`はsession内の表示順である。document IDはsession IDとsequenceから決定し、retry時の重複を抑止する。

### Turn

```text
kind: turn
role: user | assistant
content
turnIndex
responseSource
```

### Internal event

```text
kind: internal_event
eventType
payload
severity
```

### Snapshot

```text
kind: state_snapshot
snapshotReason
state
```

## 4. 初期event catalog

```text
user_turn_received
interpreter_completed
candidate_accepted
candidate_rejected
assumption_proposed
assumption_accepted
assumption_rejected
assumption_superseded
correction_applied
correction_rejected
readiness_evaluated
feasibility_evaluated
dialogue_planned
fallback_used
preview_gate_evaluated
preview_generated
draft_promoted
approval_started
approval_item_saved
approval_item_failed
approval_completed
stale_async_result_discarded
trace_write_failed
```

自由文字列ではなく有限unionで管理する。

## 5. Redactionとvalidation

保存前に必ずrecursive redactionを実行する。

禁止keyは大小文字と区切りを正規化して判定する。

```text
prompt
rawPrompt
systemPrompt
secret
apiKey
accessToken
refreshToken
token
authorization
password
privateId
cookie
```

文字列、配列、objectの深さ、要素数、UTF-8相当サイズに上限を設ける。上限超過payloadは縮約または破棄し、計画処理自体は継続する。

## 6. 接続位置

### Pipeline完了

`weeklyPlanningBehaviorAwareIntakePipeline`のpublic entrypoint完了後に、次を記録する。

```text
user turn
interpreter diagnostics
assumption lifecycle
correction lifecycle
readiness
feasibility
allowed actions
preview gate
preview summary
state snapshot
non-exam assistant turn
```

### Exam dialogue renderer完了

最終的に画面へ返すassistant messageとresponse sourceを記録する。

### Preview promotion

preview candidateをdraft blockへ昇格した件数、preview ID、state revisionを記録する。

### Approval

approval開始、itemごとのsaved／duplicate／failed、完了statusを記録する。

## 7. Debug viewer

開発環境の次routeで提供する。

```text
/debug/weekly-planning-conversations
```

認証済みuserは自分のsessionのみ閲覧できる。admin横断閲覧は今回実装しない。

表示内容:

```text
session一覧
conversation timeline
internal events
state snapshots
redacted JSON export
```

## 8. Retention

初期値は90日とする。全entryとsessionに`expireAt`を保存し、Firestore TTL policyを別途有効化できる状態にする。

TTL設定自体はrepository codeだけでは有効化できないため、deploy作業として残す。

## 9. テスト要件

```text
redaction後に禁止keyが残らない
payload上限が機能する
sequence順が安定する
同一entry IDのretryで重複しない
user ownershipが一致しない書き込みを拒否する
保存失敗でもpipeline outputが変化しない
corrupt entryをviewerがsafe discardする
exportがredacted済みである
```

## 10. 完了条件

```text
実会話のuser／assistant turnが保存される
主要な内部処理を時系列で追跡できる
state snapshotを確認できる
previewとapprovalをsessionへ関連付けられる
debug viewerからDeveloper Toolsなしで確認できる
JSON exportが可能である
機密情報を保存しない
既存の計画結果を変更しない
TypeScript、targeted test、full test、buildが成功する
```

## 11. Codex検証コマンド

```sh
npm run test:run -- src/features/weeklyPlanning/trace
npm run test:run -- src/features/weeklyPlanning
npm run test:run
npm run build
```

Firestore Emulatorを利用できる場合は、rules testでowner以外のread／write拒否とappend-only制約も確認する。
