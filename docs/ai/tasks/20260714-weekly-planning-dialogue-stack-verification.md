# weeklyPlanning dialogue stack local verification

Status: **ready / verification only**
Priority: highest
Branch: `feat/weekly-planning-dialogue-stack-completion`
Production code change: prohibited
Test code change: prohibited
Git add / commit / push: prohibited

## Purpose

DA1b、approval、DA2、DA3a、DA3b、DA3cを統合した実装について、ローカル環境でcompile、test、build、browser behaviorを検証する。失敗時はコードを変更せず、原因と再現情報だけを報告する。

## Targeted tests

```bash
npx vitest run \
  src/features/weeklyPlanning/planning/weeklyPlanningAssumptionLifecycle.test.ts \
  src/features/weeklyPlanning/intake/weeklyPlanningLifecycleInterpreter.test.ts \
  src/features/weeklyPlanning/planning/weeklyPlanningApproval.test.ts \
  src/features/weeklyPlanning/planning/weeklyPlanningApprovalLegacy.test.ts \
  src/features/weeklyPlanning/planning/weeklyPlanningApprovalAssumption.test.ts \
  src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueOrchestrator.test.ts \
  src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueUiPolicy.test.ts \
  src/features/weeklyPlanning/pipeline/weeklyPlanningDialogueTurnPipeline.test.ts \
  src/features/weeklyPlanning/planning/weeklyPlanningRelativeConstraints.test.ts \
  src/features/weeklyPlanning/planning/weeklyPlanningRelativeConstraintAdapter.test.ts \
  src/features/weeklyPlanning/planning/weeklyPlanningFeasibility.test.ts \
  src/features/weeklyPlanning/testing/weeklyPlanningConversationEvaluation.test.ts \
  src/features/weeklyPlanning/planning/weeklyPlanningDialogueStackProperties.test.ts \
  src/features/weeklyPlanning/__tests__/weeklyPlanningDialogueStackIntegration.test.ts \
  src/features/weeklyPlanning/__tests__/weeklyPlanningBehaviorAwareRoleplay.test.ts
```

## Full validation

```bash
npx tsc --noEmit
npm run build
npm test -- --run
git diff --check
git status -sb
```

Use Node 20 or later. Do not modify `node_modules`, lockfiles or repository configuration merely to change the runtime.

## Manual/browser scenarios

### Behavior-aware preview

1. Vague goal does not generate preview.
2. Deadline, workload and life anchors are accepted separately.
3. Assistant suggestion does not generate preview.
4. Explicit user authorization generates the first preview.
5. Relative commute/buffer does not overlap the anchor or hard plans.

### Assumption lifecycle

1. A pending duration proposal can be explicitly accepted.
2. Reject does not delete proposal history.
3. Modify supersedes the old proposal and creates a replacement.
4. Task correction preserves unrelated tasks.
5. Stale proposal decision is rejected.

### Approval

1. Current eligible preview saves.
2. Pending-assumption preview is rejected before save.
3. Stale preview is rejected before save.
4. Repeated approval does not create a duplicate plan.
5. One failed item can be retried without resaving completed items.
6. Existing exam draft approval still works.

### DA2

1. Active request prevents a second pipeline request.
2. Reset or close makes the old result stale.
3. IME composition does not submit.
4. Enter inserts a newline.
5. Ctrl/Meta+Enter submits once.
6. Focus returns after completion/failure.

### Feasibility/evaluation

1. Required minutes equal scheduled plus unscheduled.
2. Options are deterministic IDs.
3. AI text does not recalculate values.
4. Requirement matrix has no missing or duplicate ID.
5. Replay output redacts prompt/token/API-key-like fields.

## Report format

- branch and latest commit
- targeted test result
- TypeScript result
- build result
- full test result
- diff check and final status
- browser result by scenario
- failures with test name, expected/actual and stack trace
- files changed: none

Do not fix failures in this task.
