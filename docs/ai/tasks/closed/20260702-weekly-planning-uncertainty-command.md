# uncertainty 表現の解釈を note_uncertainty command 経由へ移行する

## 背景

weeklyPlanning の intake reducer は command boundary(parser → command → adapter → reducer)への移行がほぼ完了しており、直近のタスクで曖昧進捗ヒントも `note_progress_boundary` command 化された(`docs/ai/tasks/closed/20260702-weekly-planning-progress-hint-command.md`)。現在、reducer 内に残る日本語の直接解釈は、uncertainty 判定の正規表現 `知らない分野.*時間かかる|細かく見る.*時間かかる` と、legacy fallback(別タスク予定)だけである。roadmap(`docs/ai/strategy/weekly-planning-roadmap.md`)Phase R1-1 に対応する。

## 目的

「知らない分野は時間がかかる」系の不確実性表現の解釈を parser 層に移し、`note_uncertainty` command 経由で state に反映する。reducer 内の uncertainty 正規表現直書きをなくす。挙動は変えない(同じ入力から同じ `PlanningIntakeState` が得られる)。

あわせて、この経路には既存テストが1件もないため、現挙動を固定するテストを新設する。

## 計画書との対応

- spec: §7(所要時間の不確実性の扱い)、§12(責務分離)
- 改善テーマ: LLM使用量を抑える責務分離(command boundary の完成)
- roadmap: Phase R1-1(uncertainty 正規表現の command 化)
- ガイド: `docs/ai/weekly-planning-pipeline-guide.md` §3(reducer に自然言語解釈を増やさない)

## 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/intake/weeklyPlanningCommandTypes.ts`(`NoteUncertaintyCommand` 追加)
  - `src/features/weeklyPlanning/intake/weeklyPlanningCommandAdapter.ts`(変換関数追加)
  - `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts`(正規表現ブロックを command apply に置換)
- 新規:
  - `src/features/weeklyPlanning/intake/weeklyPlanningUncertaintyParsing.ts`(parser)
