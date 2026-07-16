# 週間計画 AI ロードマップ

Status: **canonical / active**
最終更新: 2026-07-16

- Architecture: [weekly-planning-dialogue-architecture-v4.md](../../architecture/weekly-planning-dialogue-architecture-v4.md)
- Product spec: [weekly-planning-spec.md](../../weekly-planning/weekly-planning-spec.md)
- Test contract: [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md)
- Documentation index: [weekly-planning-docs-index.md](../weekly-planning-docs-index.md)

## 1. Verified baseline

次はローカル自動検証済みである。

| item | status |
| --- | --- |
| Gate P4 | complete |
| DA0a assumption proposal foundation | complete |
| DA0r behavior-aware readiness | complete |
| minimal behavior derivation | complete |
| DA0 non-exam preview bridge | complete |
| DA1 allowed action / response contract | complete |
| authorization / availability / deadline hardening | complete |
| preview metadata preservation | complete |
| behavior-aware entrypoint connection | complete |
| test architecture refactor | complete |

Baseline validation:

- targeted tests: 8 files / 38 tests passed
- full tests: 62 files / 825 tests passed
- TypeScript: passed
- build: passed
- diff check: passed
- browser roleplay: automation environment interruptionにより未完了

## 2. Implemented modules on `main`

次のmoduleとcontractは`main`に存在する。ただし、module実装、production entrypoint接続、自動検証、browser検証を同じ意味で扱わない。

| item | module status | remaining verification |
| --- | --- | --- |
| DA1b assumption decision and correction | implemented | local integration / browser |
| Draft approval idempotency | implemented and App approval path connected | local integration / retry scenario |
| DA2 request orchestrator and UI policy | implemented | actual assistant entrypoint connection / browser race and IME |
| DA3a relative constraint domain | implemented | local integration |
| DA3b feasibility consultation | implemented | local integration / roleplay |
| DA3c conversation evaluation | implemented | local full validation / requirement status sync |
| conversation trace | implemented | production TTL / privacy / lifecycle decision |

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

1. `20260714-weekly-planning-dialogue-stack-verification.md`
   - `main`を対象に、targeted tests、TypeScript、build、full testsを実行する。
   - moduleの存在だけでなく、production entrypoint、stale result、IME、reset、unmountを確認する。
   - 失敗時はこのtask内で修正せず、再現情報を別taskへ切り出す。

2. `20260715-weekly-planning-cross-cutting-risks.md`
   - entrypoint ownership、trace privacy/lifecycle、approval persistence、trace scalability、controller責務を分割するための調査taskである。
   - 複数責務を一つのproduction変更として実装しない。

完了済みのPR #3関連taskとconversation trace実装taskは、`docs/ai/tasks/closed/`のcompletion recordへ統合済みである。

## 4. Decision gates

次は単純な整理では決められない。決定前にproduct spec、architecture、test contract、AI promptを一括で同期する。

### 4.1 AIとdeterministic parserの責務

現在の実装は、legacy fallbackを含まないdeterministic baselineを先に適用し、AI commandを補完的に適用する。一方、一部canonical文書は通常provider経路でsemantic resultをmergeしないと記載する。

次のどちらを正とするか決定する。

- deterministic baseline + AI補完
- AI single semantic interpreter + deterministic normalization / validation only

### 4.2 「来週」の意味論

次のどちらをproduct contractとするか決定する。

- 翌週月曜から日曜へ一意解決し、開始日を再質問しない
- 来週scopeを保持し、その週の開始曜日を確認する

### 4.3 conversation trace privacy

次を決定する。

- productionでopt-inにするか
- 発話全文を保存するか
- turn本文へ保存前redactionを適用するか
- retention、account deletion、admin accessをどう説明するか

## 5. Long-term direction

次は新しいtaskを切る前に実コードを再調査する。

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
- trace pagination、archive、schema migration

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

## 7. Task operation

- task rootには未完了taskだけを置く。
- 実装結果は`docs/ai/tasks/closed/`のcompletion recordへ統合する。
- `implemented`、`production connected`、`automated verified`、`browser verified`を区別する。
- 検証前にfully completeと記載しない。
- 新taskはarchitecture、roadmap、roleplay requirement matrixと同期する。
- historical / closed / superseded文書をcurrent instructionとして直接実行しない。
