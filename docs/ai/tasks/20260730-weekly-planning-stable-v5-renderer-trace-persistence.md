# Stable V5 renderer trace persistence

Status: active / local re-verification pending
Date: 2026-07-31
Issue: #103
PR: #104
Branch: `agent/stable-v5-renderer-trace-persistence`

## Goal

PR #102で追加したAI dialogue rendererについて、採用・fallback・system bypassの判断情報を1ターン診断レコードへ永続化し、正常系の最終結果traceを欠落させない。追加fieldによって既存の保存上限、outbox、stale処理、Worker schema、管理表示、exportを壊さない。

## Scope

- `dialogueRendererTrace`の実行結果保持
- application side effectからtrace runtimeへの伝播
- turn diagnosticへのサイズ制限付き保存
- 正常系`projectedResult`のfield整合
- fallback判定のsession／turn整合
- stale／commit rejectedでassistant outputを保存せずrenderer診断を保持する経路
- outbox向けrenderer payload制限と重複debug情報の除去
- 48KB client targetと64KB server hard limitの境界検証
- Worker schema、管理表示、exportへの回帰確認
- repository appendまでの統合test

以下の既存機能自体の修正は対象外とする。

- trace sessionの新規作成条件
- repositoryの選択
- Firestore／Worker transport実装
- 管理APIのページング
- PR #102以前から存在するtrace障害

## Exit conditions

- focused testが通過する
- typecheckが通過する
- `npm run verify`が通過する
- renderer request、raw response、fallback reason、final decisionがexport対象のturn diagnosticへ保存される
- AI、deterministic fallback、systemのresponse sourceが正しく保存される
- stale turnはassistant textを保存せず、試行済みrenderer診断とsystem sourceを保存する
- diagnosticがclient target内に収まり、Worker preparation後もserver hard limit内に収まる
- failed writeのoutbox再送でrenderer診断が欠落しない

ローカル検証完了後にStatusをclosedへ変更する。
