# 週間計画AI 自走会話改善ループ

Status: active
Date: 2026-08-01
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
- 会話状態をassistant文面の部分一致で推定しない。
- 特定発話だけの例外、test削除、期待値緩和で通さない。
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

問題: 「明日の予定」1本だけだった。

対応: scenario registryと複数phaseへ分離。

結果: 修復・複数target・preview後訂正を表現可能。

### Loop 1: APIなしで基盤を検証できない

問題: driver、判定、transcriptが実API testに混在。

対応: pure driver、contract、manifest、fake adapter testへ分離。

結果: foundationをAPIなしで実行可能。

### Loop 2: cross-turn訂正がFact化だけで止まる

問題: correction intentを旧Factへ適用していなかった。

対応: target解決、replacement再接続、supersede、重複container除去、rollbackを追加。

結果: 単一・複数task訂正をschedulerまで反映。

### Loop 3: 誤単位回答が別task化される

問題: 「3ページです」が新規task/workloadへ流れ得た。

対応: contextual replyを`not_contextual / incompatible / applied`へ分類。

結果: Factを増やさず同じtargetへ聞き返し、「3時間です」で復帰。

### Loop 4: preview消去後も`draft_created`

問題: preview実体0件でもmodeだけ残った。

対応: preview・draft実体からmodeを再計算。

結果: 訂正後は`collecting_tasks`、再preview後は`draft_created`。

### Loop 5: legacyへ戻れる入口

問題: env、URL、storage、UIからlegacyを選択できた。

対応: getter/setterをStable V5固定、切替UI削除。

結果: legacy実装は内部test-supportだけに残した。

### Loop 6: 初回Actions型エラー

問題: eval用interfaceと非同期captureで13件の型エラー。

対応: `any`やstrict緩和を使わず型境界を明示。

結果: TypeScript checks通過。

### Loop 7: revisionだけ増える無限会話

問題: 同じ質問・同じ回答でもrevision増加で停止検出を回避。

対応: question code、target、正規化回答のattempt signatureを追加。

結果: 同一回答は停止し、修正回答は許可。

### Loop 8: manifestと実行内容のずれ

問題: 能力ラベルを書いても実際に発話・checkを実行した保証がない。

対応: 必須発話順と必須checkをmanifestへ追加。

結果: transcriptとmanifestのずれを失敗扱い。

### Loop 9: 訂正traceの保存未検証

問題: 新しいdiagnosticのサイズ・再送・Worker保存が未検証。

対応: 48KB client、64KB server、outbox、unknown field、truncation testを追加。

結果: 巨大Graphを保存せずbounded diffを保持。

### Loop 10: Stable V5固定後の保存消失

問題: session scope確立前や保存拒否時にstateが消えた。

対応: owner付きstaging、Stable V5昇格、失敗時退避、成功時のみ旧key削除。

結果: owner A/B、再読込、runtime lossを回帰固定。

### Loop 11: 消失pending targetの再解釈

問題: target不在でも「3時間です」を新規task化し得た。

対応: pipeline全体で原子的`canonicalization_rejected`。

結果: Graph、revision、applied turnを変更しない。

### Loop 12: 廃止中GitHub ModelsでPRが赤い

問題: 外部410を製品回帰へ混在。

対応: 自動PR triggerを削除し、OpenAI手動evalへ移行。

結果: 決定論的CIと実API診断を分離。

### Loop 13: 実API preflight

結果: run `30679195853`でfoundation成功。Secret確認で停止。

原因: Repository Secret `OPENAI_API_KEY`未設定。

API request: 0件。

対応: keyをコードへ埋めず、`blocked_missing_secret` artifactを定義。

### Loop 14: real suiteの安全性不足

問題: fallbackでも通り得る、失敗後も残りを実行、artifactが最後まで残らない。

対応: AI-only経路検査、1 turn最大3 request、fail-fast、incremental artifact。

結果: 実行済みturnと未実行scenarioをreportへ保存。

### Loop 15: mainとの差分同期

問題: branchはmainより履歴上1 commit遅れ、手動workflowはbranch単体をcheckoutする。

対応: mainの起動再マウント修正8ファイルの内容をbranchへ同期。週間計画testはPR追加分を保持し、mainの型修正だけ統合。

結果: run `30680860590`で型、全test、build、diff check成功。

