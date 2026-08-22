# 対話Stage1: AI interpreter に現在日時と直前質問の grounding を供給する

Priority: **High**(理由: interpreter は context を受け取りながら破棄しており、日付相対表現「明日/明後日/来週」の日付化と、直前質問への短答・訂正の anchor 付き解釈が構造的に不可能。対話アーキテクチャ(親設計)の全 stage の前提であり、変更は入力供給のみで低リスク)

本mdの範囲外へ進まない。git add / commit / push はしない。

**前提**: 親設計 `docs/architecture/weekly-planning-dialogue-architecture.md` §5 の Stage 1。T1〜T3(range guard / confirmedSlots 実体化 / AI range 正規化)はコミット済み(`a96bb6c` ほか)。着手時に実コードが本mdの「現在の処理経路」と食い違う場合は実装せず報告する。

## 背景

実測(2026-07-10)で、「明日と明後日の予定立てたい」「来週の予定を立てたい」等が AI モードでも解釈不能で catch-all に落ちることを確認した。原因は AI の能力ではなく入力 contract にある: `createAiWeeklyPlanningInterpreter` の `interpretUserTurn({ userText, stateSummary })` は引数の `context`(currentDateTime / selectedDate / planningDayCount)を**分割代入で破棄**し、`createUserPrompt` は userText + stateSummary だけを JSON 化している。また「直前に何を聞いたか」はどこにも供給されず、短答・訂正を結び付けられない(短答 slot filling は unit_rate 専用の deterministic ハードコードのみ)。

## 目的

AI interpreter が (a) 日付相対表現を現在日時から ISO 日付へ解決でき、(b) 短い回答・訂正をまず直前質問の slot への応答として解釈できるよう、deterministic に確定した grounding を入力 contract に追加する。値の安全性は既存 validator(isDate / isTime / isReasonableYear / pending 保護 / explicit guard)が引き続き担保する。

## 計画書との対応

- spec: §5(聞き取り)、§12(LLM の担当 = 自然文からの抽出)
- 改善テーマ: 親設計 §5.1「DialogueContext Tier 1」/ dialogue-design-review W3・W5 / capability model 診断原則 G(dialogue grounding 不足)

## 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts`(createUserPrompt / createSystemPrompt / interpretUserTurn)
  - `src/features/weeklyPlanning/intake/weeklyPlanningInterpreterTypes.ts`(`InterpreterStateSummary.lastQuestions` 追加)
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts`(`createInterpreterStateSummary` へ lastQuestions 供給)
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueManager.ts`(`createMissingQuestionPlan` の再利用手段の export。下記「修正方針」3)
- 新規: なし
- テスト:
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts`
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts`

## 現在の処理経路

1. `runWeeklyPlanningIntakePipelineWithInterpreter` が `createInterpreterContext(input)` で `WeeklyPlanningIntakeContext`(selectedDate / planningDayCount / currentDateTime)を作り、`interpreter.interpretUserTurn({ userText, context, stateSummary })` に渡す。
2. `createAiWeeklyPlanningInterpreter` の実装は `async interpretUserTurn({ userText, stateSummary })` — **context をここで破棄**。
3. `createUserPrompt` は `JSON.stringify({ userText, stateSummary })` のみ。
4. `InterpreterStateSummary` は knownFields / confirmedSlots / planningRangeSummary / pendingPlanningRange / availableConstraintSources を持つ。直前質問を表すフィールドは無い。
5. 「直前に何を聞いたか」の情報源: decision は state の純関数であり、前ターン終了時 state(= 今ターンの `previousState`)から `createMissingQuestionPlan(previousState)`(`weeklyPlanningDialogueManager.ts` 内 private)で決定的に復元できる。同関数は `createWeeklyPlanningClarificationDecision` からも使われている。

## 問題点

- 日付相対表現を解決する材料(現在日時)が AI に無い。deterministic parser も「明日/明後日」を扱わないため、この種の発話は全経路で解釈不能(実測で catch-all 落ちを確認)。
- 直前質問が AI に渡らないため、「水曜日から」以外の短答(「3時間くらい」「うーん、たぶん無い」)や訂正(「いや、テスト勉強はゴールでしょ？」)を質問文脈に結び付けられない。
- system prompt は「Use only the provided userText and stateSummary. Do not assume saved plans, past turns...」と past turns の推測を禁じている(正しい原則)が、その代わりに必要な対話状態の構造化供給が無い。

## 修正方針

