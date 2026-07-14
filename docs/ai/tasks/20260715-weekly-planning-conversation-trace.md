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

現行DBはCloud Firestoreであるため、次の2 collectionを用いる。

```text
weekly_planning_trace_sessions
weekly_planning_trace_entries
```

`weekly_planning_trace_sessions`は一覧表示用summaryを持つ。

`weekly_planning_trace_entries`はappend-only journalとし、TypeScriptのdiscriminated unionで次を分離する。

```text
turn
internal_event
state_snapshot
```

session配下のsubcollectionは採用しない。親session削除時に子が自動削除されず、retentionとaccount deletionで孤児データを残しやすいためである。

## 3. 保存契約

sessionには次を保存する。

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

entry共通項目は次とする。

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

`sequence`はsession内の表示順である。document IDはsession IDとsequenceから決定し、同一内容のretryを冪等にする。

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

event typeは自由文字列ではなく有限unionで管理する。

## 5. Redactionとvalidation

保存前にrecursive redactionを実行する。

禁止key候補:

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

文字列長、配列数、object key数、深さ、serialized sizeへ上限を設ける。上限超過時も週間計画処理は継続する。

## 6. 接続位置

次の境界を記録する。

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
assistant turn
draft promotion
approval start
approval item result
approval completion
fallback
```

## 7. 管理者viewer

独立したdevelopment debug routeは設けない。

既存の管理者画面へ次のrouteを追加する。

```text
/admin/weekly-planning-traces
```

入口は`AdminApp`と`AdminGuard`を通し、Firestoreの`admins/{uid}.enabled == true`で許可されたユーザーだけが閲覧できる。

管理者画面では次を提供する。

```text
全ユーザーのsession一覧
user IDによる絞り込み
status／error／fallback／preview filter
conversation timeline
internal events
state snapshots
redacted JSON export
evaluation fixture候補
roleplay候補
```

Firestore Rulesでは、traceのreadを管理者だけに許可する。通常ユーザーは自分のtraceを書き込めるが、viewerとraw documentのreadは許可しない。

## 8. Retention

初期保持期間は90日とする。sessionとentryへ`expireAt`を保存し、Firestore TTL policyを別途設定する。

TTL policyの作成とaccount deletion時の明示削除はdeploy／運用タスクとして残す。

## 9. テスト要件

```text
redaction後に禁止keyが残らない
payload上限が機能する
sequence順が安定する
同一entry IDのretryが冪等になる
異なる内容によるentry上書きを拒否する
user ownership不一致の書き込みを拒否する
管理者一覧で複数userのsessionを取得できる
非管理者がtraceをreadできない
管理者が全sessionとentryをreadできる
保存失敗でもpipeline outputが変化しない
corrupt entryをsafe discardする
exportがredacted済みである
```

## 10. 完了条件

```text
実会話のuser／assistant turnが保存される
主要な内部処理を時系列で追跡できる
state snapshotを確認できる
previewとapprovalをsessionへ関連付けられる
管理者画面からDeveloper Toolsなしで確認できる
非管理者はviewerとFirestore traceを閲覧できない
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

Firestore Emulatorを利用できる場合は、次も確認する。

```text
管理者だけがtrace sessionをlistできる
管理者だけがtrace entryをreadできる
通常ユーザーは自分のsession／entryをcreateできる
通常ユーザーでもtraceをreadできない
session immutable fieldを変更できない
entryを異なる内容でupdateできない
```
