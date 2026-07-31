# 週間計画AI 実API会話結合テスト

## 目的

この基盤は、開発者がStudyPlannerの画面へ毎回文章を入力し、traceを手動で書き出す作業を減らすためのものです。GitHub Actions上から本番と同じ週間計画AI経路を複数ターン実行し、仮予定の生成、承認、保存までを一続きで検証します。

単発のStructured Outputだけを評価する既存real-evalとは役割が異なります。この基盤はproduction entry pointである`executeWeeklyPlanningTurn`とapplication/controller境界を再利用します。

## 実行経路

```text
固定scenario
→ submitWeeklyPlanningApplicationTurn
→ submitWeeklyPlanningControlledTurn
→ executeWeeklyPlanningTurn
→ Stable V5 semantic normalizer
→ OpenAI API structured output
→ validation / repair
→ Fact Graph V5
→ machine pending question
→ scheduler
→ preview
→ draft block promotion
→ approval application
→ test repositoryへ保存
→ completion / duplicate suppression
```

AIが担当するのは発話の意味構造化と利用者向け文面です。期間解決、Fact Graph更新、質問対象、予定配置、承認、保存、重複抑止は既存のdeterministic coreを使用します。

## 基準scenario

最初のscenarioは、Production traceで失敗した「明日の予定立てたいです」を起点にします。

```text
選択日: 2026-08-03
ユーザー: 明日の予定立てたいです
アプリ: machine pending questionに基づく質問
ユーザー: 英語を2時間勉強したいです
アプリ: 必要に応じて作業量または所要時間を確認
ユーザー: machine question codeに対応する固定回答
ユーザー: この条件で予定を作って
```

予定対象日は2026-08-04です。同日18:00から20:00に既存のバイト予定を置き、生成候補が衝突しないことも確認します。

## 合格条件

現在のscenarioでは、次を機械判定します。

- 複数ターンでpreviewへ到達する
- normalization、canonicalization、provider failureが発生しない
- `tomorrow`が2026-08-04へ解決される
- 英語の合計120分が失われない
- 既存予定18:00から20:00と重ならない
- preview候補がdraft blockへ昇格する
- approval後に全件が保存される
- weekly-planning provenanceが保存される
- 同じapprovalを再実行しても予定が増えない
- 完了後にpending approvalとdraft blockが残らない
- 各ターンのdebug traceがartifactへ保存される

## 実行方法

通常のtestでは実APIを呼びません。明示的にopt-inした場合だけ実行します。

```bash
WEEKLY_PLANNING_REAL_API_CONVERSATION_EVAL=1 \
VITE_WEEKLY_PLANNING_RUNTIME_MODE=stable_v5 \
VITE_AI_PROVIDER=openai \
VITE_AI_BASE_URL=https://api.openai.com/v1 \
VITE_AI_MODEL=gpt-5.4-mini \
VITE_AI_API_KEY="$OPENAI_API_KEY" \
npm run test:weekly-ai:conversation:real
```

GitHub Actionsでは`.github/workflows/weekly-planning-real-api-conversation-eval.yml`を使用します。Repository Secretとして`OPENAI_API_KEY`が必要です。必要に応じてRepository Variable `WEEKLY_PLANNING_EVAL_MODEL`またはmanual dispatchのmodel入力でモデルを上書きできます。

workflowはmain向けpull requestの関連変更、またはmanual dispatchで起動します。同じPR branchへのpushは`synchronize`として同じ検証を再実行し、mainへの通常pushでは実APIを自動実行しません。

## artifact

実行結果は次へ出力します。

```text
artifacts/weekly-planning-real-api-conversation-eval/
  scenario.json
  report.json
  report.md
  turn-01.json
  turn-02.json
  ...
  approval.json
  failure.txt
```

各turn JSONにはユーザー入力、assistant返答、response source、failure code、question code、graph revision、preview件数、実行中に収集したStable V5 debug traceを含めます。debug traceから、実際のAI request、raw response、structured result、validation、repair、scheduler、renderer判断を追跡できます。

API keyやAuthorization headerはartifactへ保存しません。

## 外部エージェントによる修正ループ

外部エージェントはGitHub Actionsのjob、step、artifactを読み、失敗したturnと契約境界を特定します。修正は同じIssue、branch、PRへ追加し、pushによって同じscenarioを再実行します。

```text
Actions実行
→ artifact取得
→ failure turn特定
→ prompt / schema / validator / runtimeを修正
→ deterministic test追加
→ 同じbranchへpush
→ real API scenario再実行
```

一時的なAI出力はartifactにだけ保存します。再現性があり、将来の回帰を防ぐべきケースだけを正式なfixtureまたはdeterministic testへ昇格します。

## 境界

この基盤はブラウザDOM、Firebase login UI、Production deployそのものは操作しません。ただし、AI意味解釈からcontroller、Fact Graph、scheduler、preview、approval、保存までのapplication経路を結合して検証します。

ブラウザ固有の表示、入力イベント、認証、Production Worker revisionまで確認する場合は、後続段階としてPlaywright E2Eを追加します。
