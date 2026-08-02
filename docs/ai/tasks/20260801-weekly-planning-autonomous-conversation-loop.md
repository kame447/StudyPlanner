# 週間計画AI 自走会話改善ループ

Status: active
Date: 2026-08-02
Issue: #108
PR: #109
Branch: `agent/weekly-ai-conversation-eval`

## 目的

Stable V5の実API経路を複数ターン動かし、質問、誤回答、明示的修復、preview訂正、再preview、承認、保存まで自動確認する。
人間による毎回の入力とtrace受け渡しを減らす。

## 固定方針

- application経路はStable V5のみ。
- AI APIは意味解釈と利用者向け返答生成だけに使う。
- ユーザー役、採点、合否判定、原因推定にはAIを使わない。
- assistant文面の部分一致で状態を推定しない。
- 特定発話向け例外、test削除、期待値緩和で通さない。
- 訂正対象はexact public IDで解決し、曖昧なら推測しない。
- preview訂正後の旧previewは承認不可。
- owner切替、再読込、保存失敗でデータを黙って失わない。
- 各ループで七視点監査を行い、自分の実装説明を信用しない。

## 七視点

1. runtime入口
2. 対話進行
3. 意味状態・Fact Graph
4. 訂正・preview lifecycle
5. テスト妥当性・過学習
6. trace・artifact・再現性
7. API費用・Secret・保存・運用安全性

## 1ループ

```text
七視点監査
→ 最初の失敗境界を1つに絞る
→ 原因調査
→ 最小修正と回帰test
→ GitHub Actions
→ log / artifact再監査
→ 思想整合を確認
→ 台帳更新
```

Actions実行中は次の変更を重ねない。

## scenario

1. 明日の自然な複数ターン計画と既存予定回避。
2. 来週・別表現・非学習task。
3. 誤単位回答からの明示的修復。
4. 英語と数学の複数target訂正。
5. preview後訂正、旧preview無効化、再preview。

## ループ記録

### Loop 0: 1 scenario直書き

問題: 「明日の予定」1本だけ。

対応: scenario registry、複数phase、scenario別artifactへ分離。

結果: 修復・複数target・preview後訂正を表現可能。

### Loop 1: APIなしで基盤を検証できない

問題: driver、判定、transcriptが実API testに混在。

対応: pure driver、contract、manifest、fake adapter testへ分離。

結果: foundationをAPIなしで実行可能。

### Loop 2: cross-turn訂正がFact化だけで止まる

問題: correction intentを旧Factへ適用していない。

対応: target解決、replacement再接続、supersede、重複container除去、rollbackを追加。

結果: 単一・複数task訂正をschedulerまで反映。

### Loop 3: 誤単位回答が別task化される

問題: 「3ページです」が新規task/workloadへ流れ得た。

対応: contextual replyを`not_contextual / incompatible / applied`へ分類。

結果: Factを増やさず聞き返し、「3時間です」で復帰。

### Loop 4: preview消去後も`draft_created`

問題: preview実体0件でもmodeだけ残る。

対応: preview・draft実体からmodeを再計算。

結果: 訂正後`collecting_tasks`、再preview後`draft_created`。

### Loop 5: legacyへ戻れる入口

問題: env、URL、storage、UIからlegacyを選べる。

対応: getter/setterをStable V5固定、切替UI削除。

結果: legacyは内部test-supportだけに残した。

### Loop 6: 初回Actions型エラー

問題: eval interfaceと非同期captureで13件の型エラー。

対応: `any`やstrict緩和を使わず型境界を明示。

結果: TypeScript checks通過。

### Loop 7: revisionだけ増える無限会話

問題: 同じ質問・同じ回答でもrevision増加で停止検出を回避。

対応: question code、target、正規化回答のattempt signatureを追加。

結果: 同一回答は停止し、修正回答は許可。

### Loop 8: manifestと実行内容のずれ

問題: 能力ラベルと実際の発話・checkが同期していない。

対応: 必須発話順と必須checkをmanifestへ追加。

結果: transcriptとのずれを失敗扱い。

### Loop 9: 訂正traceの保存未検証

問題: diagnosticのサイズ・再送・Worker保存が未検証。

対応: 48KB client、64KB server、outbox、unknown field、truncation testを追加。

結果: 巨大Graphを保存せずbounded diffを保持。

### Loop 10: Stable V5固定後の保存消失

問題: session scope確立前や保存拒否時にstateが消える。

対応: owner付きstaging、Stable V5昇格、失敗時退避、成功時だけ旧key削除。

結果: owner A/B、再読込、runtime lossを回帰固定。

### Loop 11: 消失pending targetの再解釈

問題: target不在でも「3時間です」を新規task化し得た。

対応: pipeline全体で原子的`canonicalization_rejected`。

結果: Graph、revision、applied turnを変更しない。

### Loop 12: 廃止中GitHub ModelsでPRが赤い

問題: 外部HTTP 410を製品回帰へ混在。

対応: 自動PR triggerを削除し、OpenAI手動evalへ移行。

結果: 決定論的CIと実API診断を分離。

