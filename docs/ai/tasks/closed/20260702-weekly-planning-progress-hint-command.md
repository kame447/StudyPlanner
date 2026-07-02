# 曖昧進捗ヒント(progressHint)を ParsedWeeklyPlanningCommand 経由に移行する

## 背景

weeklyPlanning の intake reducer は、Phase 9.7 までにほとんどの解釈経路を `ParsedWeeklyPlanningCommand` 境界(parser → command → adapter → reducer)へ移行済みである。しかし「ソフトウェアは2021まで終わってる」のような方向が曖昧な進捗表現だけは、`parseProgressHint` が domain 型 `StudyProgress` を直接返し、reducer が command を経ずに `state.progress` へ直接 push している。reducer 内に `TODO(Phase 9.8): move ambiguous progress hints into ParsedWeeklyPlanningCommand` として明示されている残作業である。

## 目的

曖昧進捗ヒントの経路を command 境界に乗せ、reducer から「parser の返り値を直接 state に反映する」最後の進捗系経路をなくす。挙動は変えない(同じ入力から同じ `PlanningIntakeState` が得られる)。

## 計画書との対応

- spec: §5(タスク具体化の入力解釈)、§13(分からない情報は決めつけず曖昧のまま保持する方針)
- 改善テーマ: 自然言語入力の対応範囲拡大(の基盤整備)、LLM使用量を抑える責務分離
- ガイド: `docs/ai/weekly-planning-pipeline-guide.md` §3(責務境界)、§6(次の重点 = progressHint / legacy fallback / reducer 内直接 parse の棚卸し)

## 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/intake/weeklyPlanningCommandTypes.ts`(command 型追加)
  - `src/features/weeklyPlanning/intake/weeklyPlanningCompletionParsing.ts`(command を返す parser 関数追加)
  - `src/features/weeklyPlanning/intake/weeklyPlanningCommandAdapter.ts`(command → `StudyProgress` 変換追加)
  - `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts`(直接 push を command apply に置換、TODO コメント除去)
