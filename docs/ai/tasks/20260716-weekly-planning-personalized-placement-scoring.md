# 個人別の週間計画配置scoreを導入する

Status: open / blocked by decayed profile
Priority: P4
Created: 2026-07-16
Updated: 2026-07-19
Tracking: Issue #47
Parent: `docs/ai/strategy/weekly-planning-personalization-history-and-optimization-design.md`
Depends on: `20260716-weekly-planning-user-profile-time-decay.md`

## 目的

現行の安全な候補生成を維持したまま、過去の完了率、開始遅延、教科と時間帯の相性、見積り誤差、session長傾向を使って、安全な候補の優先順位だけを個人化する。

このtaskはcandidate selectionを担当する。hard constraints、planning horizon、profile集計をscore内部へ移さない。

## score構造

```text
hard constraints
  -> safe candidates
  -> heuristicScore
  -> personalizedScore
  -> riskPenalty
  -> uncertaintyPenalty
  -> final order
```

```text
finalScore = heuristicScore + personalizedScore - riskPenalty - uncertaintyPenalty
```

個人データが不足している場合、profileが破損している場合、score計算に失敗した場合は、現行heuristicの順序へ戻す。

## 最初に利用する特徴

- 曜日と時間帯
- 教科・task種別
- 予定時間
- 直前予定との間隔
- 就寝までの残り時間
- 過去の完了率
- 開始遅延
- 中断率
- 見積り補正値
- 継続しやすいsession長
- profileの観測数、有効重み、不確実性、最終観測日時

## 安全境界

- 固定予定と重なる候補はscore前に除外する
- 現在より前の候補はscore前に除外する
- 利用不可時間、睡眠、最低休息を破壊する候補は除外する
- 承認済み予定を暗黙に移動しない
- unresolvedな日時をscoreで推測しない
- 明示的な利用者設定を推定scoreより優先する
- score無効時は現行候補順序を維持する
- personalized scoreは候補生成件数やhard constraint判定を変更しない

## 説明可能性

候補ごとに、主要な加点・減点要因をstructured reasonとして保持する。

例:

- 火曜19時は過去の完了率が高い
- 英語の60分sessionは中断率が高いため分割候補を優先した
- 観測数が少ないため個人加点を抑制した

自由記述の生成をscoreの正本にせず、version付きfeature contributionから説明文を作る。

## offline評価

- time-based splitまたはwalk-forwardで現行heuristicと比較する
- constraint violation数を第一のgateとする
- 完了率、開始遅延、中断、再配置、利用者修正量を比較する
- profile不足者で現行heuristicと同等になることを確認する
- score version、feature version、weight versionを固定して再現可能にする

## 完了条件

- [ ] 現行safe candidateへ個人別scoreを追加できる
- [ ] score無効時に現行scheduler結果が変わらない
- [ ] 個人データ不足時に既定heuristicへ戻る
- [ ] 不確実性が高い候補を過度に優先しない
- [ ] 明示的な利用者設定がscoreより優先される
- [ ] 主要な加点・減点要因を説明できる
- [ ] score、feature、weightのversionを記録する
- [ ] offlineで現行heuristicと比較できる
- [ ] constraint violation数を増やさない
- [ ] 現在時刻境界、固定予定、睡眠、利用不可時間を破壊しない
- [ ] profile reset後にstale scoreを利用しない
- [ ] 同じcandidate setとversionから同じ順序へ収束する
- [ ] user-facing previewで個人化理由を誤って確定事実として表現しない

## 対象外

- 自動探索
- contextual bandit
- RNN・Transformer
- reward係数のオンライン更新
- hard constraintの学習化
- scheduler全体の置換
