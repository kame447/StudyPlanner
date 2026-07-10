# 週間計画の range 確定時 missing 再シード / explicit range 上書き / 開始日質問レンダリングを修正する

本mdの範囲外へ進まない。git add / commit / push はしない。

**前提**: 本タスクは、working tree にある未コミットの temporal scope / 開始日 clarification 実装差分(`weeklyPlanningScopeParsing.ts` の pending range 対応、`weeklyPlanningIntakeReducer.ts` の `set_pending_planning_range` 等)の上に載せる補完修正である。実装前に `git status` で当該差分が存在することを確認する。存在しない(コミット済み・破棄済みで実コードが本mdの調査結果と食い違う)場合は実装せず報告する。

## 背景

未コミットの temporal scope 実装により、「来週の計画を立てたい」は `pendingPlanningRange` を保持して開始日 clarification へ進み、「水曜日から」で `set_planning_range` が確定するようになった。この変更で `set_planning_range` は**会話の途中ターンでも発火する** command になったが、既存実装には「`set_planning_range` は会話の最初のターンでしか発火しない」ことを暗黙の前提とした処理が2つ残っており、複数ターン対話で stale state を作る。さらに、新設の `planning_start_date` 質問 slot が renderer 層に未登録のため、本番の質問文が意味を成さない。

3つの問題はすべて実パイプラインの実行で再現確認済みである(既存テスト 405 件は green のまま再現する。つまり既存テスト網はこのシームを通っていない)。

## 目的

temporal scope / 開始日 clarification を含む複数ターン対話で、(1) 回答済みの情報が再質問されない、(2) 確定済みの explicit range が後続発話で壊れない、(3) 開始日質問が期間ラベル(「来週」等)つきの意味の通る文で表示される、ようにする。

## 計画書との対応

- spec: §5(計画範囲の聞き取り)、§6(質問しすぎ防止 = 同じ質問を繰り返さない)、§13(メンター対話)
- 改善テーマ: メンター対話型ヒアリング / 質問しすぎ防止(pipeline-guide §5)
- roadmap: Phase R2-Capability の診断原則 E(state transition)・F(renderer context)に該当する、temporal scope タスク(`20260709-weekly-planning-temporal-scope-start-clarification.md`)の残欠陥修正

