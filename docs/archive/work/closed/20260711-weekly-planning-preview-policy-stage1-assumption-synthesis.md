# preview方針Stage1: assumable slot の仮定合成層を導入する(挙動中立)

Priority: **High**(理由: draft-first 思想(親設計 v2)の土台。これが無い限り dialogue policy は「全 slot 充足まで質問」以外の選択肢を持てない。本タスク自体はユーザー可視挙動を変えない挙動中立の層追加であり、安全に先行投入できる)

本mdの範囲外へ進まない。git add / commit / push はしない。

**前提**: 親設計 `docs/architecture/weekly-planning-dialogue-architecture.md`(v2)§2・§6。T5(question slot registry = `intake/weeklyPlanningQuestionSlots.ts`)実装済みであること。着手時に実コードが本mdと食い違えば実装せず報告する。

## 背景

現在 `createWeeklyDraftRequestFromIntakeState` は `missing.length > 0` で即 null を返し、さらに yearRange / field_first priority / minutesPerUnit 付き unitRate の完全充足を要求する。このため dialogue は情報が揃い切るまで preview を出せず、slot filling が構造的に唯一の通常系になっている。一方で型システムには仮定の語彙(`UnitRateEstimate.source: 'assumption' | 'default'`、`PlanningRange.confidence: 'inferred'`、`assumptions: string[]`)が既にあり、時間割・既存予定の自動回避や session policy 既定値(09:00–22:00)も稼働済みである。欠けているのは「未確定 slot を既定値・導出値で仮置きした draft request を合成する deterministic 層」だけである。

## 目的

state を汚さずに「仮定つき draft request + 構造化された仮定リスト」を合成できるようにし、pipeline がそれを dry-run に使えるようにする。**decision は本タスクでは変更しない**(質問優先の現挙動を維持)。preview-first への切替は次タスク(preview方針Stage2)。

## 計画書との対応

- spec: §6(質問しないで仮置きする条件)、§13(仮置きして最後にまとめて承認)
- 改善テーマ: 親設計 v2 §6-1〜3 / roadmap R4「分からないの仮置き化」の基盤先取り

## 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.ts`(slot 定義へ `previewPolicy` 追加)
  - `src/features/weeklyPlanning/intake/weeklyPlanningDraftRequestAdapter.ts`(仮定つき合成関数の追加。既存関数は不変)
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts`(output への露出。decision への接続はしない)
  - `src/features/weeklyPlanning/intake/weeklyPlanningIntakeTypes.ts` または interpreterTypes(`PlanningAssumption` 型の置き場所は既存規約で判断)
- 新規: 仮定合成の実体を adapter 内に置くか `intake/weeklyPlanningAssumptionSynthesis.ts`(名称候補)として分離するかは実装判断(registry を参照し、自然言語を読まない純関数であること)
- テスト:
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningDraftRequestAdapter.test.ts`
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts`

## 現在の処理経路(要点のみ)

- `buildPipelineOutput` → `createWeeklyDraftRequestFromIntakeState(state)` が null なら dry-run も decision summary も作られない。null 条件: status ≠ draft_ready / shouldCreateDraft false / missing 非空 / yearRange 無し / field_first 以外 / year_field_chunk の minutesPerUnit 無し。
- 生活制約の未指定は scheduler 側では既定 sessionPolicy(dayStart/dayEnd)で吸収されるが、intake の missing がそれを知らない(fixed_events / sleep_cycle / meal_bath_constraints が missing に残ると draft request 自体が null)。

## 修正方針

### 1. registry へ `previewPolicy` を追加

`PlanningQuestionSlotDefinition` に `previewPolicy: 'blocking' | 'assumable' | 'deferrable'` を追加し、全 slot に設定する(網羅は型で強制)。初期分類:

| slot(missing key) | previewPolicy | 仮定の内容(assumable の場合) |
|---|---|---|
| tasks_or_goals | blocking | —(学習対象なしでは生成不能) |
| planning_start_date | assumable(pending scope に実日付があるときのみ。無ければ blocking) | `pendingPlanningRange.scope.startDate` を開始日とする(**state.range は書き換えない**。合成 request/scheduling 入力にのみ使用) |
| year_range | assumable(`examPrepScope.totalYears` 既知のときのみ。未知なら blocking) | endYear = 現在年、startYear = 現在年 − (totalYears − 1) |
| unit_duration_estimate | assumable | 既定値定数(暫定 120 分/単位・1箇所で定義)、`source: 'default'`, `uncertainty: 'high'` |
| priority_policy / next_field_after_math | assumable | `field_first` + `examPrepScope.fields` の宣言順(既存 order があれば先頭維持) |
| progress / completion_direction | deferrable | 進捗ゼロ仮定(zero-progress draft は既存対応済み) |
| fixed_events | assumable | 追加固定予定なし(時間割・既存予定の自動回避は稼働済みである旨を仮定 description に含める) |
| sleep_cycle / meal_bath_constraints / life_constraints | assumable | 既定 sessionPolicy 枠(09:00–22:00)に委ねる |

分類・既定値は本表を初期値とし、実装中に矛盾があれば報告のうえ調整してよい(値はプロダクト調整可能な定数として1箇所に置く)。

### 2. 仮定合成関数(deterministic・純関数)

```text
createAssumedWeeklyDraftRequest(state, context: { currentDateTime: string }):
  { draftRequest: WeeklyPlanningDraftRequest; assumptions: PlanningAssumption[] } | null
