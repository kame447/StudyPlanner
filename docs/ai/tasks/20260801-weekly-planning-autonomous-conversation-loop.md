# 週間計画AI 自走会話改善ループ

Status: active
Date: 2026-08-01
Issue: #108
PR: #109
Branch: `agent/weekly-ai-conversation-eval`

## 目的

人間がStudyPlannerへ毎回発話を入力してtraceを渡す作業を減らす。
実際の週間計画AI application経路を複数ターン実行し、会話開始、質問、誤回答、明示的修復、preview訂正、承認、保存まで確認する。
失敗時は外部開発エージェントがtranscript、trace、状態差分を読み、同じIssue・branch・Draft PRで原因単位の修正を続ける。

## 思想境界

- applicationから到達する週間計画runtimeはStable V5だけとする。
- AI APIは意味解釈と利用者向け返答生成だけに使う。
- テスト発話、ユーザー役、採点、合否判定、原因推定にはAIを使わない。
- assistant表示文面の部分一致で会話状態を推定しない。
- 特定発話だけを通す正規表現、固定patch、期待値緩和、test削除で通さない。
- 訂正targetを推測せず、exact public IDかuncertaintyを使う。
- previewは承認前に確認可能で、訂正後の旧previewは承認できない。
- 保存移行で利用者データを黙って捨てない。
- 実APIの一時障害を決定論的CIの失敗と混同しない。
- 実装者自身の説明を信用せず、各ループで七視点監査とActions結果を確認する。

## 七視点

1. runtime入口: legacy downgradeや別経路が残っていないか。
2. 対話進行: 質問対象、回答、停止条件、定型反復が正しいか。
3. 意味状態: Fact Graph、revision、pending question、target identityが整合するか。
4. 訂正・preview lifecycle: rollback、stale preview、再preview、承認が原子的か。
5. テスト妥当性: scenarioが実際に能力を検査し、過学習していないか。
6. 観測・再現性: trace、artifact、manifest、失敗境界が復元可能か。
7. 運用・安全性: API費用、secret、CI trigger、owner分離、保存失敗が安全か。

## 1ループ

```text
七視点監査
→ 最初の失敗境界を1つに絞る
→ 原因仮説を立てる
→ 最小修正と強い回帰test
→ GitHub Actions
→ logとartifactを再監査
→ 思想整合を確認
→ 次ループ
```

同じ失敗へ複数の推測修正をまとめて入れない。Actions実行中は追加修正を重ねず、結果を待ってから次へ進む。

## 完了条件

- 自然な複数ターン会話でpreviewまで進める。
- 誤回答を別taskとして採用せず、聞き返しと明示的修復で復帰できる。
- 複数taskで質問・訂正targetを取り違えない。
- preview後訂正で旧previewを無効化し、修正版だけ承認できる。
- 承認、保存、二重承認抑止まで通る。
- 類似表現、非学習task、別日付でも同じ構造が成立する。
- transcriptで不自然な定型反復、会話停止、責任転嫁がない。
- URL、storage、environment、UIからlegacy runtimeへ切り替えられない。
- traceがclient、outbox、Worker、server size gateを通過する。
- owner切替、再読込、保存拒否でも他人のstate混入とデータ消失がない。

## scenario群

1. 明日の自然な複数ターン計画、既存予定回避、承認、保存。
2. 別表現、来週、非学習task、承認、保存。
3. 誤った単位回答、聞き返し、明示的修復、承認、保存。
4. 英語と数学のtargetを取り違えない複数訂正、承認、保存。
5. preview後の作業量訂正、旧preview無効化、再preview、承認、保存。

manifestには能力ラベル、固定発話、実行必須発話、必須checkを持たせる。実際のtranscriptとcheckがmanifestからずれた場合は失敗とする。

## ループ記録

### Loop 0: 1 scenario直書きの解消

問題: 初期実装は「明日の予定」1本だけで、修復、複数target、preview後訂正を表現できなかった。

対応: scenario registry、決定論的user driver、複数scenario artifact、preview後phaseへ分離した。

### Loop 1: 決定論的foundation分離

問題: 実API testへdriver、判定、transcript生成が混在し、APIなしでは基盤自体を検証できなかった。

対応: conversation driver、停止検出、transcript renderer、修復contract、preview訂正contract、scenario manifest、fake adapter testを純粋ロジックとして分離した。

### Loop 2: cross-turn訂正の接続

問題: correction intentはFact化できても、通常semantic pipelineがlifecycle transactionを適用していなかった。

対応: public ID target解決、replacement再接続、旧Fact supersede、correction intent consume、現在turnの重複container除去、失敗時rollbackを行うgeneric correction applicationを追加した。

