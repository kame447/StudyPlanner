# 個人別の週間計画配置scoreを導入する

Status: open
Created: 2026-07-16
Parent: `docs/ai/strategy/weekly-planning-personalization-history-and-optimization-design.md`
Phase: P4
Depends on: `20260716-weekly-planning-user-profile-time-decay.md`

## 目的

現行の安全な候補生成を維持したまま、過去の完了率、開始遅延、教科と時間帯の相性などを使って候補の優先順位を個人化する。

## score構造

```text
finalScore = heuristicScore + personalizedScore - riskPenalty - uncertaintyPenalty
```

個人データが不足している場合は、既定ヒューリスティックへ戻す。

## 最初に利用する特徴

- 曜日と時間帯
- 教科
- 予定時間
- 直前予定との間隔
- 就寝までの残り時間
- 過去の完了率
- 開始遅延
- 中断率
- profileの観測数と不確実性

## 安全境界

- 固定予定と重なる候補はscore前に除外する
- 過去時刻の候補はscore前に除外する
- 睡眠や利用不可時間を破壊する候補は除外する
- scoreが計算できない場合は現行順序を維持する

## 完了条件

- [ ] 現行候補へ個人別scoreを追加できる
- [ ] score無効時に現行scheduler結果が変わらない
- [ ] 個人データ不足時に既定値へ戻る
- [ ] 不確実性が高い候補を過度に優先しない
- [ ] 主要な加点・減点要因を説明できる
- [ ] model・feature・weightのversionを記録する
- [ ] offlineで現行ヒューリスティックと比較できる
- [ ] 制約違反数を増やさない

## 対象外

- 自動探索
- contextual bandit
- RNN・Transformer
- reward係数のオンライン更新
