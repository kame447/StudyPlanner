# 週間計画の対話処理経路修正 completion record

Status: **closed / completed**
Completed: 2026-07-15
PR: #3
Current branch containing the result: `main`

## 目的

週間計画のAI interpreter経路で情報が欠落する問題、dialogue actionの優先順位、topic別fallback、聞き返し文脈、実装時に生じた一時的なcore複製を、一連の修正として完了させた記録である。

## 統合した旧task

次のroot taskを本記録へ統合した。

- `20260715-weekly-planning-ai-deterministic-baseline.md`
- `20260715-weekly-planning-dialogue-action-priority-and-fallback.md`
- `20260715-weekly-planning-clarification-context-generalization.md`
- `20260715-weekly-planning-dialogue-path-implementation-cleanup.md`
- `20260715-weekly-planning-dialogue-path-issue-breakdown.md`
- `20260715-weekly-planning-dialogue-path-pr-finalization.md`

## 実装結果

- legacy fallbackを含まないdeterministic command phaseをAI呼び出し前のbaselineとして適用する。
- AI成功時はdeterministic stateへAI commandを補完的に適用する。
- provider例外時だけlegacy fallbackを含むrules経路へ切り替える。
- planning rangeとtask identityをdialogue action上限内で優先する。
- fallback rendererをtopic別に描画し、planning rangeをavailability質問として誤表示しない。
- `lastQuestionContext`をsession-localで保持し、説明対象と回答例を同一slotへgroundingする。
- missing以外の質問後も、実際に描画した質問文脈からclarification targetを解決する。
- 一時的なpipeline core複製、wrapper、helper、trigger、cleanup scriptを削除し、既存pipelineへ直接統合する。

## 回帰条件

- 「来週の予定立てたい」でAIが`begin_weekly_planning`だけを返してもpending planning rangeを失わない。
- AI成功経路へlegacy task extractionを混ぜない。
- planning rangeとtask identityがaction上限から脱落しない。
- topic別fallbackが質問対象を取り違えない。
- 明示用語と先頭missing slotが異なっても、説明と回答例が一致する。
- AI command、AI空応答、rules-only、provider例外の各経路でclarification decisionの契約を維持する。

## 検証結果

- `npm run test:run -- src/features/weeklyPlanning`: 688 passed、13 skipped、5 todo
- `npm run build`: passed
- `git diff --check`: passed
- PR base: `main`
- PR changed files: 18

## 注記

本記録は2026-07-15時点の実装方針を記録する。AIとdeterministic parserの最終的なcanonical責務分担は、product spec、dialogue architecture、roleplay test plan、Codex guideを同期したうえで確定する。履歴taskをcurrent instructionとして直接再実行しない。
