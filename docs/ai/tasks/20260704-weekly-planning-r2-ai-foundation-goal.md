# [Goal] AI未接続の入力理解基盤(R2-A interpreter 基盤 + R2-B renderer 基盤)

R2 方針転換(`docs/ai/strategy/weekly-planning-r2-ai-interpreter-design.md`、以下「設計メモ」)に基づく、**AI 未接続の基盤づくり**をまとめた大きめの goal md である。実 AI は一切呼ばない。fake interpreter / fake renderer を使い、後から AI を安全に差し込める境界・validator・escalation・renderer fallback を作り、テストで固定するところまでを1本で行う。

**運用ルール**: 本mdに書かれていない範囲へ進まない。対象外の問題は修正せず発見事項として報告する。git add / commit / push はしない(コミットはユーザー指示後)。Phase をまたいで変更を混ぜない。期待値変更が必要な場合は「現状固定」か「intended behavior 変更」かを明記する。

**大原則(設計メモ §0)**: AI にスケジューリング本体・保存・承認・missing 判定・質問対象の選定を任せない。AI の役割は (1) 自然文を command candidates に分解する、(2) コードが決めた質問内容を自然な日本語に整える、の2つに限定する。**AI(および fake)が `PlanningIntakeState` を直接作成・更新する経路を作らない。**

## 背景

R1 で command boundary(parser → `ParsedWeeklyPlanningCommand` → adapter → reducer)が完成し、AI の出力を受ける器ができた。実使用ログでは「数学とOSとハードウェアとソフトウェアとヒューマンサイエンスがあって、2025〜2019までそれぞれあるんだけど、それらを分野ごとにまとめてやる。優先順位的には数学から初めて最後がヒューマンサイエンスかな」のような自由な説明文(fields / yearRange / priorityPolicy / 部分順序を含む)が受理できず、正規表現 parser の限界が確認された。R2 は parser 増設ではなく、AI interpreter + deterministic validation + AI dialogue renderer の基盤へ移行する。本タスクはその基盤を **AI 未接続で**作る。

## Phase 1: 現状の処理経路の再調査(調査のみ)

production / test を変更せず、以下を確認して報告する。

1. `intake/weeklyPlanningIntakeTypes.ts` の既存 `WeeklyPlanningIntakeInterpreter` interface(返り値 `Promise<Partial<PlanningIntakeState>>` の TODO boundary)の**参照箇所**。おそらく未使用だが、実装・参照が存在する場合は再設計の影響範囲を報告してから進める。
2. `pipeline/weeklyPlanningIntakePipeline.ts` の `runWeeklyPlanningIntakePipeline` が**同期関数**であること、および呼び出し元(`NaturalLanguageAssistant.tsx` など UI 側)の呼び方。**UI は今回変更しないため、既存の同期エントリポイントは温存し、interpreter 付きの async エントリポイントを別に足す**方針の妥当性を確認する。
3. `parseWeeklyPlanningCommands` / `applyWeeklyPlanningCommands`(reducer)の入出力と、「このターンで command が何件生成されたか」「missing が減ったか」を pipeline 側から判定できる形。
4. `dialogue/weeklyPlanningDialogueManager.ts` の `WeeklyPlanningDialogueDecision`(kind / messageKey / requiredFields / summary)と `dialogue/weeklyPlanningDialogueMessages.ts` のテンプレ生成の現状(RenderInput の素材と fallback の実体になる)。
5. 短答 slot filling(`parseBareDurationAsUnitRateCommand`)の判定位置(escalation 条件の「短答ではない」判定と整合させるため)。
6. `testFixtures/weeklyPlanningEvaluationCases.ts` の現在の構造(評価ケース追加の受け皿)。
7. `state.assumptions`(string[])と既存 ambiguity(`field_order_incomplete` 等)の使われ方(confidence=medium の受け皿にできるか)。

## 変更対象候補ファイル

- 変更:
  - `src/features/weeklyPlanning/intake/weeklyPlanningIntakeTypes.ts`(旧 interpreter interface の置換。未使用確認後)
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts`(async エントリポイント追加。既存同期関数は挙動不変)
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueManager.ts` または新ファイル(RenderInput の組み立て)
- 新規:
  - `src/features/weeklyPlanning/intake/weeklyPlanningInterpreterTypes.ts`(`InterpretedCommandCandidate` / `InterpreterStateSummary` / 再設計 interface。types.ts 内でもよいが分離推奨)
  - `src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts`(純関数 validator)
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningInterpreterEscalation.ts`(escalation 判定の純関数)
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts`(renderer 境界 + fallback)
  - fake 実装はテスト側(`testUtils/` または各テストファイル内)
