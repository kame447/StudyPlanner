# 保存済みの週間計画sessionがある場合は会話画面を再開する

Status: closed
Closed: 2026-07-16
Created: 2026-07-16
Parent: `20260716-weekly-planning-conversation-hardening.md`

## 対象問題

会話messagesとintake stateを永続化しても、`NaturalLanguageAssistant`の入力モードはmountごとに`chat`へ初期化される。そのためmodalを閉じて再度開いた直後は相談画面が表示され、保存した週間計画履歴が画面上へ復元されたように見えない。

## 方針

保存済みmessagesまたはintake stateがある場合、初回mount時の入力モードを`weekly_planning`にする。会話sessionがない場合は従来どおり`chat`を初期値にする。

ユーザーがmount後に手動でタブを切り替えた操作は上書きしない。props更新のたびに強制遷移させず、初期値の決定だけを純粋関数へ分離する。

## 完了条件

- [x] messagesがある場合は週間計画画面から再開する
- [x] intake stateだけがある場合も週間計画画面から再開する
- [x] sessionがない場合は相談画面を維持する
- [x] mount後の手動タブ切替をprops更新で上書きしない
- [x] 純粋関数テスト、週間計画テスト、build、diff checkを通す
