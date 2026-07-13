# 質問 slot の文言・順序・語彙を単一 registry に統合する(挙動変更なしリファクタ)

Priority: **Medium**(単体では不具合を起こさないが、slot 追加のたびに登録漏れを再発させる構造要因。R4 質問計画の前提整理)

本mdの範囲外へ進まない。git add / commit / push はしない。

**前提**: `20260710-weekly-planning-range-reseed-guard-and-start-date-render.md`(修正C: renderer への planning_start_date 登録)の実装後に着手する。修正Cの文言が registry の初期内容に含まれるため。着手時に実コードを再確認し、食い違えば実装せず報告する。

## 背景

missing slot に対する「質問の優先順」「質問文」「ユーザー向けラベル」「語彙ヒント」「用語説明」が、現在5ファイルに分散して重複定義されている。2026-07-10 の全体レビューで、temporal scope 実装が `planning_start_date` を dialogueManager 側には登録した一方 renderer 側2箇所に登録し漏れ、本番の質問文が汎用文に落ちる実害(レビュー問題4)が確認された。分散管理が登録漏れを構造的に招いている。

## 目的

slot 1つの追加・変更が1箇所の編集で済むようにする。出力文言・質問順序は現状と完全一致(挙動変更なし)とし、既存テストを green のまま維持する。

## 計画書との対応

- spec: §6(質問制御の基盤)、§13(メンター対話)
- 改善テーマ: pipeline-guide §5「メンター対話型ヒアリング」/ roadmap Phase R4(質問計画)の前提整理。挙動変更なしリファクタ(guide §6「挙動変更とリファクタを分ける」)

