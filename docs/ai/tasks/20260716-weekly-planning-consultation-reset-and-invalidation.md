# 「この週の相談をリセット」と派生データ無効化を実装する

Status: open / blocked by synced session store
Priority: P1
Created: 2026-07-16
Updated: 2026-07-19
Tracking: Issue #47
Parent: `docs/ai/strategy/weekly-planning-personalization-history-and-optimization-design.md`
Depends on: `20260716-weekly-planning-synced-conversation-session-store.md`
Blocks: `20260716-weekly-planning-history-feature-extraction.md`

## 目的

「履歴をクリア」を、単なるmessage削除ではなく、その週の相談状態、未承認仮予定、派生観測を安全に無効化する操作として定義する。

このtaskはconversation sessionのresetを担当する。account全体のprofile reset、承認済み予定削除、保持期限後の物理削除とは別責務である。

## リセット対象

- その週のmessages
- intake state
- 未解決質問と仮定
- そのsessionから生成された未承認仮予定
- そのsession由来で未確定のplanning observation
- session-localの再試行・ownership情報

## リセット対象外

- 承認済みの通常予定
- 通常のカレンダー予定
- 完了済み実績
- 他週・他sessionの履歴
- 他sessionから得られた有効な個人profile
- account全体の明示設定

## UI

操作名は「この週の相談をリセット」とする。

確認文では、会話、入力済み条件、未承認仮予定が消え、承認済み予定と完了済み実績は残ることを明示する。profile resetと誤認させない。

## 内部処理

同期済みsessionは直ちに物理削除せず、まず`invalidated`へ遷移させる。派生eventには`sourceSessionId`とvalidityを持たせ、同一transactionまたは再試行可能なoperationで学習対象から除外する。

```text
session.status = invalidated
observation.validity = invalidated
```

reset operationはidempotentにし、途中失敗後の再試行で会話だけ消えて仮予定・観測が残る状態を作らない。

## 完了条件

- [ ] resetでmessagesとintake stateが消える
- [ ] 同じsession由来の未承認仮予定が消える
- [ ] 承認済み予定と完了済み実績は残る
- [ ] 別週・別sessionは変更されない
- [ ] session statusが`invalidated`になる
- [ ] 派生した未確定eventが`invalidated`になる
- [ ] invalidated eventをprofile集計へ含めない
- [ ] 途中失敗後の再試行で部分resetを収束させる
- [ ] reset後に同じ週で新しいsessionを開始できる
- [ ] stale async resultがreset後のsessionへ再適用されない
- [ ] reset、仮予定一括破棄、通常予定削除、account profile resetを混同しない
- [ ] audit上、誰がいつどのsessionをresetしたか追跡できる

## 対象外

- account全体のデータ削除
- 承認済み予定の一括削除
- profileの即時全再計算
- 保持期限後の物理削除batch
- feature式やscore weightの変更