確認: 単一workload訂正、英語と数学の同時訂正、不明target rollback、scheduler反映を決定論的testへ追加した。

### Loop 3: 誤単位回答の明示的修復

問題: 所要時間質問へ「3ページです」と答えると、通常canonicalizerが別taskまたはworkloadとして追加し得た。

対応: contextual replyを`not_contextual`、`incompatible`、`applied`へ分類した。型不一致はFactを増やさずturnだけ記録し、同じtargetの不足を維持する。

確認: 「3ページです」後に「3時間です」で元の数学40問へ180分を適用し、task/workloadが増えないpipeline testを追加した。

### Loop 4: preview訂正後のmode整合

問題: previewを空にしても`draft_created`が残り得た。

対応: preview候補、draft block、会話状態からcommit後modeを再計算した。旧preview消去後は`collecting_tasks`、再preview後は`draft_created`とする。

確認: 旧revision承認拒否、再previewだけ承認可能なapplication lifecycle testを追加した。

### Loop 5: Stable V5 runtime固定

問題: environment、URL、session storage、会話画面、設定画面からlegacyへ戻せた。

対応: getterとsetterをStable V5へ固定し、legacy選択UIを削除した。legacy実装はdirect test-supportとして内部に残す。

確認: legacy query・storage・setterでもStable V5になるtestとUI不在testを追加した。

### Loop 6: Actions初回監査

結果: 初回CIは13件のTypeScript errorで停止した。製品仕様の失敗ではなく、eval用interfaceと非同期captureの型境界だった。

対応: `any`化、strict緩和、test除外を行わず、具体interfaceと非同期callback後のread境界を明示した。

外部障害: 旧Semantic EvalはGitHub Models廃止brownoutのHTTP 410で失敗した。製品精度として扱わず、期待値も緩めなかった。

### Loop 7: 意味的な会話反復

問題: Graph revisionだけ増えると、同じquestion targetへ同じ回答を返し続けても状態signatureが変わり、停止検出をすり抜けた。

対応: question code、target fact、正規化済み回答のattempt signatureを追加した。回答内容を変えた修復は許可する。

確認: revisionだけ増える同一回答を1回で停止し、「3ページ」から「3時間」への変更は通すtestを追加した。

### Loop 8: scenario manifest drift

問題: manifestへ発話と能力を書いても、suiteが実際にその発話とcheckを実行した保証がなかった。

対応: `requiredUserUtterancesInOrder`と`requiredChecks`を追加し、suite終了時に実行結果との一致を検証した。

### Loop 9: 訂正trace永続化gate

問題: 新しい訂正diagnosticがclient size、outbox、Worker preparation、未知field、truncationを通る回帰がなかった。

対応: 巨大Graph非保存、canonicalization diff保持、未知sentinel保持、48KB client target、64KB server limit、初回失敗outbox再送、大容量truncationを1本のintegration testで固定した。

### Loop 10: Stable V5保存移行

問題: runtime固定後、Stable V5 scope確立前の保存が黙って失われ、owner storageとapplication統合testが破れた。

対応: owner付きstaging envelopeを移行入力として残し、scope確立後にStable V5 envelopeへ昇格する。Stable V5保存が拒否された場合はstagingへ退避し、成功時だけ旧keyを削除する。

確認: owner A/B分離、legacy v2移行、Stable V5昇格、保存拒否後の再読込、runtime loss後のstale preview拒否を追加・更新した。

### Loop 11: 消失pending targetの原子的拒否

問題: binder単体がtarget不在を適用しなくても、後続の通常canonicalizerが「3時間です」を新規taskとして採用し得た。

対応: machine-selected targetがGraphに存在しないminimal replyは、Graph、revision、applied turnを変えない`canonicalization_rejected`へ昇格した。

確認: 正常な誤単位修復を維持しつつ、消失targetだけpipeline全体でrollbackするtestを追加した。

### Loop 12: Actions運用境界

問題: 旧Semantic EvalがPRごとに廃止中のGitHub Modelsへ接続し、HTTP 410で無関係な赤を作っていた。

対応: PR自動triggerを削除し、評価4ケースと厳格なmetricsは残したままOpenAI Chat Completionsの手動workflowへ移した。会話suiteも手動opt-inとし、modelは両方`gpt-5.4-mini`固定、secretはstep環境だけへ渡す。

自己修正: semantic workflowへ一度自由model入力を追加したが、再現性と費用境界を弱めるため削除した。

### Loop 13: 実API preflightとSecret境界

結果: run `30679195853`でfoundationは全面成功したが、実API jobはRepository Secret `OPENAI_API_KEY`が空のためpreflightで停止した。OpenAI API requestは0件で、scenario、transcript、traceは未生成。