### Loop 13: 実API preflight

実行: run `30679195853`。

結果: foundation成功、`OPENAI_API_KEY`未設定で停止。API request 0件。

対応: keyを埋めず、`blocked_missing_secret` artifactを定義。

### Loop 14: real suiteの安全性不足

問題: fallbackでも通り得る、失敗後も残りを実行、artifactが最後まで残らない。

対応: AI-only経路検査、1 turn最大3 request、fail-fast、incremental artifact。

結果: 実行済みturnと未実行scenarioをreportへ保存。

### Loop 15: mainとの差分同期

問題: 手動workflowはbranch単体をcheckoutするが、branchはmainより履歴上1 commit遅れ。

対応: mainの起動再マウント修正8ファイルの内容を同期。

結果: run `30680860590`で全面成功。

### Loop 16: API費用上限

問題: 理論上240 requestで、report判定だけではfetchを止めない。

対応: 1 scenario最大8 turn、suite最大40 turn・120 request、semantic最大12 request、fetch前circuit breaker。

結果: runs `30681177783`、`30681406369`、`30681543550`、`30681654965`で全面成功。

思想確認: Productionでは上限環境変数未設定のため無効。

### Loop 17: planning window語彙不整合

実行: run `30745377735`。

会話: `次の日の勉強計画を立てたいです` → 期間を再質問。

原因: AIは`relative_day / next_day`、runtimeは`tomorrow`だけを解決。

対応: canonical day/week語彙を単一正本化し、独自aliasを1回だけAI repair。「次の日」「翌日」「翌週」を同じcontractで検証。

結果: run `30745926382`で全面成功。

### Loop 18: canonical日付の表示をrendererが誤拒否

実行: run `30746307987`。

前進: horizonは`2026-08-04`へ解決し、質問は`missing_schedulable_work`へ進んだ。

AI返答: `明日の勉強計画を作るために、まず入れたい作業内容と、だいたいどれくらい進めたいかを教えてください。`

問題: 自然な返答を`ungrounded_text`で拒否。

初期仮説: 「次の日」と「明日」の表層不一致。

対応: canonical date factから安全な日本語表示を導出し、未知日付は引き続き拒否。

自己監査: helperの層を誤りproduction isolationが停止。allowlistを増やさず汎用dialogue安全層へ移動。

結果: run `30747039416`で全面成功。

### Loop 19: rendererへGraphが渡っていない

実行: run `30747437859`。

結果: Loop 18と同じ自然な返答が再び`ungrounded_text`。

原因: runtime sessionではGraph revision 1をcommit済みだが、turn resultの`stableV5Graph`が未投影。rendererは`planningInformation: null`で動き、日付だけでなくtask・workload・制約のgroundingも失っていた。

対応: instrumented runtime executorがowner一致時だけsource-of-truth session Graphを全resultへ投影。duplicate resultにも現在Graphを返し、別ownerには返さない。turn executor既存contractでGraphをrenderer planning informationへ投影。

自己監査: duplicate trace stageへ`graphRevision`を期待したが、trace schemaではduplicate事実と最終出力を分離していた。未保存fieldを実装から削除し、duplicate stageと`runtime_turn_output.finalDecision.graphRevision`を別々に検証。

結果: run `30748034682`でTypeScript、全Vitest、build、diff checkが全面成功。

## Actions確認済み

- TypeScript checks: success
- 全Vitest regression suite: success
- production build: success
- diff check: success
- Stable V5 production isolation: success
- real API workflow foundation: success
- OpenAI Secret・direct API接続: success
- AI-only経路・request budget・fail-fast policy: success
- canonical planning window repair contract: success
- canonical date表示grounding: success
- runtime session Graphのowner-safe result投影: success

## 現在できること

- Stable V5だけでapplication会話を実行。
- 5 scenarioを決定論的に自走。
- 誤回答から聞き返し・修復。
- 複数task訂正。
- preview後訂正とstale承認拒否。
- 承認、保存、二重承認抑止。
- turnごとのtranscript、trace、renderer trace、request数をartifact保存。
- 最初の失敗で停止。
- 会話suite最大120 request、semantic suite最大12 requestで物理停止。
- noncanonical relative date aliasをAI repair。
- canonical date factから安全な日本語表示を導出。
- source-of-truth Graphをrendererとartifactへowner-safeに引き渡す。

## 未確認

- Loop 19修正後のOpenAI実API会話5 scenario。
- OpenAI semantic schema 4ケース。
- transcriptの自然さ。
- token usageと実費。
- Production Worker、Firebase auth、ブラウザDOM、Playwright E2E。
- merge前のcommit squash。

## 現在のblocker

決定論的blockerなし。実API再実行で次の失敗境界を確認する。

## 次の順序

1. `Weekly Planning Real API Conversation Eval`を同じ5 scenarioで再実行。
2. artifactとtranscriptを七視点監査。
3. 最初の失敗境界だけ修正。
4. 会話suite通過後にsemantic 4ケースを実行。
5. 台帳とPR本文を更新。
6. 最終レビュー後にcommitをsquash。
