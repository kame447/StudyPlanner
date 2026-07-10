# 週間計画の confirmedSlots を missing 不在の proxy から state 実体の導出に変える

Priority: **High**(理由: AI モードの主要ペルソナ経路で、ユーザーが伝えた情報が確認・記録・フィードバックなしに silent drop され、後で同じ質問が再出現する。先行タスクの修正A/Bを適用しても pending 段階の誤判定は残るため、実害が現行のまま継続する)

本mdの範囲外へ進まない。git add / commit / push はしない。

**前提**: `20260710-weekly-planning-range-reseed-guard-and-start-date-render.md`(修正A/B/C)の実装が working tree に存在すること。修正Aで導入される「slot に state 実体があるか」の導出 helper を本タスクで共有するため、先行タスクが未実装の場合は実装せず報告する。着手時に実コードを再確認し、本mdの調査結果と食い違う場合も報告で止める。

## 背景

`runWeeklyPlanningIntakePipelineWithInterpreter` は AI interpreter に渡す `InterpreterStateSummary.confirmedSlots` を `confirmedSlotsFromState`(`pipeline/weeklyPlanningIntakePipeline.ts`)で作る。このうち `fixed_events` と `life_constraints` は「`state.missing` に無い = 確定済み」という proxy で判定している。missing の不在には「回答済み」と「まだ質問リストに載っていない(未シード)」の2つの意味があり、temporal scope 実装(pending clarification)によって後者の期間が会話冒頭に常態化した。この誤判定は 2026-07-10 の全体レビューで実行再現済みである。

## 目的

「AI が確定済み slot を上書きしようとした」という validator の防御(`confirmed-slot-overwrite`)が、実際に回答済みの slot に対してのみ働くようにする。pending 段階でユーザーが伝えた固定予定・constraint source が正しく受理・記録されるようにする。

## 計画書との対応

- spec: §5(聞き取り)、§6(同じ質問を繰り返さない)
- 改善テーマ: roadmap Phase R2-Capability 診断原則 D(intake 可視性)。`20260708-weekly-planning-constraint-source-capability.md`(closed)が導入した capability 可視化の欠陥修正

## 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts`(`confirmedSlotsFromState`)
  - `src/features/weeklyPlanning/intake/weeklyPlanningMissingStatus.ts` または reducer 内 helper(先行タスク修正Aの導出 helper の共有化。置き場所は修正Aの実装に合わせる)
  - 必要な場合のみ: `src/features/weeklyPlanning/intake/weeklyPlanningIntakeTypes.ts`(`note_no_fixed_events` の痕跡フィールド追加。追加的・optional に限る)+ `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts`(同フィールドの設定)
- 新規: なし
- テスト:
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts`
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts`

## 現在の処理経路

1. `runWeeklyPlanningIntakePipelineWithInterpreter` → deterministic turn 適用後、`createInterpreterStateSummary(deterministicTurn.state, capabilitySnapshot)`。
2. `confirmedSlotsFromState(state)` が slot 一覧を作る。現在の判定:
   - `planning_range` / `exam_scope` / `year_range` / `unit_duration_estimate` / `priority_policy` / `progress`: state の実体(range / examPrepScope / unitRates / priorityPolicy / progress)から導出 — **問題なし**
   - `fixed_events`: `!state.missing.includes('fixed_events')` — **missing 不在 proxy**
   - `life_constraints`: `!state.missing.includes('life_constraints') && !state.missing.includes('meal_bath_constraints')` — **missing 不在 proxy**
3. `validateInterpretedCandidates`(`intake/weeklyPlanningCandidateValidator.ts`)が `commandSlotKeys(command)` と `summary.confirmedSlots` の交差で `confirmed-slot-overwrite` reject を行う。`add_fixed_event` / `add_unavailable` / `note_no_fixed_events` / `use_constraint_source` はいずれも slot `fixed_events`、`update_life_constraint` は `life_constraints` に写像される。
4. reject された候補は `interpreterDiagnostics.rejected` に入るだけで、state 反映もユーザーへのフィードバックもない。

## 問題点(実行再現済み)

- ターン1「来週の計画を立てたい。院試の過去問を7年分、5分野やりたい。」の後(pending 中、missing = `[planning_start_date, year_range, ...]`。`fixed_events` は未シード)、ターン2「時間割の通りでお願いします」+ 有効な timetable あり:
  - escalation → AI が `use_constraint_source`(timetable, high)を返す
  - `confirmedSlotsFromState` が `fixed_events` を「確定済み」と誤報告 → validator が `confirmed-slot-overwrite` で reject
  - `constraintSourcesInUse` 未記録、応答にも反映なし。range 確定後に `fixed_events` がシードされ、**伝えたはずの固定予定を再質問**する
- 同じ理屈で、pending 中の `add_fixed_event` / `update_life_constraint`(AI 経由)も落ちる。
- 先行タスクの修正Aは「range 確定時の再シード」を直すが、confirmedSlots の proxy 判定自体は直さないため、この silent drop は残る。

## 修正方針

- `fixed_events` / `life_constraints` の confirmed 判定を、missing 不在 proxy から **state 実体の導出**に置き換える。判定条件は先行タスク修正Aのシード条件の**逆**(実体があれば confirmed)とし、同じ helper を共有して片側だけ変わる事故を防ぐ:
  - `fixed_events` confirmed ⇔ `constraints` に `kind: 'fixed_event' | 'unavailable'` がある、または `constraintSourcesInUse` が非空、または「固定予定なし」宣言済み(下記)
  - `life_constraints` confirmed ⇔ `constraints` に `kind: 'sleep' | 'buffer'` があり、かつ `kind: 'meal' | 'bath'` がある(現行の2キー AND 判定の実体版)
