# 週単位の週間計画sessionを別端末同期する

Status: open / blocked by current-time boundary
Priority: P1
Created: 2026-07-16
Updated: 2026-07-19
Tracking: Issue #47
Parent: `docs/ai/strategy/weekly-planning-personalization-history-and-optimization-design.md`
Depends on: `20260716-weekly-planning-midweek-current-time-start-boundary.md`
Blocks:
- `20260716-weekly-planning-consultation-reset-and-invalidation.md`
- `20260716-weekly-planning-history-feature-extraction.md`

## 目的

現在のlocalStorage中心の会話保存を、同一利用者が別端末でも直近の週間計画相談を再開できる週単位session storeへ移行する。

PR #48で実装したaccount-linked personalization profileとは別の保存責務である。profileの別端末復元が完了していても、messages、intake state、preview参照を含むconversation session同期は完了していない。

## session単位

```text
sessionKey = userId + weekStartDate
```

conversation sessionの週境界と、実際の配置対象であるplanning horizonを分離して保存する。

## 保存対象

- schema version
- owner ID
- week start date
- planning horizon
- messages
- intake state
- session status
- 未承認仮予定への参照
- feature extraction version
- revision
- createdAt / updatedAt

`pendingTurn`、`pendingApproval`、`assumptionProposalRecords`などsession-localで永続化禁止の値は除外する。

## 要件

- クラウド側を共有の正本とする
- localStorageはoffline cacheまたは一度限りの移行元として扱う
- 更新競合を検出するrevisionを持つ
- 別週のsessionを混ぜない
- 利用者切替時に他利用者のsessionを表示・再保存しない
- 既存localStorageデータを失わず一度だけ移行する
- 完全会話の保持件数・期間を設定可能にする
- profile repository、quality trace、approval ledgerとcollection・権限・削除責務を分離する
- 保存失敗を現在の画面上session消失へつなげない

## 完了条件

- [ ] 端末Aで作成した直近sessionを端末Bで復元できる
- [ ] messages、intake state、preview参照を同一revisionとして保存する
- [ ] 週を切り替えると別sessionが表示される
- [ ] session weekとplanning horizonが独立して復元される
- [ ] localStorageのみの既存sessionを一度だけ移行できる
- [ ] 永続化禁止フィールドがクラウドへ保存されない
- [ ] offline時はcacheを利用し、再接続時の競合を明示的に処理する
- [ ] owner不一致、cross-user payload、破損schemaをfail closedで破棄する
- [ ] 認可ルールで本人以外が読み書きできない
- [ ] 保存失敗で現在の画面上sessionを消さない
- [ ] retryで古いrevisionが新しいsessionを上書きしない
- [ ] account deletion cascadeと保持期限の対象になる

## 対象外

- 長期profileの集計
- placement score
- contextual bandit
- 完全会話の最終保持期間に関する法務判断
- ChatGPT同等の全文検索UI
- 相談resetの派生観測無効化

## 実装上の注意

UI componentがbackend APIを直接操作せず、session repositoryを介する。保存形式にはschema versionとrevisionを持たせる。profile storeとconversation session storeを同じdocumentへ統合しない。
