# 週間計画 AI ロードマップ

Status: **canonical / active**
最終更新: 2026-07-14

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
| actual entrypoint connection | complete |
| test architecture refactor | complete |

Baseline validation:

- targeted tests: 8 files / 38 tests passed
- full tests: 62 files / 825 tests passed
- TypeScript: passed
- build: passed
- diff check: passed
- browser roleplay: automation environment interruptionにより未完了

## 2. Implemented stack awaiting local verification

`feat/weekly-planning-dialogue-stack-completion`へ次を実装した。

| item | implementation status |
| --- | --- |
| DA1b assumption decision and correction | implemented |
| Draft approval idempotency | implemented |
| DA2 request orchestrator and UI policy | implemented |
| DA3a relative constraint domain | implemented |
| DA3b feasibility consultation | implemented |
| DA3c conversation evaluation | implemented |

含まれる主な契約:

- assumption accept / reject / modifyとproposal audit history
- correctionのatomic apply、決定的順序、proposal resolution
- canonical `assistant_suggested`
- common authorization command type
- save-boundary stale/pending guard
- item ledger、partial retry、duplicate save抑止
- request / turn / revision ownership
- IME、multiline、focus、Tab、retry policy
- relative anchor validationとabsolute interval解決
- deterministic feasibility値とoption ID
- requirement matrix、redaction、metrics、property tests

## 3. Current queue

production implementation taskは残っていない。`docs/ai/tasks/`直下の次の検証taskだけがcurrent queueである。

1. `20260714-weekly-planning-dialogue-stack-verification.md`

検証ではコードを変更せず、targeted tests、TypeScript、build、full tests、diff check、browser/manual scenarioを実行する。失敗は原因と再現情報だけを報告し、修正は別のGitHub-side commitとして行う。

## 4. Long-term direction

次は新しいtaskを切る前に実コードを再調査する。

- generic progress unit（page、word、problem、report stage等）
- recurring life profileと明示同意つき永続化
- actual resultによるestimate補正
- deterministic replanning trigger
- scheduler二系統の整理
- legacy fallback縮小
- dead message state / unreachable branchの整理
- opportunity annotationのplacement score高度化

## 5. Safety boundaries

- AIはstate、readiness、available minutes、hard constraint、scheduler、save、approve、deleteを決定しない。
- user textはtyped candidateとvalidatorを通す。
- previewはexplicit authorizationとreadiness gate通過後だけ生成する。
- previewはexplicit UI approvalまで保存しない。
- behavior annotationとrelative constraintでavailabilityを増やさない。
- existing plan、timetable、buffer、hard busy intervalを上書きしない。
- current-week factをrecurring profileへ無断昇格しない。
- stale async resultをstateへ適用しない。
- stale/pending preview approvalでrepository writeを開始しない。

## 6. Task operation

- task rootには未完了taskだけを置く。
- 実装結果は`docs/ai/tasks/closed/`のcompletion recordへ統合する。
- 検証前にfully completeと記載しない。
- 新taskはarchitecture、roadmap、roleplay requirement matrixと同期する。
