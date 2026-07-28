# 週間計画personalization rollout

Status: active / foundation implemented, observation pipeline not started
Priority: P2 after cloud session boundary
Created: 2026-07-28
Tracking: Issue #47
Depends on:
- `20260716-weekly-planning-synced-conversation-session-store.md`
- `20260716-weekly-planning-midweek-current-time-start-boundary.md`

Supersedes:
- `superseded/20260716-weekly-planning-consultation-reset-and-invalidation.md`
- `superseded/20260716-weekly-planning-history-feature-extraction.md`
- `superseded/20260716-weekly-planning-longitudinal-personalization-data-governance.md`
- `superseded/20260716-weekly-planning-user-profile-time-decay.md`
- `superseded/20260716-weekly-planning-personalized-placement-scoring.md`

## 1. 現在地

実装済みfoundation:

- account-linked personalization profile schema
- week start設定
- origin、confidence、scope、confirmedAt、expiresAt
- explicit settingの保存・復元・reset
- v1からv2 profileへの読み替え
- bounded placement parameter schema
- quality trace、conversation session、approval ledgerとのrepository分離
- 一時的な相談条件をlongitudinal profileへ自動昇格しない境界

未実装:

- planning/outcome observation repository
- source session resetからobservation validityへの伝播
- active observationだけを用いた再計算可能aggregate
- time decay、不確実性、effective sample information
- safe candidateの順位だけを変えるpersonalized score
- account deletion、TTL、同意、訂正、auditのproduction operation

## 2. 実装順序

### Phase P1: observation contract

- deterministic observation ID
- source session、Plan、draft block、scheduler policy versionへの参照
- schema version
- `active | invalidated | superseded`
- planning estimate、actual duration、completion、delay、interruption、reschedule
- raw conversation本文を複製しない
- retryで同一observationへ収束

### Phase P2: reset propagation

- cloud session reset operationと同じidempotent operationでsource observationをinvalidatedへ遷移
- 承認済みPlanと完了済みactualは勝手に削除しない
- stale async resultまたはstale observation writeを拒否
- 別週・別sessionへ伝播しない

### Phase P3: aggregate profile

- active observationだけを入力にする
- invalidated/supersededを除外
- feature別のversion付きtime decay
- 観測数、有効重み、不確実性、lastObservedAt
- explicit settingを推定値で上書きしない
- 同じ入力集合とversionから同じprofileへ収束

### Phase P4: placement scoring

```text
hard constraints
→ safe candidates
→ existing heuristic
→ personalized contribution
→ uncertainty/risk penalty
→ final ordering
```

- 候補生成件数とhard constraint判定を変えない
- profile不足・破損・計算失敗時は既存heuristic順へ戻す
- current-time、fixed plan、sleep、unavailableをscore前に除外
- feature/weight/score versionとstructured reasonを保持

### Phase P5: production governance

- version付きconsent/notice acceptance
- observation・source historyの180日TTL
- account deletion cascade
- profile訂正とreset
- access audit、least privilege、sensitive free textの非保持
- Emulatorとproduction checklist

## 3. 完了条件

- [ ] observation schema/repositoryとidempotent writeを実装
- [ ] Plan/actualからobservationを生成
- [ ] session resetをvalidityへ原子的に伝播
- [ ] invalidated/supersededを集計しない
- [ ] aggregateを全observationから再計算可能にする
- [ ] time decayと不確実性をversion付きで保持
- [ ] explicit settingを保護する
- [ ] score無効時に現行scheduler結果が変わらない
- [ ] hard constraint violationを増やさない
- [ ] offline walk-forward評価を実行
- [ ] consent、TTL、account deletion、auditを検証
- [ ] focused/full/typecheck/build/diff checkがgreen
- [ ] 実browserとmulti-client確認を完了

## 4. 対象外

- hard constraintの学習化
- contextual bandit
- online exploration
- RNN/Transformerによるend-to-end scheduler置換
- quality trace本文を直接profile入力にすること