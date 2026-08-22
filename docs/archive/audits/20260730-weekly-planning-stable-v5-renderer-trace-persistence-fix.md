# Stable V5 renderer trace persistence 修正記録

Status: verified / ready to merge
Date: 2026-07-31
Issue: #103
PR: #104
Branch: `agent/stable-v5-renderer-trace-persistence`
Base: `ee0dbc0006e3b82e950d0a4b3e4c720de41cd1c6`
Verified head: `bb7407db8d817c050719502450def290db4de950`

## 対象

PR #102で追加したAI dialogue rendererのtrace経路だけを対象とする。session作成、保存先選択、管理APIの既存障害は本修正へ混在させない。ただし今回の追加が既存transport、outbox、Worker schema、管理画面、exportへ回帰を起こさないかは確認対象に含めた。

## 確認した不具合

1. 正常系`turn_executor_result_projected`は`result`を記録していたが、debug projectionは`projectedResult`を読んでいた。
2. rendererのrequest、raw response、fallback reason、final decisionはdebug traceへ書かれるだけで、1ターン診断レコードへ永続化されなかった。
3. `responseSource: deterministic_fallback`でもturn diagnosticの`diagnostics.fallback`がnullになり、sessionの`hasFallback`と不整合だった。
4. executor単体testはdebug trace recorderをmockしており、side effectからrepository appendまでの欠落を検出できなかった。
5. 追加test fixtureのruntime sessionに必須`weekStartDate`がなく、focused testは通る一方でtypecheckが失敗した。
6. renderer追加後のサイズ判定が64KB server limitだけを見ていた。Workerがsubject token、policy version、expiry等を後付けするため、client側で64KB近くまで使うとserver preparation後にwriteが拒否される可能性があった。
7. UTF-8文字列をbyte境界で単純切断すると、複数byte文字の途中でU+FFFDが混入する可能性があった。
8. write失敗時のoutboxに専用renderer traceとrenderer debug stageが重複して入り、再送queueを圧迫する可能性があった。
9. stale／commit rejected経路でassistant本文を保存しない要件と、試行済みrenderer診断を残す要件の分離が不足していた。

## 修正内容

- 正常系の最終結果を`projectedResult`へ統一した。
- executor resultへ`dialogueRendererTrace`を追加した。
- renderer traceにaction、決定済み質問情報、fallback文、raw response、採用文、fallback理由、最終sourceと最終文面を保持する。
- application side effectからStable V5 trace runtimeへrenderer traceを明示的に渡す。
- 1ターン診断レコードの`diagnostics.dialogueRenderer`へサイズ制限付きで保存する。
- renderer情報をnormal、compact、minimalの順で縮小し、48KB client targetへ収まらなければ任意のrenderer詳細だけを省略する。assistant text、response source、fallback判定は保持する。
- wrapper追加後も48KBを超える場合は、semantic raw responseや任意配列などを段階削減してwriteabilityを優先する。
- UTF-8 code point境界まで戻して切り詰め、置換文字の混入を避ける。
- deterministic fallback時は`diagnostics.fallback`へrenderer reasonを保存し、sessionとturnのfallback判定を一致させる。
- outbox保存前にrenderer payloadを制限し、専用fieldと重複するrenderer debug stageおよび投影内のrenderer traceを除去する。
- outbox保存時にresponse sourceとrenderer payloadのshapeを検証し、failed writeの再送でもrenderer情報を保持する。
- staleまたはcommit rejectedではassistant本文を保存せず、top-level sourceを`system`として試行済みrenderer診断のみ保持する。
- typecheck失敗の原因だったtest fixtureへ`weekStartDate`を追加し、不必要な型assertionを除去した。

## 別領域への回帰監査

### アプリケーション状態・対話処理

renderer traceはexecution resultの追加optional fieldであり、Fact Graph、質問code、scheduler、preview候補、commit判定を変更しない。表示文とstateの既存更新経路にも追加mutationはない。

### committed／discarded／failed turn

committed turnは採用済みrenderer traceを保存する。staleまたはcommit rejectedのdiscarded turnはassistant outputを保存せず、試行済みrenderer診断だけを残す。failed turnは従来どおりsystem responseを保存する。

### outbox・再送

outbox item全体の既存上限を維持し、追加fieldのshapeも検証する。write失敗後のreloadと再送でrenderer request、response、decisionが失われない統合testを追加した。重複renderer情報はoutbox投入前に除去する。

### Worker・保存上限

Workerのschema validatorは`diagnostics`内のoptional追加fieldを受理し、禁止key検査を再帰適用する。専用Worker互換testでserver preparation後もrenderer diagnosticが保持され、64KB hard limit内に収まることを検証する。

### 管理画面・export

管理画面Eventsはturn diagnosticの`diagnostics`全体を表示するため、新しい専用UI分岐なしでrenderer情報が見える。schema v2 exportはturn diagnosticをそのまま保持するため、`diagnostics.dialogueRenderer`もJSONへ含まれる。Conversation表示とState diff表示の既存内容は変更しない。

### privacy

API key、authorization header、provider configurationはrenderer traceへ格納しない。追加するraw responseはrendererの文字列出力のみで、既存のtrace同意・アクセス制御・保持期間を変更しない。

## 追加・更新した検証

- AI採用、deterministic fallback、system bypass時のexecutor result
- 正常系`projectedResult`
- committed／stale side effectのrenderer trace伝播
- renderer payload制限と重複debug情報除去
- diagnosticへのrenderer trace格納、UTF-8切り詰め、48KB client target
- oversized base diagnosticへのsource上書き後もclient targetを維持
- trace runtimeからrepository appendまでの統合経路
- failed writeからoutbox再送までのrenderer trace保持
- deterministic fallback時のsession／turn整合性
- Worker schemaとserver preparation後のrenderer diagnostic保持

## ローカル検証結果

2026-07-31に最新head `bb7407db8d817c050719502450def290db4de950`を対象として`npm run verify`を実行し、次を確認した。

- typecheck: pass
- test files: 250 passed / 7 skipped（257 total）
- tests: 1732 passed / 19 skipped / 5 todo（1756 total）
- production build: pass（Vite 6.4.3、2000 modules transformed）

build時のdynamic import重複と500KB超chunkの警告は既存のbundle最適化警告であり、この修正の機能・型・test・buildを失敗させるものではないため別課題とする。

## 結論

exit conditionsをすべて満たした。PR #104はready化してmerge可能である。Productionでsession自体が作られない既存障害は本修正の対象外であり、本修正だけで解消したとは判定しない。
