# renderer に deterministic context を供給する(planning period・対象単位・利用中 constraint source・ユーザー語彙ヒント)

本mdの範囲外へ進まない。git add / commit / push はしない。production code は本タスク実装時のみ変更。設計根拠は `docs/architecture/weekly-planning-nl-capability-model.md` §10(renderer context 契約)。

## 背景

AI dialogue renderer(R2-D で実接続済み)は「どう言うか」だけを担当する責務分離が成立している。しかし「何を言うか」に必要な deterministic context が RenderInput に不足し、次の実害が出ている。

実例1(「来週」が「今週」に化ける):
```text
ユーザー: 来週、過去問を進めたい
アプリ: 今週取り組みたいことや達成したい目標はありますか？   ← 来週なのに今週
```
実例2(内部語がそのまま出る):
```text
アプリ: 固定の予定があれば教えてください。
ユーザー: 固定の予定って何ですか？   ← 内部用語が伝わらない
```

診断分類は **F(renderer context 不足)**。`DialogueRenderInput.acceptedFacts` は `fields / yearRange / unitRateMinutes / priorityOrder / constraintSummary` のみで、**planning period(`state.range`)が含まれない**。AI が事実を捏造しているのではなく、renderer input 自体が不足している。

## 目的

- planning period を RenderInput に載せ、「来週」を「今週」と誤らせない(AI・deterministic fallback とも)。
- intent の内部キー的な語(`ask_fixed_events` 等)を直訳させないユーザー語彙ヒントを供給し、「固定の予定」のような内部語を緩和する。
- 既知予定の差分(受理済み/不足)、利用中の constraint source を尋ねる素材を供給する。
- **AI が context 外の事実を補完しない**ことを検証で担保する。

## 計画書との対応

- spec: §5(選択肢つき聞き取り)、§13(メンター対話)
- 改善テーマ: R2-D renderer の後続改善(context 拡充)。roadmap Phase R2-Capability の一部(capability snapshot を renderer へ接続)。

## 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts`(`DialogueRenderInput` に context 追加、`createDialogueRenderInput` の供給、`fallbackQuestionText` / `renderDeterministicMissingQuestions` の period・平易語反映)
  - 必要なら `src/features/weeklyPlanning/dialogue/weeklyPlanningAiDialogueRenderer.ts`(プロンプトで context 外捏造を禁止)
- 新規: なし
- テスト:
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningAiDialogueRenderer.test.ts`
  - renderer の unit テスト(deterministic fallback の period 出力)

## 現在の処理経路

- `createDialogueRenderInput`(renderer.ts:67-93)が state/decision から RenderInput を組む。`acceptedFacts` に **planning period が無い**。
- `DialogueNextQuestion.intent` は `MISSING_FIELD_KEYS` 由来の内部キー的な語で、ユーザー語彙への言い換えヒントが無い。AI はほぼ直訳する。
- `fallbackQuestionText`(renderer.ts:159-186)は slotKey 別の固定文だが、period(今週/来週)を反映しない。

## 問題点

- planning period(`state.range`)が RenderInput に無く、AI が period を補完してしまう(実例1)。
- 内部キーの言い換えヒントが無く、内部語がそのまま出る(実例2 の入口)。
- 「対象単位(過去問=年度)」「既知予定の差分」「利用中の constraint source」も context に無い。

## 修正方針

- `DialogueRenderInput` に deterministic context を追加する:
  - **planning period**(`state.range` を「来週」等の period ラベル素材として。日付そのものでなくラベル)。← 実例1 回帰防止の中核。
  - 対象単位(exam prep なら「年度」)。
  - 各 nextQuestion のユーザー語彙ヒント / 平易な言い換え(intent 内部キーを直訳させない)。options も活用。
  - 既知予定の差分(受理済み / 不足)。
  - **利用中の constraint source**（`constraint-source-capability` task が入った後は「授業は既存の時間割を利用中」を accepted fact として載せる。capability snapshot 由来）。
- deterministic fallback(`renderDeterministicMissingQuestions` / `fallbackQuestionText`)も period と平易語を反映。AI 未使用でも「今週/来週」を正しく出す。
- AI プロンプト/検証で、context にない period を勝手に決めないことを担保。

## 触らない範囲

- 「何を聞くか」の決定(questionPlan・missing 判定)。本 task は「どう言うか」に必要な context 供給のみ。
- fixed_events の状態モデル・capability snapshot の**算出**そのもの(別 task: constraint-source-capability。本 task はその結果を context に載せる接続のみ)。
- completion target モデル(実装済み)。
- renderer の sanitize/fallback 安全性ロジック(計画外 slot 破棄・failure fallback・questionPlan 順再構成)は不変。
- UI / CSS / save / approval。`shouldSavePlan: false` 維持。

## 受け入れ条件

- 「来週」入力に対し質問文が「今週」と誤らない(AI・deterministic fallback とも)。
- nextQuestion に平易語ヒントが載り、「固定の予定」のような内部語的表現が緩和される。
- 既知予定の差分(受理済み/不足)、利用中 constraint source を尋ねる素材が context に載る。
- 既存の renderer 安全性(計画外 slot 破棄・failure fallback・questionPlan 順再構成)が不変。
- weeklyPlanning テスト green / build 成功。

## テスト観点

- 「来週」state で RenderInput に planning period が含まれ、deterministic fallback が「来週」を出す(「今週」と誤らない)。
- nextQuestion に言い換えヒントが含まれる(fixed_events → 平易語)。
- AI renderer 経由でも sanitize が計画順・計画外破棄を維持(既存不変)。
- planning period 未設定時のフォールバック挙動。
- AI に context 外 period を渡さないとき、prompt/検証で捏造が抑止される。

## リスク

- period ラベル化(`state.range` → 「来週」)の判定が曖昧だと誤ラベルの可能性。範囲を「今週/来週/指定日〜」程度に限定し、曖昧なら period ラベルを付けず日付素材に留める。
- 利用中 constraint source の表示は `constraint-source-capability` task 完了に依存。その部分は依存先完了後に載せる(period・平易語ヒント部分は先行可)。

## Codexへの実装指示

1. **planning period と平易語ヒントは `constraint-source-capability` に依存せず先行実装してよい**(実例1・2 の直接改善)。利用中 constraint source の表示だけ依存先完了後。
2. renderer は表示専用。state を一切 mutate しない。
3. 既存 sanitize/fallback の観点(計画外 slot 破棄・failure fallback・questionPlan 順再構成)を壊さない。
4. `shouldSavePlan: false` 維持。UI/CSS/save/approval に触れない。
5. 最後に必ず `docs/ai/codex-task-guide.md` に従う。

## 検証(Node 22)

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/dialogue/weeklyPlanningAiDialogueRenderer.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```
