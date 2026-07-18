# 週間計画承認の保存副作用分離 完了記録

Status: complete / merged / automated verified
Completed: 2026-07-18
Implementation: PR #56
Verification: GitHub Actions run `29645304800`

## 完了内容

- 週間計画承認専用の`saveWeeklyApprovedPlan`を追加した。
- 手動editor用保存経路からselectedDate、monthDate、view、editor、notice副作用を分離した。
- repositoryが返した実Plan IDをapproval ledgerへ記録した。
- rollbackは失敗したoptimistic Planだけをfunctional updateで除去する。

## 検証

- partial retry、実Plan ID、画面非変更、rollback回帰: passed
- full test suite: passed
- TypeScript / production build: passed
- diff check: passed