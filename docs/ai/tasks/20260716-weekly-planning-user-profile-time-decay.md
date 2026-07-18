# 時間減衰付きの週間計画profileを作る

Status: open
Created: 2026-07-16
Parent: `docs/ai/strategy/weekly-planning-personalization-history-and-optimization-design.md`
Phase: P3

## 目的

過去の計画結果から、時間帯、曜日、教科、予定時間ごとの傾向を計算し、古い記録ほど影響を弱めた個人profileを作る。

## 最初に扱う集計値

- 時間帯別の完了率
- 時間帯別の開始遅延
- 教科と時間帯の組合せ
- 連続学習時間と中断率
- 計画依頼から最初の開始までの準備時間
- 各値の観測数と不確実性

## 時間減衰

指数減衰または半減期表現を利用する。半減期は特徴ごとに分離し、固定値をコードへ散在させない。

## 調整方法

時系列を守ったwalk-forward validationで、複数の半減期候補を比較する。未来の結果を過去のprofile計算へ混ぜない。

## 完了条件

- [ ] version付きprofileを再計算できる
- [ ] 古い記録の重みが時間とともに低下する
- [ ] 特徴ごとに異なる半減期を設定できる
- [ ] 観測数が少ない場合は既定値へ安全に戻る
- [ ] profileに観測数と不確実性を保持する
- [ ] walk-forward validationで半減期を比較できる
- [ ] resetで無効化された記録を集計しない
- [ ] profileは再計算可能なcacheとして扱う

## 対象外

- contextual bandit
- RNN
- 本番配置scoreへの接続
