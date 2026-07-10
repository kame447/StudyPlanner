# AI 経由の set_planning_range を deterministic 経路と同じ正規化・clarification 保護に載せる

Priority: **Medium**(AI が set_planning_range を出すのは deterministic parser が拾えない表現に限られ発生頻度は低いが、発生時は「表示上の期間」と「配置結果」が乖離する)

本mdの範囲外へ進まない。git add / commit / push はしない。

**前提**: temporal scope 実装差分(`resolveSchedulingInput` / `calendarDayCount` / `pendingPlanningRange`)と `20260710-weekly-planning-range-reseed-guard-and-start-date-render.md` が実コードに存在すること。着手時に実コードを再確認し、食い違えば実装せず報告する。

## 背景

temporal scope 実装で、scheduler の計画ウィンドウは `resolveSchedulingInput`(`pipeline/weeklyPlanningIntakePipeline.ts`)が `state.range.calendarDayCount` の有無を鍵として決めるようになった。`calendarDayCount` は deterministic parser(`rangeFromStartDate`)だけが設定し、AI interpreter の `set_planning_range` schema(`intake/weeklyPlanningAiInterpreter.ts` の `WEEKLY_PLANNING_COMMAND_SCHEMAS`)には存在しない。また `InterpreterStateSummary` は `pendingPlanningRange` を含まないため、AI は開始日 clarification が進行中であることを知らない。2026-07-10 の全体レビュー(問題5)で特定した、deterministic 経路と AI 経路の非対称である。

## 目的

range 確定の後処理(scheduler ウィンドウへの反映)と clarification 保護が、command の出所(deterministic parser / AI interpreter)によらず同じになるようにする。

## 計画書との対応

- spec: §5(計画範囲)、§12(責務分離: 抽出は LLM 可、計算・判定はコード)
- 改善テーマ: roadmap Phase R2-Capability 診断原則 B(representation)・D(intake 可視性)

