# 週間計画履歴から再利用可能な特徴を抽出する

Status: open
Created: 2026-07-16
Parent: `docs/ai/strategy/weekly-planning-personalization-history-and-optimization-design.md`
Phase: P2
Depends on:
- `20260716-weekly-planning-synced-conversation-session-store.md`
- `20260716-weekly-planning-consultation-reset-and-invalidation.md`

## 目的

完全な会話を毎回読み直さなくても後続の集計を実行できるよう、計画時の条件と実行結果をversion付きの構造化記録へ変換する。

## 対象

- 相談sessionとの参照
- 計画開始時刻と予定時間
- 教科とtask種別
- 曜日と時間帯
- 直前予定、睡眠、当日負荷の分類
- 実開始時刻、完了率、開始遅延、中断、再配置
- schema versionと有効状態

## 原則

- 同じ操作の再送で重複記録しない
- 修正前の値を無言で破壊しない
- resetされたsession由来の値を集計対象から外せる
- 自由記述本文を不要に複製しない
- 記録失敗で予定作成を失敗させない

## 完了条件

- [ ] 計画作成時の特徴を構造化して保存できる
- [ ] 承認と実績更新から結果を関連付けられる
- [ ] session resetを関連記録へ伝播できる
- [ ] schema versionを必須にする
- [ ] 再試行で重複しない
- [ ] 後続profile計算が会話本文なしで実行できる
- [ ] 不要なraw textを保存しない

## 対象外

- profile集計
- 配置score
- contextual bandit
- 系列モデル
