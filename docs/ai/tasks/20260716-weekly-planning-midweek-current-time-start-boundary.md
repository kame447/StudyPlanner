# 週途中の週間計画で現在時刻より前へ配置しない

Status: open / next implementation
Priority: P0
Created: 2026-07-16
Updated: 2026-07-19
Tracking: Issue #47
Parent: `docs/ai/strategy/weekly-planning-personalization-history-and-optimization-design.md`
Depends on: none
Blocks: `20260716-weekly-planning-synced-conversation-session-store.md`

## 目的

週の途中で「今週の予定を立てたい」と依頼された場合、明示的な開始日時がなければ、現在時刻より前へ新しい予定を配置しない。

これは個人最適化ではなくschedulerのhard safety boundaryである。profile、履歴集計、placement scoreより先に実装する。

## 基本仕様

開始可能時刻は次の優先順位で解決する。

1. 明示された開始日時
2. 明示された開始日 + session policyの開始時刻
3. request開始時に固定した現在日時 + 60分の準備猶予

解決後はschedulerの配置粒度へ切り上げる。

## 対象

- request単位で一貫した`currentDateTime`をcontextへ注入する
- planning horizonの開始日時を解決する純粋関数
- 現在より前の日付・時刻をavailabilityから除外する
- 明示された開始日時が過去の場合は黙って置換せず確認へ倒す
- timezone、日付境界、週末のテスト
- session weekとplanning horizonを分離する型境界

## 対象外

- 60分の準備猶予の個人最適化
- 別端末同期
- 過去の実績入力
- scheduler全体の配置アルゴリズム変更
- profile更新

## 完了条件

- [ ] 明示開始日時が現在より後なら、その日時を優先する
- [ ] 明示開始日時がなければ、現在 + 60分以降だけを候補にする
- [ ] 配置粒度へ正しく切り上げる
- [ ] 経過済みの日付へ候補を生成しない
- [ ] 過去の明示指定を黙って現在時刻へ置換しない
- [ ] 同一request内で異なる現在時刻を再取得しない
- [ ] 日跨ぎ、週末、timezoneの回帰テストを追加する
- [ ] 既存の明示的な計画期間指定を壊さない
- [ ] 個人profileが未設定でも同じ安全境界が働く

## 実装上の注意

`new Date()`を複数層で直接呼ばず、request単位で解決した現在日時をcontextへ注入する。時間境界の判断と候補配置を分離し、schedulerに個別例外を散らさない。
