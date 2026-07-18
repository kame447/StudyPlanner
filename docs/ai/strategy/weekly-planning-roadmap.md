# 週間計画 AI ロードマップ

Status: canonical / active
最終更新: 2026-07-18
Current implementation baseline: `fe0dc86af264ab339e81b2191b333b4ef2a779b0`

- Current contract status: [weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
- PR #5 post-merge status: [weekly-planning-pr5-post-merge-status.md](../weekly-planning-pr5-post-merge-status.md)
- Approval stream completion: [20260716-weekly-planning-approval-persistence-and-idempotency.md](../tasks/closed/20260716-weekly-planning-approval-persistence-and-idempotency.md)
- Approval operational rollout: [20260718-weekly-planning-approval-operational-rollout.md](../tasks/20260718-weekly-planning-approval-operational-rollout.md)
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

これらは記録時点の結果であり、browser verifiedまたはoperationally deployedを意味しない。

### 1.3 PR #24 / #26 recorded validation

PR #24は期間短答と`日曜日まで`の終了境界契約、PR #26は漢数字絶対日付と曜日誤認を修正した。各PRでfocused regression、週間計画suite、full tests、TypeScript、production build、diff checkが成功している。

### 1.4 Current main dialogue-stack verification

`main` `2af1a5e`をGitHub Actions run `29582279740`で再検証した。

- targeted dialogue-stack tests: 48 files / 423 tests passed、1 file / 1 test skipped
- full tests: 109 files / 1118 tests passed、1 file / 13 tests skipped、5 todo
- TypeScript: passed
- production build: passed
- diff check: passed

production entrypointの静的確認ではsession、preview、storage、approvalが接続済みである。request ownershipの実装後もbrowser roleplayは未検証であり、entrypoint taskへ残す。

### 1.5 Approval stream recorded validation

2026-07-18にPR #54〜#60、#62、#63をmainへmergeした。

- PR #54: application behavior test harness
- PR #55: validation session binding
- PR #56: save side-effect isolation
- PR #57: in-flight interruption
- PR #58: restored draft lifecycle
- PR #59: user-boundary storage guard
- PR #60: structured Plan provenance
- PR #62: server transaction idempotency
- PR #63: operation/item retention boundary

GitHub Actions runs `29642637792`、`29644307045`、`29645304800`、`29645775829`、`29646646819`、`29648193062`、`29649806549`、`29650224824`で、対象PRのfull tests、TypeScript、production build、diff checkが成功している。

これはimplemented / production connected / automated verifiedを意味する。本番Firestore rules deploy、TTL policy、Emulator、multi-client実環境確認が完了するまではoperationally deployedとしない。

## 2. Implemented modules and contracts on `main`

次のmoduleとcontractは`main`に存在する。ただし、module実装、production entrypoint接続、自動検証、browser検証、production運用を同じ意味で扱わない。

| item | module / connection status | remaining verification / decision |
| --- | --- | --- |
| PR #5 conversation/session hardening | merged to `main` | browser close-resume、IME、focus |
| deterministic baseline + AI semantic補完 | merged to `main` | long-form spec/architecture/test planの旧no-merge記述同期 |
| explicit repair / pass-over / grounded acknowledgement | merged to `main` | browser roleplay、real-model rubric |
| contextual fixed-event question | merged to `main` | browser rendering、range edge cases |
| planning range pending contract | PR #26までmerged / automated verified | week-start profile、browser roleplay |
| session-owned preview lifecycle | merged / automated verified | browser close-resume、reload表示確認 |
| closed storage validation | merged | current main round-trip再実行 |
| approval application harness | merged / automated verified | browser multi-client scenario |
| approval validation and save boundary | merged / automated verified | production rollout |
| approval interruption and restored-draft lifecycle | merged / automated verified | browser reset/reload scenario |
| approval user-boundary storage | merged / automated verified | legacy migration実環境確認 |
| approval server idempotency | merged / automated verified | rules deploy、TTL、Emulator、multi-client実環境確認 |
| DA2 request orchestrator and UI policy | implemented | browser race and IME |
| DA3a relative constraint domain | implemented | local integration |
| DA3b feasibility consultation | implemented | local integration / roleplay |
| DA3c conversation evaluation | implemented | local full validation / requirement status sync |
| conversation trace | implemented | production privacy rollout、scalability |
| longitudinal personalization profile | active draft PR | validation、merge、operational rollout |

## 3. Current queue

`docs/ai/tasks/`直下には未完了または追加確認が必要なtaskだけを置く。現在のroot taskは6件である。

### P1

1. `20260716-weekly-planning-entrypoint-request-ownership.md`
   - controller/envelope実装と自動検証は完了し、browser verificationが残る。
   - modal close/presentation unmountをsession cancelとして扱わない。

2. `20260716-weekly-planning-trace-privacy-and-lifecycle.md`
   - code実装後の本番設定、TTL、削除、限定閲覧、privacy/legal reviewを完了する。

3. `20260716-weekly-planning-longitudinal-personalization-data-governance.md`
   - active draft PR #48を現行application境界へ統合し、検証・review・merge・運用確認を完了する。

4. `20260718-weekly-planning-approval-operational-rollout.md`
   - 本番Firestore rules deploy、operation/item双方のTTL policy、Emulator rules/transaction、multi-client実環境確認を完了する。

### P2

5. `20260716-weekly-planning-trace-scalability-and-schema-migration.md`
   - pagination、query cost、index、archive、schemaVersion decoderを設計する。

6. `20260716-weekly-planning-controller-ui-responsibility-split.md`
   - conversation controller、preview controller、view componentへ責務を分離する。

承認applicationの実装順序は完了済みである。今後の承認streamでは`approval operational rollout`だけをactive taskとして扱い、完了記録から実装taskを再開しない。

## 4. Decision gates

決定済みcontractは`weekly-planning-current-contract-status.md`を正とし、product spec、architecture、test contract、AI prompt、runtime testを順次同期する。

### 4.1 AIとdeterministic parserの責務 — decided and implemented

2026-07-16に次を決定し、PR #5で`main`へ実装した。

- deterministic baseline + AI semantic補完を採用する。
- 高信頼でないAI解釈は、影響と質問コストに応じて明示的修復またはやり過ごしへ分類する。
- previewを止める不確実性だけを一度に一件確認する。
- accepted stateに根拠がある事項だけを短い反復でacknowledgeする。

product spec、architecture、roleplay test planに残る`single interpreter / no merge`はhistorical contractであり、current implementation指示として使用しない。

### 4.2 「来週」と週の始まり — decision recorded / profile not merged

- 初回だけ月曜始まりまたは日曜始まりを確認する。
- 選択をaccount-linked personalization profileへ保存する。
- 以後の「今週」「来週」は保存設定に従って一意解決する。
- 今回発話の具体的な日付・曜日範囲をprofile設定より優先する。
- profileが未設定、破損、競合している場合だけ明示的修復へ入る。

active draft PR #48は未mergeであり、現行mainの完了機能として扱わない。

### 4.3 conversation trace privacy — implementation merged / rollout incomplete

- quality traceとaccount-linked personalization profileを別schema、別repository、別権限で管理する。
- traceではraw user IDを保存せず、server-side rotating HMAC subject tokenを使用する。
- 全sessionのredacted本文、state snapshot、structured metadataを180日保持する。
- account deletion、限定admin access、閲覧auditを実装する。

code実装はPR #46でmerge済みである。本番設定、TTL、削除、限定閲覧、privacy/legal reviewはactive taskに残る。

### 4.4 longitudinal personalization data — decision recorded / active draft

- 長期個別最適化データの収集・利用を週間計画機能の中核契約とする。
- 必要な情報だけをorigin、confidence、scope、confirmedAt付きprofile factへ昇格する。
- 構造化profileはアカウント存続中保持する。
- traceをそのままprofileへ転用せず、専用profile update boundaryを通す。
- 医療等の要配慮情報を含む自由記述は必要な生活制約へ一般化する。

### 4.5 reload後のbehavior-aware仮予定 — implemented / automated verified

- modal close/reopenは同一sessionのpresentation lifecycleとして扱う。
- browser reload後は復元されたbehavior-aware仮予定をそのまま承認しない。
- 復元案は参考表示し、最新条件での再計算を明示する。
- approval domainのfail-closed guardを維持する。
- legacy metadataなしblockの互換経路を維持する。

PR #58で実装・自動検証済みである。実ブラウザ確認はentrypoint verificationに残る。

### 4.6 approval persistent idempotency — implemented / rollout incomplete

- Planへ構造化provenanceを保存する。
- server transactionをduplicate判定の正本とする。
- operation、item、Planを原子的に保存する。
- deterministic Plan IDで同一itemの同時保存を一件へ収束させる。
- progress消失時はdurable provenanceから復旧する。
- itemとPlanの不整合はfail closedとする。
- operation/item双方を180日TTL対象とする。

PR #60、#62、#63で実装・自動検証済みである。operational rollout task完了前は本番保証としない。

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
- 同一approval itemのduplicate判定はserver transactionを正本とする。
- operation/item/Planのidentity不一致はfail closedとする。
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