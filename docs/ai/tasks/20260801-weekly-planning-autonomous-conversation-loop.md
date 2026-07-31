# 週間計画AI 自走会話改善ループ

Status: active
Date: 2026-08-01
Issue: #108
PR: #109
Branch: `agent/weekly-ai-conversation-eval`

## 目的

人間がStudyPlannerへ毎回文章を入力してtraceを渡す作業をなくす。
実際の週間計画AI経路を複数ターン実行し、会話開始からpreview訂正、承認、保存まで確認する。
失敗時はtranscriptとtraceを外部開発エージェントが読み、原因を調査して同じbranchで修正する。

## 必須要件

- 単発発話ではなく、予定完成まで複数ターン会話する。
- アプリのmachine question、target fact、graph revisionを使って会話を進める。
- 通常会話、曖昧回答、誤回答、言い間違い、対象訂正を含める。
- 誤回答を勝手に採用せず、聞き返しから明示的修復できることを確認する。
- preview生成後も条件を訂正できることを確認する。
- 訂正時は旧previewを無効化し、修正後のFact Graphから再previewする。
- 最終previewを承認し、テストrepositoryへ保存する。
- 二重承認で予定が重複しないことを確認する。
- 全会話、各turnのtrace、Graph revision、preview、保存結果をartifactへ残す。
- 会話の自然さは別AIで採点せず、外部開発エージェントがtranscriptを読む。

## AI API利用境界

AI APIを使ってよいのは次の2用途だけである。

1. ユーザー発話の意味解釈
2. アプリの利用者向け返答生成

次にはAI APIを使わない。

- テスト発話の生成
- ユーザー役
- 会話の採点
- 合否判定
- 原因推定
- コード修正判断

テストユーザーは固定scenarioと決定論的state machineで動かす。

## 修正原則

- 特定文言だけを通す正規表現・例外追加をしない。
- assistant表示文面の部分一致で状態を推定しない。
- traceから失敗した契約境界を特定してから修正する。
- prompt、schema、validator、pending question、canonicalizer、lifecycle、preview ownershipのどこが原因かを明示する。
- 元の発話だけでなく、別表現、別タスク、別日付でも直ることを確認する。
- 既存機能を壊さず、Draft PRのまま検証する。

## 1ループの手順

1. scenario群を実行する。
2. artifactのtranscript、trace、状態差分を読む。
3. 問題を短文で特定する。
4. 具体的な構造原因を調査する。
5. 原因単位で修正する。
6. 決定論的回帰テストと類似scenarioを追加する。
7. scenario群を再実行する。
8. この台帳へ結果を追記する。

GitHub Actionsが使用できない間は、1、2、7を保留し、driver、contract、scenario、artifact生成、通常テストの基盤を先に整備する。

## 完了条件

- 通常の自然な会話で予定をpreviewまで作れる。
- 曖昧・誤回答から聞き返しと明示的修復で復帰できる。
- 複数タスクで質問対象を取り違えない。
- preview後の訂正で旧previewが無効化され、修正版previewへ更新される。
- 承認・保存・重複抑止まで通る。
- 類似表現・別タスク・別日付でも同じ構造が成立する。
- transcriptを外部開発エージェントが確認し、不自然な定型反復や会話停止がない。

## 現在のscenario群

1. 明日の自然な複数ターン計画、既存予定回避、承認、保存。
2. 別表現、来週、非学習タスク、承認、保存。
3. 誤った単位回答、聞き返し、明示的修復、承認、保存。
4. 英語と数学の対象を取り違えない複数訂正、承認、保存。
5. preview後の作業量訂正、旧preview無効化、再preview、承認、保存。

## ループ記録

### Loop 0: 現状確認

問題: PR #109は「明日の予定立てたいです」から固定回答で保存まで進む1 scenarioだけで、修復・preview後訂正・類似会話を検証していない。

原因: テストdriverが1本の定数と共通回答表へ直書きされ、scenarioごとの状態遷移とpreview後turnを表現できない。

対応: scenario registry、決定論的user driver、複数scenario artifact、preview後訂正phaseへ再設計する。

確認: 未実施。次ループで基盤を修正する。

### Loop 1: Actions非依存の基盤分離

問題: 実API test本体に会話driver、合否契約、transcript生成が混在し、Actions停止中は基盤自体を検証できない。

