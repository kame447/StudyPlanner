# 週間計画履歴から再利用可能な特徴を抽出する

Status: open / blocked by session reset contract
Priority: P2
Created: 2026-07-16
Updated: 2026-07-19
Tracking: Issue #47
Parent: `docs/ai/strategy/weekly-planning-personalization-history-and-optimization-design.md`
Depends on:
- `20260716-weekly-planning-synced-conversation-session-store.md`
- `20260716-weekly-planning-consultation-reset-and-invalidation.md`
Blocks: `20260716-weekly-planning-user-profile-time-decay.md`

## 目的

完全な会話を毎回読み直さなくても後続の集計を再現できるよう、計画時の条件と実行結果をversion付きの構造化観測へ変換する。

このtaskは観測eventの作成と有効性管理だけを担当する。profile集計、時間減衰、placement scoreは後続taskへ分離する。

## 観測単位

### planning observation

- deterministic observation ID
- source session ID
- source draft block / Plan ID
- observedAt
- feature schema version
- requested startとresolved planning horizon
- 教科、task種別、予定時間
- 曜日、時間帯、直前予定、睡眠、当日負荷の分類
- scheduler policy version
- validity: `active | invalidated | superseded`

### outcome observation

- deterministic outcome ID
- planning observation ID
- actual start、actual duration、completion ratio
- start delay、中断、再配置、abandoned
- recordedAt
- outcome schema version
- validity

## 原則

- 同じ操作の再送で重複記録しない
- plan revisionとoutcome revisionを追跡可能にする
- 修正前の値を無言で破壊せず`superseded`へ遷移させる
- resetされたsession由来の観測を`invalidated`として集計対象から外す
- 自由記述本文を不要に複製しない
- 記録失敗で予定作成・承認・実績更新を失敗させない
- profileが後から全観測を再計算できる情報を保持する
- explicit user settingと観測値を同じeventとして扱わない

## 完了条件

- [ ] 計画作成時の特徴をversion付きplanning observationとして保存できる
- [ ] 承認済みPlanとplanning observationを安定したIDで関連付けられる
- [ ] 実績更新からoutcome observationを関連付けられる
- [ ] retryで同じobservation / outcomeを重複作成しない
- [ ] 計画修正で旧観測を`superseded`にできる
- [ ] session resetを関連観測の`invalidated`へ伝播できる
- [ ] schema versionを必須にする
- [ ] 後続profile計算が会話本文なしで再現できる
- [ ] 不要なraw textを保存しない
- [ ] 観測保存失敗を主要操作の失敗へ昇格させない
- [ ] account deletionと180日TTLの対象として削除できる
- [ ] fixtureから同じ入力を再生すると同じ観測IDと内容へ収束する

## 対象外

- profile集計
- 半減期の決定
- placement score
- contextual bandit
- 系列モデル
- user-facing分析dashboard