- `note_no_fixed_events` は現在 state に痕跡を残さない(missing から消すだけ)。「固定予定なし」を confirmed として扱うために、`PlanningIntakeState` に **optional の追加フィールド**(例: `fixedEventsDeclaredNone?: true`)を足し、reducer の `case 'note_no_fixed_events'` で設定する。破壊的変更(既存フィールドの削除・型変更)は行わない。turn 開始時の state コピー(`applyWeeklyPlanningUserTurnWithDiagnostics`)への引き継ぎを忘れない。
- 導出 helper の置き場所は intake 層(修正Aの実装位置に合わせる)。pipeline は helper を呼ぶだけにし、pipeline 内に判定条件を直書きしない。
- validator・reducer の適用ロジック・escalation 判定は変更しない(validator は confirmedSlots の enforcement のみという現行分担を維持)。

## 触らない範囲

- `weeklyPlanningCandidateValidator.ts` の判定順序・reject 理由の体系(confirmedSlots の**中身**だけを直す)
- `weeklyPlanningReferenceResolution.ts` / `weeklyPlanningInterpreterEscalation.ts`
- `InterpreterStateSummary` への pendingPlanningRange 追加(別タスク `20260710-weekly-planning-ai-range-normalization.md` の範囲)
- clarification と accepted commands の直交化(別タスク)
- parser 層、dialogue 層、renderer 層、legacy fallback、scheduler、UI、保存・承認導線
- `shouldSavePlan: false` を維持する

## 受け入れ条件

1. pending 中(「来週の計画を立てたい。院試の過去問を7年分、5分野やりたい。」適用後)に、stub interpreter が `use_constraint_source`(timetable, high, timetable 利用可能)を返した場合、候補が accepted になり `state.constraintSourcesInUse` に `{ kind: 'timetable', selector: 'active' }` が記録される。`interpreterDiagnostics.rejected` に `confirmed-slot-overwrite` が現れない。
2. 上記の後に「水曜日から」で range を確定しても、`fixed_events` が missing に再出現しない(先行タスク修正Aとの連鎖確認)。
3. ユーザーが実際に固定予定を答えた後(`constraints` に `fixed_event` あり)は、AI の `add_fixed_event` 系が従来どおり `confirmed-slot-overwrite` で reject される(防御の維持)。
4. 「固定の予定はありません」等で `note_no_fixed_events` が適用された state では、`fixed_events` が confirmed と判定される(AI の後追い `add_fixed_event` を hard-apply しない)。
5. `confirmedSlotsFromState` の他の slot(planning_range / exam_scope / year_range / unit_duration_estimate / priority_policy / progress)の判定結果が全ケースで従来と一致する。
6. 既存テストがすべて green(`npm run test:run src/features/weeklyPlanning`)。

## テスト観点

- `weeklyPlanningInterpreterFoundation.test.ts`: confirmedSlots 導出の単体観点(実体あり/なし × missing あり/なし の組で、missing 状態に依存しないこと)。`note_no_fixed_events` 痕跡の引き継ぎ(複数ターン後も confirmed のまま)。
- `weeklyPlanningIntakePipeline.test.ts`: 受け入れ条件1〜4 の pipeline 統合(stub interpreter 使用)。
- regression: 通常フロー(range を最初に確定する既存シナリオ)で confirmedSlots の実効挙動が変わらないこと。

## リスク

- confirmed 条件とシード条件(修正A)が将来片側だけ変更されると逆方向の stale を作る。helper 共有と鏡像テストで固定する。
- `fixedEventsDeclaredNone` 追加は `PlanningIntakeState` の追加的変更であり、state を literal で組み立てる既存テストには影響しない(optional のため)が、turn コピー処理への追加漏れに注意。
- soft な fixed_event(`hardness: 'soft'`)だけがある state を confirmed とみなすか、は解釈余地がある。現行の missing 解除(`add_fixed_event` は hard のみ `fixed_events` を除去)に合わせ、**hard のみを confirmed 根拠**とするのを既定とし、解釈は報告に明記する。

## Codexへの実装指示

1. 最初に本md全体と `docs/ai/codex-task-guide.md` を読む。
2. 先行タスク(`20260710-weekly-planning-range-reseed-guard-and-start-date-render.md`)の修正Aが実装済みであることを確認し、その導出 helper の実装位置・シグネチャに本タスクを合わせる。未実装なら報告で止める。
3. 実装順: (1) `note_no_fixed_events` 痕跡フィールド → (2) 導出 helper の confirmed 側 → (3) `confirmedSlotsFromState` の置き換え → (4) テスト。
4. 参照すべき既存実装: `commandSlotKeys` / `validateInterpretedCandidates`(validator の enforcement 対象)、`applyUseConstraintSourceCommand` / `removeMissingForLifeConstraint`(充足の実体定義)、`applyWeeklyPlanningUserTurnWithDiagnostics` の state コピー。
5. 検証(Node 22):

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```

6. `docs/ai/codex-task-guide.md` に従う: スコープ外へ広げない、git 操作をしない、受け入れ条件のチェック結果と解釈で埋めた点を報告する。
