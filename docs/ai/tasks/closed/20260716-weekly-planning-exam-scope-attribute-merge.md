# exam scopeを属性単位で安全に補完する

Status: closed
Closed: 2026-07-16
Created: 2026-07-16
Parent: `20260716-weekly-planning-conversation-hardening-review-fixes.md`

## 完了条件

- [x] fieldsの空文字と重複を拒否する
- [x] 確定済みfieldsを欠落させない
- [x] 確定済みexamType、件数、strategy、unit情報を上書きしない
- [x] 未確定yearRangeだけを補完できる
- [x] reducer適用後まで既存属性を保持する
- [x] 自動単一分野priorityにprovenanceを持たせる
- [x] 分野追加時にpriority確認を再開する
