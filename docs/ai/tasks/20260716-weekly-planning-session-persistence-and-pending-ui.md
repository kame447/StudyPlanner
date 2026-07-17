# 週間計画sessionを保持し送信中UIを整理する

Status: closed
Closed: 2026-07-16
Parent: `20260716-weekly-planning-conversation-hardening.md`

## 対象問題

会話履歴とintake stateが`NaturalLanguageAssistant`内のlocal stateだけに存在するため、modalを閉じると失われる。

既存の`PlanningState.messages`とlocalStorageはUIへ接続されておらず、draft blockが0件ならstorage keyを削除するため、会話だけのsessionを保存できない。

送信開始時にはユーザー発話を会話履歴へ追加する一方、textareaを応答完了後まで残すため、同じ文が会話履歴と入力欄へ二重表示される。成功応答も履歴とstatus cardへ重複表示される可能性がある。

## 方針

週間計画の会話履歴とintake stateを既存のweekly planning stateへ集約し、modalのmount/unmountから独立させる。storageはdraft、messages、intake stateのいずれかがあれば保持する。

送信開始時に入力文を履歴へ確定してtextareaを即時クリアする。処理中は入力欄を隠し、assistant側のtyping indicatorを表示する。成功応答は会話履歴を唯一の表示元とし、status cardには入れない。

`assumptionProposalRecords`は既存コメントどおり永続化対象外とし、保存時に除外する。

## 完了条件

- [x] modalを閉じて再度開いてもmessagesが復元される
- [x] intake stateも復元され、次turnが前の文脈を継続する
- [x] draftが0件でも会話sessionがstorageに残る
- [x] 「履歴をクリア」でmessagesとintake stateを消す
- [x] clear操作まで会話を自動削除しない
- [x] 送信直後にtextareaから送信済み文が消える
- [x] 処理中はtyping indicatorを表示し入力欄を隠す
- [x] 成功応答をstatus cardへ重複表示しない
- [x] storageとreducerの回帰テストを追加する
