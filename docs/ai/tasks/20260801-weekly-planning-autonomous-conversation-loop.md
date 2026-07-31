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

## ループ記録

### Loop 0: 現状確認

問題: PR #109は「明日の予定立てたいです」から固定回答で保存まで進む1 scenarioだけで、修復・preview後訂正・類似会話を検証していない。

原因: テストdriverが1本の定数と共通回答表へ直書きされ、scenarioごとの状態遷移とpreview後turnを表現できない。

対応: scenario registry、決定論的user driver、複数scenario artifact、preview後訂正phaseへ再設計する。

確認: 未実施。次ループで基盤を修正する。

### Loop 1: Actions非依存の基盤分離

問題: 実API test本体に会話driver、合否契約、transcript生成が混在し、Actions停止中は基盤自体を検証できない。

原因: production実行adapterと、純粋な会話進行・判定ロジックの境界が分離されていなかった。

対応: 決定論的conversation driver、進捗停止検出、human-readable transcript renderer、明示的修復contract、preview訂正contract、fake adapterの通常testを追加した。実API workflowは手動実行専用に変更した。

調査: correction intentのschema、canonicalization、transactionは存在する。一方、通常semantic pipelineがtransactionを適用する接続は現時点で確認できない。preview後訂正が失敗する場合の第一原因候補として扱う。

確認: GitHub Actionsは未使用。typecheck・test・buildは未実行。次は通常pipelineのcorrection適用境界を決定論的testで固定し、構造的に接続する。
