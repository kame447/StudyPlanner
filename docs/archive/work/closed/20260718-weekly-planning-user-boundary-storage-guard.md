# 週間計画storageのuser境界保護 完了記録

Status: complete / merged / automated verified
Completed: 2026-07-18
Implementation: PR #59

## 完了内容

- 週間計画stateを`version + ownerId + payload`の同一envelopeへ移行した。
- owner不一致、cross-user draft、破損payloadをfail closedで破棄する。
- user/week scope切替renderで旧stateを新keyへ保存しないguardを追加した。
- approval ledgerをuser別keyへ分離した。
- 旧global ledgerをoperation.userId単位で安全に分割移行する。
- blank/anonymous ownerではledgerを復元しない。

## 検証

- envelope round-trip、owner mismatch、legacy migration、A→B切替、ledger remount: passed
- server-side claimとmulti-device idempotencyは後続taskで実装した。