- テスト:
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts`(新規。interpreter/validator/escalation 系)
  - `src/features/weeklyPlanning/dialogue/` 配下または `__tests__/` に renderer 系テスト(新規)
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts`(async エントリポイント経由の追加ケース)
  - `src/features/weeklyPlanning/testFixtures/weeklyPlanningEvaluationCases.ts`(第1号評価ケースの追加。既存値の変更は不可)

ここに挙げた範囲を超える変更が必要になったら停止して報告する。

## 追加する型の候補(設計メモ §2 準拠。最終形は Phase 1 の調査で微調整可)

```ts
interface InterpretedCommandCandidate {
  command: ParsedWeeklyPlanningCommand;   // 既存 union を再利用。新 command 型は作らない
  origin: 'ai_interpreter';
  needsConfirmation: boolean;
}

interface InterpreterStateSummary {
  knownFields: string[];
  confirmedSlots: string[];               // 確定済み slot の一覧(上書き禁止判定用)
  planningRangeSummary?: string;
}

interface WeeklyPlanningIntakeInterpreter {
  interpretUserTurn(params: {
    userText: string;
    context: WeeklyPlanningIntakeContext;
    stateSummary: InterpreterStateSummary;
  }): Promise<InterpretedCommandCandidate[]>;
}

interface CandidateValidationResult {
  accepted: ParsedWeeklyPlanningCommand[];          // そのまま適用
  acceptedWithConfirmation: ParsedWeeklyPlanningCommand[]; // 適用+assumption 記録
  clarifications: InterpretedCommandCandidate[];    // 適用しない。質問材料
  rejected: Array<{ candidate: InterpretedCommandCandidate; reason: string }>;
}
```

旧 `WeeklyPlanningIntakeInterpreter`(`Partial<PlanningIntakeState>` 返却)は削除または deprecated 化する。**state 断片を返す boundary を温存しない。**

## validator の仕様(純関数・AI なしで unit test 可能)

`validateInterpretedCandidates(candidates, summary): CandidateValidationResult` として実装する。検証項目:

| 検証 | 不合格時 |
| --- | --- |
| 型: `ParsedWeeklyPlanningCommand` union に合致(unknown type、必須フィールド欠落) | rejected |
| 値域: 年度が妥当範囲(例: 2000〜現在+1)、`minutesPerUnit > 0` かつ現実的、日付・時刻形式 | rejected |
| fields: `knownFields` に解決できるか。未知 field は破棄せず格下げ | acceptedWithConfirmation |
| priorityPolicy: order の field がすべて既知か。部分的に未知なら格下げ | acceptedWithConfirmation |
| 確定済み slot との矛盾(`confirmedSlots` にある slot を別値で上書きする候補) | rejected |
| 同一ターン内の候補同士の矛盾(同じ slot に別値)は confidence が高い方のみ残す | rejected(低い方) |
| confidence: high → accepted / medium → acceptedWithConfirmation / low または欠落 → clarifications | 分類 |

rejected は理由つきで diagnostics に残す(pipeline 出力に `interpreterDiagnostics` 相当のフィールドを追加してよい。既存 `WeeklyDraftCandidateDiagnostics` は変更しない)。

## interpreter escalation の仕様(純関数)

`shouldEscalateToInterpreter(params)` を pipeline 側の純関数として実装する。**すべて満たすとき**だけ escalate:

1. このターンで決定的 parser 由来の command が0件、**または** turn 適用後も missing が1つも減っていない(適用前後の missing 比較)。
2. 入力が短答 slot filling の対象でない(`parseBareDurationAsUnitRateCommand` がマッチしない等、Phase 1 で確認した判定に整合させる)。
3. interpreter が注入されている(未注入なら常に escalate しない = 既存挙動)。

適用順は「決定的 parser の command 適用 → escalation 判定 → interpreter 候補を validator に通す → accepted / acceptedWithConfirmation を既存 `applyWeeklyPlanningCommands` で適用」。**決定的 parser の結果が常に優先**され、AI 候補による上書きは validator が拒否する。