1. **context をプロンプトへ**: `interpretUserTurn` で context を受け取り、`createUserPrompt` の JSON に `context: { currentDateTime, selectedDate, planningDayCount }` を含める。
2. **lastQuestions を stateSummary へ**: `InterpreterStateSummary` に optional `lastQuestions?: Array<{ slotKey: string; intent: string }>` を追加。`createInterpreterStateSummary` で **turn 適用前の `previousState`** から質問計画を復元して設定する(最大2件 = `MAX_MISSING_QUESTIONS_PER_TURN` と同じ上限。previousState が無い初回ターンは undefined)。турン適用後 state から作らないこと(今ターンの回答で消えた質問こそが「直前に聞いた質問」であるため)。
3. **復元手段の export**: `createMissingQuestionPlan` を dialogueManager から export するか、薄い wrapper(例: `createLastQuestionSummary(state)`)を export して pipeline から呼ぶ。pipeline → dialogue の import は既存方向(`createWeeklyPlanningDialogueDecision` を import 済み)なので層逆転はない。質問計画ロジック自体は変更しない。
4. **system prompt 追記**(3〜4行。命令のみ・例の羅列にしない):
   - 相対日付(今日/明日/明後日/来週 等)は context.currentDateTime を基準に解決し、ISO(YYYY-MM-DD / YYYY-MM-DDTHH:mm:ss)で出すこと。解決に確信が持てなければ command を出さないこと。
   - stateSummary.lastQuestions がある場合、短い回答・訂正・確認はまずその slot への応答として解釈すること。
   - 既存の「past turns を仮定しない」原則は維持(供給された grounding だけを使う)。
5. **テスト可能化**: `createUserPrompt`(および必要なら `createSystemPrompt`)を export し、prompt payload をユニットテストで検証できるようにする(renderer 側で `createDialogueRenderInput` を export してテストしている既存パターンに合わせる)。

## 責任境界

- AI へ渡すのは deterministic に確定した値のみ(現在日時は pipeline が既に解決済み、lastQuestions は state の純関数)。生の会話履歴・前ターンの assistant 文章は渡さない(Tier 2 = Stage 4 の範囲)。
- AI の日付解決の結果は従来どおり validator の値域検証と reducer の guard(pending 保護・explicit 保護)を通る。**validator / reducer / escalation 判定は本タスクでは変更しない。**
- 質問計画の内容・順序は dialogueManager の既存ロジックのまま(export のみ)。

## 触らない範囲

- `weeklyPlanningCandidateValidator.ts` / `weeklyPlanningIntakeReducer.ts` / `weeklyPlanningInterpreterEscalation.ts`
- AI schema(`WEEKLY_PLANNING_COMMAND_SCHEMAS`)— 語彙追加は Stage 2/3
- dialogue decision・renderer・messages(Stage 2/5)
- parser 層・legacy fallback・scheduler・UI・保存/承認導線
- `shouldSavePlan: false` を維持する

## 受け入れ条件

1. export された `createUserPrompt` の出力 JSON に `context.currentDateTime` / `context.selectedDate` が含まれる(ユニットテスト)。
2. `runWeeklyPlanningIntakePipelineWithInterpreter` で、前ターンが unit_rate を質問した状態(missing に `unit_duration_estimate`)を previousState に渡すと、stub interpreter が受け取る `stateSummary.lastQuestions` に `unit_rate` slot の項目が含まれる(pipeline テスト・stub で検証)。
3. 初回ターン(previousState なし)では `lastQuestions` が undefined。
4. system prompt に相対日付解決と lastQuestions anchor の指示文が含まれる(ユニットテスト・文字列包含)。
5. stub interpreter が「明日と明後日」相当の explicit `set_planning_range`(2026-07-11〜2026-07-12)を返した場合、既存の正規化(T3)・guard を通って state.range に反映され、dry-run 候補が 7/11 起点になる(統合テスト。AI の実解釈品質はここでは検証しない)。
6. rules モード(interpreter なし)の挙動が一切変わらない(既存テスト全 green)。
7. `npm run build` が通る。

## テスト観点

- `weeklyPlanningInterpreterFoundation.test.ts`: prompt payload(context / lastQuestions を含む JSON 構造)、system prompt の指示文包含、lastQuestions が previousState 由来であること(適用後 state と異なるケース)。
- `weeklyPlanningIntakePipeline.test.ts`: 受け入れ条件2・3・5(stub interpreter)。
- regression: interpreter を渡さない経路・escalation されない turn で挙動不変。

## リスク

- prompt 変更による実 AI の出力分布変化は本タスクでは測定しない(roadmap の方針どおり real-eval を別途1回)。防衛線(validator/guard)は不変のため、誤解釈は従来どおり reject/確認に倒れる。
- lastQuestions の復元は「前ターンの decision が questionPlan 型だった」場合のみ正確(clarification 応答ターン等では直前質問=維持された questionPlan なので同じ結果になる)。`confirm_ambiguity` 等 questionPlan の無い decision の直後は lastQuestions が「その時点の missing から見た質問」になるが、anchor 用途では実害なし。厳密化は Stage 4(DialogueContext Tier 2)で行う。

## Codexへの実装指示

1. 最初に本md全体と `docs/ai/codex-task-guide.md`、親設計 `docs/architecture/weekly-planning-dialogue-architecture.md` §5 を読む。
2. 実装順: interpreterTypes → pipeline(lastQuestions 供給)→ dialogueManager(export)→ aiInterpreter(prompt)→ テスト。
3. 参照すべき既存実装: `createInterpreterStateSummary` / `createMissingQuestionPlan` / renderer の `createDialogueRenderInput` export パターン。
4. 検証(Node 22):

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```

5. `docs/ai/codex-task-guide.md` に従う: スコープ外へ広げない、git 操作をしない、受け入れ条件のチェック結果と解釈で埋めた点を報告する。