## 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/intake/weeklyPlanningMissingStatus.ts`(`resolveQuestions` / `resolveStatus` の参照先切替)
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueManager.ts`(`MISSING_FIELD_KEYS` / `missingMessageKey` / `createMissingQuestionPlan` の順序・依存 / `TERM_EXPLANATIONS` / `CLARIFICATION_TERM_KEYWORDS` の参照先切替)
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts`(`SLOT_VOCABULARY_HINTS` / `fallbackQuestionText` の参照先切替)
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueMessages.ts`(`formatQuestionSlot` の labels の参照先切替)
- 新規:
  - `src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.ts`(registry 本体。intake 層に置く理由: `PlanningIntakeMissing` 型の所有層であり、dialogue → intake の既存 import 方向に順行するため。missingStatus が dialogue から import する層逆転を作らない)
- テスト:
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueManager.test.ts`
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningAiDialogueRenderer.test.ts`
  - (既存テストの green 維持が主。新規アサーションは registry と各消費先の一致確認に限る)

## 現在の処理経路

slot に関する知識の所在(2026-07-10 時点、未コミット temporal scope 差分込み):

| 知識 | 定義場所 |
| --- | --- |
| missing key → 質問優先順(status 決定) | `weeklyPlanningMissingStatus.ts` `resolveStatus` の if 連鎖 |
| missing key → 決定的な質問文(state.questions) | 同 `resolveQuestions` の if 連鎖 |
| missing key → targetSlot 名 | `weeklyPlanningDialogueManager.ts` `MISSING_FIELD_KEYS` |
| missing key → messageKey 優先順 | 同 `missingMessageKey` の if 連鎖 |
| 質問計画の順序・dependsOn・kind | 同 `createMissingQuestionPlan` の addCandidate 列 |
| slot → 用語説明(聞き返し応答) | 同 `TERM_EXPLANATIONS` |
| ユーザー語 → slot への写像 | 同 `CLARIFICATION_TERM_KEYWORDS` |
| slot → 語彙ヒント(AI renderer 入力) | `weeklyPlanningDialogueRenderer.ts` `SLOT_VOCABULARY_HINTS` |
| slot → deterministic fallback 質問文 | 同 `fallbackQuestionText` の switch |
| slot → ユーザー向け短ラベル | `weeklyPlanningDialogueMessages.ts` `formatQuestionSlot` の labels |

また `state.questions`(`resolveQuestions` の出力)は本番コードのどこからも描画されておらず、消費者はテストのみ(`weeklyPlanningIntakePipeline.test.ts` / `weeklyPlanningIntakeEdgeCases.test.ts` / `weeklyPlanningRoleplayScenarios.test.ts` が参照)。

## 問題点

- slot 追加時に最大10箇所の手動同期が必要で、temporal scope 実装で実際に renderer 側2箇所が漏れた(先行タスクで修正済み)。
- 質問の優先順が `resolveStatus` / `missingMessageKey` / `createMissingQuestionPlan` の3箇所に独立に符号化されており、順序変更時に食い違うリスクがある。
- `state.questions` が本番未使用のまま文言の第4の定義場所になっている。

## 修正方針

1. `intake/weeklyPlanningQuestionSlots.ts` に slot 定義の配列(優先順に並べる)を作る。1エントリの持つ知識(現行値をそのまま転記):
   - `missing: PlanningIntakeMissing[]`(グルーピング。priority_policy + next_field_after_math のような複合を表現)
   - `targetSlot: string`(現 `MISSING_FIELD_KEYS` の値)
   - `intent: string`(現 questionPlan の intent = messageKey)
   - `kind: 'missing_slot' | 'missing_life_constraint'`
   - `dependsOn?: PlanningIntakeMissing[]`
   - `status: PlanningIntakeStatus`(現 `resolveStatus` の対応値)
   - `deterministicQuestion: (state) => string` または文字列テンプレート(現 `resolveQuestions` / `fallbackQuestionText` の文言。planning_start_date の scope label 差し込みも表現できる形にする)
   - `vocabularyHint: string`、`userLabel: string`、`termExplanation: string`、`clarificationKeywords?: RegExp`
2. 各消費先(missingStatus / dialogueManager / renderer / messages)を registry 参照に切り替える。**出力は現状と byte 単位で一致させる**(文言・順序・改行を変えない)。
3. `state.questions` は削除しない(型の破壊的変更を避け、テスト消費者を維持)。`resolveQuestions` を registry から導出する実装に置き換えるのみとし、「本番未使用・テスト用」であることを registry ファイルの JSDoc に明記する。廃止判断は R4 で行う(本タスクの対象外)。
4. `resolveStatus` の `year_range` と `completion_direction` の順序が questionPlan 側の順序(tasks_or_goals → year_range → completion_direction)と入れ替わっている点は**現状のまま**registry に2系統の順序として保持する(status 用順序と質問用順序を無理に統一しない。統一は挙動変更になるため R4 へ)。

## 触らない範囲

- 文言・質問順序・status 遷移・questionPlan の内容(いかなる出力変化も本タスクでは不可)
- `MAX_MISSING_QUESTIONS_PER_TURN` 等の質問数制御(R4)
- `applyPriorityMissingState` のロジック
- pipeline、validator、interpreter、reducer の command 適用、parser、legacy fallback、scheduler、UI、保存・承認導線
- `shouldSavePlan: false` を維持する

## 受け入れ条件

1. `npm run test:run src/features/weeklyPlanning` が**期待値の変更なしで** green(挙動変更なしの証明。テスト期待値を1件でも書き換えた場合は挙動変更が混入しているので実装を見直す)。
2. slot に関する文言・順序・写像の定義が `weeklyPlanningQuestionSlots.ts` の1ファイルに集約され、`MISSING_FIELD_KEYS` / `SLOT_VOCABULARY_HINTS` / `TERM_EXPLANATIONS` / `formatQuestionSlot` の labels / `fallbackQuestionText` の文言 / `resolveQuestions` の文言が registry 由来になっている(旧定義の重複が残っていない)。
3. 新しい missing key を registry に1件足すだけで、status 遷移・質問計画・deterministic 質問文・語彙ヒント・用語説明・ユーザーラベルが揃うことを、テスト用のダミー slot ではなく registry 構造のアサーション(全 slot が全フィールドを持つこと)で担保する。
4. `npm run build`(tsc --noEmit 含む)が通る。

## テスト観点

- 一致性: registry の全エントリが `PlanningIntakeMissing` を過不足なくカバーすること(Record 型による網羅 or テスト)。
- regression: dialogueManager テスト・renderer テスト・pipeline テスト・roleplay テストの既存期待値が無変更で green。
- 境界: `progress` slot の targetFields 差し込み、planning_start_date の scope label 差し込みが registry 経由でも機能すること(既存テストで担保されるが、なければ追加)。

## リスク

- 「挙動変更なし」の判定はテスト網に依存する。特に `missingMessageKey` の if 連鎖の順序(planning_start_date → year_range → unit_duration_estimate → …)と `resolveStatus` の順序の**差異**を registry へ写し間違えると、テストに現れない順序変化が起きうる。転記後に新旧関数の出力を突き合わせる一時的な等価性テストを書いてから旧実装を消す手順を推奨する。
- `CLARIFICATION_TERM_KEYWORDS` は複数 slot に同一キーワードが重複しない前提の線形探索。registry 化で順序が変わると解決先が変わりうるため、配列順を現行の定義順で固定する。

## Codexへの実装指示

1. 最初に本md全体と `docs/ai/codex-task-guide.md` を読む。
2. 実装手順: (1) registry ファイル新設(現行値の転記)→ (2) 新旧等価性の一時テスト → (3) 消費先を1ファイルずつ切替(都度テスト実行)→ (4) 旧定義削除・一時テスト整理。
3. いかなる文言改善も行わない(改善したい文言を見つけたら報告のみ)。
4. 検証(Node 22):

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/dialogue
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```

5. `docs/ai/codex-task-guide.md` に従う: スコープ外へ広げない、git 操作をしない、受け入れ条件のチェック結果と解釈で埋めた点を報告する。