- 新規: なし(テストは既存ファイルへの追加でよい)
- テスト:
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningIntakeEdgeCases.test.ts`(command 生成の単体テスト追加)

## 現在の処理経路

1. `applyWeeklyPlanningUserTurn`(`weeklyPlanningIntakeReducer.ts` 315行付近)が、setup command(`set_planning_range` / `set_exam_scope`)適用後に `parseProgressHint(userText, fields)` を直接呼ぶ。
2. `parseProgressHint`(`weeklyPlanningCompletionParsing.ts:6`)は、否定・条件付き完了・予定表現を除外したうえで `([^\s、。]+?)(?:の)?\s*(20\d{2})\s*まで.*(?:終わ|済|完了|やった)` にマッチした場合、`StudyProgress { field?, completionBoundaryYear, ambiguity: 'completion_direction', rawText }` を返す。
3. reducer は返り値をそのまま `nextState.progress` に push し、`addMissing(['completion_direction'])` を行う。
4. その後 `parseWeeklyPlanningCommands` → `applyWeeklyPlanningCommands` で残りの command(`mark_completed_units` 等)が適用される。`mark_completed_units` の `mergeMode: 'replace'` は「同 field の最後の progress、なければ末尾の progress」を上書きするため、progressHint が先に progress へ入っていることが前提の挙動になっている。

## 問題点

- parser(`parseProgressHint`)が domain 型 `StudyProgress` を直接返し、reducer がそれを command を経ずに state へ反映している。ガイド §3 の責務境界(parser は command を作る、reducer は command を apply する)に反する唯一の進捗系経路。
- 同じ「進捗」を扱う `mark_completed_units` は command 化済みであり、経路が二重になっている。今後、進捗単位の一般化(ページ・語数など)を進めるときに、この非対称が拡張の妨げになる。

## 修正方針

挙動変更なしの純粋なリファクタとして行う。

1. `weeklyPlanningCommandTypes.ts` に新 command を追加する:

   ```ts
   export interface NoteProgressBoundaryCommand {
     type: 'note_progress_boundary';
     field?: string;
     boundaryYear: number;
     ambiguity: 'completion_direction';
     sourceText: string;
     sourceSegment?: string;
     confidence: 'high' | 'medium' | 'low';
   }
   ```

   `ParsedWeeklyPlanningCommand` union に加える。confidence は既存 progressHint が曖昧扱いであることから `'medium'` 固定でよい。
2. `weeklyPlanningCompletionParsing.ts` に `parseNoteProgressBoundaryCommand(text, fields): NoteProgressBoundaryCommand | undefined` を追加する。内部は既存 `parseProgressHint` のロジックを使う(既存関数を内部 helper 化してよい)。マッチ判定・除外条件(`hasIncompleteExpression` 等)は一切変えない。
3. `weeklyPlanningCommandAdapter.ts` に `toStudyProgressFromNoteProgressBoundaryCommand(command): StudyProgress` を追加する。返す値は現在の `parseProgressHint` の返り値と同一形(`field`, `completionBoundaryYear`, `ambiguity: 'completion_direction'`, `rawText = sourceSegment ?? sourceText`)にする。
4. `weeklyPlanningIntakeReducer.ts`:
   - `applyWeeklyPlanningCommand` に `case 'note_progress_boundary'` を追加し、「progress へ append + `addMissing(['completion_direction'])`」を行う。
   - `applyWeeklyPlanningUserTurn` の直接 push ブロックを、`parseNoteProgressBoundaryCommand` の結果を `applyWeeklyPlanningCommands` で適用する形に置き換える。
   - **適用順序を維持すること**: setup commands → progress boundary command → `parseWeeklyPlanningCommands` の順。`mark_completed_units`(replace)の対象解決が progress の並び順に依存するため、順序が変わると挙動が変わる。
   - `TODO(Phase 9.8): move ambiguous progress hints ...` コメントを除去する。

## 触らない範囲

- `parseProgressHint` の正規表現・除外条件(対応表現をこのタスクで広げない)
- `mark_completed_units` の parse / apply 挙動、`applyMarkCompletedUnitsCommand` の replace / append ロジック
- legacy fallback(`assessWeeklyPlanningRequest` / `mergeWeeklyPlanningRevision` / `looksLikeWeeklyPlanningRequest`)と uncertainty 正規表現(`知らない分野.*時間かかる` 等)— 別タスクで扱う
- `scheduling/`, `preview/`, `dialogue/`, `pipeline/`, `profiling/`, `weeklyPlanningTransforms.ts`
- UI / CSS、保存導線、承認導線
- `shouldSavePlan: false` の維持、`finalizeState` / `weeklyPlanningMissingStatus.ts` のロジックと質問文言

## 受け入れ条件

- 「ソフトウェアは2021まで終わってる」を含むターンで、従来と同一の state になる: `progress` に `{ completionBoundaryYear: 2021, ambiguity: 'completion_direction' }` を含む entry が追加され、`missing` に `completion_direction` が入る。
- 否定・条件付き・予定表現(「2021は終わってない」「終わったらやる」「2021までやる予定」)では command が生成されない(従来どおり progress に入らない)。
- 同一ターンに明確な完了表現がある場合の `mark_completed_units`(replace)との相互作用が従来と同じ(既存 roleplay / edge case テストの期待値変更なし)。
- 既存テストがすべて green のまま(期待値の変更・削除・skip なし)。
- reducer の `applyWeeklyPlanningUserTurn` から `state.progress` への直接 push が消え、progress 更新がすべて `applyWeeklyPlanningCommand` 経由になっている。
- `TODO(Phase 9.8)` の progressHint に関するコメントが除去されている。

## テスト観点

- regression anchor(変更しない・green 維持):
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningIntakeEdgeCases.test.ts` の completion_direction 系ケース
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningRoleplayScenarios.test.ts`(completionBoundaryYear: 2021 のシナリオ)
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts`
- 追加(`weeklyPlanningIntakeEdgeCases.test.ts` へ):
  - `parseNoteProgressBoundaryCommand` が曖昧進捗表現から `note_progress_boundary` command(field 解決、boundaryYear、sourceSegment)を返すこと
  - 否定・条件付き完了・予定表現で `undefined` を返すこと
  - reducer が command 適用で progress append + missing 追加を行うこと

## リスク

- `mark_completed_units`(replace)の対象 index 解決が progress の並び順に依存するため、command の適用順序を誤ると roleplay シナリオが赤くなる。修正方針に書いた3段階の順序(setup → progress boundary → その他 command)を厳守すること。
- `parseProgressHint` を内部 helper 化する際に export を消すと、他所から参照されていた場合に build が壊れる。参照箇所を確認してから整理すること(現状の参照は reducer のみのはずだが、実コードで確認する)。

## Codexへの実装指示

1. まず `weeklyPlanningCommandTypes.ts` に command 型を追加し、`weeklyPlanningCompletionParsing.ts` に command 生成関数を追加する(この時点で既存挙動は不変)。
2. 次に adapter 関数を追加し、reducer の `case 'note_progress_boundary'` を実装する。
3. 最後に `applyWeeklyPlanningUserTurn` の直接 push を command 適用に置き換え、TODO コメントを除去する。
4. 参照実装: 既存の `mark_completed_units` の parse(`parseMarkCompletedUnitsCommand`)/ adapter(`toStudyProgressFromMarkCompletedUnitsCommand`)/ apply(`applyMarkCompletedUnitsCommand`)の3点セットが同じパターンである。
5. `docs/ai/codex-task-guide.md` に従うこと: タスクmd外へ広げない、git add / commit / push をしない、作業後に対象テスト(`npm run test:run src/features/weeklyPlanning/__tests__/weeklyPlanningIntakeEdgeCases.test.ts`)、`npm run test:run src/features/weeklyPlanning`、`npm run build`、`git diff --check`、`git diff --stat`、`git status -sb` を報告する。
