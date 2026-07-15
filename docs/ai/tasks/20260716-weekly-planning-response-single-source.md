# 週間計画の成功応答を会話履歴へ一本化する

Status: open
Created: 2026-07-16
Parent: `20260716-weekly-planning-conversation-hardening.md`

## 対象問題

通常turnの成功応答は会話履歴だけへ表示するよう修正したが、preview昇格と一括承認の成功時には、同じ文を`status`とassistant messageの双方へ設定していた。このため確認画面では応答カードと会話履歴に同文が重複する。

## 方針

週間計画の会話として記録する成功応答はassistant messageを唯一の表示元とする。`status`は単発自然言語入力など、会話履歴を持たない経路だけで使う。

## 完了条件

- [ ] preview昇格成功時に同じ文をstatusへ設定しない
- [ ] 一括承認成功時に同じ文をstatusへ設定しない
- [ ] assistant messageとして履歴には残す
- [ ] エラー表示と単発自然言語入力のstatusは変更しない
- [ ] 週間計画テスト、build、diff checkを通す
