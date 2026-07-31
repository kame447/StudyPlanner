# 週間計画AI 実API会話結合テスト

## 目的

この基盤は、人間がStudyPlannerへ発話を繰り返し入力してtraceを手動で書き出す作業を減らすためのものです。
本番の週間計画application経路を固定scenarioで複数ターン実行し、質問、誤回答、明示的修復、preview、preview後訂正、再preview、承認、保存までを一続きで確認します。

単発のStructured Outputを確認するsemantic real-evalとは役割を分けます。会話suiteは`submitWeeklyPlanningApplicationTurn`、controller、`executeWeeklyPlanningTurn`、Stable V5 runtime、scheduler、preview、approval applicationを再利用します。

## 実行経路

```text
固定scenarioと決定論的user driver
→ application / controller
→ executeWeeklyPlanningTurn
→ 意味解釈AI
→ schema validation / repair
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

AI APIを使うのは、ユーザー発話の意味解釈と利用者向け返答生成だけです。テスト発話生成、ユーザー役、採点、合否判定、原因推定、修正判断には使用しません。

## Stable V5 runtime境界

applicationから到達する週間計画runtimeはStable V5へ固定しています。

- environment variable、URL query、session storageからlegacyへ変更できません。
- runtime setterへ`legacy`を渡してもStable V5へ正規化します。
- 会話画面と設定画面からlegacy選択UIを削除しています。
- legacy実装とdirect test-supportは削除せず、application経路からだけ隔離しています。

旧保存形式はruntime選択には使いません。Stable V5 session scope確立前、またはStable V5 envelope保存が検証で拒否された場合のowner付きstagingと既存利用者データ移行にだけ使用します。Stable V5保存成功後はstaging keyを削除します。

## scenario群

現在は次の5本を定義しています。

1. 明日の自然な複数ターン計画、既存予定回避、承認、保存。
2. 別表現、来週、非学習タスク、承認、保存。
3. 誤った単位回答、聞き返し、明示的修復、承認、保存。
4. 英語と数学の対象を取り違えない複数訂正、承認、保存。
5. preview後の作業量訂正、旧preview無効化、再preview、承認、保存。

各scenarioのユーザー役は固定発話と決定論的state machineです。assistant表示文面の部分一致ではなく、machine question code、target fact、Graph revision、preview状態を使います。

scenario manifestには、能力ラベルだけでなく、実行必須発話と必須checkを持たせています。実際のtranscriptとcheckがmanifestからずれた場合は、scenarioが成功していてもsuiteを失敗させます。

## 会話停止検出

次の2種類を別々に検出します。

- question code、target、action、Graph revision、preview数が同一のまま繰り返す状態反復。
- Graph revisionだけ増えても、同じquestion targetへ同じ固定回答を再送する意味的反復。

後者を検出することで、誤回答をno-op turnとして記録し続け、最大turn数までAPIを消費する状態を防ぎます。回答内容を修正した場合は同じtargetへの再回答を許可します。

## 明示的修復

pending questionへの短答は次へ分類します。

```text
not_contextual
incompatible
applied
```

所要時間質問へ「3ページです」と答えたような型不一致では、taskやworkloadを増やさず、質問targetを維持します。その後の「3時間です」は元のtargetへ適用します。

machine-selected targetがGraphから消失している場合は、利用者の誤回答として消費しません。通常canonicalizerへ流して新規タスク化することもせず、Graph、revision、applied turnを変更しない`canonicalization_rejected`として原子的に停止します。

## 訂正の構造契約

意味解釈AIには、active Graph上の公開可能なFactと訂正契約を渡します。taskとcomponentはworkload等の所属文脈を特定するためにも提示します。

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

途中でtarget解決、replacement整合、lifecycle操作のいずれかに失敗した場合は、訂正turn前のGraphへ戻し、schedulerへ不完全なGraphを渡しません。

## preview訂正

訂正turnでは旧previewを空にし、modeをpreview・draft実体から再計算します。

- 旧preview消去後は`collecting_tasks`へ戻ります。
- 旧Graph revisionのdraft blockは承認できません。
- 修正後Graphから再計算したpreviewだけ承認できます。
- 二重承認は既存approval operationで抑止します。

## 決定論的foundation

実APIを使わずに次を検証します。

- Stable V5 runtime固定とlegacy UI不在。
- machine questionに基づく会話進行。
- 状態反復と意味的反復の停止。
- human-readable transcript生成。
- scenario manifestと実行内容の同期。
- 誤単位回答からの明示的修復。
- 消失pending targetの原子的拒否。
- 単一Fact訂正、複数タスク訂正、不明target rollback。
- preview訂正、stale preview拒否、再preview。
- owner分離、Stable V5保存昇格、保存拒否時の無損失staging。
- 訂正traceのサイズ制限、未知field保持、Worker preparation、outbox再送、truncation。

実行コマンド:

```bash
npm run test:weekly-ai:conversation:foundation
```

通常CIでは、これに加えて`typecheck`、`typecheck:build`、全Vitest、production build、diff checkを実行します。

## 実API suite

明示的にopt-inした場合だけ実行します。modelは`gpt-5.4-mini`へ固定します。

```bash
WEEKLY_PLANNING_REAL_API_CONVERSATION_EVAL=1 \
VITE_AI_PROVIDER=openai \
VITE_AI_BASE_URL=https://api.openai.com/v1 \
VITE_AI_MODEL=gpt-5.4-mini \
VITE_AI_API_KEY="$OPENAI_API_KEY" \
npm run test:weekly-ai:conversation:real
```

GitHub Actionsでは`Weekly Planning Real API Conversation Eval`を手動実行し、`run_real_api=true`を選びます。foundation jobが成功した場合だけ実API jobへ進みます。

単発semantic schemaの4ケースは別の`Weekly Planning Stable V5 Semantic Eval`で手動実行します。廃止中のGitHub Models依存は削除し、OpenAI Chat Completionsと`OPENAI_API_KEY`を使用します。こちらもmodelは`gpt-5.4-mini`固定です。

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

会話の自然さは別AIで採点しません。外部開発エージェントが`transcript.md`を読み、定型反復、質問の取り違え、会話停止、不自然な責任転嫁を判断します。API keyとAuthorization headerはartifactへ保存しません。

## trace永続化gate

訂正traceでは巨大Graphをそのまま保存しません。既存のcanonicalization diff、target解決、rejection errorをbounded diagnosticへ投影します。

回帰テストでは次を通します。

1. client diagnosticが`clientDocumentTargetBytes`以下。
2. 初回append失敗時にoutboxへ残り、次回turnで再送される。
3. `prepareWeeklyPlanningTraceServerWrite`を通過する。
4. Worker preparation後も`maxDocumentBytes`以下。
5. 未登録sentinelがschema同期漏れで消えない。
6. 大容量diffでもturn全体を破棄せずtruncation metadataを残す。
7. correction application内部の巨大Graphは永続化しない。

## 自走修正ループ

```text
七視点監査
→ 原因仮説を1つに絞る
→ 最小修正と強い回帰test
→ 自動CI
→ logとartifactを再監査
→ 思想整合を確認して次ループへ進む
```

七視点は、runtime入口、対話進行、意味状態、訂正・preview lifecycle、テスト妥当性、観測・再現性、運用・安全性です。失敗したtestの削除、期待値緩和、strictness低下、特定発話だけの例外追加は採用しません。

ループ記録は`docs/ai/tasks/20260801-weekly-planning-autonomous-conversation-loop.md`へ残します。

## 境界

この基盤はブラウザDOM、Firebase login UI、Production deployそのものは操作しません。AI意味解釈からcontroller、Fact Graph、scheduler、preview、訂正、approval、保存までのapplication結合経路を対象にします。

ブラウザ固有の表示、入力イベント、認証、Production Worker revisionは後続のPlaywright E2E対象です。

## 現在の検証状態

2026年8月1日時点で、PR #109の自動CIにより次が成功しています。

- TypeScript checks。
- 全Vitest regression suite。
- production build。
- pull request diff check。

決定論的基盤は緑です。実API会話5 scenarioとOpenAI semantic schema 4ケースは、手動workflowをまだ実行していないため未確認です。transcriptの自然さ、OpenAI実応答、API使用量、Production Worker・ブラウザE2Eは成功確認済みとして扱いません。
