# 週間計画 AI ロードマップ

Status: canonical / active
最終更新: 2026-07-17
Current main baseline: `10c40296dc6655343d4d36d04ceb63abb9c07f8e`

- Current contract status: [weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
- PR #5 post-merge status: [weekly-planning-pr5-post-merge-status.md](../weekly-planning-pr5-post-merge-status.md)
- PR #24 completion record: [20260717-weekly-planning-period-short-answer-and-sunday-boundary.md](../tasks/closed/20260717-weekly-planning-period-short-answer-and-sunday-boundary.md)
- PR #26 completion record: [20260717-weekly-planning-kanji-absolute-date-guard.md](../tasks/closed/20260717-weekly-planning-kanji-absolute-date-guard.md)
- Current main verification: [20260714-weekly-planning-dialogue-stack-verification.md](../tasks/closed/20260714-weekly-planning-dialogue-stack-verification.md)
- Architecture: [weekly-planning-dialogue-architecture-v4.md](../../architecture/weekly-planning-dialogue-architecture-v4.md)
- Product spec: [weekly-planning-spec.md](../../weekly-planning/weekly-planning-spec.md)
- Test scenarios: [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md)
- Test coverage status: [weekly-planning-roleplay-status.md](../../testing/weekly-planning-roleplay-status.md)
- Documentation index: [weekly-planning-docs-index.md](../weekly-planning-docs-index.md)

## 1. Verified baseline

### 1.1 Historical dialogue-stack baseline

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

Historical recorded validation:

- targeted tests: 8 files / 38 tests passed
- full tests: 62 files / 825 tests passed
- TypeScript: passed
- build: passed
- diff check: passed
- browser roleplay: automation environment interruptionにより未完了

### 1.2 PR #5 recorded validation

PR #5最終head `052d7f0`には次の記録がある。

- `git diff --check origin/main...HEAD`: passed
- 104 test files passed、1 skipped
- 1003 tests passed、13 skipped、5 todo
- production build: passed
- 既知警告: dynamic/static import重複、500kB超chunk

PR #5は2026-07-17にsquash mergeされ、`main` merge commitは`55f8e32`である。

これらは記録時点の結果であり、現在`main` HEADを別環境で再実行したこと、browser verified、operationally deployedを意味しない。

### 1.3 PR #24 recorded validation

PR #24は2026-07-17にsquash mergeされ、`main` merge commitは`bb39e96`である。Issue #23の期間短答再質問ループと、`日曜日まで`の終了境界契約を修正した。

GitHub Actions run `29577182656`でPR merge refを対象に次を実行し、すべて成功した。

- `npm ci`: passed
- `git diff --check origin/main...HEAD`: passed
- focused regression: passed
- `src/features/weeklyPlanning` suite: passed
- full tests: passed
- production build: passed

一時検証workflowは検証後に削除した。Cloudflare Pages deployもsquash merge前の最終branch headで成功した。これはautomated verifiedを意味するが、browser verifiedまたは自然言語入力の完全網羅を意味しない。

### 1.4 PR #26 recorded validation

PR #26は2026-07-17にsquash mergeされ、`main` merge commitは`10c4029`である。Issue #21の漢数字絶対日付と曜日の誤認を修正した。

GitHub Actions run `29581399006`で実装適用後のworktreeを対象に次を実行し、すべて成功した。

- `npm ci`: passed
- `git diff --check`: passed
- focused regression: 19 passed
- `src/features/weeklyPlanning` suite: passed
- full tests: passed
- production build: passed

検証済みworktreeからhelperを除去して実装commitを作成し、最終branch headのCloudflare Pages deployも成功した。automated verifiedであり、browser verifiedを意味しない。

### 1.5 Current main dialogue-stack verification

`main` `2af1a5e`をGitHub Actions run `29582279740`で再検証した。

- targeted dialogue-stack tests: 48 files / 423 tests passed、1 file / 1 test skipped
- full tests: 109 files / 1118 tests passed、1 file / 13 tests skipped、5 todo
- TypeScript: passed
- production build: passed
- diff check: passed

production entrypointの静的確認ではsession/preview/storage/approvalは接続済みである。request ownershipはpartialであり、conversation/turn identity、explicit cancel、clear-conversation UI、keyboard/IME/focusは未接続である。browser roleplayは未検証であり、entrypoint ownership taskへ引き継ぐ。

## 2. Implemented modules and contracts on `main`

次のmoduleとcontractは`main`に存在する。ただし、module実装、production entrypoint接続、自動検証、browser検証、production運用を同じ意味で扱わない。

| item | module / connection status | remaining verification / decision |
| --- | --- | --- |
| PR #5 conversation/session hardening | merged to `main` | merge後main再検証、browser close-resume、IME、focus |
| deterministic baseline + AI semantic補完 | merged to `main` | long-form spec/architecture/test planの旧no-merge記述同期 |
| explicit repair / pass-over / grounded acknowledgement | merged to `main` | browser roleplay、real-model rubric |
| contextual fixed-event question | merged to `main` | browser rendering、range edge cases |
| planning range pending contract | PR #26までmerged / automated verified | week-start profile、browser roleplay |
| session-owned preview lifecycle | merged to `main` | browser close-resume、reload semantics |
| closed storage validation | merged to `main` | current main round-trip再実行 |
| DA1b assumption decision and correction | implemented | local integration / browser |
| Draft approval idempotency | implemented and App approval path connected | retry / persistent multi-device design |
| DA2 request orchestrator and UI policy | implemented | controller ownership統一 / browser race and IME |
| DA3a relative constraint domain | implemented | local integration |
| DA3b feasibility consultation | implemented | local integration / roleplay |
| DA3c conversation evaluation | implemented | local full validation / requirement status sync |
| conversation trace | implemented | production privacy、TTL、deletion、access control、scalability |
| longitudinal personalization profile | not implemented | schema、profile update、correction、deletion、terms gate |

PR #5で追加・強化された主なcontract:

- messagesとintake stateのsession ownership
- modal close後のconversation/preview再開
- preview candidateのstate ownership、個別削除、全破棄、draft昇格
- request ID、対象週、base revision guard
- pending turn / approval中のnon-terminal mutation拒否
- deterministic exam scopeとAI属性補完
- single-field priority自動導出
- known fixed-event groundingと跨日event抽出
- explicit repair、pass-over、grounded acknowledgement
- optional null canonicalizationとclosed command validation
- pending planning rangeのscope/start/duration分離
- closed storage validatorとlegacy/v2 sanitize
- save-boundary stale/pending guard
- item ledger、partial retry、duplicate save抑止
- relative anchor validationとabsolute interval解決
- deterministic feasibility値とoption ID
- requirement matrix、redaction、metrics、property tests

PR #24で追加・強化されたplanning range contract:

- active `planning_period` questionに対する`今週`、`来週`、`週末`の自然な短答受理
- `日曜日まで`の終了境界だけをpendingへ保持する状態
- `今すぐ`、相対時間、今日・明日、月日、曜日、時刻による任意開始日時
- 開始と終了が揃った時点でのcanonical range昇格
- 終了後開始候補、引用、例文、第三者発話、教材・説明文脈の拒否
- 片側date window、runtime validator、AI candidate validator、storage復元のclosed contract統一

## 3. Current queue

`docs/ai/tasks/`直下には、未完了または追加確認が必要なtaskだけを置く。現在のqueueは次である。

### P1

1. `20260716-weekly-planning-entrypoint-request-ownership.md`
   - conversation、turn、request、revision、selected week、reset、explicit cancel、retryのownershipをproduction controllerへ統一する。
   - modal close/presentation unmountをsession cancelとして扱わない。

2. `20260716-weekly-planning-trace-privacy-and-lifecycle.md`
   - rotating HMAC subject token、全session本文の保存前redaction、本文・snapshot・metadataの180日TTL、account deletion、限定admin accessを実装・検証する。
   - privacy/legal reviewをdeploy前条件として残す。

3. `20260716-weekly-planning-longitudinal-personalization-data-governance.md`
   - account-linked profile schema、profile factのorigin/confidence/scope、原履歴180日TTL、profile訂正、account deletion、初回acceptance gateを実装する。
   - 週の始まり、学習時間見積り、session構成、修正傾向、実績差、修復方針を次回計画へ反映する。

4. `20260716-weekly-planning-approval-persistence-and-idempotency.md`
   - localStorageを越えたmulti-device、multi-tab、partial retryの重複保存防止を設計する。

### P2

5. `20260716-weekly-planning-trace-scalability-and-schema-migration.md`
   - pagination、query cost、index、archive、schemaVersion decoderを設計する。

6. `20260716-weekly-planning-controller-ui-responsibility-split.md`
   - conversation controller、preview controller、view componentへ責務を分離する。
   - PR #5 post-merge stateとentrypoint ownership taskの結果を前提にする。

構造監査の全項目は`weekly-planning-pr5-post-merge-status.md`と`tasks/closed/20260717-codebase-maintainability-review.md`を参照する。個別実装へ進める際は、一つの主原因と受け入れ条件を持つtaskへ分ける。

## 4. Decision gates

決定済みcontractは`weekly-planning-current-contract-status.md`を正とし、product spec、architecture、test contract、AI prompt、runtime testを順次同期する。

### 4.1 AIとdeterministic parserの責務 — decided and implemented

2026-07-16に次を決定し、PR #5で`main`へ実装した。

- deterministic baseline + AI semantic補完を採用する。
- 高信頼でないAI解釈は、影響と質問コストに応じて明示的修復またはやり過ごしへ分類する。
- previewを止める不確実性だけを一度に一件確認する。
- accepted stateに根拠がある事項だけを短い反復でacknowledgeする。

product spec、architecture、roleplay test planに残る`single interpreter / no merge`はhistorical contractであり、current implementation指示として使用しない。

### 4.2 「来週」と週の始まり — decision recorded / profile not implemented

2026-07-16に次を決定した。

- 初回だけ月曜始まりまたは日曜始まりを確認する。
- 選択をaccount-linked personalization profileへ保存する。
- 以後の「今週」「来週」は保存設定に従って一意解決する。
- 今回発話の具体的な日付・曜日範囲をprofile設定より優先する。
- profileが未設定、破損、競合している場合だけ明示的修復へ入る。

profile schemaとprofile-based range resolutionは未実装である。現在`main`はPR #24までのpending planning range契約を使用する。漢数字絶対日付の誤認はP0 taskで修正する。

### 4.3 conversation trace privacy — decision recorded / production controls not implemented

2026-07-16に次を決定した。

- 毎conversationの同意ではなく、初回利用前の利用規約・privacy noticeで収集目的、必須性、保持期間、削除方法を説明する。
- quality traceとaccount-linked personalization profileを別schema、別repository、別権限で管理する。
- traceではraw user IDを保存せず、server-side rotating HMAC subject tokenを使用する。
- 暗号化を匿名化の代替として扱わない。
- 全sessionのredacted本文、state snapshot、structured metadataを180日保持する。
- unlinkable aggregateだけ最大24か月保持する。
- account deletion、限定admin access、閲覧auditを実装する。

詳細は`20260716-weekly-planning-trace-privacy-and-lifecycle.md`を正とする。

### 4.4 longitudinal personalization data — decision recorded / not implemented

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
- lint、format、feature boundary、cycle、bundle budget
- test architectureとtask metadataの再編

mutation testingは`20260716-weekly-planning-mutation-testing-deferred.md`へ履歴化し、current queueから除外した。

## 6. Safety boundaries

- AIはstate、readiness、available minutes、hard constraint、scheduler、save、approve、deleteを決定しない。
- user textとAI outputはtyped candidateとruntime validatorを通す。
- deterministic baselineとAI補完のmergeはclosed attribute contractを通す。
- previewはexplicit authorizationとreadiness gate通過後だけ生成する。
- previewはexplicit UI approvalまで保存しない。
- behavior annotationとrelative constraintでavailabilityを増やさない。
- existing plan、timetable、buffer、hard busy intervalを上書きしない。
- current-week factをrecurring profileへ無断昇格しない。
- profile factはorigin、confidence、scope、confirmedAtを持つ。
- trace documentを直接longitudinal profileとして参照しない。
- selected week変更、session reset、explicit cancel、revision不一致後のstale async resultをstateへ適用しない。
- modal closeまたはpresentation unmountだけで有効session resultを失わない。
- stale/pending preview approvalでrepository writeを開始しない。
- trace保存はplanning処理の成功条件にしない。
- client生成traceを監査、課金、security判定の根拠にしない。

## 7. Task operation

- task rootには未完了taskだけを置く。
- 一taskは一つの主原因、責務境界、完了条件を持つ。
- 実装結果は`docs/ai/tasks/closed/`のcompletion recordへ統合する。
- `implemented`、`production connected`、`automated verified`、`browser verified`、`operationally deployed`を区別する。
- PR本文のtest結果を現在`main`へ自動継承しない。
- 新taskはcurrent contract、post-merge status、roadmap、roleplay statusと同期する。
- historical / closed / superseded文書をcurrent instructionとして直接実行しない。
