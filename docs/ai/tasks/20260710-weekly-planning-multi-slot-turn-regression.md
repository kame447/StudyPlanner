# 複合ターン(1発話複数slot・pending割り込み)の regression テストを整備する(テストのみ)

Priority: **Medium**(production code 変更なし。2026-07-10 レビューで確認した「405件 green のまま複数の複数ターン不具合が再現する」というテスト網の穴を塞ぎ、以後の intake 変更の安全網にする)

本mdの範囲外へ進まない。git add / commit / push はしない。**production code は一切変更しない(テストのみ)。**

**前提・着手順**: 以下の3タスクの実装が完了してから着手する(未修正の状態でシナリオを書くと bug を期待値として固定してしまうため)。
1. `20260710-weekly-planning-range-reseed-guard-and-start-date-render.md`
2. `20260710-weekly-planning-confirmed-slots-semantics.md`
3. `20260710-weekly-planning-clarification-accepted-orthogonality.md`
(`20260710-weekly-planning-ai-range-normalization.md` は完了していればシナリオ7を含め、未完了ならシナリオ7を除外して報告に明記する)

## 背景

2026-07-10 の全体レビューで、既存テスト 405 件が green のまま、複数ターン対話の不具合(missing 再シード、explicit range 上書き、pending 中の confirmedSlots 誤判定、混合発話の silent drop、legacy fallback による偽タスク生成)がすべて production 経路で再現することを確認した。既存テストは「1ターン=1情報」または「決められた順序の応答」を前提としており、実ユーザーの「1発話に複数 slot の情報」「質問と違う slot を先に答える」「clarification への割り込み」を系統的にカバーしていない。

## 目的

複合ターンの会話シナリオを pipeline レベルの regression suite として固定し、intake / dialogue / pipeline の変更が複数ターンの整合性を壊したら即座に red になるようにする。

## 計画書との対応

- spec: §5・§6・§13(メンター対話の複数ターン整合)
- 改善テーマ: pipeline-guide §5「テスト戦略」、roadmap §1「テスト状況」の弱点(経路の spec 化不足)

## 対象ファイル

- 変更: なし(production code 変更禁止)
- 新規: `src/features/weeklyPlanning/__tests__/weeklyPlanningMultiSlotTurns.test.ts`
- テスト: 上記新規ファイル(既存テストファイルは変更しない。重複するアサーションがあっても既存側を消さない)

## 現在の処理経路

テスト対象は公開 API のみ: `runWeeklyPlanningIntakePipeline` / `runWeeklyPlanningIntakePipelineWithInterpreter`(stub interpreter 注入)+ `renderWeeklyPlanningDialogueMessage`(renderer なし = deterministic 経路)。内部関数(`confirmedSlotsFromState` 等)を直接 import しない(実装リファクタ耐性のため)。

日付固定の前提: `planningStartDate: '2026-07-10'`(金曜)、`currentDateTime: '2026-07-10T15:30:00'`、`planningDayCount: 7`。

## 問題点(埋めるべきテストの穴)

- 既存の pipeline テストは pending → 開始日回答の2ターンのみで、pending 中に他 slot の情報を渡すケースがない。
- range 確定後のターンに期間語(「一週間」)が再出現するケースがない。
- stub interpreter を使った「pending 中の AI 候補受理」「混合発話(accepted + request_clarification)」の統合ケースがない。
- 「答えたのに再質問される」ことを**質問系列として**検証するテスト(同一 slot の質問が2回出ないこと)がない。

## 修正方針(シナリオ一覧)

以下を新規テストファイルに実装する。各シナリオは「ターン列 → 最終 state / decision / 質問系列」の形で書き、途中ターンの重要な不変条件(missing の単調減少が期待される slot)をアサートする。

