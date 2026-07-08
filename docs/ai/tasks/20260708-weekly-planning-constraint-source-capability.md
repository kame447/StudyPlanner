# 既存 schedule source を計画制約として利用する capability を intake に可視化し、`use_constraint_source` 意図で fixed_events を充足する

本mdの範囲外へ進まない。git add / commit / push はしない。production code は本タスク実装時のみ変更。設計根拠は `docs/architecture/weekly-planning-nl-capability-model.md`(§6 診断原則・§7 capability inventory・§8.1 semantic intent・§9 vertical slice)。

## 背景

実使用で次が確認された(意味は同じ・表現だけ違う一群):

実例2:
```text
ユーザー: 大学院入試の過去問を進めていきたい。授業が木曜日の二コマの時間帯にあるのと今日の夜に18〜20:30でバイトがあります
アプリ: 固定の予定があれば教えてください。   ← 授業・バイトを伝えたのに broad 再質問
```
実例4a:
```text
ユーザー: 授業は予定表に記載されている通りにあります
（後続で固定予定の扱いが反映されない）
```

監査(実コード確認)の結論は「新しい scheduling capability を作る必要はない」。既存予定(`Plan[]`)と active timetable(`ScheduleTemplate[]`)を busy interval として避ける capability は **generator に汎用実装済みで毎ターン稼働している**(`weeklyDraftCandidateGenerator.buildBusyIntervals` / `buildTimetableBusyIntervals`、`NaturalLanguageAssistant.tsx:526-528` が毎ターン供給)。欠けているのは、この read-only capability の可用性が **intake の missing/充足判定・interpreter stateSummary に見えていない**こと(診断分類 D)と、「既存 schedule source を制約として使う」という**意味カテゴリ(B)が無い**ことだけ。

この task は、その最小の縦切り(vertical slice)を1経路だけ貫通させる基盤。以後の同種問題(capability はあるが intake が知らない)の手本にする。

## 目的

- 「授業は予定表の通り」等の表現ゆれを、**1つの発話非依存 intent `use_constraint_source(kind, selector)`** に写像できるようにする(発話ごとの専用 command/regex を作らない)。
- planner が既存予定・timetable を保持しているという **capability 可用性を intake/interpreter/renderer に構造化供給**する。
- 参照ソースが実際に非空であることを deterministic に検証したうえで `fixed_events` missing を充足し、broad 再質問を止める。空ソースへの defer は鵜呑みにせず確認に倒す。
- バイト(18-20:30 のように時刻明確)は従来どおり hard `add_fixed_event` として受理され `fixed_events` を充足する経路を、実 AI/決定的 parser のどちらで落ちているか特定して繋ぐ。

## 計画書との対応

- spec: §4(生活・既存予定の活用)、§5(聞き取り)、§6(質問しすぎ防止)、§12(責務分離)
- 改善テーマ: roadmap Phase **R2-Capability**(semantic intent ↔ planner capability の橋渡し)。`existing-plans-availability-exclusion`(closed)の intake 側続編。

## 対象ファイル

- 変更(想定):
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts`(capability snapshot の算出と、`confirmedSlotsFromState` / `createInterpreterStateSummary` への反映)
  - `src/features/weeklyPlanning/intake/weeklyPlanningInterpreterTypes.ts`(`InterpreterStateSummary` に capability 可用性フィールド)
  - `src/features/weeklyPlanning/intake/weeklyPlanningCommandTypes.ts`(`use_constraint_source` intent を1つ追加。payload は `source: { kind, selector }`)
  - `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts`(planner decision: ソース非空検証 → `fixed_events` 充足 or 確認に倒す)
  - `src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts`(schema と system prompt に `use_constraint_source` を追加。**発話パターン列挙ではなく意味写像として**)
  - `src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts`(新 intent の値域・空ソース時の格下げ)
- 新規: なし想定(既存境界に載せる)
- テスト:
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts`
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningIntakeEdgeCases.test.ts`
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.test.ts`(fake interpreter で `use_constraint_source` を注入)

## 現在の処理経路

- `NaturalLanguageAssistant.tsx:526-528` が `existingPlans: plans` / `scheduleTemplates` / `timetableTermId` を pipeline input へ毎ターン渡す。
- `weeklyPlanningIntakePipeline.buildPipelineOutput` はそれらを generator へ素通しするだけ(`weeklyDraftCandidateGenerator` が busy interval 化)。**`PlanningIntakeState` にも `InterpreterStateSummary` にも、既存予定/timetable の存在は反映されない。**
- `confirmedSlotsFromState`(pipeline.ts:121-138)は `fixed_events` を「`!state.missing.includes('fixed_events')` のとき」しか confirmed にしない。既存予定/timetable の有無を参照していない。
- `set_planning_range` apply(reducer:407-418)が `fixed_events` を無条件で missing に追加。除去は hard `add_fixed_event`(reducer:324-326)か `note_no_fixed_events`(reducer:366-370)のみ。**「既存 timetable を使う」経路が無い。**

## 問題点

- 診断分類 **D**: 既存予定/timetable を避ける capability は稼働しているのに、intake の充足判定・interpreter stateSummary がその存在を知らない。
- 診断分類 **B**: 「既存 schedule source を制約として使う」という意味カテゴリが command/intent に無い。
- 診断分類 **A/E**(実例2 バイト): 時刻明確なバイトが hard fixed event として `fixed_events` を充足できていない可能性。実 AI/決定的 parser のどちらで落ちるか未特定。

## 修正方針

