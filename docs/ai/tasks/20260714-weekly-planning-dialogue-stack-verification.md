# weeklyPlanning dialogue stack verification on `main`

Status: **ready / verification only**
Priority: highest
Target branch: `main`
Production code change: prohibited
Test code change: prohibited
Git add / commit / push: prohibited

## Purpose

`main`に存在するDA1b、approval、DA2、DA3a、DA3b、DA3cのmoduleと接続状態について、compile、test、build、production entrypoint、browser behaviorを検証する。

moduleが存在すること、unit testが通ること、production entrypointへ接続されていること、browserで契約が成立することを別々に判定する。失敗時はコードを変更せず、原因と再現情報だけを報告する。

## Phase 1: repository state

最初に次を確認する。

```sh
git branch --show-current
git status -sb
git log -1 --oneline
```

- branchが`main`でない場合は切り替えず、実際のbranchを報告して停止する。
- working treeに差分がある場合は、差分を変更せず報告する。
- 本task開始時のHEADを最終報告へ残す。

## Phase 2: targeted tests

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

## Phase 3: full validation

```bash
npx tsc --noEmit
npm run build
npm test -- --run
git diff --check
git status -sb
```

Use Node 20 or later. Do not modify`node_modules`、lockfile、repository configuration merely to change the runtime.

## Phase 4: production entrypoint inspection

次を静的に確認する。module単体の存在やtestだけで接続済みと判定しない。

- `NaturalLanguageAssistant`または実際の週間計画UI entrypointがrequest orchestratorを利用しているか。
- request envelopeにconversation、turn、request、state revision、対象週が含まれるか。
- stale resultをstate、history、status、previewへ適用しないか。
- reset、close、unmountでactive requestを無効化するか。
- active request中の二重送信を防ぐか。
- keyboard policyが実際のtextareaとsubmit処理へ接続されているか。
- approval pathは`App.tsx`の実保存境界へ接続されているか。

未接続または部分接続の場合は、対象fileと不足する不変条件を報告する。修正は行わない。

## Phase 5: manual/browser scenarios

### Behavior-aware preview

1. Vague goal does not generate preview.
2. Deadline、workload、life anchors are accepted separately.
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

### Request ownership and UI policy

1. Active request prevents a second pipeline request.
2. Selected weekの変更後に旧resultを適用しない。
3. Reset、close、unmount後に旧resultを適用しない。
4. IME composition does not submit.
5. Enter inserts a newline.
6. Ctrl/Meta+Enter submits once.
7. Focus returns after completion/failure.
8. retry creates a new request/turn identity.

### Feasibility/evaluation

1. Required minutes equal scheduled plus unscheduled.
2. Options are deterministic IDs.
3. AI text does not recalculate values.
4. Requirement matrix has no missing or duplicate ID.
5. Replay output redacts prompt/token/API-key-like fields.

## Result classification

各項目を次で分類する。

```text
module implemented
automated verification passed
production connected
browser verified
not verified
failed
```

一つの`complete`へ丸めない。

## Report format

- branch、HEAD、initial working tree
- targeted test result
- TypeScript result
- build result
- full test result
- production entrypoint inspection
- browser result by scenario
- classification matrix
- failures with file、test/scenario、expected、actual、stack traceまたは再現手順
- files changed: none
- final `git status -sb`

Do not fix failures in this task. 不具合が見つかった場合は、一つの原因と責務境界を持つ別task候補として報告する。
