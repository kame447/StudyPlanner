# 週間計画approvalの永続idempotencyを設計する

Status: planned
Priority: P1
Requirement IDs: DA-PREVIEW-001
Updated: 2026-07-18

## 1. 背景

approval operation ledgerはlocalStorageを利用しているため、別端末、storage消去、複数tab、同時approvalでは重複保存を完全に防げない。現行のitem ledgerと`userId + sourceDraftBlockId`契約は維持しつつ、永続境界を再設計する必要がある。

### 1.1 2026-07-18 監査での追加所見

2026-07-18の全体監査(main 37b1146)で、multi-device以外にも次の重複・照合の穴を確認した。本taskの設計範囲に含める。

- 単一端末クラッシュ変種: ledger書き込みは`executeWeeklyDraftApproval`完了後の一括のみ(`weeklyPlanningApprovalApplication.ts`の`onOperationCompleted`)。複数itemの保存途中でタブが落ちると、一部planは保存済みだがledger無記録になる。復元後の再計算で新しいblock idが採番されるとmemo markerが一致せず、同じ学習内容が二重登録される。item単位の逐次ledger書き込みで大きく軽減できる。
- 複数tabの重複判定の実効性: `plans`はログイン時の一括`getDocs`ロードで、realtime同期がない(`firebasePlannerRepository.ts`)。tab Bのメモリ上`plans`はtab Aの保存を含まないため、`findExistingPlanId`のmemo marker走査が空振りし、重複保存に至る。
- 重複判定の脆弱性: dedupeがユーザー可視のmemo文字列`[weekly-source:...]`に依存しており、ユーザーがmemoを編集すると壊れる。`Plan`には`sourceType`/`sourceId`フィールドが既に存在するのに`'manual'`/`null`で保存している(`weeklyPlanningTransforms.ts` `createPlanDraftFromWeeklyDraftBlock`)。構造化フィールドへの移行を設計に含める。
- `savedPlanId`が実Firestore IDでなく擬似ID`weekly-plan:<sourceDraftBlockId>`で記録されており、ledgerと実データの照合力がない。実planId返却は`20260718-weekly-planning-approval-save-side-effect-isolation.md`で先行して修正する。

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
- 同じ`userId + sourceDraftBlockId`を複数端末から承認してもplanは一件だけ保存される。
- partial failure後は未保存itemだけをretryする。
- storage消去後も重複保存を防止する。
- transaction failureとrepository failureを区別して再試行できる。
- legacy exam previewの互換経路を維持する。
- item保存の完了ごとにclaim/ledgerが更新され、途中クラッシュ後も保存済みitemを重複保存しない。
- 重複判定がユーザー編集可能なmemo文字列に依存しない(構造化source参照へ移行する)。
- 別tabの古い`plans`スナップショットを根拠にした保存が重複を生まない。

## 7. Exit conditions

- data model、transaction順序、failure category、retention、migrationを文書化する。
- localStorage ledgerの役割をcacheまたは互換用途へ限定する。