**Phase 1（調査・確定。実装前）**

1. 実例2・4a を実 AI トレース(または決定的 parser 経路)で流し、`add_fixed_event`(バイト)/ timetable 参照(授業)がどう扱われ `fixed_events` がなぜ残るかを1点ずつ確定する。落ちている層(A/D/E)を実データで確認して報告に残す。

**Phase 2（実装。発話非依存で）**

2. **capability snapshot(read-only・deterministic)**: pipeline input の `existingPlans` / `scheduleTemplates` / `timetableTermId` から、`{ hasActiveTimetable: boolean; existingPlanCount: number; }` 相当の可用性を1回算出する。これを (a) `InterpreterStateSummary`(AI にどの source が存在するか伝える)、(b) reducer の planner decision(下記)、(c) 将来の renderer context(別 task が参照)へ供給する。**capability を新設しない。可用性の可視化のみ。**
3. **`use_constraint_source` intent を1つ追加**: payload は `source: { kind: 'timetable' | 'existing_plans' | 'calendar'; selector: 'active' }`。「予定表の通り」「時間割に入っている」「登録済みの授業を考慮」「いつもの授業を避けて」「普段通りの授業」を**すべて同じ intent へ写像**する。発話ごとに case を増やさない(§8.4 の不変条件)。
4. **planner decision（deterministic）**: `use_constraint_source` 適用時、capability snapshot で参照ソースが**非空**なら `fixed_events` を充足し「その source を制約として利用中」を state に記録。**空**なら鵜呑みにせず `requires confirmation`(assumption + 確認)へ倒す。
5. バイト(時刻明確)は hard `add_fixed_event` として `fixed_events` を充足する既存経路に確実に乗せる。授業(木曜二コマ・時刻未確定)は、timetable から解決できるなら timetable 利用に含め、できないなら broad 再質問ではなく**その予定の時刻を確認**に倒す。

## 触らない範囲

- generator の busy interval 化ロジック本体(`existing-plans-availability-exclusion` で完了済み。**ここは変更しない**)。
- scheduler 本体・placement scoring・二系統統合。
- draft block の作成/削除/移動(§7.2)、保存・承認導線(`shouldSavePlan: false` 維持)。
- renderer の質問文表現・平易語彙(別 task: renderer-deterministic-context)。ただし capability snapshot を renderer が読めるよう供給する所までは本 task で用意してよい。
- clarification(別 task)。
- timetable データ層の改修。UI 配線がデータ層大改修に及ぶなら interface まで実装し停止・報告。
- `note_no_fixed_events` / 既存の hard fixed event テストの期待値変更(不変)。

## 受け入れ条件

- 「授業は予定表に記載の通り」で `use_constraint_source(timetable, active)` に写像され、timetable が非空なら `fixed_events` が充足し broad 再質問が止まる。
- 「時間割に入っている予定を使って」「登録済みの授業を考慮して」「いつもの授業を避けて」「普段通りの授業があります」が**同一の intent** に写像される(表現ゆれが semantic level で同じ intent になる契約)。
- timetable が空のまま「予定表の通り」と言われた場合、`fixed_events` を勝手に充足せず確認に倒れる。
- 「今日の夜18〜20:30 バイト」が hard fixed event として受理され `fixed_events` を充足する。
- `InterpreterStateSummary` に capability 可用性(timetable/既存予定の有無)が載る。
- weeklyPlanning テスト green / build 成功。既存 `note_no_fixed_events` / hard fixed event / generator テストの期待値不変。

## テスト観点

- 正常系: 4表現ゆれ →同一 `use_constraint_source`。timetable 非空 → `fixed_events` 充足。
- 境界/曖昧: 空 timetable への defer → 確認に倒れ hard 確定しない。時刻未確定の授業 → broad 再質問でなく時刻確認 or timetable 解決。
- regression: 「予定なし」明示(`note_no_fixed_events`)不変。既存予定 busy interval 除外(closed task)不変。バイト hard 受理。
- fake interpreter で `use_constraint_source` を注入し、pipeline が capability snapshot を見て state を充足することを決定的に固定(実 AI 非依存)。

## リスク

- 空ソース検証を誤ると「利用中」と偽って `fixed_events` を静かに充足しかねない。**非空検証を必須**とし、テストで空ソースの確認倒しを固定する。
- interpreter schema に intent を増やすと candidate 契約に波及。validator の値域チェックと anyOf union 追加を漏らさない。
- Phase 1 でバイト未受理の主因が別層(例: 時刻 parse)なら、本 task 範囲を超える。切り分けて報告し、越境しない。

## Codexへの実装指示

1. **Phase 1(調査)を先に完了し報告**してから Phase 2 実装に入る。落ちている層(A/D/E)を実データで確定する。
2. 参照実装: `mark_completion_target`(1 command で `target.kind` の payload variation を吸収する良い手本。`weeklyPlanningCommandTypes.ts` / reducer `applyMarkCompletionTargetCommand`)。`use_constraint_source` も同様に payload で表現を吸収し、発話ごとに case を増やさない。
3. capability snapshot は read-only。state を mutate しない。generator の既存 busy interval 化には触れない。
4. `shouldSavePlan: false` を維持。保存・承認・削除・draft mutation を AI から実行可能にしない。
5. 越境しそうな箇所(UI 配線がデータ層大改修に及ぶ等)は停止して報告する。
6. 最後に必ず `docs/ai/codex-task-guide.md` に従う(スコープ外に広げない、git 操作しない、報告項目)。

## 検証(Node 22)

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```
