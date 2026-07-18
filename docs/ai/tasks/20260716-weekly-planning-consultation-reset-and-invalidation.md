# 「この週の相談をリセット」と派生データ無効化を実装する

Status: open
Created: 2026-07-16
Parent: `docs/ai/strategy/weekly-planning-personalization-history-and-optimization-design.md`
Phase: P1
Depends on: `20260716-weekly-planning-synced-conversation-session-store.md`

## 目的

「履歴をクリア」を、単なるmessage削除ではなく、その週の相談状態と未承認仮予定を安全にリセットする操作として定義する。

## リセット対象

- その週のmessages
- intake state
- 未解決質問と仮定
- そのsessionから生成された未承認仮予定
- そのsession由来で未確定のplanning observation

## リセット対象外

- 承認済みの通常予定
- 通常のカレンダー予定
- 完了済み実績
- 他sessionの履歴
- 他sessionから得られた有効な個人profile

## UI

操作名は「この週の相談をリセット」とする。

確認文では、会話、入力済み条件、未承認仮予定が消え、承認済み予定は残ることを明示する。

## 内部処理

同期済みsessionは直ちに物理削除せず、まず`invalidated`へ遷移させる。派生eventには`sourceSessionId`を持たせ、同一transactionまたは再試行可能な処理で学習対象から除外する。

## 完了条件

- [ ] resetでmessagesとintake stateが消える
- [ ] 同じsession由来の未承認仮予定が消える
- [ ] 承認済み予定は残る
- [ ] 別週のsessionは変更されない
- [ ] session statusが`invalidated`になる
- [ ] 派生した未確定eventが学習対象から除外される
- [ ] 途中失敗しても会話だけ消えて仮予定が残る不整合を起こさない
- [ ] reset後に同じ週で新しいsessionを開始できる
- [ ] reset、仮予定一括破棄、通常予定削除の責務を混同しない

## 対象外

- アカウント全体のデータ削除
- 承認済み予定の一括削除
- profileの即時全再計算
- 保持期限後の物理削除batch
