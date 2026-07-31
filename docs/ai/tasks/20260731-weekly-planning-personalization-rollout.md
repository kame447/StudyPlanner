# 週間計画personalization rollout

Status: active / foundation implemented, observation pipeline not started
Priority: P2 after cloud session boundary
Created: 2026-07-28
Updated: 2026-07-31
Tracking: Issue #47
Depends on:
- `20260731-weekly-planning-synced-conversation-session-store.md`
- `20260731-weekly-planning-midweek-current-time-start-boundary.md`

## 現在地

実装済みfoundation:

- account-linked profile schema
- week-start setting
- origin、confidence、scope、confirmedAt、expiresAt
- explicit settingの保存・復元・reset
- bounded placement parameter schema
- trace、conversation session、approval ledgerとのrepository分離
- 一時的な相談条件をlongitudinal profileへ自動昇格しない境界

未実装:

- planning/outcome observation repository
- source session resetからobservation validityへの伝播
- active observationだけを用いた再計算可能aggregate
- time decay、不確実性、effective sample information
- safe candidateの順位だけを変えるpersonalized score
- consent、TTL、account deletion、訂正、audit

## 実装順序

1. version付きobservation contractとidempotent repository
2. reset/invalidation propagation
3. active observationだけのaggregate profile
4. hard constraint通過後のplacement scoring
5. production governance

## 完了条件

- [ ] observation schema/repositoryを実装
- [ ] Plan/actualからobservationを生成
- [ ] session resetをvalidityへ原子的に伝播
- [ ] invalidated/supersededを集計しない
- [ ] aggregateを全observationから再計算可能にする
- [ ] time decayと不確実性をversion付きで保持
- [ ] explicit settingを保護
- [ ] score無効時に現行scheduler結果を維持
- [ ] hard constraint violationを増やさない
- [ ] offline walk-forward評価を実行
- [ ] consent、TTL、account deletion、auditを検証
- [ ] focused/full/typecheck/build/diff checkがgreen
- [ ] browser/multi-client確認

## 対象外

- hard constraintの学習化
- contextual bandit、online exploration
- end-to-end neural scheduler置換
- quality trace本文の直接profile入力