1. **複合初回ターン + 開始日回答**: 「来週の計画を立てたい。院試の過去問を7年分、5分野やりたい。」→「水曜日から」。期待: range = 2026-07-15〜21、examPrepScope 維持、`tasks_or_goals` が missing に現れない、decision の questionPlan に `tasks_or_goals` が含まれない。
2. **pending 中の固定予定回答**: 「来週の計画を立てたい」→「日曜の13時から歯医者」→「水曜日から」。期待: constraint 維持、range 確定後に `fixed_events` が missing に再出現しない。
3. **explicit range の安定性**: 「来週の計画を立てたい」→「水曜日から」→「この一週間で数学を重点的にやりたい」。期待: `range.startDateTime === '2026-07-15T00:00:00'` のまま、missing 再シードなし。
4. **explicit の指定し直し**: 上記3の後に「やっぱり7月20日から一週間で」。期待: range が 2026-07-20 起点に更新される。
5. **pending 中の constraint source(AI)**: 「来週の計画を立てたい。院試の過去問を7年分、5分野やりたい。」→ stub interpreter が `use_constraint_source`(timetable, high)を返すターン(scheduleTemplates あり)→「水曜日から」。期待: `constraintSourcesInUse` に timetable が記録され、`fixed_events` が最後まで missing に現れず、`confirmed-slot-overwrite` reject が発生しない。
6. **混合発話(accepted + 聞き返し)**: draft 直前 state で、stub が `add_fixed_event`(high)+ `request_clarification`(ref: fixed_events)を返す。期待: constraint 反映 + `answer_clarification` decision + 用語説明。
7. **AI 経由 range の scheduler 反映**(ai-range-normalization 完了時のみ): stub が calendarDayCount 無しの `set_planning_range`(explicit, 2026-08-01〜08-05)を返す(pending なし state)。期待: 確認へ倒れず適用された場合に dry-run 候補が 8/1 起点(同タスクの受け入れ条件に合わせて調整)。
8. **質問系列の非重複**: シナリオ1・2の全ターンの decision から questionPlan の targetSlot 系列を収集し、「一度 state に実体が入った slot の質問が後続ターンに再出現しない」ことを検証する helper を作って適用する。
9. **deterministic レンダリングの整合**: シナリオ1のターン1について `renderWeeklyPlanningDialogueMessage`(renderer なし)の出力が「来週」を含み、汎用文「次に確認したい条件を教えてください。」でないこと。

roleplay 系の既存ヘルパー(`__tests__/weeklyPlanningRoleplayTestHelpers.ts`)に再利用できるものがあれば使ってよいが、変更はしない。

## 触らない範囲

- production code 全部(`src/features/weeklyPlanning/` のテスト以外・`src/components/`)
- 既存テストファイル(追記・修正・削除すべて不可。重複が生じても新規ファイル側に書く)
- testFixtures / golden case(`weeklyPlanningGoldExpectations.ts` 等)の変更
- 実 AI を呼ぶテスト(`real-eval`)への追加

## 受け入れ条件

1. 新規ファイル `weeklyPlanningMultiSlotTurns.test.ts` にシナリオ1〜6・8・9(+可能なら7)が実装され、green である。
2. 各シナリオが前提タスクの修正を検証するものとして、**修正前のコードでは red になる**ことが説明できる(レビューの再現手順と対応: シナリオ1・3 = レビュー問題1・2、シナリオ5 = 問題3、シナリオ6 = 問題6、シナリオ9 = 問題4)。実際に revert して確認する必要はないが、どの修正の regression かをテスト名または comment で明示する。
3. production code と既存テストに diff がない(`git diff --stat` で新規ファイルのみ)。
4. `npm run test:run src/features/weeklyPlanning` が green。

## テスト観点

本タスク自体がテスト整備である。観点の網羅は「修正方針」のシナリオ一覧に従う。追加の観点(発見した未修正 bug など)は実装せず報告に列挙する。

## リスク

- 前提タスクの実装詳細(assumptions 文言など)に期待値を強く結合させると、文言変更で壊れる脆いテストになる。文言の完全一致は最小限(シナリオ9のみ)にし、それ以外は state / decision の構造(missing 集合、questionPlan の targetSlot、constraints の kind)でアサートする。
- stub interpreter の返す payload が validator の shape 検査を通らないと、意図せず rejected になりシナリオが無意味になる。既存の `weeklyPlanningInterpreterFoundation.test.ts` の stub payload を参考に、accepted になる最小 payload を使う。

## Codexへの実装指示

1. 最初に本md全体と `docs/ai/codex-task-guide.md` を読む。
2. 前提3タスクの実装が working tree / コミット済みコードに存在することを確認する。欠けている場合は、そのタスクに依存するシナリオを除外して報告するか、実装せず報告で止める(どちらにしたかを明記)。
3. 期待値は必ず実行して得られた実値と突き合わせ、「こうなるはず」で書かない。期待値が本mdの記載と食い違う場合は、テストを実値に合わせる前に報告する(前提タスクの実装漏れの可能性があるため)。
4. 検証(Node 22):

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningMultiSlotTurns.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```

5. `docs/ai/codex-task-guide.md` に従う: スコープ外へ広げない、git 操作をしない、受け入れ条件のチェック結果と解釈で埋めた点を報告する。