原因: コード不具合やPRイベント制限ではなく、Repository Secretが未設定だった。ログ上の`OPENAI_API_KEY`は空で、`Verify OpenAI secret`が明示的に失敗した。

対応: API keyをコード、workflow入力、artifactへ埋める回避は行わなかった。一時的なPR/push triggerは閉じてsentinelを削除し、workflowを手動opt-inへ戻した。今後はSecret不足時も`blocked_missing_secret`、必要Secret名、API request 0件を`report.md`と`report.json`へ残してartifact化する。

思想確認: AI用途、合格条件、scenario期待値、製品コードを変更していない。外部設定不足を会話品質の失敗として扱わず、Secret設定後に同じ5 scenarioを再実行する。

### Loop 14: 実API suiteのAI経路・費用・artifact境界

問題: 既存suiteはrendererがdeterministic fallbackへ落ちても構造checkだけで通り得た。1 scenario失敗後も残りを実行し、artifactはsuite終了時まで書かれなかった。

原因: real-eval専用のAI経路contract、request集計、fail-fast、incremental writeが独立した実行ポリシーとして存在しなかった。

対応: 1 turnあたり意味解釈は最大2 request、返答生成は最大1 request、合計最大3 requestとするpure policyを追加した。semantic traceの`semantic_provider_request`とrenderer traceを検査し、全turnで意味解釈AIと`ai_rendered`返答AIの両方を必須化した。fallback、bypass、system responseはreal API会話成功として扱わない。

運用: 最初のfailed scenarioで残りを停止し、未実行scenario IDをreportへ残す。turn、preview、approvalの更新ごとにscenario・suite artifactを書き、途中timeoutでも完了済みturnのtranscript、trace、AI usageを保持する。

費用: 実行済みturnだけからsemantic request、renderer request、合計request、許容上限を集計する。上限超過またはAI経路違反はsuite failureとする。token usageは共通clientが返していないため未計測のまま明記する。

確認: pure policy testとreal suite接続後、CI run `30679774395`、`30679922354`、`30680110265`でTypeScript、全Vitest、production build、diff checkが全面成功した。実API requestはSecret未設定のためまだ0件。

思想確認: AI judgeやAI採点は追加していない。機械判定はAPI経路、request上限、状態・保存整合だけで、自然さはtranscriptを外部開発エージェントが読む。

## GitHub Actions結果

複数ループで次を確認した。

- TypeScript checks: success。
- 全Vitest regression suite: success。
- production build: success。
- pull request diff check: success。
- 旧GitHub Models workflowが最新commitで自動起動しないこと: 確認済み。
- 実API会話workflow foundation: success。
- 実API会話OpenAI request: Secret未設定のため0件。
- 実API suiteのAI経路・request budget・fail-fast pure policy: success。

主な成功runは`30658884680`、`30678971529`、`30679056181`、`30679370452`、`30679522816`、`30679774395`、`30679922354`、`30680110265`。run `30679195853`はfoundation成功、実API jobは`blocked_missing_secret`相当で停止した。

## 現在の到達点

完了済み:

- Stable V5 application runtime固定。
- 5 scenarioの決定論的会話driver。
- 状態反復と意味的反復の停止。
- cross-turn訂正のgeneric lifecycle application。
- 誤単位回答からの明示的修復。
- 消失pending targetの原子的拒否。
- preview訂正、旧preview無効化、stale承認拒否、再preview。
- owner付きstorage移行と保存失敗時staging。
- trace永続化gate。
- 通常CIのTypeScript、全test、build、diff success。
- 廃止済みGitHub ModelsからOpenAI手動evalへの移行。
- 実API workflowの決定論的foundation完走。
- Secret不足時の明示的preflight停止とartifact定義。
- real suiteのAI-only経路検査、request budget、fail-fast、incremental artifact。

未確認:

- 実API会話5 scenarioの完走。
- OpenAI semantic schema 4ケースの実行結果。
- transcriptの自然さ。
- token usageと実費。
- Production Worker、Firebase auth、ブラウザDOM、Playwright E2E。
- merge前のcommit squash。

現在のblocker:

- Repository Actions Secret `OPENAI_API_KEY`が未設定。

## 次の順序

1. Repository Actions Secretへ`OPENAI_API_KEY`を設定する。
2. `Weekly Planning Real API Conversation Eval`を`run_real_api=true`で手動実行する。
3. 5 scenarioのartifactとtranscriptを七視点監査する。
4. 最初に壊れた境界だけを同じbranchで修正する。
5. 会話suite通過後、`Weekly Planning Stable V5 Semantic Eval`の4ケースを実行する。
6. 実API結果をこの台帳とPR本文へ追記する。
7. 未確認のProduction・ブラウザ境界はIssue #108または関連Issueで継続する。
