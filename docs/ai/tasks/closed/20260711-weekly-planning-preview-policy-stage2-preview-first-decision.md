# preview方針Stage2: dialogue decision を preview-first に切り替える

Priority: **High**(理由: draft-first 思想の本体。これにより例1「来週、院試の過去問を進めたい。数学を多めに」が質問連鎖ではなく初回 preview + 仮定要約 + 最大1質問で応答するようになる)

本mdの範囲外へ進まない。git add / commit / push はしない。

**前提**: 親設計 v2 §2〜§4・§6。**preview方針Stage1(仮定合成層)実装済みが必須。** T5 registry 実装済み。着手時に実コードが本mdと食い違えば実装せず報告する。

## 背景

Stage1 で「仮定つき draft request + 仮定リスト + dry-run 結果」が pipeline output に(decision と独立に)得られるようになった。しかし decision は依然 `missing.length > 0 → ask_missing_info` を最優先しており、assumable しか残っていない状態でも質問を続け、preview を出さない。spec §6「質問しないで仮置きする条件」を decision に実装するのが本タスクである。

## 目的

blocking が残る場合のみ質問を主応答にし、仮定つき preview が生成できる場合は preview 提示を主応答にする。仮定は確定事実と区別して summary に反映し、影響の大きい assumable slot 1 件までを preview と同時に質問できるようにする。

## 計画書との対応

- spec: §6(質問するべき度・仮置き)、§10(仮表示)、§13(聞きすぎない)
- 改善テーマ: 親設計 v2 §3・§6-4 / dialogue contract 2・3・4(前半)

## 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts`(assumedDraft を decision 入力と preview 出力へ接続)
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueManager.ts`(decision 優先順の変更・preview 同時質問・仮定 summary)
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueMessages.ts`(offer_dry_run_preview 文言への仮定・修正招待の反映)
  - `src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.ts`(preview 同時質問の優先度規則が必要な場合)
