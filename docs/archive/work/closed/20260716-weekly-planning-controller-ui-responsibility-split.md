# 週間計画controllerとUIの責務分離

Status: closed / implementation completed
Closed: 2026-07-28
Original priority: P2
Requirement IDs: DA-TURN-001, DA-PREVIEW-001

## 完了根拠

- PR #50で`useWeeklyPlanningApplication`、approval application、identity、ledger storageをapplication層へ抽出した。
- PR #86でsession lifecycle、turn application、turn side effects、storage decodeを分離し、composition rootから実装詳細を外した。
- request ownership、preview ownership、stale result、close/reopen、reset、approval boundaryには専用module/testが存在する。
- `App.tsx`またはmodal componentだけがsession-owned Promise resultを所有する旧構造ではない。

## 残件の移管

実browserでのclose/reopen、IME、focus、roleplay、default cutover確認は次へ移管した。

- `../20260728-weekly-planning-stable-v5-verification-and-cutover.md`

将来さらにcomponentを小さくする保守refactorは、本taskの未完了ではない。新しい具体的依存違反が発見された場合に別taskを作る。