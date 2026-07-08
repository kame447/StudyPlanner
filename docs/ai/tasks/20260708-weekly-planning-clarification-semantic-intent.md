# ユーザーの聞き返しを発話非依存の clarification intent として扱い、state を誤進行させない

本mdの範囲外へ進まない。git add / commit / push はしない。production code は本タスク実装時のみ変更。設計根拠は `docs/architecture/weekly-planning-nl-capability-model.md` §8.2(clarification intent)。

## 背景

ユーザーがアプリの質問語句の意味を聞き返すと、interpreter が既存 command のどれか(学習量の不確実性=`note_uncertainty` 等)へ無理に写像し、適切な説明が返らず state が誤進行する。

実例(実例2 の続き):
```text
アプリ: 固定の予定があれば教えてください。
ユーザー: 固定の予定って何ですか？
（interpreter は uncertainty に近い command として誤解釈し、適切な説明が返らない）
```

診断分類は **B(clarification という意味カテゴリが無い)+ A(既存 command へ無理写像)**。`ParsedWeeklyPlanningCommand` に聞き返しを表す intent が無い。

## 目的

- 「固定の予定って何ですか？」「それってどういう意味？」「何を答えればいいの？」を、**用語ごとの専用 command にせず**、1つの発話非依存 intent `request_clarification` で扱う。
- clarification を受けたら **state を進めず(missing を消さず)**、その用語の deterministic な説明を返し、**元の unresolved question / intent を維持**する。
- clarification が `note_uncertainty` 等へ誤写像されないよう分離する。

## 計画書との対応

- spec: §5(メンター対話)、§13(対話品質)
- 改善テーマ: roadmap Phase R2-Capability(意味カテゴリ層の追加)。責務分離文書 §10 の `ask_clarification` 設計案を、用語非依存の payload 設計で最小実装。

## 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/intake/weeklyPlanningCommandTypes.ts`(`request_clarification` intent を1つ追加。payload は `target: 'referenced_question' | 'referenced_term' | 'unresolved_slot'` と `ref`)
  - `src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts`(schema + system prompt に clarification を追加し、uncertainty との分離を明記)
  - `src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts`(clarification の値域・分離)
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueManager.ts`(clarification decision: state 不進行・直前質問維持)
  - 用語辞書(deterministic な説明文。新規 or 既存 messages に追加)
- テスト:
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.test.ts`
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueManager.test.ts`

## 現在の処理経路

- `ParsedWeeklyPlanningCommand`(`weeklyPlanningCommandTypes.ts`)に clarification を表す型が無い(`add_fixed_event` / `set_*` / `note_uncertainty` / `mark_*` のみ)。
- AI interpreter は聞き返しを既存 command のどれかへ写像し、reducer が state を誤進行させる/固まる。
- clarification に対し「用語を説明して同じ質問を維持する」dialogue 経路が無い。

## 問題点

- 聞き返しの意味カテゴリ(B)が無く、既存 command へ誤写像(A)される。
- 説明後に元の unresolved question を維持する責務が dialogue manager に無い。

## 修正方針

- **`request_clarification` intent を1つ追加**（用語ごとに case を増やさない。§8.4 の不変条件）。payload:
  - `target`: `referenced_question`(直前の質問) / `referenced_term`(用語) / `unresolved_slot`(未解決 slot)
  - `ref`: 対象の slotKey または term
- dialogue manager: clarification を受けたら missing を消さず、`ref` の用語の deterministic 説明(用語辞書)を返し、**直前の unresolved question を維持**する。説明文は deterministic、言い回しだけ renderer が整える。
- interpreter プロンプト/validator で clarification を uncertainty 等から分離する。

## 触らない範囲

- 質問文そのものの平易語彙化(別 task: renderer-deterministic-context が供給)。本 task は「意味を聞かれたら説明し、進行を止めない」経路。
- fixed_events の状態モデル・capability snapshot(別 task)。
- 一般的な雑談・範囲外質問への応答(clarification = アプリの質問語句/用語に限定)。
- UI / CSS / save / approval。`shouldSavePlan: false` 維持。

## 受け入れ条件

- 「固定の予定って何ですか？」で state が誤進行せず(missing 不変)、用語説明が返り、直前の質問が維持される。
- 「それってどういう意味？」「何を答えればいいの？」も**同一の `request_clarification` intent** に写像される(表現ゆれが semantic level で同じ intent になる契約)。
- clarification が `note_uncertainty` / `set_unit_rate` 等へ誤写像されない。
- weeklyPlanning テスト green / build 成功。

## テスト観点

- 3表現ゆれ →同一 `request_clarification`。missing 不変・用語説明・直前質問維持(fake interpreter で intent 注入し決定的に固定)。
- clarification が uncertainty/unit_rate へ写像されない分離テスト。
- 用語説明後、同じ質問(fixed_events)が維持される。

## リスク

- clarification と「分からない(=有効回答・仮置き)」の混同。前者は state 不進行、後者は assumption 化。両者を分けてテストする。
- interpreter schema 追加による candidate 契約への波及(anyOf union / validator 値域を漏らさない)。

## 依存

- `constraint-source-capability`(基盤)完了後が望ましい(意味カテゴリ層の追加様式を先に確立するため)。ただし clarification 単体でも実装は可能。**基盤 task の後に着手**を推奨。

## Codexへの実装指示

1. `constraint-source-capability` の後に着手する。
2. 参照実装: `mark_completion_target`(1 command に payload variation を吸収する手本)。clarification も target/ref で表現を吸収し、用語ごとに case を増やさない。
3. state を誤進行させない(missing を消さない)責務は dialogue manager に置く。interpreter/reducer は intent を受け渡すだけ。
4. `shouldSavePlan: false` 維持。UI/CSS/save/approval に触れない。
5. 最後に必ず `docs/ai/codex-task-guide.md` に従う。

## 検証(Node 22)

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueManager.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```