原因: production実行adapterと、純粋な会話進行・判定ロジックの境界が分離されていなかった。

対応: 決定論的conversation driver、進捗停止検出、human-readable transcript renderer、明示的修復contract、preview訂正contract、scenario能力manifest、fake adapter testを追加した。

類似確認: 通常会話、別表現、非学習、誤回答、複数タスク訂正、preview後訂正の5 scenarioを定義した。

確認: コード作成済み。typecheck・test・buildは未実行。

### Loop 2: cross-turn訂正の接続

問題: correction intentをschemaとFact Graphへ保存できても、通常semantic pipelineが訂正transactionを適用していなかった。preview後訂正では旧Factがactiveのまま残る。

原因: canonicalizationとlifecycle transactionの間にapplication層がなく、公開IDのtarget解決、replacementの親Fact再接続、重複container整理、失敗時rollbackが欠けていた。

対応: generic correction applicationを追加した。exact publicIdとkindでtargetを解決し、replacementを既存taskへ再接続し、旧Factをsupersedeし、訂正intentと現在turnだけのcontainerを除去する。途中失敗時はturn前Graphへ戻す。

AI契約: active Graphのplanning window、task、component、workload、effort estimate、temporal constraint、recurrenceをpublic factとして渡す。対象が一意ならexact publicIdを使い、曖昧なら推測せずuncertaintyを返すmachine contractを追加した。

類似確認: 単一workload訂正、英語と数学の同時訂正、不明targetのrollback、pipelineからschedulerまでの訂正適用、normalizerへのcontract受け渡しを決定論的testとして追加した。

確認: GitHub Actionsは使用していない。typecheck・test・buildは未実行。実API transcriptも未生成。

### Loop 3: 誤回答からの明示的修復

問題: 所要時間を質問中に「3ページです」と答えると、所要時間には採用されないが、通常canonicalizerへ流れて別のtaskまたはworkloadとして追加され得た。

原因: contextual answer APIが「会話外の新規入力」と「質問には答えているが型が違う入力」をどちらも`null`で返し、pipelineが両者を区別できなかった。

対応: contextual replyを`not_contextual`、`incompatible`、`applied`へ型分類した。型不一致の短答はFactを追加せず、turn revisionとappliedTurnKeyだけを記録する。同じtargetの不足をschedulerへ残し、返答生成AIが聞き返せるようにした。

類似確認: 数学40問の所要時間質問へ「3ページです」と答え、その後「3時間です」で元の数学taskへ180分を適用するpipeline testを追加した。誤回答後もtaskとworkloadは増えず、質問targetを保持するcontractも追加した。

確認: GitHub Actionsは使用していない。testは作成済みだが、typecheck・実行結果は未確認。

### Loop 4: preview訂正後の状態整合

問題: 訂正turnで旧preview候補を空にしても、PlanningState.modeが`draft_created`のまま残り得た。画面上は仮予定がある状態なのに実体は0件となる。

原因: reducerの`commit_turn`がpreview候補を受け取らない場合、以前のmodeをそのまま保持していた。

対応: commit後のpreview候補数、draft block、会話状態からmodeを再計算する共通境界へ変更した。旧preview消去後は`collecting_tasks`、再preview生成後は`draft_created`になる。

類似確認: revision 3の旧preview表示、訂正turnで空化、revision 4で旧preview承認拒否、revision 5の再previewだけ承認可能、というapplication lifecycle testを追加した。

確認: GitHub Actionsは使用していない。testは作成済みだが、typecheck・実行結果は未確認。

次: 実行可能な環境で最初に`npm run test:weekly-ai:conversation:foundation`を実行する。通過後に実API suiteを回し、5 transcriptを人間判断する。失敗した最初の構造境界だけを次ループで修正する。

## 実行停止時点

現在できるようにしたこと: 5 scenarioの会話進行、明示的修復とpreview訂正の機械契約、cross-turn訂正のgeneric適用、誤単位回答のFact非採用、旧previewの無効化とmode再計算、原子的rollback、transcriptとtraceのartifact定義。

まだ確認できていないこと: TypeScript型整合、決定論的test結果、既存testへの影響、build、実APIの意味解釈、実際の返答自然さ、5 scenarioの完走。

再開時の順序: foundation test、既存safety test、build、実API suite、transcript確認、最初の失敗原因の修正。
