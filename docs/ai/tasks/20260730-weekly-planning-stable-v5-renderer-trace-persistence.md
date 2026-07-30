# Stable V5 renderer trace persistence

Status: active
Date: 2026-07-30
Issue: #103
Branch: `agent/stable-v5-renderer-trace-persistence`

## Goal

PR #102で追加したAI dialogue rendererについて、採用・fallback・system bypassの判断情報を1ターン診断レコードへ永続化し、正常系の最終結果traceを欠落させない。

## Scope

- `dialogueRendererTrace`の実行結果保持
- application side effectからtrace runtimeへの伝播
- turn diagnosticへのサイズ制限付き保存
- 正常系`projectedResult`のfield整合
- fallback判定のsession／turn整合
- repository appendまでの統合test

以下は対象外とする。

- trace sessionの新規作成条件
- repositoryの選択
- Firestore／Worker transport
- 管理APIのページング
- PR #102以前から存在するtrace障害

## Exit conditions

- focused testが通過する
- typecheckが通過する
- `npm run verify`が通過する
- renderer request、raw response、fallback reason、final decisionがexport対象のturn diagnosticへ保存される
- AI、deterministic fallback、systemのresponse sourceが正しく保存される

ローカル検証完了後にStatusをclosedへ変更する。