## 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/intake/weeklyPlanningCommandAdapter.ts`(`toPlanningRangeFromSetPlanningRangeCommand` の正規化)
  - `src/features/weeklyPlanning/intake/weeklyPlanningInterpreterTypes.ts`(`InterpreterStateSummary` への pending 情報追加)
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts`(`createInterpreterStateSummary`)
  - `src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts`(pending 中の set_planning_range 保護)
  - `src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts`(system prompt への pending 説明 1〜2 行。schema は変更しない)
- 新規: なし
- テスト:
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts`
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts`

## 現在の処理経路

1. deterministic 経路: `parseSetPlanningRangeCommand` → `rangeFromStartDate` が `calendarDayCount: durationDays` を設定 → reducer → `resolveSchedulingInput` が `usesResolvedCalendarWindow = Boolean(state.range?.calendarDayCount)` で range 起点のウィンドウを generator に渡す。
2. AI 経路: schema の `set_planning_range.range` は `startDateTime / endDateTime / sourceText / confidence` のみ → `toPlanningRangeFromSetPlanningRangeCommand` は **passthrough** → `state.range` に `calendarDayCount` 無しで保存 → `resolveSchedulingInput` は `input.planningStartDate`(UI の selectedDate)に fallback。**state.range と配置ウィンドウが乖離する。**
3. pending 中の保護: validator の `confirmed-slot-overwrite` は `confirmedSlots` に `planning_range` がある場合のみ働くが、`planning_range` は `state.range` があるときだけ入る。pending 中は range 未確定なので、AI の `set_planning_range`(high)は素通しで適用され、reducer が `pendingPlanningRange` を消して clarification をバイパスする。
4. `InterpreterStateSummary` は `knownFields / confirmedSlots / planningRangeSummary / availableConstraintSources` のみ。pending の存在は AI に伝わらない。

## 問題点

- AI 経由の range 確定では `calendarDayCount` が付かず、候補生成が selectedDate 起点のまま(例: AI が「8月1日から5日間」を range 化しても候補は今日から並ぶ)。
- pending clarification 中に AI が推測 range を hard-apply でき、「来週のどの日から?」の質問が消える。temporal scope タスクの「解決できるまで hard apply しない」原則の AI 側の穴。

## 修正方針

1. **正規化は adapter に置く**: `toPlanningRangeFromSetPlanningRangeCommand` で、`command.range.calendarDayCount` が無く `startDateTime` / `endDateTime` が揃っている場合、日付差から `calendarDayCount` を算出して付与する(`resolveSchedulingInput` 内の `dateDiffDays` / `planningDayCountFromRange` と同じ算式。日数計算は純粋な date 演算で、自然言語は読まない)。deterministic 経路の値はそのまま透過する。schema に `calendarDayCount` は追加しない(AI に日数計算をさせない)。
2. **pending の可視化**: `InterpreterStateSummary` に optional の pending 情報(例: `pendingPlanningRange?: { label: string; startDate?: string; endDate?: string }`)を追加し、`createInterpreterStateSummary` で `state.pendingPlanningRange` から設定する。
3. **validator での保護**: stateSummary に pending があるとき、AI 候補の `set_planning_range` は `range.confidence === 'explicit'` の場合のみ通し、それ以外は reject(理由例: `pending-range-clarification`)とする。explicit の場合も `acceptedWithConfirmation` へ倒す(hard-apply しない)。どちらのバケットにするかの細部は Codex 判断でよいが、「pending 中に非 explicit range で clarification が消えない」ことを必須とする。
4. **prompt**: system prompt に「stateSummary.pendingPlanningRange があるときは、ユーザーが明示的な開始日を言った場合を除き set_planning_range を出さない(アプリが曜日回答を deterministic に解決する)」旨を 1〜2 行追加する。プロンプトだけに頼らず、enforcement は 3 の validator が担う。

## 触らない範囲

- `resolveSchedulingInput` 本体・generator・scheduler(正規化で `calendarDayCount` が入れば既存ロジックがそのまま働く)
- reducer の `set_planning_range` 適用(explicit 保護 guard は先行タスクで導入済み。ここに pending 分岐を足さない — 保護は validator 層の責務とする)
- `confirmedSlotsFromState`(別タスク `20260710-weekly-planning-confirmed-slots-semantics.md`)
- deterministic parser、dialogue、renderer、legacy fallback、UI、保存・承認導線
- AI schema の構造変更(enum 追加・required 変更を含む)
- `shouldSavePlan: false` を維持する

## 受け入れ条件

1. `calendarDayCount` 無しの `set_planning_range`(2026-08-01T00:00:00〜2026-08-05T24:00:00)を adapter に通すと `calendarDayCount: 5` が付与され、その state での dry-run 候補が 8/1 起点で生成される(pipeline テストで `draftCandidates[0].date === '2026-08-01'` 相当を確認)。
2. deterministic 経路の range(parser が `calendarDayCount` 設定済み)は値が変わらない。
3. pending 中(「来週の計画を立てたい」適用後)に stub interpreter が `set_planning_range`(inferred)を返しても、`state.pendingPlanningRange` が維持され、`planning_start_date` の質問が継続する。
4. pending 中に explicit な `set_planning_range` が来た場合は hard-apply されず、確認系(acceptedWithConfirmation + assumptions 追記)に倒れる。
5. `createInterpreterStateSummary` が pending 中に `pendingPlanningRange` 情報(label を含む)を返す。
6. 既存テストがすべて green(`npm run test:run src/features/weeklyPlanning`)。

## テスト観点

- `weeklyPlanningInterpreterFoundation.test.ts`: adapter 正規化の単体(日数境界: 同日=1、月跨ぎ、endDateTime '24:00' 表記)、validator の pending 保護(explicit / inferred / missing confidence の3値)。
- `weeklyPlanningIntakePipeline.test.ts`: 受け入れ条件1・3・4 の統合(stub interpreter)。
- regression: temporal scope 差分の既存テスト(「resolved planning range as the scheduler window」)が green のまま。

## リスク

- `endDateTime` の '24:00' 表記(deterministic 経路の慣習)と AI が返しうる '23:59' 等で日数計算が1日ずれる可能性。`slice(0, 10)` の日付部比較(既存 `planningDayCountFromRange` と同じ)に揃えることでずれを避ける。
- validator に stateSummary 依存の分岐を増やすため、`use_constraint_source` の既存 special-case と順序が絡む。既存の判定順(shape → enum → value → source 解決 → clarification 振り分け → slot)のどこに挿すかを報告に明記する。
- prompt 変更は golden eval(`weeklyPlanningAiInterpreter.real-eval.test.ts`)の対象外だが、実 AI 挙動の変化は本タスクでは検証しない(roadmap の「実 AI 評価は別途1回」方針に従う)。

## Codexへの実装指示

1. 最初に本md全体と `docs/ai/codex-task-guide.md` を読む。
2. 実装順: adapter 正規化 → stateSummary 拡張 → validator 保護 → prompt 追記 → テスト。
3. 参照すべき既存実装: `resolveSchedulingInput` / `dateDiffDays` / `planningDayCountFromRange`(日数算式の正)、`validateInterpretedCandidates` の `use_constraint_source` special-case(reject + 確認へ倒すパターンの前例)、`addConfirmationAssumptions`(確認 assumptions の前例)。
4. 検証(Node 22):

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```

5. `docs/ai/codex-task-guide.md` に従う: スコープ外へ広げない、git 操作をしない、受け入れ条件のチェック結果と解釈で埋めた点を報告する。
