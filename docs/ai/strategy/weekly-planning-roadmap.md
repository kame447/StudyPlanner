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
| conversation trace | implemented | privacy product decision recorded / production TTL・deletion・access control・scalability未実装 |

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
   - rotating HMAC subject token、本文sampling/redaction、content 30日、metadata 90日のTTL、account deletion、限定admin accessを実装・検証する。
   - privacy/legal reviewをdeploy前条件として残す。

4. `20260716-weekly-planning-approval-persistence-and-idempotency.md`
   - localStorageを越えたmulti-device、multi-tab、partial retryの重複保存防止を設計する。

### P2

5. `20260716-weekly-planning-trace-scalability-and-schema-migration.md`
   - pagination、query cost、index、archive、schemaVersion decoderを設計する。

6. `20260716-weekly-planning-controller-ui-responsibility-split.md`
   - conversation controller、preview controller、view componentへ責務を分離する。
   - entrypoint ownership taskの結果とPR #5の状態を先に確認する。

完了済みのPR #3関連task、conversation trace実装task、cross-cutting trackerは`docs/ai/tasks/closed/`のcompletion recordへ統合済みである。

## 4. Decision gates

未決定事項は、決定時にproduct spec、architecture、test contract、AI prompt、runtime testを同じ変更で同期する。

### 4.1 AIとdeterministic parserの責務

現在の実装は、legacy fallbackを含まないdeterministic baselineを先に適用し、AI commandを補完的に適用する。一方、一部canonical文書は通常provider経路でsemantic resultをmergeしないと記載する。

次のどちらを正とするか決定する。

- deterministic baseline + AI補完
- AI single semantic interpreter + deterministic normalization / validation only

決定前は`weekly-planning-current-contract-status.md`の読み方に従い、旧文書だけを根拠にruntimeを変更しない。

### 4.2 「来週」の意味論

次のどちらをproduct contractとするか決定する。

- 翌週月曜から日曜へ一意解決し、開始日を再質問しない
- `来週`scopeを保持し、その週の開始日を必要に応じて確認する

決定前は`P6-RANGE-RESOLUTION-001`を固定pass/fail条件にしない。

### 4.3 conversation trace privacy — decision recorded

2026-07-16に次を決定した。

- 毎conversationの同意ではなく、初回利用時の利用規約・privacy noticeと設定画面で説明・停止を扱う。
- raw user IDを保存せず、server-side rotating HMAC subject tokenを使用する。
- 暗号化を匿名化の代替として扱わない。
- structured metadataを基本とし、本文は調査価値の高いsessionと少量sampleへ限定する。
- 保存前redactionを適用する。
- redacted本文とstate snapshotは30日、metadataは90日、unlinkable aggregateだけ最大12か月保持する。
- account deletion、利用者からの削除要求、限定admin access、閲覧auditを実装する。

詳細は`20260716-weekly-planning-trace-privacy-and-lifecycle.md`を正とする。production enablementは実装・運用・privacy/legal review完了後に判定する。

## 5. Deferred backlog

次はactive root taskへまだ昇格させない。実コードを再調査し、単一の責務と受け入れ条件を持てる場合だけtask化する。

- generic progress unit（page、word、problem、report stage等）
- recurring life profileと明示同意つき永続化
- actual resultによるestimate補正
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
