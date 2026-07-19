# 週間計画 AI ロードマップ

Status: canonical / active
最終更新: 2026-07-19
Current implementation baseline: `34c6744fefbc9b7f34bce36b97d47da4a86bf264`

- Current contract status: [weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
- PR #5 post-merge status: [weekly-planning-pr5-post-merge-status.md](../weekly-planning-pr5-post-merge-status.md)
- Approval stream completion: [20260716-weekly-planning-approval-persistence-and-idempotency.md](../tasks/closed/20260716-weekly-planning-approval-persistence-and-idempotency.md)
- Approval operational rollout: [20260718-weekly-planning-approval-operational-rollout.md](../tasks/20260718-weekly-planning-approval-operational-rollout.md)
- Personalization foundation completion: [20260718-weekly-planning-personalization-foundation.md](../tasks/closed/20260718-weekly-planning-personalization-foundation.md)
- Personalization design: [weekly-planning-personalization-history-and-optimization-design.md](weekly-planning-personalization-history-and-optimization-design.md)
- Architecture: [weekly-planning-dialogue-architecture-v4.md](../../architecture/weekly-planning-dialogue-architecture-v4.md)
- Product spec: [weekly-planning-spec.md](../../weekly-planning/weekly-planning-spec.md)
- Test scenarios: [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md)
- Test coverage status: [weekly-planning-roleplay-status.md](../../testing/weekly-planning-roleplay-status.md)
- Documentation index: [weekly-planning-docs-index.md](../weekly-planning-docs-index.md)

## 1. Statusの読み方

次の状態を同一視しない。

```text
module implemented
→ production connected
→ automated verified
→ browser verified
→ operationally deployed
```

PR本文や過去のcompletion recordに記録されたテスト成功は、その時点のheadに対する記録である。現在の`main`、実ブラウザ、本番Firestore設定へ自動的に継承しない。

## 2. 現在の実装基盤

### 2.1 対話・preview・承認

次は`main`へ実装済みである。

- deterministic baselineとAI semantic補完の属性単位merge
- 明示的修復、やり過ごし、grounded acknowledgement
- planning range pending contract
- session-owned preview lifecycle
- closed storage validation
- request ownershipとstale result拒否
- approval専用保存境界
- browser reload後の復元仮予定の再計算要求
- user-boundary storage
- server transactionを正本とするapproval idempotency

残る作業は、実ブラウザでのclose/reopen、reload、IME、focus、reset、週切替、複数tab・複数端末相当の確認と、本番Firestore rules・TTL・Emulatorの運用検証である。

### 2.2 conversation trace

quality traceのcode実装と自動検証は完了している。本番secret、TTL、rules/Worker deploy、account deletion、限定閲覧、audit、privacy/legal reviewは未完了である。

### 2.3 長期個別最適化

PR #48は2026-07-18に`main`へmerge済みであり、次の基盤を実装した。

- version付きaccount-linked personalization profile
- profile factのorigin、confidence、scope、confirmedAt、expiresAt
- 月曜始まり／日曜始まりの初回選択
- 保存済み週始まりの「今週」「来週」解釈への反映
- 明示的な日付・曜日指定の優先
- 設定画面からの変更とprofile reset
- conversation traceとは別のrepository、collection、Firestore権限
- 一時的な相談条件を自動的に長期profileへ昇格しない境界

これはpersonalization foundationの完了を意味する。次は未実装であり、PR #48の完了範囲へ含めない。

- 週途中の現在時刻境界
- 週sessionのクラウド同期と競合処理
- 相談resetと派生観測の無効化
- plan／actualからのversion付き観測記録
- 見積り補正、session長、時間帯傾向の集計
- 時間減衰、不確実性、既定値への縮約
- 個人別placement score
- 同意version、TTL、削除cascade、admin audit、privacy/legal review

## 3. Current queue

`docs/ai/tasks/`直下には未完了taskだけを置く。個別最適化は基盤実装と学習pipelineを一つの巨大taskへ戻さず、依存順に分離する。

### P0: scheduler safety boundary

1. `20260716-weekly-planning-midweek-current-time-start-boundary.md`
   - 明示開始がない今週計画で、現在時刻より前へ候補を生成しない。
   - request単位の`currentDateTime`とplanning horizon開始境界を確立する。

### P1: production boundary / data governance

2. `20260716-weekly-planning-entrypoint-request-ownership.md`
   - controller/envelope実装後のbrowser verificationを完了する。

3. `20260716-weekly-planning-trace-privacy-and-lifecycle.md`
   - traceの本番設定、TTL、削除、限定閲覧、audit、privacy/legal reviewを完了する。

4. `20260716-weekly-planning-longitudinal-personalization-data-governance.md`
   - PR #48で完了したprofile基盤を前提に、同意、保持、訂正、削除、権限、監査、本番運用を完了する。
   - 学習観測、集計、scoreの実装は後続taskへ委譲する。

5. `20260718-weekly-planning-approval-operational-rollout.md`
   - 本番Firestore rules、operation/item TTL、Emulator、multi-client確認を完了する。

6. `20260716-weekly-planning-synced-conversation-session-store.md`
   - 週単位sessionをクラウド正本へ移行し、別端末復元、revision競合、offline cache、legacy migrationを実装する。

7. `20260716-weekly-planning-consultation-reset-and-invalidation.md`
   - session store確立後に、相談resetと未承認仮予定・派生観測の無効化を原子的に実装する。

### P2: observation and maintainability

8. `20260716-weekly-planning-history-feature-extraction.md`
   - 計画・承認・実績を、会話本文なしで再集計できるversion付き観測へ変換する。

9. `20260716-weekly-planning-trace-scalability-and-schema-migration.md`
   - pagination、query cost、index、archive、schema decoderを設計する。

10. `20260716-weekly-planning-controller-ui-responsibility-split.md`
    - conversation controller、preview controller、view componentへ責務を分離する。

### P3: profile aggregation

11. `20260716-weekly-planning-user-profile-time-decay.md`
    - 有効な観測だけから、時間減衰、観測数、不確実性を持つ再計算可能profileを構築する。

### P4: personalized selection

12. `20260716-weekly-planning-personalized-placement-scoring.md`
    - hard constraints通過後の安全な候補だけを個人別scoreで並べ替える。
    - profile不足または計算失敗時は現行heuristicへ戻す。

## 4. 個別最適化の実装順序

```text
PR #48 profile foundation: complete
  ↓
P0 current-time start boundary
  ↓
P1 synced weekly session store
  ↓
P1 consultation reset / invalidation
  ↓
P2 planning and outcome observations
  ↓
P3 decayed profile aggregation
  ↓
P4 personalized placement score
```

同意・保持・削除・権限・監査は上記pipelineと並行してP1で進める。ただし、同意前にprofileまたはaccount-linked観測を作成しない。

contextual bandit、オンライン探索、RNN、Transformer、rewardのオンライン更新はこのqueueへ含めない。説明可能な統計集計とoffline比較が成立し、観測biasと安全評価を扱える段階で別途decision gateを設ける。

## 5. Decision gates

### 5.1 AIとdeterministic parser — decided / implemented

- deterministic baselineを先に適用する。
- AIはsemantic補完を担当する。
- mergeはclosed attribute contractとruntime validatorを通す。
- previewを止める高影響の不確実性だけを確認する。
- accepted stateに根拠がある事項だけをacknowledgeする。

旧`single interpreter / no merge`はcurrent contractではない。

### 5.2 週の始まり — decided / foundation implemented

- 初回だけ月曜始まりまたは日曜始まりを確認する。
- account-linked profileへ保存する。
- 以後の「今週」「来週」は保存設定に従う。
- 今回発話の具体的な日付・曜日範囲をprofileより優先する。
- 未設定、破損、競合時だけ明示的修復へ入る。

PR #48でmodule実装、production接続、自動検証まで完了した。本番運用、同意、削除、監査はP1 taskに残る。

### 5.3 個別最適化データ — decided / operational work incomplete

- quality traceとaccount-linked profileを別schema、repository、identity、権限で管理する。
- current-week factをrecurring profileへ無断昇格しない。
- profile factはorigin、confidence、scope、confirmedAt、必要に応じてexpiresAtを持つ。
- 原会話をそのままprofileとして参照しない。
- 医療等の詳細は必要な生活制約へ一般化し、不要な自由記述を長期保持しない。
- 明示的な利用者設定は推定値より優先する。
- 推定値は観測数と不確実性が不足する場合に既定値へ戻す。

### 5.4 Approval idempotency — implemented / rollout incomplete

- server transactionをduplicate判定の正本とする。
- operation、item、Planを原子的に保存する。
- deterministic Plan IDで同一itemを一件へ収束させる。
- identity不一致はfail closedとする。
- operation/item双方をTTL対象とする。

本番rules、TTL、Emulator、multi-client確認が完了するまでoperationally deployedとしない。

## 6. Safety boundaries

- AIはstate、readiness、available minutes、hard constraint、scheduler、save、approve、deleteを決定しない。
- user textとAI outputはtyped candidateとruntime validatorを通す。
- previewはexplicit authorizationとreadiness gate通過後だけ生成する。
- previewはexplicit UI approvalまで保存しない。
- fixed event、timetable、buffer、hard busy intervalを上書きしない。
- 現在より前、利用不可時間、睡眠・最低休息違反の候補をscore前に除外する。
- current-week factをrecurring profileへ無断昇格しない。
- trace documentを直接longitudinal profileとして参照しない。
- resetまたはsupersedeされた観測をprofile集計へ含めない。
- 明示的設定を推定値で黙って上書きしない。
- profile不足またはscore失敗時は現行heuristicへ戻す。
- selected week変更、session reset、explicit cancel、revision不一致後のstale resultをstateへ適用しない。
- trace、観測、profileの保存失敗を計画作成成功の必須条件にしない。

## 7. Task operation

- task rootには未完了taskだけを置く。
- 一taskは一つの主原因、責務境界、完了条件を持つ。
- 完了した実装範囲は`docs/ai/tasks/closed/`のcompletion recordへ移す。
- broad parent Issueは進捗の索引として使い、実装責務はtask mdへ分離する。
- `implemented`、`production connected`、`automated verified`、`browser verified`、`operationally deployed`を区別する。
- PR本文のtest結果を現在`main`へ自動継承しない。
- historical / closed / superseded文書をcurrent instructionとして直接実行しない。