注記: connectorに安全なbranch merge操作がないため履歴上の`behind 1`表示は残るが、対象内容は同期済み。

### Loop 16: API費用上限

問題: 16 turn × 5 scenario × 3 requestで理論上240 requestだった。report判定だけではfetchを物理停止できなかった。

対応:

- 共通driverを1 scenario最大8 turnへ制限。
- suite最大40 turn、120 requestをcontract化。
- 共通AI clientへ任意のprocess request circuit breakerを追加。
- 会話workflowは`VITE_AI_MAX_PROCESS_REQUESTS=120`。
- semantic 4ケースworkflowは`VITE_AI_MAX_PROCESS_REQUESTS=12`。
- 上限到達後はfetch前に拒否。

結果: run `30681177783`、`30681406369`、`30681543550`、`30681654965`で型、全test、build、diff check成功。

思想確認: Productionでは環境変数未設定のためbudget機構は無効。

### Loop 17: 初回実API会話とplanning window語彙不整合

実行: run `30745377735`。foundation、Secret確認、OpenAI接続は成功した。

結果: scenario 1のturn 1でfail-fast。API requestは意味解釈1件、返答生成1件の合計2件。残り4 scenarioは未実行。

会話:

```text
ユーザー: 次の日の勉強計画を立てたいです
アプリ: いつからいつまでの予定を作るか教えてください。
```

七視点監査:

1. runtime入口: Stable V5経路、Secret、direct OpenAIは正常。
2. 対話進行: 期間を既に述べたのに再質問しており不正。
3. 意味状態: AIは`relative_day / next_day`をaccepted Factとして追加したが、runtime resolverは`tomorrow`しか解決できなかった。
4. lifecycle: preview前のため未到達。Graph commit自体は原子的だった。
5. テスト妥当性: renderer fallbackを成功扱いせず、最初の実不整合で停止できた。
6. 観測: semantic raw response、Graph、renderer trace、transcriptをartifactから復元できた。
7. 運用: 2 requestでfail-fastし、費用上限は機能した。

根本原因: `planningWindow.value`がschema・validatorでは任意文字列だった一方、calendar resolverは`today / tomorrow / day_after_tomorrow / this_week / next_week`だけを受理していた。rendererは誤ったmachine questionを自然に言い換えただけで、原因ではない。

対応:

- relative dayとrelative weekのcanonical語彙をcalendar resolverへ単一正本化。
- normalizerのpost-schema contractで独自aliasを拒否。
- `next_day`、`following_day`、`following_week`等は1回だけAI repairし、canonical値へ直す。
- 「次の日」固有の文字列置換やdeterministic日本語parserは追加しない。
- canonical day/week全値がruntime resolverで解決できるtestを追加。
- 「次の日」「翌日」「翌週」の異なる表現を同じcontractで検証。

自己監査: 初回testで`Array.at()`を使い現行TypeScript libと不整合になった。lib緩和や`any`を使わず配列末尾参照へ直した。

決定論的結果: run `30745926382`でTypeScript、全Vitest、production build、diff checkが成功。

次: 同じ5 scenarioを実API再実行し、scenario 1が次の質問へ進むかを確認する。

## Actions確認済み

- TypeScript checks: success
- 全Vitest regression suite: success
- production build: success
- diff check: success
- real API workflow foundation: success
- AI-only経路・request budget・fail-fast policy: success
- main内容同期後のbranch単体CI: success
- OpenAI Secret・direct API接続: success
- canonical planning window repair contract: success

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
- 非canonicalなrelative day/week aliasをAI repairで正規語彙へ直す。

## 未確認

- 修正後のOpenAI実API会話5 scenario。
- OpenAI semantic schema 4ケース。
- transcriptの自然さ。
- token usageと実費。
- Production Worker、Firebase auth、ブラウザDOM、Playwright E2E。
- merge前のcommit squash。

## 現在のblocker

決定論的blockerはなし。実API再実行で次の失敗境界を確認する。

## 次の順序

1. `Weekly Planning Real API Conversation Eval`を同じ5 scenarioで再実行。
2. artifactとtranscriptを七視点監査。
3. 最初の失敗境界だけ修正。
4. 会話suite通過後にsemantic 4ケースを実行。
5. 台帳とPR本文を更新。
6. 最終レビュー後にcommitをsquash。
