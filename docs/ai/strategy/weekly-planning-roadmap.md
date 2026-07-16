# 週間計画 AI ロードマップ

Status: canonical / active
最終更新: 2026-07-16

- Current contract status: [weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
- Architecture: [weekly-planning-dialogue-architecture-v4.md](../../architecture/weekly-planning-dialogue-architecture-v4.md)
- Product spec: [weekly-planning-spec.md](../../weekly-planning/weekly-planning-spec.md)
- Test scenarios: [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md)
- Test coverage status: [weekly-planning-roleplay-status.md](../../testing/weekly-planning-roleplay-status.md)
- Documentation index: [weekly-planning-docs-index.md](../weekly-planning-docs-index.md)

## 1. Verified baseline

次は記録済みのローカル自動検証を持つ。

| item | status |
| --- | --- |
| Gate P4 | complete historical gate |
| DA0a assumption proposal foundation | complete |
| DA0r behavior-aware readiness | complete |
| minimal behavior derivation | complete |
| DA0 non-exam preview bridge | complete |
| DA1 allowed action / response contract | complete |
| authorization / availability / deadline hardening | complete |
| preview metadata preservation | complete |
| behavior-aware entrypoint connection | complete |
| test architecture refactor | complete |

Recorded baseline validation:

- targeted tests: 8 files / 38 tests passed
- full tests: 62 files / 825 tests passed
- TypeScript: passed
- build: passed
- diff check: passed
- browser roleplay: automation environment interruptionにより未完了

これは記録時点の結果であり、現在の`main` HEADに対する再実行を意味しない。

## 2. Implemented modules on `main`

次のmoduleとcontractは`main`に存在する。ただし、module実装、production entrypoint接続、自動検証、browser検証、production運用を同じ意味で扱わない。

| item | module status | remaining verification / decision |
| --- | --- | --- |
| DA1b assumption decision and correction | implemented | local integration / browser |
| Draft approval idempotency | implemented and App approval path connected | local integration / retry / persistent multi-device design |
| DA2 request orchestrator and UI policy | implemented | actual assistant entrypoint connection / browser race and IME |
| DA3a relative constraint domain | implemented | local integration |
| DA3b feasibility consultation | implemented | local integration / roleplay |
| DA3c conversation evaluation | implemented | local full validation / requirement status sync |
| conversation trace | implemented | privacy decision recorded / production TTL・deletion・access control・scalability未実装 |
| longitudinal personalization profile | not implemented | product decision recorded / schema・profile update・correction・deletion・terms gate未実装 |

含まれる主なcontract:

- assumption accept / reject / modifyとproposal audit history
- correctionのatomic apply、決定的順序、proposal resolution
- canonical `assistant_suggested`
- common authorization command type
- save-boundary stale/pending guard
- item ledger、partial retry、duplicate save抑止
- request / turn / revision ownership module
- IME、multiline、focus、Tab、retry policy module
- relative anchor validationとabsolute interval解決
- deterministic feasibility値とoption ID
- requirement matrix、redaction、metrics、property tests

## 3. Current queue

`docs/ai/tasks/`直下には、未完了または追加確認が必要なtaskだけを置く。現在のqueueは次である。

### P1

1. `20260714-weekly-planning-dialogue-stack-verification.md`
   - current `main`でtargeted tests、TypeScript、build、full tests、production entrypoint、browser behaviorを再分類する。
   - 失敗時はtask内で修正せず、原因と再現情報を別taskへ切り出す。

2. `20260716-weekly-planning-entrypoint-request-ownership.md`
   - conversation、turn、request、revision、selected week、reset/close/unmountのownershipをproduction entrypointへ統一する。

3. `20260716-weekly-planning-trace-privacy-and-lifecycle.md`
   - product decisionは記録済み。
   - rotating HMAC subject token、全session本文の保存前redaction、本文・snapshot・metadataの180日TTL、account deletion、限定admin accessを実装・検証する。
   - privacy/legal reviewをdeploy前条件として残す。

4. `20260716-weekly-planning-longitudinal-personalization-data-governance.md`
   - account-linked profile schema、profile factのorigin/confidence/scope、原履歴180日TTL、profile訂正、account deletion、初回acceptance gateを実装する。
   - 週の始まり、学習時間見積り、session構成、修正傾向、実績差、修復方針を次回計画へ反映する。
   - 個別最適化データの収集を週間計画機能の利用条件とし、収集だけを停止した継続利用modeは設けない。

5. `20260716-weekly-planning-approval-persistence-and-idempotency.md`
   - localStorageを越えたmulti-device、multi-tab、partial retryの重複保存防止を設計する。

### P2

6. `20260716-weekly-planning-trace-scalability-and-schema-migration.md`
   - pagination、query cost、index、archive、schemaVersion decoderを設計する。

7. `20260716-weekly-planning-controller-ui-responsibility-split.md`
   - conversation controller、preview controller、view componentへ責務を分離する。
   - entrypoint ownership taskの結果とPR #5の状態を先に確認する。

完了済みのPR #3関連task、conversation trace実装task、cross-cutting trackerは`docs/ai/tasks/closed/`のcompletion recordへ統合済みである。

## 4. Decision gates

決定済みcontractは`weekly-planning-current-contract-status.md`を正とし、product spec、architecture、test contract、AI prompt、runtime testを順次同期する。

### 4.1 AIとdeterministic parserの責務 — decision recorded

2026-07-16に次を決定した。

- deterministic baseline + AI semantic補完を採用する。
- 高信頼でないAI解釈は、影響と質問コストに応じて明示的修復またはやり過ごしへ分類する。
- previewを止める不確実性だけを一度に一件確認する。
- accepted stateに根拠がある事項だけを短い反復でacknowledgeする。

明示的修復・やり過ごし・grounded acknowledgementの実装はPR #5にあり、merge前は`main`実装済みと扱わない。

### 4.2 「来週」と週の始まり — decision recorded

2026-07-16に次を決定した。

- 初回だけ月曜始まりまたは日曜始まりを確認する。
- 選択をaccount-linked personalization profileへ保存する。
- 以後の「今週」「来週」は保存設定に従って一意解決する。
- 今回発話の具体的な日付・曜日範囲をprofile設定より優先する。
- profileが未設定、破損、競合している場合だけ明示的修復へ入る。

profile schemaとrange resolutionは未実装である。

### 4.3 conversation trace privacy — decision recorded

2026-07-16に次を決定した。

- 毎conversationの同意ではなく、初回利用前の利用規約・privacy noticeで収集目的、必須性、保持期間、削除方法を説明する。
- quality traceとaccount-linked personalization profileを別schema、別repository、別権限で管理する。
- traceではraw user IDを保存せず、server-side rotating HMAC subject tokenを使用する。
- 暗号化を匿名化の代替として扱わない。
- 全sessionのredacted本文、state snapshot、structured metadataを180日保持する。
- unlinkable aggregateだけ最大24か月保持する。
- account deletion、限定admin access、閲覧auditを実装する。

詳細は`20260716-weekly-planning-trace-privacy-and-lifecycle.md`を正とする。

### 4.4 longitudinal personalization data — decision recorded

2026-07-16に次を決定した。

- 長期個別最適化データの収集・利用を週間計画機能の中核契約とする。
- 収集を拒否したまま同じ週間計画機能を利用するmodeは提供しない。
- user / assistant本文とstate snapshotは180日保持する。
- 必要な情報だけをorigin、confidence、scope、confirmedAt付きprofile factへ昇格する。
- 構造化profileはアカウント存続中保持する。
- account deletion後はprimary storageから30日以内、backupから最大90日以内に消去する。
- traceをそのままprofileへ転用せず、専用profile update boundaryを通す。
- 医療等の要配慮情報を含む自由記述は不要な詳細を長期保持せず、必要な生活制約へ一般化する。

詳細は`20260716-weekly-planning-longitudinal-personalization-data-governance.md`を正とする。

## 5. Deferred backlog

次はactive root taskへまだ昇格させない。実コードを再調査し、単一の責務と受け入れ条件を持てる場合だけtask化する。

- generic progress unit（page、word、problem、report stage等）
- deterministic replanning trigger
- scheduler二系統の整理
- legacy fallback semanticsとretirement条件
- command schema / runtime validator / scheduler boundaryの網羅性
- scheduler capacity policyとatomic split permission dialogue
- 時刻不定の生活制約
- dead message state / unreachable branch / renderer不要callの整理
- opportunity annotationのplacement score高度化

mutation testingは`20260716-weekly-planning-mutation-testing-deferred.md`へ履歴化し、current queueから除外した。

## 6. Safety boundaries

- AIはstate、readiness、available minutes、hard constraint、scheduler、save、approve、deleteを決定しない。
- user textとAI outputはtyped candidateとruntime validatorを通す。
- previewはexplicit authorizationとreadiness gate通過後だけ生成する。
- previewはexplicit UI approvalまで保存しない。
- behavior annotationとrelative constraintでavailabilityを増やさない。
- existing plan、timetable、buffer、hard busy intervalを上書きしない。
- current-week factをrecurring profileへ無断昇格しない。
- profile factはorigin、confidence、scope、confirmedAtを持つ。
- trace documentを直接longitudinal profileとして参照しない。
- stale async resultをstateへ適用しない。
- stale/pending preview approvalでrepository writeを開始しない。
- trace保存はplanning処理の成功条件にしない。
- client生成traceを監査、課金、security判定の根拠にしない。

## 7. Task operation

- task rootには未完了taskだけを置く。
- 一taskは一つの主原因、責務境界、完了条件を持つ。
- 実装結果は`docs/ai/tasks/closed/`のcompletion recordへ統合する。
- `implemented`、`production connected`、`automated verified`、`browser verified`、`operationally deployed`を区別する。
- 検証前にfully completeと記載しない。
- 新taskはarchitecture、roadmap、roleplay statusと同期する。
- historical / closed / superseded文書をcurrent instructionとして直接実行しない。