- 新規: なし
- テスト:
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts`
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueManager.test.ts`
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueMessages.test.ts`

## 現在の処理経路(要点のみ)

- `createWeeklyPlanningDialogueDecision` の優先順: missing 非空 → ask_missing_info / ambiguity → confirm_ambiguity / … / dry-run 有 → offer_dry_run_preview / … / 最終 else。
- Stage1 の `output.assumedDraft` は decision に未接続。`output.draftCandidates`(UI が preview block 化する)にも未接続。
- `WeeklyPlanningDialogueDecisionSummary.assumptions` は既存(`state.assumptions` 由来の文字列)で、`buildConditionSummary` が「仮の前提:」として表示する。

## 修正方針

1. **decision 入力の拡張**: `WeeklyPlanningDialogueDecisionInput` に `assumedDraft?: { assumptions: PlanningAssumption[]; candidates; diagnostics }` を追加し、pipeline から渡す。
2. **優先順の変更**(`createWeeklyPlanningDialogueDecision`):
   - missing のうち **blocking 分類**(registry の previewPolicy 参照)が残る → 従来どおり ask_missing_info。
   - blocking 無しで確定 draftRequest または assumedDraft の candidates がある → `offer_dry_run_preview` を主応答にする。missing(assumable)が残っていても質問を主応答にしない。
   - ambiguity(confirm_ambiguity)は従来位置を維持する(hard 確定しない既存原則)。
   - unscheduled が多い場合の `ask_relax_constraints` は従来どおり(diagnostics 起点)。
3. **preview 同時質問(最大1件)**: assumable のうち「選択で予定が大きく変わる」slot(初期規則: `unit_duration_estimate`、次点 `planning_start_date`。規則は registry 側の優先度で表現)を questionPlan 1 件として `offer_dry_run_preview` decision に添付できるようにする(型上 questionPlan は既存フィールド)。無理に毎回付けない(該当仮定が無ければ質問なし)。
4. **仮定の summary 反映**: decision summary に構造化 assumptions(slot / description)を追加し、`buildConditionSummary` で「仮定:」として確定事実と区別して表示する(既存の「仮の前提:」= state.assumptions とは表示上統合してよいが、出所は区別して保持)。文言は簡潔に(全仮定の長文説明をしない — 件数が多い場合は代表 + 件数)。
5. **preview 出力への接続**: 確定 draftRequest が null で assumedDraft がある場合、`output.draftCandidates` / `diagnostics` に assumedDraft のものを載せる(UI はそのまま preview block 化する。UI 変更なし)。承認導線は既存のまま = 仮定込み候補もユーザー承認を経てのみ保存される。
6. **renderer**: `renderWeeklyPlanningDialogueMessage` の AI 経路は ask_missing_info のみのまま(P7 まで不変)。offer_dry_run_preview は dialogueMessages の deterministic 文言で、(a) 仮定の要点、(b) 添付質問、(c) 「多すぎる・少なすぎる・配分変更などがあれば教えてください」という修正招待を含める(固定文言でよい。自然文化は P7)。

## 責任境界

- preview 可否・質問要否の判定は deterministic(registry 分類 + 合成結果)。AI は関与しない。
- 仮定込み候補の生成・表示は既存 generator / preview / 承認 flow をそのまま使う。保存は従来どおりユーザー承認のみ。

## 触らない範囲

- 合成規則・既定値(Stage1 の範囲。変更が必要なら報告)
- AI interpreter / renderer の AI 経路 / UI コンポーネント
- scheduler・承認導線・`shouldSavePlan: false`
- taxonomy の新 kind 追加(P3 の範囲。本タスクは既存 kind の優先順変更のみ)

## 受け入れ条件

前提日付は既存テスト規約(2026-07-10 / 15:30)に合わせる。

1. 例1シナリオ(院試 7年分・5分野・数学多め・pending scope 実日付あり、単位時間/年度範囲/生活制約 未回答): decision.kind が `offer_dry_run_preview`、`output.draftCandidates` 非空、summary の仮定に unit_duration_estimate 由来が含まれ、questionPlan が最大1件。
2. 同状態から「1年分は3時間くらい」を適用した次ターン: 仮定リストから unit_duration_estimate が消え、確定値で候補が再計算される(仮定の置換 → 再計画)。
3. blocking(tasks_or_goals 等)が残る state では従来どおり ask_missing_info(preview を出さない)。
4. ambiguity がある state では confirm_ambiguity が維持される。
5. 確定条件が完全に揃った既存フロー(従来の offer_dry_run_preview / confirm_draft_conditions / ask_relax_constraints / cannot_create_draft)の decision が変わらない。ただし「assumable のみ残で質問していた」既存テストは本タスクの意図した変更として期待値を更新し、理由つきで報告する。
6. 仮定込み候補が preview block として昇格・承認できる(既存 flow のテストが green のまま)。
7. offer_dry_run_preview の deterministic 文言に仮定の要点と修正招待が含まれる(dialogueMessages テスト)。
8. 既存テスト green(意図した更新を除く)+ `npm run build` 成功。

## テスト観点

- decision の優先順マトリクス(blocking 有/無 × 確定 request 有/無 × assumedDraft 有/無 × ambiguity 有/無)。
- 仮定置換 → 再計画の複数ターン。
- 「質問しすぎない」: assumable のみ残ターンで questionPlan が 0〜1 件であること。

## リスク

- 仮定込み preview の品質(unit 120分仮定で過大/過小)はユーザー修正前提。unscheduled が大量に出る場合は既存 `ask_relax_constraints` が先に立つため、破綻はしない。
- 既存テストのうち「assumable のみ残で ask_missing_info」を固定しているものの洗い出しが必要(想定: 生活制約質問系)。意図変更として更新し報告する。

## Codexへの実装指示

1. 本md・`docs/ai/codex-task-guide.md`・親設計 v2 §3〜§6 を読む。
2. Stage1 の実装(assumedDraft / PlanningAssumption / previewPolicy)を確認。無ければ実装せず報告。
3. 実装順: decision 入力拡張 → 優先順変更 → 同時質問 → summary/文言 → preview 接続 → テスト。
4. 検証(Node 22): `npm run test:run -- src/features/weeklyPlanning` と `npm run build`、`git diff --check && git diff --stat && git status -sb`。
5. `docs/ai/codex-task-guide.md` に従い、期待値を更新した既存テストを理由つきで報告する。