## 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts`(修正A・B)
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts`(修正C)
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueMessages.ts`(修正C)
- 新規: なし(必要なら missing シード導出 helper を `weeklyPlanningMissingStatus.ts` に置いてもよい。その場合は同ファイルも変更対象に含める)
- テスト:
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts`(A・B の複数ターン regression)
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningAiDialogueRenderer.test.ts`(C の renderer 出力)
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueMessages.test.ts`(C の slot ラベル)

## 現在の処理経路と状態遷移

### range 確定の経路

1. `applyWeeklyPlanningUserTurnWithDiagnostics`(reducer)が**毎ターン無条件に** `parseSetPlanningRangeCommand(userText, context, nextState.pendingPlanningRange)` を setup command として実行する。`state.range` が確定済みかどうかは見ない。
2. `parseWeeklyPlanningRange`(parser)は「一週間 / 7日間」があれば range を返す。将来 scope 語(来週・夏休み)も明示日付もない場合は**現在日時起点の `confidence: 'inferred'` range を返す**(temporal scope 差分で新設された fallback 分岐)。
3. reducer の `case 'set_planning_range'` は、(a) `state.range` を**無条件に上書き**し、(b) `missing` に `tasks_or_goals / fixed_events / sleep_cycle / meal_bath_constraints` を**無条件に `addMissing`** する。
4. `finalizeState` → `resolveStatus` が `tasks_or_goals` missing を見て `needs_scope` に戻し、dialogue manager が再質問を組む。

### 質問レンダリングの経路

1. `planning_start_date` missing → `createMissingQuestionPlan`(dialogueManager)が `targetSlot: 'planning_start_date'` の質問計画を作る(未コミット差分で登録済み)。
2. `renderWeeklyPlanningDialogueMessage`(dialogueRenderer)が questionPlan を `DialogueNextQuestion` に変換する。このとき `SLOT_VOCABULARY_HINTS` に `planning_start_date` が**無い**ため vocabularyHint は undefined。
3. rules モード(renderer なし)では `renderDeterministicMissingQuestions` → `fallbackQuestionText` に `planning_start_date` case が**無い**ため default の「次に確認したい条件を教えてください。」に落ちる。
4. AI renderer モードでは `createDialogueRenderInput` の `planningPeriodLabel(state)` が `state.range.sourceText` からしか期間ラベルを導かないため、pending 中(`range` 未確定・`pendingPlanningRange.scope.label = '来週'` 保持中)は undefined になり、システムプロンプトの「ラベルが無ければ期間に一切言及するな」の制約下で文脈の無い質問になる。
5. clarification 応答(`answer_clarification`)は `createWeeklyPlanningDialogueMessage`(dialogueMessages)の `formatQuestionSlot` を通るが、ここにも `planning_start_date` のラベルが**無い**ため、「引き続き、planning_start_date を教えてください。」と内部キーがそのまま表示される。

なお、正しい質問文「来週のどの日から計画を始めますか？」は `finalizeState` → `resolveQuestions` が `state.questions` に生成しているが、`state.questions` を描画する本番コードは存在しない(消費者はテストのみ)。本タスクではこの重複には触れない(slot registry 統合は対象外)。

## 問題点(実行再現済み)

### 問題A: `set_planning_range` の missing 無条件再シード

- 再現: ターン1「来週の計画を立てたい。院試の過去問を7年分、5分野やりたい。」(pending + examPrepScope 確定)→ ターン2「水曜日から」。
- 結果: range は正しく 2026-07-15〜07-21 に確定するが、`missing` に `tasks_or_goals` が復活し、examPrepScope が state に残っているのに「計画したい学習内容や目標を教えてください」を再質問する。pending 中に固定予定・生活制約を答えていた場合も同様に全部再質問になる。
- 根本原因: `case 'set_planning_range'` が「range の確定」と「intake チェックリストの初期化」を1つの command 適用に癒着させている。従来は range 確定 = 会話開始ターンだったため露見しなかった。

### 問題B: explicit range の inferred range による上書き

- 再現: 「来週の計画を立てたい」→「水曜日から」で range 確定(explicit, 07-15 開始)後、ターン3「この一週間で数学を重点的にやりたい」。
- 結果: parser の新設 fallback 分岐が「一週間」に反応して inferred range(今日 15:30 開始)を返し、reducer が explicit range を**無言で上書き**し、missing も再シードされる(問題Aと連鎖)。
- 根本原因: 毎ターンの再 parse 自体は parser stateless の規約上正しいが、reducer 側に「explicit で確定済みの range を inferred の command で上書きしない」防御がない。`PlanningRange.confidence` は存在するのに上書き判定に使われていない。

### 問題C: `planning_start_date` 質問の renderer 未登録と pending scope label の欠落

- 再現: rules モードで「来週の計画を立てたい」→ 表示は「ここまでの条件を確認しました。/ 次に確認したい条件を教えてください。」となり、何を聞かれているのか分からない。
- 根本原因: 質問 slot の文言資材が renderer 層(`fallbackQuestionText` / `SLOT_VOCABULARY_HINTS`)と messages 層(`formatQuestionSlot`)に分散しており、temporal scope 差分は dialogueManager 側(questionPlan / TERM_EXPLANATIONS)にしか登録しなかった。また期間ラベルの供給源が `range.sourceText` に限定され、pending 段階の scope label が renderer input に流れない。

## 修正方針

局所的な例外(「pending 経由のときだけ〜しない」等の発話・経路分岐)は追加しない。以下の3点とも「state が既に持っている構造化情報から導出する」方向で直す。

### 修正A: missing シードを state 内容からの導出に変える(reducer)

`case 'set_planning_range'` の無条件 `addMissing([...4キー])` を、**そのターンの適用前 state に当該 slot の実体が無い場合のみ追加する**導出型シードに置き換える:

- `tasks_or_goals`: `state.examPrepScope` が無く、かつ `state.tasks` が空のときのみ追加
- `fixed_events`: `state.constraints` に `kind: 'fixed_event' | 'unavailable'` が無く、かつ `state.constraintSourcesInUse` が空/未定義のときのみ追加
- `sleep_cycle`: `state.constraints` に `kind: 'sleep' | 'buffer'` が無いときのみ追加
- `meal_bath_constraints`: `state.constraints` に `kind: 'meal' | 'bath'` が無いときのみ追加

判定に使う kind の対応は、既存の解除ロジック `removeMissingForLifeConstraint` および `applyUseConstraintSourceCommand` と鏡像になるように書く(充足条件と再シード条件が食い違うと別の stale を作るため)。導出 helper は reducer 内 private 関数か `weeklyPlanningMissingStatus.ts` の純関数として置く。自然言語・正規表現は一切使わない。

既知の限界(許容する): `note_no_fixed_events`(「固定予定はない」)は state に痕跡を残さないため、range 確定**前**にこれを答えていた場合は `fixed_events` が再シードされる。回答済み slot の明示的な記録(confirmedSlots の意味論修正)は別タスク(レビュー問題3)の範囲であり、本タスクでは直さない。

### 修正B: explicit range の下位 confidence 上書きを reducer で拒否する

`case 'set_planning_range'` の先頭に guard を足す: 適用前 `state.range?.confidence === 'explicit'` かつ `command.range.confidence !== 'explicit'` の場合、**state を一切変更せずそのまま返す**(range・pendingPlanningRange・missing のいずれにも触れない)。

- explicit → explicit の上書きは許可する(ユーザーの明示的な指定し直し「やっぱり7月20日から一週間で」を通すため)。
- inferred → 任意 の上書きは許可する(仮の range はより良い情報で置き換えてよい)。
- guard は reducer の command 適用に置くため、deterministic parser 由来と AI interpreter 由来の `set_planning_range` の両方に同じ防御が効く。parser には手を入れない(「一週間」→ inferred range という parser の仕様は temporal scope タスクの受け入れ条件そのものであり、維持する)。

### 修正C: `planning_start_date` の文言登録と pending scope label の伝搬(renderer / messages)

1. `weeklyPlanningDialogueRenderer.ts` の `planningPeriodLabel(state)`: `state.range` が無く `state.pendingPlanningRange` がある場合、`pendingPlanningRange.scope.label` を返す分岐を追加する。label は parser がユーザー発話から設定した値のみであり(「来週」「夏休み」)、「日付から週を推測して補完しない」という既存コメントの規約に反しない。`range.sourceText` 由来の既存判定は優先順を先のまま維持する。
2. 同ファイル `SLOT_VOCABULARY_HINTS` に `planning_start_date` を追加する(例: `'計画を始める日(質問中の期間内の曜日や日付)'`)。
3. 同ファイル `fallbackQuestionText` に `planning_start_date` case を追加する。期間ラベルが利用可能な場合は「来週のどの日から計画を始めますか？」のようにラベルを含め、無い場合は「どの日から計画を始めますか？」とする。文言は `resolveQuestions`(missingStatus)の既存文「{label}のどの日から計画を始めますか？」に揃える。`fallbackQuestionText` は現在 `DialogueNextQuestion` しか受け取らないため、`renderDeterministicMissingQuestions` から `input.planningPeriodLabel` を引数で渡すか、当該 case のみ呼び出し側で組み立てる。実現手段は Codex に任せるが、**renderer 層の中で完結させる**こと(dialogueManager や missingStatus から文言を import しない)。
4. `weeklyPlanningDialogueMessages.ts` の `formatQuestionSlot` の labels に `planning_start_date`(例: `'計画の開始日'`)を追加する(`answer_clarification` の「引き続き、〜」経路で内部キーが露出しないように)。
5. `weeklyPlanningDialogueManager.ts` の `TERM_EXPLANATIONS` には未コミット差分で `planning_start_date` が登録済みのため、**変更しない**。

## 責任境界

- parser(`weekly*Parsing.ts`): 変更しない。stateless のまま、毎ターン再 parse する現行動作を維持する。
- reducer: 上書き可否・missing シードの判定を持つ(修正A・B)。判定材料は state の構造化フィールドと command payload のみ。自然言語・正規表現を追加しない。
- dialogueManager: 変更しない。「何を聞くか」(questionPlan)は既に正しい。
- renderer / messages: 「どう言うか」の資材登録のみ(修正C)。事実の推測・state の解釈を足さない。期間ラベルはユーザー発話由来の値(range.sourceText / pending scope.label)以外から作らない。
- scheduler: 変更しない。

## 触らない範囲

- `weeklyPlanningScopeParsing.ts`(parser。temporal scope 差分の parse 仕様は本タスクの前提であり変更禁止)
- `weeklyPlanningMissingStatus.ts` の `resolveQuestions` / `resolveStatus` / `applyPriorityMissingState`(helper 追加は可、既存関数の挙動変更は不可)
- `weeklyPlanningDialogueManager.ts`(questionPlan 生成・TERM_EXPLANATIONS・clarification decision)
- `weeklyPlanningIntakePipeline.ts` / `weeklyPlanningInterpreterEscalation.ts` / `weeklyPlanningCandidateValidator.ts` / `weeklyPlanningReferenceResolution.ts`(confirmedSlots の意味論、AI 経由 range の calendarDayCount、clarification と accepted commands の直交化は別タスク=レビュー問題3・5・6)
- `weeklyPlanningLegacyFallback.ts` / `weeklyPlanningTransforms.ts`(legacy 経路)
- UI(`NaturalLanguageAssistant.tsx` ほか `src/components/`)、CSS、保存・承認導線、scheduler 本体
- `state.questions`(`resolveQuestions` の出力)の扱い・slot registry 統合(別タスク)
- `shouldSavePlan: false` を維持する
- 既存テストの期待値は、本mdで意図した挙動変更(A・B・C)に該当する場合のみ更新可。それ以外の red は実装側を直す

## 受け入れ条件

すべて `planningStartDate: '2026-07-10'`, `currentDateTime: '2026-07-10T15:30:00'` を前提とする。

1. **A**: ターン1「来週の計画を立てたい。院試の過去問を7年分、5分野やりたい。」→ ターン2「水曜日から」の後、`state.missing` に `tasks_or_goals` が含まれず、`state.examPrepScope` が維持され、decision の questionPlan に `tasks_or_goals` が含まれない。`fixed_events` / `sleep_cycle` / `meal_bath_constraints` は未回答なので missing に含まれる(シード自体は残る)。
2. **A**: ターン1「来週の計画を立てたい」→ ターン2「日曜の13時から歯医者」(既存 parser が fixed_event として拾う表現)→ ターン3「水曜日から」の後、`state.missing` に `fixed_events` が含まれず、当該 constraint が `state.constraints` に残っている。
3. **A(regression)**: 初回ターン「今日の19時から土日の終わりまで予定立てたい。英語を3時間、数学を2時間」の missing が従来どおり `['tasks_or_goals', 'fixed_events', 'sleep_cycle', 'meal_bath_constraints']` になる(`weeklyPlanningLegacyFallback.test.ts` の既存期待値が green のまま)。
4. **B**: 「来週の計画を立てたい」→「水曜日から」で range 確定後、「この一週間で数学を重点的にやりたい」を適用しても `state.range.startDateTime` が `'2026-07-15T00:00:00'` のまま変わらず、missing も再シードされない。
5. **B**: 初回ターン「一週間の計画を立てたい」は従来どおり `confidence: 'inferred'`・現在日時開始の range になる(temporal scope 差分の既存テストが green のまま)。
6. **B**: explicit range 確定後に「7月20日から一週間で」を適用すると range が 2026-07-20 開始に更新される(explicit → explicit の指定し直しは通る)。
7. **C**: rules モード(renderer 引数なし)で「来週の計画を立てたい」ターンの `renderWeeklyPlanningDialogueMessage` 出力が「来週」を含み、「どの日から計画を始め」を含む。「次に確認したい条件を教えてください。」にならない。
8. **C**: pending 中の `createDialogueRenderInput` の戻り値で `planningPeriodLabel === '来週'`、かつ `nextQuestions` の `planning_start_date` 項目に `vocabularyHint` が定義されている。
9. **C**: `questionPlan` に `planning_start_date` を含む `answer_clarification` decision を `createWeeklyPlanningDialogueMessage` に渡したとき、出力に生の文字列 `planning_start_date` が含まれない。
10. 既存テストがすべて green のまま(`npm run test:run src/features/weeklyPlanning`)。特に未コミット差分で追加された pipeline テスト2件(pending 保持 / scheduler window)と edge cases の temporal scope parse テストを壊さない。

## テスト観点

- `pipeline/weeklyPlanningIntakePipeline.test.ts` に追加:
  - 受け入れ条件1・2(pending 中に得た scope / 固定予定が range 確定後に再質問されない)
  - 受け入れ条件4・6(inferred による上書き拒否 / explicit による指定し直し許可)
  - 境界: pending 中の「一週間」再出現(pending がある間は `parseWeeklyPlanningRange` が pending 分岐を通るため開始日未解決なら range 化されないこと=既存挙動の固定)
- `dialogue/weeklyPlanningAiDialogueRenderer.test.ts` に追加:
  - 受け入れ条件7・8(deterministic レンダリングの文言、pending 由来の planningPeriodLabel、vocabularyHint)
  - AI renderer 経路: `createDialogueRenderInput` が pending 中に planningPeriodLabel を渡すこと(プロンプト側の「ラベルが無ければ期間に言及しない」規約が正しく解除されること)
- `dialogue/weeklyPlanningDialogueMessages.test.ts` に追加:
  - 受け入れ条件9(`formatQuestionSlot` の `planning_start_date` ラベル)
- regression: 既存の legacy fallback テスト・temporal scope 差分の新規テスト・weekend range テストを変更せず green を確認する。

## リスク

- 修正Aの導出シードが `removeMissingForLifeConstraint` / `applyUseConstraintSourceCommand` の充足条件と食い違うと、逆方向の stale(答えていないのに聞かれない)を作る。鏡像であることをテストで固定する。
- `note_no_fixed_events` を range 確定前に答えたケースは修正後も再質問される(state に痕跡が無いため)。本タスクでは許容し、confirmedSlots 意味論タスク(別途)で解消する。
- 修正Bで inferred command を無視したターンは、`deterministicCommandCount` には計上されたまま state が進まない。escalation 判定(`shouldEscalateToInterpreter`)が「進捗あり・missing 減少なし」と見なす副作用があるが、その場合 AI へエスカレーションされるだけで安全側。escalation カウントの整理は本タスクの対象外。
- 修正Cの planningPeriodLabel 追加により、AI renderer が pending 中も期間に言及するようになる。プロンプトの「exactly that word」規約により捏造リスクは増えない見込みだが、renderer 出力テストで「来週」以外の期間語が混入しないことまでは保証できない(sanitize は slot 構造のみ検証するため)。deterministic fallback 側の文言テストで下限品質を担保する。

## Codexへの実装指示

1. 最初に本md全体と `docs/ai/codex-task-guide.md` を読む。
2. `git status` で未コミットの temporal scope 差分(`weeklyPlanningScopeParsing.ts` / `weeklyPlanningIntakeReducer.ts` ほか9ファイル)が working tree にあることを確認する。無ければ実装せず報告する。
3. 実装順: 修正B(guard、最小)→ 修正A(シード導出)→ 修正C(文言登録)。A・B は同じ `case 'set_planning_range'` に入るため、guard(B)を先頭、シード(A)を適用本体に置く。
4. 参照すべき既存実装: `removeMissingForLifeConstraint` / `applyUseConstraintSourceCommand`(Aの鏡像条件)、`resolveQuestions` の `planning_start_date` 文言(Cの文言の正)、`planningPeriodLabel` の既存コメント(捏造禁止規約)。
5. parser・pipeline・validator・dialogueManager・legacy fallback には触れない。reducer に自然言語解釈を追加しない。`shouldSavePlan: false` を維持する。
6. 検証(Node 22):

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/dialogue
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```

7. `docs/ai/codex-task-guide.md` に従う: スコープ外に広げない、git 操作をしない、作業報告に受け入れ条件のチェック結果・テスト/ビルド結果・解釈で埋めた不明点を含める。
