# 時間減衰付きの週間計画profileを作る

Status: open / blocked by history feature extraction
Priority: P3
Created: 2026-07-16
Updated: 2026-07-19
Tracking: Issue #47
Parent: `docs/ai/strategy/weekly-planning-personalization-history-and-optimization-design.md`
Depends on: `20260716-weekly-planning-history-feature-extraction.md`
Blocks: `20260716-weekly-planning-personalized-placement-scoring.md`

## 目的

有効なplanning observationとoutcome observationから、曜日、時間帯、教科、予定時間ごとの傾向を再計算し、古い記録ほど影響を弱めたversion付き個人profileを作る。

PR #48でprofile schemaとrepositoryは実装済みである。本taskは、観測から推定factを安全に更新する集計ロジック、更新境界、不確実性管理を担当する。

## 最初に扱う集計値

- 教科・task種別ごとの予定時間と実績時間の比
- 教科・task種別ごとの見積り補正値
- 時間帯別の完了率
- 時間帯別の開始遅延
- 教科と時間帯の組合せ
- 連続学習時間と中断率
- 継続しやすいsession長
- 計画依頼から最初の開始までの準備時間
- 各値の観測数、有効重み、不確実性、最終観測日時

## 集計原則

- `active`な観測だけを集計する
- `invalidated`と`superseded`を除外する
- 古い観測へ時間減衰を掛ける
- 半減期は特徴ごとに設定し、定数をコードへ散在させない
- 少数観測や高不確実性では安全な既定値へ縮約する
- 明示的な利用者設定を推定値で上書きしない
- 外れ値一件で補正値が急変しないよう、比率の上限・下限またはrobust estimatorを持つ
- profileは派生元観測から再計算可能なcacheとする
- 同じ観測集合とversionから同じprofileへ収束する
- profile全体のlast-write-wins置換で、同時更新された明示設定を消失させない

## 時間減衰と調整

指数減衰または半減期表現を利用する。候補となる半減期は、時系列を守ったwalk-forward validationで比較する。未来の結果を過去時点のprofile計算へ混ぜない。

初期実装では、説明可能な集計とoffline再計算を優先する。contextual banditやオンライン探索を導入しない。

## 完了条件

- [ ] version付きprofileを有効観測から再計算できる
- [ ] 古い記録の重みが時間とともに低下する
- [ ] 特徴ごとに異なる半減期を設定できる
- [ ] 観測数が少ない場合は既定値へ安全に戻る
- [ ] profileに観測数、有効重み、不確実性、最終観測日時を保持する
- [ ] 明示的設定が推定更新で上書きされない
- [ ] 外れ値一件で補正値が許容範囲外へ急変しない
- [ ] walk-forward validationで半減期候補を比較できる
- [ ] resetで無効化された記録を集計しない
- [ ] supersededされた旧観測を二重集計しない
- [ ] 同じ入力とversionでprofile再計算がidempotentになる
- [ ] 更新競合で別factを消失させない
- [ ] profile reset後に古い集計結果がstale writeとして復活しない
- [ ] score未接続状態ではscheduler結果を変えない

## 対象外

- placement scoreへの接続
- contextual bandit
- RNN・Transformer
- reward係数のオンライン更新
- 自動探索
- user-facing分析dashboard
