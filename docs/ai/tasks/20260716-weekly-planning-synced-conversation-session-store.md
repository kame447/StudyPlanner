# 週単位の週間計画sessionを別端末同期する

Status: open
Created: 2026-07-16
Parent: `docs/ai/strategy/weekly-planning-personalization-history-and-optimization-design.md`
Phase: P1
Depends on: `20260716-weekly-planning-midweek-current-time-start-boundary.md`

## 目的

現在のlocalStorage中心の会話保存を、同一ユーザーが別端末でも直近の週間計画相談を再開できるsession storeへ移行する。

## session単位

```text
sessionKey = userId + weekStartDate
```

planning horizonは週sessionと分離して保存する。

## 保存対象

- messages
- intake state
- session status
- planning horizon
- 未承認仮予定への参照
- feature extraction version
- createdAt / updatedAt

`assumptionProposalRecords`などsession-localで永続化禁止の値は除外する。

## 要件

- クラウド側を共有の正本とする
- localStorageはoffline cacheまたは移行元として扱う
- 更新競合を検出できるrevisionまたはupdatedAtを持つ
- 別週のsessionを混ぜない
- ユーザー切替時に他ユーザーのsessionを表示しない
- 既存localStorageデータを失わず移行できる
- 完全会話の保持件数・期間を設定値として変更できる

## 対象外

- 長期個人profileの計算
- contextual bandit
- 完全会話の最終保持期間決定
- ChatGPT同等の全文検索UI

## 完了条件

- [ ] 端末Aで作成した直近sessionを端末Bで復元できる
- [ ] messagesとintake stateが同じrevisionとして保存される
- [ ] 週を切り替えると別sessionが表示される
- [ ] localStorageのみの既存sessionを一度だけ移行できる
- [ ] 永続化禁止フィールドがクラウドへ保存されない
- [ ] offline時はcacheを利用し、再接続時の競合を明示的に処理する
- [ ] 認可ルールで本人以外が読み書きできない
- [ ] 保存失敗で現在の画面上sessionを消さない

## 実装上の注意

UI componentがbackend APIを直接操作せず、session repositoryを介する。保存形式にはschema versionを持たせ、将来の特徴抽出・保持期間変更に耐えられるようにする。
