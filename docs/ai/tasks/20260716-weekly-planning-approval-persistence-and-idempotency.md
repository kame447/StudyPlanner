# 週間計画approvalの永続idempotencyを設計する

Status: planned
Priority: P1
Requirement IDs: DA-PREVIEW-001

## 1. 背景

approval operation ledgerはlocalStorageを利用しているため、別端末、storage消去、複数tab、同時approvalでは重複保存を完全に防げない。現行のitem ledgerと`userId + sourceDraftBlockId`契約は維持しつつ、永続境界を再設計する必要がある。

## 2. 目的

approval operationをserver-sideの永続境界でclaimし、partial failure、crash、retry、multi-tab、別端末でも同じplan itemを重複保存しない。

## 3. Entry conditions

- 現行approval pathとrepository write順序を再調査する。
- previewId、stateRevision、userId、sourceDraftBlockIdの一意性を確認する。
- Firestore transactionで保証できる範囲を確認する。

## 4. 対象責務

- approval operation claim
- item-level idempotency
- partial successとretry
- stale/pending previewの保存前拒否
- multi-tabと別端末
- operation retentionとmigration

## 5. 触らない範囲

- preview生成条件
- AIによるapproval判断
- scheduler再計算
- conversation traceをidempotencyの正として使うこと

## 6. 受け入れ条件

- staleまたはpending-assumption previewではoperation claimを作らない。
-同じ`userId + sourceDraftBlockId`を複数端末から承認してもplanは一件だけ保存される。
- partial failure後は未保存itemだけをretryする。
- storage消去後も重複保存を防止する。
- transaction failureとrepository failureを区別して再試行できる。
- legacy exam previewの互換経路を維持する。

## 7. Exit conditions

- data model、transaction順序、failure category、retention、migrationを文書化する。
- localStorage ledgerの役割をcacheまたは互換用途へ限定する。
