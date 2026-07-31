# 週間計画AI 実API会話結合テスト

## 目的

この基盤は、開発者がStudyPlannerへ毎回文章を入力し、traceを手動で書き出す作業を減らすためのものです。
本番と同じ週間計画AI経路を複数ターン実行し、質問、明示的修復、preview、preview後訂正、再preview、承認、保存までを一続きで確認します。

単発のStructured Outputを評価する既存real-evalとは役割が異なります。この基盤は`submitWeeklyPlanningApplicationTurn`、controller、`executeWeeklyPlanningTurn`、Stable V5 runtime、preview、approval applicationを再利用します。

## 実行経路

```text
固定scenarioと決定論的user driver
→ application / controller
→ executeWeeklyPlanningTurn
→ 意味解釈AI
→ validation / repair
→ Fact Graph V5
→ machine pending question
→ scheduler
→ 返答生成AI
→ preview
→ 訂正turn / Graph revision更新
→ 旧preview無効化
→ 再preview
→ draft block promotion
→ approval application
→ test repositoryへ保存
→ duplicate suppression / completion
```

AI APIを使うのは、ユーザー発話の意味解釈と利用者向け返答生成だけです。
テスト発話生成、ユーザー役、採点、合否判定、原因推定、修正判断には使用しません。

## scenario群

現在は次の5本を定義しています。

1. 明日の自然な複数ターン計画、既存予定回避、承認、保存。
2. 別表現、来週、非学習タスク、承認、保存。
3. 誤った単位回答、聞き返し、明示的修復、承認、保存。
4. 英語と数学の対象を取り違えない複数訂正、承認、保存。
5. preview後の作業量訂正、旧preview無効化、再preview、承認、保存。

各scenarioのユーザー発話は固定です。アプリの日本語文面ではなく、machine question code、target fact、Graph revision、preview状態を使って次の発話を選びます。

## 訂正の構造契約

意味解釈AIには、active Graph上の公開可能なFactと訂正契約を渡します。

- planning window
- task
- component
- workload
- effort estimate
- temporal constraint
- recurrence

明示的な訂正では、対象Factのexact `publicId`とkindをcorrection targetへ設定します。replacementは現在turnで新しく述べられたFactだけです。対象を一意に決められない場合は推測せず、uncertaintyとして返します。

canonicalization後はgeneric correction applicationが次を行います。

```text
publicIdとkindでtarget解決
→ replacementを既存containerへ再接続
→ 旧Factをsupersede
→ correction intentをconsume
→ 現在turnだけの重複containerをremove
→ schedulerへ修正後active Graphを渡す
```

途中でtarget解決やlifecycle操作に失敗した場合は、訂正turn前のGraphへ戻し、schedulerへ不完全なGraphを渡しません。

## 決定論的foundation

実APIを使わずに次を検証するtestを分離しています。

- machine questionに基づく会話進行
- 同一状態反復の停止
- human-readable transcript生成
- 明示的修復contract
- preview訂正とstale preview拒否contract
- scenario能力manifestの網羅性
- 単一Fact訂正
- 複数タスク訂正
- 不明targetの原子的rollback
- semantic pipelineからschedulerまでの訂正適用
- normalizerへの公開Factと訂正契約の受け渡し

実行コマンド:

```bash
npm run test:weekly-ai:conversation:foundation
```

## 実API suite

明示的にopt-inした場合だけ実行します。

```bash
WEEKLY_PLANNING_REAL_API_CONVERSATION_EVAL=1 \
VITE_WEEKLY_PLANNING_RUNTIME_MODE=stable_v5 \
VITE_AI_PROVIDER=openai \
VITE_AI_BASE_URL=https://api.openai.com/v1 \
VITE_AI_MODEL=gpt-5.4-mini \
VITE_AI_API_KEY="$OPENAI_API_KEY" \
npm run test:weekly-ai:conversation:real
```

## artifact

```text
artifacts/weekly-planning-real-api-conversation-eval/
  report.json
  report.md
  scenarios/
    <scenario-id>/
      transcript.md
      report.json
      turn-01.json
      turn-02.json
      preview-01.json
      preview-02.json
      approval.json
      failure.txt
```

各turnにはユーザー発話、assistant返答、response source、failure code、machine question、target fact、Graph revision、preview候補、Stable V5 debug traceを保存します。

会話の自然さは別AIで採点しません。外部開発エージェントが`transcript.md`を読み、定型反復、質問の取り違え、会話停止、不自然な責任転嫁を判断します。

API keyやAuthorization headerはartifactへ保存しません。

## workflow

workflowは手動実行専用です。自動push・PR eventでは起動しません。

```text
foundation job
→ typecheck
→ 決定論的foundation test
→既存safety test
→ build

real-api job
→ foundation成功後のみ実行
→ OpenAI Secret確認
→ 5 scenario実行
→ transcriptとtraceをartifact保存
```

GitHub Actionsが利用できない間も、workflow以外の実装と通常test基盤は進められます。

## 自走修正ループ

```text
scenario実行
→ transcriptとtraceを読む
→ 最初に壊れた構造境界を特定
→ 原因単位で修正
→ 決定論的testと類似scenarioを追加
→ 再実行
→ ループ台帳を短文更新
```

ループ記録は`docs/ai/tasks/20260801-weekly-planning-autonomous-conversation-loop.md`へ残します。

## 境界

この基盤はブラウザDOM、Firebase login UI、Production deployそのものは操作しません。
AI意味解釈からcontroller、Fact Graph、scheduler、preview、訂正、approval、保存までのapplication結合経路を対象にします。

ブラウザ固有の表示、入力イベント、認証、Production Worker revisionは後続のPlaywright E2E対象です。

## 現在の検証状態

GitHub Actionsは使用していません。typecheck、foundation test、既存test、build、実API suiteは未実行です。
コードとtest定義を作成した段階であり、成功確認済みとは扱いません。