pipeline には `runWeeklyPlanningIntakePipelineWithInterpreter`(async、`interpreter` を引数で注入)を**新設**し、既存の同期 `runWeeklyPlanningIntakePipeline` と UI 呼び出しは**一切変更しない**(interpreter 未注入時の挙動が現行と完全一致することをテストで固定する)。

## confidence と assumption / ambiguity の扱い

- high: 適用(parser 由来と同格)。
- medium: 適用し、`state.assumptions`(既存 string[])へ要約文字列を追記して最終確認に回す。部分順序(「数学から始めて最後がヒューマンサイエンス」)はこの区分で受け、`set_priority_policy`(中間は既知 fields 順で補完した order)+ assumption + 既存 ambiguity 機構(`field_order_incomplete`)に乗せる。
- low: 適用しない。`clarifications` として pipeline 出力に載せ、renderer の質問材料にする(missing 型の拡張はしない)。

**domain 型(`PlanningIntakeState` / `PriorityPolicy` / `PlanningIntakeMissing`)の大改造はしない。** 既存の assumptions / ambiguity / diagnostics / summary に乗せられない要件が出たら、実装せず停止条件として報告する。

## renderer input / output / fallback の仕様(AI 未接続)

- **RenderInput の組み立て(コード側)**: 既存 `WeeklyPlanningDialogueDecision` から `DialogueRenderInput` を構築する純関数を作る。

```ts
interface DialogueRenderInput {
  acceptedFacts: { fields?: string[]; yearRange?: { startYear: number; endYear: number }; unitRateMinutes?: number; priorityOrder?: string[]; constraintSummary?: string[] };
  assumptions: string[];
  nextQuestions: Array<{ slotKey: string; intent: string; options?: string[] }>; // コードが決める。上限1〜2件に絞って渡す
  styleConstraints: { tone: 'mentor'; maxQuestions: number };
}

interface DialogueRenderOutput {
  acknowledgement?: string;                       // 受理確認の一文
  questions: Array<{ slotKey: string; text: string }>; // slot ごとに分離
}

interface WeeklyPlanningDialogueRenderer {
  render(input: DialogueRenderInput): Promise<DialogueRenderOutput>;
}
```

- **出力の検証と plan 外質問の破棄**: renderer 出力の `questions` のうち、`nextQuestions` に存在しない `slotKey` の要素は**コード側で破棄**する。質問数が `maxQuestions` を超えた分も切り捨てる。
- **fallback**: renderer が未注入・失敗・出力が構造を満たさない(questions が空になった等)場合は、**既存テンプレ文言**(`weeklyPlanningDialogueMessages.ts` の現行出力)へ差し替える。fallback 文言自体の改善(トーン)は別タスク(R2初期-4)であり、今回は現行文言をそのまま fallback として使う。
- renderer は表示専用で `PlanningIntakeState` に触れない。**何を聞くかは RenderInput(コード)が決め、renderer は言い回しだけを担当する。**

## fake interpreter / fake renderer のテスト方針(red → green)

**production code に触る前に、fake を使う intended test を先に書いて red を確認する。** fake は固定値を返すだけの実装(テスト側に置く)。

interpreter / validator / escalation 系(`weeklyPlanningInterpreterFoundation.test.ts`):

1. 【評価ケース第1号】実使用ログの入力文に対し、fake interpreter が設計メモ §1 の期待 command 候補(fields 5件を含む `set_exam_scope`、yearRange 2025〜2019、`set_priority_policy`(medium)等)を返すとき、validator 通過後に reducer 適用され、missing が減り、部分順序が assumption に記録されること。この入力・期待値を `weeklyPlanningEvaluationCases.ts` に評価ケースとして登録する(**実 AI の golden 評価の実行は範囲外**。fixture の設計と fake テストまで)。
2. escalation 判定: (a) parser が command を生成したターンでは interpreter が呼ばれない、(b) command 0件かつ短答でない長文で呼ばれる、(c) 短答(「3時間です」)では呼ばれない、(d) interpreter 未注入なら呼ばれず既存挙動と完全一致。
3. validator 単体: 型不正 / 値域外(年度 1800、minutesPerUnit 負)/ 未知 field の格下げ / 確定済み slot 上書きの拒否 / 同一 slot 矛盾候補の解決 / confidence 3区分の振り分け。rejected が理由つきで diagnostics に載ること。
4. 優先順位: parser と fake interpreter が同じ slot に別値を出したとき、parser 側が残ること。
5. 既存回帰: interpreter 未注入の従来経路(同期 pipeline・reducer 直呼び)の既存テストがすべて期待値変更なしで green のままであること。

