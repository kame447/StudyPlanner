# Stable V5 renderer trace persistence

Status: closed
Date: 2026-07-31
Issue: #103
PR: #104
Branch: `agent/stable-v5-renderer-trace-persistence`
Verified head: `bb7407db8d817c050719502450def290db4de950`

## Goal

PR #102で追加したAI dialogue rendererについて、採用・fallback・system bypassの判断情報を1ターン診断レコードへ永続化し、正常系の最終結果traceを欠落させない。

## Completed scope

- `dialogueRendererTrace`をexecution resultへ保持
- application side effectからtrace runtimeへ伝播
- turn diagnosticの`diagnostics.dialogueRenderer`へサイズ制限付き保存
- 正常系`projectedResult`のfield整合
- fallback判定のsession／turn整合
- committed／stale／failed経路のsourceと保存内容の分離
- outbox投入前のrenderer payload制限と重複debug情報除去
- failed write後のoutbox再送でrenderer情報を保持
- UTF-8 code point境界での切り詰め
- 48KB client targetとWorker側64KB hard limitの余白確保
- repository appendおよびWorker preparationまでの統合test
- 管理画面Eventsとschema v2 exportの既存保持経路との互換確認

## Out of scope

- trace sessionの新規作成条件
- repositoryの選択
- PR #102以前から存在するtrace障害
- bundle chunk最適化

## Verification

2026-07-31にhead `bb7407db8d817c050719502450def290db4de950`で`npm run verify`を実行した。

- typecheck: pass
- test files: 250 passed / 7 skipped
- tests: 1732 passed / 19 skipped / 5 todo
- production build: pass

Viteのdynamic import重複および500KB超chunkの警告はbuild failureではなく、本taskから分離する。

## Exit conditions

- focused test: pass
- typecheck: pass
- full `npm run verify`: pass
- renderer request、raw response、fallback reason、final decisionをexport対象turn diagnosticへ保存
- AI、deterministic fallback、systemのresponse sourceを保存
- Worker preparation後もdocument hard limit内

すべて完了したためclosedとする。