- テスト:
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningIntakeEdgeCases.test.ts`(ケース追加)

## 現在の処理経路

1. `applyWeeklyPlanningUserTurn`(`weeklyPlanningIntakeReducer.ts` 342行付近)が、main command batch の適用後に `normalizeIntakeText(userText)` 全体へ正規表現 `/知らない分野.*時間かかる|細かく見る.*時間かかる/` を直接テストする。
2. マッチした場合、`uncertainties` に `'unknown_fields_may_take_longer'`(`PlanningIntakeUncertainty` 型の唯一の値)を `uniqueList` で追加する。
3. `finalizeState` が `uncertainties` を再度 unique 化する。同一ターン内で `uncertainties` を読む処理はほかにない。
4. この経路を検証する既存テストは存在しない(`unknown_fields_may_take_longer` / `uncertainties` は test ファイルに未出現)。

## 問題点

- reducer が日本語の正規表現を直接持っており、ガイド §3 の責務境界(自然言語を読むのは parser 層だけ)に反する。legacy fallback を除けば最後の直書き解釈である。
- テストが1件もないため、この挙動はリファクタで静かに壊れても検出できない。

## 修正方針

挙動変更なしのリファクタ+挙動固定テストの新設として行う。既存の `note_progress_boundary` の3点セット(parse / adapter / apply)と同じパターンに揃える。

1. `weeklyPlanningCommandTypes.ts` に command 型を追加し、`ParsedWeeklyPlanningCommand` union に加える:

   ```ts
   export interface NoteUncertaintyCommand {
     type: 'note_uncertainty';
     uncertainty: PlanningIntakeUncertainty;
     sourceText: string;
     sourceSegment?: string;
     confidence: 'high' | 'medium' | 'low';
   }
   ```

   `PlanningIntakeUncertainty` は `weeklyPlanningIntakeTypes.ts` から import する。confidence は `'medium'` 固定でよい(曖昧な不確実性表明のため)。
2. 新規 `weeklyPlanningUncertaintyParsing.ts` に `parseNoteUncertaintyCommand(text: string): NoteUncertaintyCommand | undefined` を実装する。判定は現行と完全に同一にする: `normalizeIntakeText(text)` **全体**(segment 分割しない)に対して `/知らない分野.*時間かかる|細かく見る.*時間かかる/` をテストし、マッチ時に `uncertainty: 'unknown_fields_may_take_longer'`、`sourceSegment` にマッチ部分(`match[0]`)を入れて返す。正規表現の内容をこのタスクで変えない・広げない。
3. `weeklyPlanningCommandAdapter.ts` に `toUncertaintyFromNoteUncertaintyCommand(command): PlanningIntakeUncertainty` を追加する(passthrough でよい。`toPriorityPolicyFromSetPriorityPolicyCommand` と同じ位置づけ)。
4. `weeklyPlanningIntakeReducer.ts`:
   - `applyWeeklyPlanningCommand` に `case 'note_uncertainty'` を追加: `uncertainties: uniqueList([...state.uncertainties, toUncertaintyFromNoteUncertaintyCommand(command)])`。
   - `parseWeeklyPlanningCommands` の `optionalCommands` に `parseNoteUncertaintyCommand(params.userText)` を追加する。
   - `applyWeeklyPlanningUserTurn` 内の正規表現ブロック(342行付近の if 文)を削除する。
   - 適用タイミングが「main batch 後」から「main batch 内」に変わるが、同一ターン内で `uncertainties` を読む処理はなく、`finalizeState` で unique 化されるため挙動等価である。

## 触らない範囲

- 正規表現のパターン自体(対応表現の拡大は Phase R2 で別タスク)
- `hasExplicitNoFixedEvents` の reducer 内呼び出し(同種の残存だが別タスクで扱う。今回触らない)
- legacy fallback(`looksLikeWeeklyPlanningRequest` / `assessWeeklyPlanningRequest` / `mergeWeeklyPlanningRevision`)と `TODO(Phase 9.8)` コメント
- `PlanningIntakeUncertainty` 型の値追加・変更
- `finalizeState` / `weeklyPlanningMissingStatus.ts`、dialogue 層、`scheduling/`、`preview/`、`pipeline/`、`profiling/`、`weeklyPlanningTransforms.ts`
- UI / CSS、保存導線、承認導線、`shouldSavePlan: false` の維持
- 既存テストの期待値(`scheduling/placementScoring.test.ts` に今回の変更と無関係の既存失敗が1件ある。触らず、報告にそのまま記載する)

## 受け入れ条件

- 「知らない分野は時間かかると思う」「細かく見ると時間かかる」を含むターンで、従来どおり `uncertainties` に `'unknown_fields_may_take_longer'` が入る。
- マッチしない入力(例: 「時間かかる」単独、「知らない分野がある」)では `uncertainties` が変化しない。
- 同じ表現を複数ターン入力しても `uncertainties` に重複が生じない。
- `applyWeeklyPlanningUserTurn` から日本語正規表現の直接テストが消え、uncertainty 反映が `applyWeeklyPlanningCommand` 経由になっている。
- 既存テストがすべて green のまま(`placementScoring.test.ts` の既存失敗1件を除く。期待値の変更・削除・skip なし)。

## テスト観点

`weeklyPlanningIntakeEdgeCases.test.ts` に追加する(この経路の既存テストはゼロなので、すべて新設):

- parser 単体: `parseNoteUncertaintyCommand` が両パターン(「知らない分野〜時間かかる」「細かく見る〜時間かかる」)で command を返し、`sourceText` / `sourceSegment` が入ること
- parser 単体: マッチしない入力・部分一致(「時間かかる」のみ等)で `undefined` を返すこと
- reducer 経由: `applyWeeklyPlanningUserTurn` で `uncertainties` に追加されること、非マッチ入力で追加されないこと
- reducer 経由: 複数ターンの重複追加が起きないこと(uniqueList)
- 全角・空白ゆれ: `normalizeIntakeText` を通すため全角スペースや表記ゆれを含む入力でも従来どおり動くこと(1ケースでよい)

## リスク

- 適用タイミングの変更(main batch 後 → batch 内)による挙動差。調査時点では `uncertainties` を同一ターン内で読む処理はないため等価だが、実装時に `uncertainties` の参照箇所を grep で再確認すること。
- 正規表現を segment 分割に載せ替えると挙動が変わる(現行は全文マッチで、`.*` が読点をまたぐ)。必ず全文に対して判定すること。
- このタスク自体は小さく、リスクは低い。むしろテスト新設が主価値なので、テストを省略しないこと。

## Codexへの実装指示

1. まずテストを書く: 現行実装(正規表現直書き)のまま、reducer 経由の挙動固定テストを追加して green を確認する。
2. 次に command 型 → parser(新規ファイル)→ adapter → reducer の順で実装し、reducer の正規表現ブロックを削除する。手順1のテストが green のままであることを確認する。
3. 最後に parser 単体テストを追加する。
4. 参照実装: `note_progress_boundary` の3点セット(`parseNoteProgressBoundaryCommand` / `toStudyProgressFromNoteProgressBoundaryCommand` / reducer の `case 'note_progress_boundary'`)が直近の同型パターンである。
5. `docs/ai/codex-task-guide.md` に従うこと: タスクmd外へ広げない、git add / commit / push をしない、作業後に対象テスト(`npm run test:run src/features/weeklyPlanning/__tests__/weeklyPlanningIntakeEdgeCases.test.ts`)、`npm run test:run src/features/weeklyPlanning`、`npm run build`、`git diff --check`、`git diff --stat`、`git status -sb` を報告する。
