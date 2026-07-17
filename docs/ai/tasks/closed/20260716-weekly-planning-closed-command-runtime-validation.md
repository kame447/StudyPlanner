# AI command unionを閉じたruntime validatorで検証する

Status: closed
Closed: 2026-07-16
Created: 2026-07-16
Parent: `20260716-weekly-planning-conversation-hardening-review-fixes.md`

## 完了条件

- [x] 共通必須type、confidence、sourceTextを検証する
- [x] command別必須項目と分岐必須項目を検証する
- [x] 配列要素型と重複を検証する
- [x] unknown propertyを拒否する
- [x] optional propertyのnullだけを未指定へ変換する
- [x] 必須nullと不正confidenceを補修しない