```

- blocking 分類の slot が missing に残る、または assumable の前提(totalYears 等)を満たせない場合は null。
- それ以外は、missing の assumable/deferrable を上表の規則で埋めた draftRequest を合成し、埋めた項目ごとに `PlanningAssumption { slot: string; source: 'default' | 'derived'; description: string }` を返す。
- **state は一切変更しない**(仮定の state 化はユーザー確認後の通常 command 経路のみ)。既存 `createWeeklyDraftRequestFromIntakeState` が非 null を返す場合はそれを優先し、assumptions は空。
- exam prep 経路(既存 generator が受けられる形)に限定する。非 exam(tasks ベース)は対象外(P5)。

### 3. pipeline output への露出(挙動中立)

- `buildPipelineOutput` で、既存 adapter が null かつ合成が非 null の場合に dry-run を合成 request で実行し、`WeeklyPlanningIntakePipelineOutput` に `assumedDraft?: { draftRequest; assumptions; candidates; diagnostics }`(名称候補)として **decision とは独立に**格納する。
- `createWeeklyPlanningDialogueDecision` への入力・decision の分岐は**変更しない**(missing 非空なら従来どおり ask_missing_info)。preview candidates(`output.draftCandidates`)にも**接続しない**(UI が preview を出してしまうため。接続は Stage2)。

## 責任境界

- 仮定値の決定は deterministic(registry の規則)のみ。AI は仮定を作らない。
- scheduler・validator・reducer・decision・renderer・UI は不変。
- 開始日仮定は scheduling 入力にのみ影響し、`state.range` / `pendingPlanningRange` の遷移(T1/T3 guard)には触れない。

## 触らない範囲

- `createWeeklyDraftRequestFromIntakeState` の既存条件(確定 request の意味を変えない)
- decision・dialogueMessages・renderer・UI(`NaturalLanguageAssistant.tsx`)
- scheduler / sessionChunking / placementScoring
- 非 exam(tasks)経路(P5)
- `shouldSavePlan: false` を維持する

## 受け入れ条件

1. 例1相当の state(「来週、院試の過去問を7年分、5分野」+「数学を多めに」+ pending scope 解決済み or scope 実日付あり、単位時間・年度範囲・生活制約は未回答)から、合成関数が非 null を返し、assumptions に unit_duration_estimate / year_range(totalYears 既知時は derived)/ 生活制約系が含まれる。
2. 合成された request で dry-run が実行され、`output.assumedDraft.candidates` が非空になる(pipeline テスト)。
3. tasks_or_goals が blocking のため、目標未指定の state では合成が null。
4. `pendingPlanningRange.scope.startDate` があるときは開始日仮定で候補が scope 内に配置され、`state.pendingPlanningRange` は消えない・`state.range` は設定されない。
5. 既存 adapter が非 null の state では assumptions が空で、request 内容が従来と同一。
6. decision・`output.draftCandidates`・rendered message が全シナリオで従来と不変(挙動中立の証明。既存テスト無変更 green)。
7. `npm run build` 成功。

## テスト観点

- adapter テスト: 分類ごとの合成規則(境界: totalYears 無し → null、scope 実日付なし → null)、既定値定数の参照、assumptions の内容。
- pipeline テスト: assumedDraft の露出、既存 output フィールドの不変。
- regression: 全既存テスト無変更 green(挙動中立)。

## リスク

- 既定 120 分/単位は根拠の薄いプロダクト仮定。定数1箇所 + uncertainty 'high' + assumption description で後段(P2 の表示・P6 の修正)に委ねる。値の妥当性は実使用で調整する前提を報告に明記。
- 合成 request の dry-run 追加により、質問中ターンでも generator が走り計算コストが増える(数百 work item 規模なら軽微)。目立つ場合は「blocking なしのときだけ合成」で既に絞られている旨を確認する。

## Codexへの実装指示

1. 本md・`docs/ai/codex-task-guide.md`・親設計 v2 §2/§6 を読む。
2. 実装順: registry(previewPolicy)→ PlanningAssumption 型 → 合成関数 → pipeline 露出 → テスト。
3. 参照: `createWeeklyDraftRequestFromIntakeState`(合成対象の形)、`resolveSchedulingInput`(開始日仮定の反映点)、closed `20260705-weekly-planning-zero-progress-draft-request.md`(進捗ゼロ前提)。
4. 検証(Node 22): `npm run test:run -- src/features/weeklyPlanning` と `npm run build`(いつもの env PATH 付き)、`git diff --check && git diff --stat && git status -sb`。
5. `docs/ai/codex-task-guide.md` に従い、スコープ外へ広げず、解釈で埋めた点を報告する。
