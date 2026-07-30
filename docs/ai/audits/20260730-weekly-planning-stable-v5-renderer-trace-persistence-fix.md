# Stable V5 renderer trace persistence 修正記録

Status: implementation complete / local verification pending
Date: 2026-07-30
Issue: #103
Branch: `agent/stable-v5-renderer-trace-persistence`
Base: `ee0dbc0006e3b82e950d0a4b3e4c720de41cd1c6`

## 対象

PR #102で追加したAI dialogue rendererのtrace経路だけを対象とする。session作成、保存先選択、Worker transport、管理APIの既存問題は本修正へ混在させない。

## 確認した不具合

1. 正常系`turn_executor_result_projected`は`result`を記録していたが、debug projectionは`projectedResult`を読んでいた。
2. rendererのrequest、raw response、fallback reason、final decisionはdebug traceへ書かれるだけで、1ターン診断レコードへ永続化されなかった。
3. `responseSource: deterministic_fallback`でもturn diagnosticの`diagnostics.fallback`がnullになり、sessionの`hasFallback`と不整合だった。
4. executor単体testはdebug trace recorderをmockしており、side effectからrepository appendまでの欠落を検出できなかった。

## 修正内容

- 正常系の最終結果を`projectedResult`へ統一した。
- executor resultへ`dialogueRendererTrace`を追加した。
- renderer traceにaction、決定済み質問情報、fallback文、raw response、採用文、fallback理由、最終sourceと最終文面を保持する。
- application side effectからStable V5 trace runtimeへrenderer traceを明示的に渡す。
- 1ターン診断レコードの`diagnostics.dialogueRenderer`へサイズ制限付きで保存する。
- Events表示は既存の`diagnostics`表示経路を使用するため、追加UI分岐なしでrenderer情報を確認できる。
- deterministic fallback時は`diagnostics.fallback`へrenderer reasonを保存し、sessionとturnのfallback判定を一致させる。

## 追加・更新した検証

- AI採用、deterministic fallback、system bypass時のexecutor result検証
- 正常系`projectedResult`の回帰検証
- side effectによるrenderer trace伝播検証
- diagnosticへのrenderer trace格納とサイズ制限検証
- trace runtimeからrepository appendまでの統合検証
- deterministic fallback時のsession／turn整合性検証

## 未確認

GitHub Actionsは利用しない。ローカル環境でfocused test、typecheck、full verifyを実行するまで成功とは判定しない。
