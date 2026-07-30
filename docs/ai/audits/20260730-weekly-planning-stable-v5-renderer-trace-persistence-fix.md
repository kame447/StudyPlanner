# Stable V5 renderer trace persistence 修正記録

Status: implementation revised / local re-verification pending
Date: 2026-07-31
Issue: #103
PR: #104
Branch: `agent/stable-v5-renderer-trace-persistence`
Base: `ee0dbc0006e3b82e950d0a4b3e4c720de41cd1c6`

## 対象

PR #102で追加したAI dialogue rendererのtrace経路だけを対象とする。session作成、保存先選択、管理APIの既存障害は本修正へ混在させない。ただし今回の追加が既存transport、outbox、Worker schema、管理画面、exportへ回帰を起こさないかは確認対象に含める。

## 確認した不具合

1. 正常系`turn_executor_result_projected`は`result`を記録していたが、debug projectionは`projectedResult`を読んでいた。
2. rendererのrequest、raw response、fallback reason、final decisionはdebug traceへ書かれるだけで、1ターン診断レコードへ永続化されなかった。
3. `responseSource: deterministic_fallback`でもturn diagnosticの`diagnostics.fallback`がnullになり、sessionの`hasFallback`と不整合だった。
4. executor単体testはdebug trace recorderをmockしており、side effectからrepository appendまでの欠落を検出できなかった。
5. 追加test fixtureのruntime sessionに必須`weekStartDate`がなく、focused testは通る一方でtypecheckが失敗した。
6. renderer追加後のサイズ判定が64KB server limitだけを見ていた。Workerがsubject token、policy version、expiry等を後付けするため、client側で64KB近くまで使うとserver preparation後にwriteが拒否される可能性があった。
7. UTF-8文字列をbyte境界で単純切断すると、複数byte文字の途中でU+FFFDが混入する可能性があった。
8. write失敗時のoutboxに専用renderer traceとrenderer debug stageが重複して入り、raw responseの大きさによって再送queueを不要に圧迫する可能性があった。
9. renderer詳細を省略した後に`responseSource`等を上書きすると、base diagnosticが48KB直前の場合に数十byteだけclient targetを超える理論上の経路が残っていた。
10. stale／commit rejectedの非表示結果について、assistant outputを保存しないことは正しいが、試行済みrendererの診断情報まで捨てると非同期競合の調査能力が低下する。

## 修正内容

- 正常系の最終結果を`projectedResult`へ統一した。
- executor resultへ`dialogueRendererTrace`を追加した。
- renderer traceにaction、決定済み質問情報、fallback文、raw response、採用文、fallback理由、最終sourceと最終文面を保持する。
- application side effectからStable V5 trace runtimeへrenderer traceを明示的に渡す。
- 1ターン診断レコードの`diagnostics.dialogueRenderer`へサイズ制限付きで保存する。
- renderer情報をnormal、compact、minimalの順で縮小し、48KB client targetへ収まらなければ任意のrenderer詳細だけを省略する。
- renderer省略後も48KBを超える場合はraw AI応答、任意配列、長文の順で段階削減し、最終診断レコードをclient target内へ収める。assistant source、outcome、error、件数等の中核診断は保持する。
- UTF-8 code point境界まで戻して切り詰め、置換文字の混入を避ける。
- deterministic fallback時は`diagnostics.fallback`へrenderer reasonを保存し、sessionとturnのfallback判定を一致させる。
- outboxへ渡すrenderer traceを事前制限し、専用fieldと重複するrenderer debug stageおよび投影結果内のrenderer traceを除去する。
- outbox保存時にresponse sourceとrenderer payloadのshapeを検証し、failed writeの再送でもrenderer情報を保持する。
- stale／commit rejectedではassistant textを保存せず、最終sourceを`system`としつつ、試行済みrenderer traceだけを診断情報として保持する。
- typecheck失敗の原因だったtest fixtureへ`weekStartDate`を追加し、不必要な型assertionを除去した。

## 別領域への回帰監査

### アプリケーション状態・対話処理

renderer traceはexecution resultの追加optional fieldであり、Fact Graph、質問code、scheduler、preview候補、commit判定を変更しない。表示文とstateの既存更新経路にも追加mutationはない。

### committed／discarded／failed turn

committed turnは採用済みrenderer traceとassistant outputを保存する。staleまたはcommit rejectedのdiscarded turnは従来どおりassistant outputを保存しない一方、実行済みrenderer traceを`diagnostics.dialogueRenderer`へ残す。top-level response sourceは`system`なので、非表示のAI文面を利用者向け最終出力として誤記録しない。実行例外で結果自体が得られないfailed turnはsystem responseと取得済みdebug情報だけを保存する。

### outbox・再送

outbox item全体の既存上限を維持し、追加fieldのshapeも検証する。専用renderer traceはtransport用上限へ切り詰め、同内容を持つdebug stageを重複保存しない。write失敗後のreloadと再送でrenderer request、response、decisionが失われない統合testを追加した。

### Worker・保存上限

Workerのschema validatorは`diagnostics`内のoptional追加fieldを受理し、禁止key検査を再帰適用する。clientは48KB target内に収めて約16KBのserver余白を確保する。新しいWorker互換testでserver preparation後もrenderer diagnosticが保持され、64KB hard limit内に収まることを確認対象にした。

### 管理画面・export

管理画面Eventsはturn diagnosticの`diagnostics`全体を表示するため、新しい専用UI分岐なしでrenderer情報が見える。schema v2 exportはturn diagnosticをそのまま保持するため、`diagnostics.dialogueRenderer`もJSONへ含まれる。Conversation表示とState diff表示の既存内容は変更しない。

### privacy

API key、authorization header、provider configurationはrenderer traceへ格納しない。追加するraw responseはrendererの文字列出力のみで、既存のtrace同意・アクセス制御・保持期間を変更しない。Worker側の禁止key検査は追加fieldにも再帰適用される。

## 追加・更新した検証

- AI採用、deterministic fallback、system bypass時のexecutor result
- 正常系`projectedResult`
- side effectによるrenderer trace伝播
- committed turnのrenderer事前制限と重複debug stage除去
- stale turnでassistant outputを保存せずrenderer診断だけを保持する経路
- diagnosticへのrenderer trace格納、UTF-8切り詰め、48KB client target
- trace runtimeからrepository appendまでの統合経路
- failed writeからoutbox再送までのrenderer trace保持
- deterministic fallback時のsession／turn整合性
- Worker schemaとserver preparation後のrenderer diagnostic保持

## ローカル検証履歴

修正前headではfocused test 7 files／29 testsが通過した。`npm run typecheck`と`npm run verify`は追加test fixtureの`weekStartDate`不足により停止した。fixtureと追加監査指摘を修正したため、最新headで再実行が必要である。

## 未確認

GitHub Actionsは利用しない。最新headに対するfocused test、typecheck、full `npm run verify`は人間のローカル環境で再実行するまで成功とは判定しない。Productionでsession自体が作られない既存障害は本修正だけでは確定・解消していない。