renderer 系:

6. fake renderer が plan どおりの出力を返すとき、acknowledgement + 質問が RenderInput の内容に一致すること。
7. fake renderer が **plan 外の slotKey の質問**や上限超過の質問を返すとき、それらが破棄されること(破棄の結果 questions が空になったら fallback へ)。
8. renderer 未注入・reject 時に既存テンプレ文言へ fallback すること(現行文言との一致を固定)。

日本語は生文字列(`\uXXXX` 禁止)、スナップショット禁止、期待値は観察してから書く(intended の骨子 — 「missing が減る」「parser 優先」「plan 外破棄」— は先に書いてよい)。

## 実行すべきテストコマンド(Node 22)

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check
git diff --stat
git status -sb
```

## 実装フェーズ(推奨順)

1. **Phase 1**: 現状再調査(上記)。`git diff` 空のまま報告。
2. **Phase 2**: 型と境界の追加(interpreter types / validator の骨格 / escalation 純関数)+ fake を使う intended test の red 確認。
3. **Phase 3**: interpreter 側の最小実装(async エントリポイント、validator、confidence 振り分け、diagnostics)→ green。既存経路の回帰確認。
4. **Phase 4**: renderer 側(RenderInput 構築、renderer 境界、plan 外破棄、fallback)を同じく red → green で。
5. **Phase 5**: 全体検証(上記コマンド)して停止。発見事項と、R2-C(実接続)への引き継ぎ事項を報告する。

## 停止条件

- 旧 `WeeklyPlanningIntakeInterpreter` に想定外の参照・実装が存在したとき(影響範囲を報告して判断を仰ぐ)。
- confidence / clarifications / assumption の要件が、既存の assumptions / ambiguity / diagnostics / summary に乗らず、domain 型の大改造が必要になったとき。
- 既存の同期 pipeline / UI 呼び出しに変更が必要になったとき(interpreter 未注入時の挙動を現行と完全一致にできないとき)。
- 変更が「変更対象候補ファイル」の範囲を超えて波及したとき。
- 既存テストの期待値変更が必要になったとき(本タスクは既存挙動に対して純追加のはず。必要になった時点で現状固定か intended かを整理して停止)。
- 説明できない新規テスト失敗が出たとき。

## 触らない範囲(対象外)

- **AI 実接続の一切**: ai-proxy 呼び出し、モデル選定、プロンプト本番化、コスト計測、レート制御、実 AI の golden 評価実行。
- scheduler 変更、保存・承認導線変更、UI 変更(`NaturalLanguageAssistant.tsx` 含む)。
- daily / weekday / weekend target の本格対応、過去問文脈と明示 duration の共存、年度範囲 parser の個別修正、文言トーン改善(それぞれ別タスク)。
- 既存の決定的 parser の削除・仕様変更、legacy fallback、`looksLikeWeeklyPlanningRequest`。
- 既存 regression テストの入力・期待値。
- `docs/ai/tasks/closed/` 配下の記録。

## Codex推奨モード

**高。** 新しい境界・型・validator・fake DI・pipeline への async エントリポイント追加が絡み、「interpreter 未注入時に既存挙動と完全一致」という等価性維持と、範囲外(AI 実接続・UI)への波及防止の判断が必要なため。

## Codexへの実装指示(要約)

1. Phase 1 の調査報告 → Phase 2 で intended test の red 確認 → Phase 3/4 で最小実装 → Phase 5 で検証して停止。テストより先に production code を触らない。
2. AI(fake 含む)が `PlanningIntakeState` を直接作る・更新する経路を作らない。候補はすべて validator → 既存 reducer 経由。
3. interpreter 未注入時の挙動が現行と完全一致であることを、テストと diff の両面で担保する。
4. 対象外の気づき(トーン改善、target 系、R2-C で必要になりそうな事項)は発見事項として報告する。
5. `docs/ai/codex-task-guide.md` に従う。
