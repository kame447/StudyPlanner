# 週間計画で漢数字の絶対日付を曜日として誤解釈しない

Status: closed / completed
Priority: P0
Created: 2026-07-17
Completed: 2026-07-17
Related Issue: #21
Related Pull Request: #26
Main merge commit: `10c40296dc6655343d4d36d04ceb63abb9c07f8e`
GitHub Actions run: `29581399006`
Parent status: `docs/ai/weekly-planning-pr5-post-merge-status.md`

## 1. 完了した契約

- `8月1日`、`8月一日`、`八月1日`、`八月一日`を同じ絶対日付tokenとして扱う。
- selected dateを基準に年を解決し、実行時current dateで上書きしない。
- 絶対日付token内の`日`を曜日候補から除外する。
- 無効な絶対日付またはpending range外の日付を、範囲内の日曜日へfallbackしない。
- `日曜日から`、`日曜から`、`来週の日曜日から`の曜日解決を維持する。
- `一日だけ`、`一週間`等を月日または日曜日として誤認しない。
- deterministic parserとAI candidate validatorを同じ絶対日付guardへ接続する。

## 2. 実装

- `weeklyPlanningAbsoluteDate.ts`へ月日tokenization、漢数字解決、selected date基準の年解決、candidate整合性判定を分離した。
- `weeklyPlanningScopeParsing.ts`で絶対日付tokenを曜日抽出より先に処理し、解決失敗時の曜日fallbackを禁止した。
- pending rangeの開始回答では、範囲内の絶対日付だけを採用する。
- `weeklyPlanningCandidateValidator.ts`でAIの`set_planning_range`がsource textの絶対日付と一致することを検証する。
- intake pipelineからcandidate validatorへ`WeeklyPlanningIntakeContext`を渡す。
- parser、candidate、pipelineを含むfocused regressionを19件追加した。

## 3. 検証

GitHub Actions run `29581399006`で、実装適用後のworktreeを対象に次を実行し、すべて成功した。

- `npm ci`
- `git diff --check`
- focused regression: 19 passed
- `src/features/weeklyPlanning` suite
- 全テスト `npm run test:run`
- production build `npm run build`

同runが検証済みworktreeからhelperを除去し、実装commitをbranchへpushした。最終branch headのCloudflare Pages deployも成功した。

## 4. 対象外

- account-linked week-start profile
- genericな日本語数詞parser
- preview lifecycle
- approval persistence
- trace privacy
- browser roleplay全体
