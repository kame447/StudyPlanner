# 週間計画 AI ロードマップ

Status: **canonical / active**
最終更新: 2026-07-14

- Architecture: [weekly-planning-dialogue-architecture-v4.md](../../architecture/weekly-planning-dialogue-architecture-v4.md)
- Product spec: [weekly-planning-spec.md](../../weekly-planning/weekly-planning-spec.md)
- Test contract: [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md)
- Documentation index: [weekly-planning-docs-index.md](../weekly-planning-docs-index.md)

## 1. Current status

次は実装・自動検証済みである。

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

検証結果:

- targeted tests: 8 files / 38 tests passed
- full tests: 62 files / 825 tests passed
- TypeScript: passed
- build: passed
- diff check: passed
- browser roleplay: automation environment interruptionにより未完了

## 2. Open implementation queue

`docs/ai/tasks/`直下の未完了taskだけが実行queueの正である。

| order | task | dependency | main purpose |
| --- | --- | --- | --- |
| 1 | DA1b assumption decision and correction contract | DA1 | accept / reject / modify、correctionとproposal lifecycle |
| 2 | Draft approval idempotency | DA1b | stale/pending guard、item ledger、duplicate save防止 |
| 3 | DA2 state-grounded dialogue orchestrator | approval | request ownership、duplicate submit、cancel/reset/IME |
| 4 | DA3a relative constraint domain | DA2 | relative range / constraintのtyped domain |
| 5 | DA3b feasibility consultation | DA3a | deterministic feasibilityと修正option |
| 6 | DA3c conversation evaluation | DA3b | roleplay/rubric/evaluation運用 |

一度に一件だけopenし、完了後はtask直下から`closed`へ移すか、統合completion recordへ置き換える。

## 3. Next-task integration notes

### DA1bへ統合するもの

- `assistant_suggested`のcanonical transition
- assumption accept / reject / modify
- correction適用と関連proposalのsupersede / expire
- authorization commandの共通command registry統合
- preview dependency再評価

### Approval taskへ統合するもの

- stale preview approval rejection
- pending-assumption preview approval rejection
- userId + sourceDraftBlockId idempotency
- partial failure / retry / duplicate save guard

### DA2以降へ統合するもの

- active request / requestId / turnId / stateRevision ownership
- double submit、button + keyboard重複、cancel、reset、unmount
- manual browser roleplay
- opportunity annotationのplacement score活用
- feasibility説明と選択肢

## 4. Long-term direction

次はtask化前に再調査する。旧phase名や旧backlog文書から直接実装を開始しない。

- generic progress unit（page、word、problem、report stage等）
- recurring life profileと明示同意つき永続化
- actual resultによるestimate補正
- deterministic replanning trigger
- scheduler二系統の整理
- legacy fallback縮小
- dead message state / unreachable branchの整理

## 5. Safety boundaries

- AIはstate、readiness、available minutes、hard constraint、scheduler、save、approve、deleteを決定しない。
- user textはtyped candidateとvalidatorを通す。
- previewはexplicit authorizationとreadiness gate通過後だけ生成する。
- previewはexplicit UI approvalまで保存しない。
- behavior annotationでavailabilityを増やさない。
- existing plan、timetable、buffer、hard busy intervalを上書きしない。
- current-week factをrecurring profileへ無断昇格しない。
- stale async resultをstateへ適用しない。

## 6. Task operation

新しいtask mdには最低限次を含める。

- Status / Priority / Requirement IDs
- Dependencies / Entry / Exit
- current production path
- exact type / state transition / validator
- failure / stale / persistence / security
- non-goals
- acceptance criteria
- targeted test / full test / build command

実装完了後は、task rootへ完了済みmdを残さない。必要な記録は`docs/ai/tasks/closed/`のcompletion recordとgit historyへ集約する。
