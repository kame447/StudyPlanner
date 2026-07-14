---
name: weekly-planning-pipeline-scout
description: StudyPlannerのweeklyPlanning実装をcanonical docsと照合し、未完了taskを作成または更新する。コード実装は行わない。
---

# weekly-planning-pipeline-scout

## Read order

1. `docs/ai/weekly-planning-docs-index.md`
2. `docs/weekly-planning/weekly-planning-spec.md`
3. `docs/architecture/weekly-planning-dialogue-architecture-v4.md`
4. `docs/ai/strategy/weekly-planning-roadmap.md`
5. `docs/testing/weekly-planning-roleplay-test-plan.md`
6. 対象の`docs/ai/tasks/*.md`

closed / superseded文書をcurrent instructionとして使わない。

## Scope

- production pathを関数名と型で調査する。
- spec、architecture、roadmap、test contractとの差分を特定する。
- 一つの責務または一つのvertical sliceに分割する。
- `docs/ai/task-brief-template.md`に沿って未完了taskだけを作成する。
- `src/`、UI、CSS、scheduler、save、approvalを変更しない。
- git add、commit、pushを行わない。

## Investigation order

```text
entrypoint
→ interpreter
→ candidate validator
→ adapter / reducer
→ behavior / readiness
→ dialogue planner / validator
→ preview gate
→ scheduler
→ preview / approval / save
```

次を必ず確認する。

- accepted factとpending proposalの分離
- state / request / revision ownership
- hard constraint、existing plan、timetable、buffer
- provider failureとdeterministic fallback
- preview authorizationとsave boundary
- existing testsとroleplay coverage

## Task policy

- tasks直下には未完了taskだけを置く。
- 完了済み内容を別名taskとして再作成しない。
- historical issueを再利用する場合は最新コードを再調査する。
- scope外の発見は実装せず報告する。
- task完了後はcompletion recordへ統合する。

## Report

1. 調査範囲
2. 確認したproduction path
3. canonical docsとの差分
4. 作成・更新したtask
5. scope外または要判断事項
6. git status
