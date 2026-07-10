# 聞き返し(request_clarification)ターンでも同ターンの accepted commands を適用する

Priority: **Medium**(混合発話「事実 + 聞き返し」で情報が silent drop されるが、発話パターンが限定的で、ユーザーは言い直しで回復できる)

本mdの範囲外へ進まない。git add / commit / push はしない。

**前提**: clarification semantic intent 実装(`20260708-weekly-planning-clarification-semantic-intent.md`・closed)が前提。着手時に実コードを再確認し、本mdの調査結果と食い違えば実装せず報告する。

## 背景

`runWeeklyPlanningIntakePipelineWithInterpreter`(`pipeline/weeklyPlanningIntakePipeline.ts`)は、validator の `clarificationRequests` に1件でも entry があると、**AI 由来の accepted / acceptedWithConfirmation を一切適用せず** `deterministicTurn.state` のまま `createWeeklyPlanningClarificationDecision` を返す。「聞き返しは state を進めない(missing を消さない)」という設計意図が、「同一ターンでユーザーが同時に提供した事実も適用しない」という過剰な制約になっている。2026-07-10 の全体レビュー(問題6)で特定した。

## 目的

1つの発話に「事実の提供」と「用語の聞き返し」が混在した場合に、事実は受理しつつ用語説明を返せるようにする。聞き返し自体が missing を消さない設計は維持する。

## 計画書との対応

- spec: §5(聞き取り)、§13(メンター対話: 聞き返しへの応答)
- 改善テーマ: roadmap Phase R2-Capability タスク3(clarification semantic intent)の後続改善

## 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts`(clarification 分岐の並び替え)
- 新規: なし
- テスト:
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts`

## 現在の処理経路

1. `interpretUserTurn` → `resolveConstraintSourceReferences` → `validateInterpretedCandidates` で候補が `accepted` / `acceptedWithConfirmation` / `clarifications`(low confidence) / `clarificationRequests`(聞き返し) / `rejected` に振り分けられる。
2. `clarificationRequests[0]` が存在すると、pipeline は `deterministicTurn.state` で `buildPipelineOutput` を作り、decision を `createWeeklyPlanningClarificationDecision({ state: deterministicTurn.state, ref })` に差し替えて **early return** する。
3. このため同ターンの `accepted` / `acceptedWithConfirmation` は `applyWeeklyPlanningCommands` に到達しない。
4. `clarifications`(low confidence バケット)は現状どの層も消費しない(適用もされず、確認質問にもならない)。

## 問題点

- 混合発話の例: 「授業は月水金の9時から12時です。ところで固定の予定ってバイトも含みますか？」→ AI が `add_fixed_event` 群 + `request_clarification` を返すと、固定予定が**すべて silent drop** され、用語説明だけが返る。ユーザーは同じ情報をもう一度言う必要がある。
- deterministic parser が拾った commands(`deterministicTurn.state` に反映済み)は生き残るため、「deterministic で拾える表現なら残り、AI 頼みの表現なら消える」という出所依存の非一貫性がある。
- `clarifications`(low confidence)の無消費は仕様上の余白として残っているが、明文化されていない。

## 修正方針

- clarification 分岐を「early return」から「decision の差し替えのみ」に変える:
  1. `clarificationRequests` の有無に関係なく、`accepted` / `acceptedWithConfirmation` の適用(`applyWeeklyPlanningCommands` → `addConfirmationAssumptions` → `addConstraintSourceConfirmationAssumptions` → `finalizeState`)を先に行う(現行の通常経路と同一の処理)。
  2. `clarificationRequests[0]` がある場合は、**適用後の state** を使って `createWeeklyPlanningClarificationDecision` を作り、decision だけを差し替える。questionPlan は適用後の missing から組まれるため、「受理した slot はもう聞かず、残りの質問+用語説明」という応答になる。
  3. 「聞き返し自体は missing を消さない」は維持される(`request_clarification` は validator 側で専用バケットに隔離され、command として適用されないため)。
- `clarifications`(low confidence バケット)は本タスクでは適用しない(現状維持)。ただし「low confidence 候補は適用されない」ことをテストで明文化して固定する。
- dialogue 層(`createWeeklyPlanningClarificationDecision`)は変更しない。渡す state が deterministic → 適用後に変わるだけで契約は同じ。

## 触らない範囲

- `weeklyPlanningDialogueManager.ts`(clarification decision の生成・TERM_EXPLANATIONS)
- `weeklyPlanningCandidateValidator.ts`(バケット振り分けの体系)
- `clarifications` バケットの新しい消費先の追加(確認質問化は R4 質問計画の範囲)
- reducer、parser、renderer、legacy fallback、scheduler、UI、保存・承認導線
- `shouldSavePlan: false` を維持する

## 受け入れ条件

すべて stub interpreter を使った pipeline テストで検証する。

1. stub が `add_fixed_event`(high, 有効な payload)+ `request_clarification`(target: referenced_term, ref: fixed_events)を同時に返した場合:
   - 当該 fixed_event が `state.constraints` に反映される
   - decision.kind が `answer_clarification` で、`clarification.explanation` に fixed_events の用語説明が入る
   - decision の questionPlan に、適用によって充足された slot が含まれない
2. stub が `request_clarification` のみを返した場合、従来どおり state が進まず(missing 不変)、`answer_clarification` が返る(既存テストの維持)。
3. stub が low confidence の候補のみを返した場合、state が進まず、その候補は適用されない(現状挙動の明文化テスト)。
4. `interpreterDiagnostics` の内容(accepted / clarificationRequests / rejected)が従来どおり output に含まれる。
5. 既存テストがすべて green(`npm run test:run src/features/weeklyPlanning`)。特に `clarification semantic intent (request_clarification)` describe 内の既存ケースの期待値を、意図した挙動変更(受け入れ条件1)に該当する場合のみ更新し、理由を報告する。

## テスト観点

- 正常系: 混合発話(受け入れ条件1)、聞き返し単独(2)。
- 境界: `acceptedWithConfirmation` + `request_clarification` の混合(確認 assumptions と用語説明が両立すること)。`use_constraint_source` の reference 解決由来の `request_clarification`(`constraint_source` ref)と通常 accepted の混合。
- regression: 聞き返しターンで missing が減らないこと(用語説明で slot が充足扱いにならないこと)。

## リスク

- 適用後 state で missing が空になった場合、clarification decision の questionPlan が空になる(用語説明のみ返る)。`createWeeklyPlanningClarificationDecision` は questionPlan 空を許容する実装のため問題ないが、テストで1ケース固定する。
- reference 解決(`constraint-source-reference-*`)由来の clarificationRequest と、ユーザー起点の聞き返しが同時に来た場合は先頭1件のみ応答する現行仕様のまま(変更しない)。
- buildPipelineOutput が clarification ターンでも dry-run を実行する非効率は本タスクの対象外(backlog 記載)。

## Codexへの実装指示

1. 最初に本md全体と `docs/ai/codex-task-guide.md` を読む。
2. 実装は pipeline の分岐並び替えのみで完結させる。dialogue / validator に手を入れたくなった場合はスコープ外として報告する。
3. 参照すべき既存実装: 通常経路の適用列(`applyWeeklyPlanningCommands` → assumptions 付与 → `finalizeState`)を clarification 有無で共通化する(コピーではなく共通の適用処理に一本化してよい)。
4. 検証(Node 22):

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```

5. `docs/ai/codex-task-guide.md` に従う: スコープ外へ広げない、git 操作をしない、受け入れ条件のチェック結果と解釈で埋めた点を報告する。
