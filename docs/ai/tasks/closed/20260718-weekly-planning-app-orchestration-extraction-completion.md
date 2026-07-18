# Appから週間計画の進行・承認・画面接続を分離した記録

Status: completed / automated verified
Completed date: 2026-07-18
Commit: `37b1146a56139c28b52624b11ff0e705a69a5544`
Issue: #49
Pull request: #50

## 目的

`App.tsx`が直接持っていた週間計画の会話進行、仮予定承認、承認履歴、QuickEntry接続を週間計画application層へ分離する。

## 実装結果

- `useWeeklyPlanningApplication`へ週間計画state、controller session、会話操作、draft操作、approval呼出しを集約した。
- `weeklyPlanningApprovalApplication`へ承認前検証、operation再利用、保存実行、部分再試行、完了反映を移した。
- approval ledgerのlocalStorage読み書きを専用storageへ移した。
- QuickEntryModalへの週間計画props接続を専用componentへ移した。
- reducer、turn controller、turn executor、approval domainは複製せず再利用した。

## 維持した安全境界

- AIはstate、scheduler、save、approveを直接変更しない。
- previewは明示承認まで通常予定として保存しない。
- request、週、revision不一致の古い結果をreducer/controllerで拒否する。
- modal closeはpresentationだけを閉じ、active sessionをcancelしない。

## 検証結果

GitHub Actions run `29635120597`で次が成功した。

- focused tests
- 週間計画test suite
- full test suite
- TypeScriptを含むproduction build
- `git diff --check`

## 未完了の後続事項

2026-07-18の追加監査で、application層の挙動test不足、保存副作用、conversation binding、in-flight interruption、reload後approval、user storage境界、server-side idempotencyをroot taskへ分離した。

## 参照すべきcanonical文書

- `docs/ai/weekly-planning-current-contract-status.md`
- `docs/ai/weekly-planning-pr5-post-merge-status.md`
- `docs/ai/strategy/weekly-planning-roadmap.md`
- `docs/ai/weekly-planning-docs-index.md`
