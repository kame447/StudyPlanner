# 週間計画 汎用意味モデル Stable V5 ロードマップ

Status: canonical / active post-runtime-integration queue
最終更新: 2026-07-31

- [Runtime trial contract](../weekly-planning-stable-v5-runtime-trial-contract.md)
- [Current contract](../weekly-planning-current-contract-v5.md)
- [Current status](../weekly-planning-current-contract-status.md)
- [Active-task inventory](../audits/20260731-weekly-planning-active-task-inventory.md)
- [Semantic handoff audit](../audits/20260731-weekly-planning-semantic-state-handoff-seven-audit.md)
- [Verification/cutover task](../tasks/20260731-weekly-planning-stable-v5-verification-and-cutover.md)

## 1. 到達済みruntime

```text
自然文
→ Stable V5 AI Semantic Normalizer
→ strict validation / max one repair
→ SemanticDocument V5
→ lifecycle canonicalizer / Fact Graph V5
→ active read view
→ generic scheduler input
→ deterministic dialogue / preview
→ AI renderer
→ existing approval / Plan save
```

Feature flagで既存UIへ接続済み。Graph更新はrequest単位にstageし、PlanningState commit受理後だけfinalizeする。

## 2. 2026-07-31 semantic handoff finding

従来はshort answerの質問種別をAI rendererが生成した日本語文面の部分一致から推定していた。また、既存Factへの回答を直接表すschemaがなく、minimal taskを生成してquestion code別binderで再結合していた。

PR #107で次を実装中:

- `publicStateSummary.pendingQuestion`をauthoritative machine stateにする
- question code、target fact、graph revisionを保持
- renderer文面をsemantic bindingへ使用しない
- exact target workloadへshort answerを適用
- renderer responseへ`actionId`、`actionKind`、`questionCode`を要求
- `明日`planningWindow omissionを一度だけrepair

## 3. Gate status

### V5-A: schema/document generation

Status: runtime connected / coverage incomplete

完了:

- generic task/component/workload/effort/temporal/recurrence/relation
- availability、fixed commitment、source request
- provider failure fail closed、parser fallback禁止

残件:

- generic semantic turn delta
- evidence coverage registry
- actual AI real-eval

### V5-B: Fact Graph lifecycle/transaction

Status: runtime connected / generic update incomplete

完了:

- active/superseded/removed lifecycle
- formal IDs/revision/diff
- staged Graph、active scheduler view
- planningWindow single-active enforcement
- exact target quantity/effort short-answer binding（PR #107、検証待ち）

残件:

- add/update/remove/uncertainty resolutionのgeneric lifecycle applier
- dependent fact batch termination
- cloud Graph repository
- migration decoder

### V5-C: dialogue/scheduler

Status: runtime connected / typed renderer contract in draft

完了:

- deterministic blocking issue/question policy
- create authorization、preview gate、partial preview禁止
- renderer contextとtrace persistence

残件:

- PR #107 typed action contract verification
- current-time hard boundary
- browser roleplay
- external source production adapter

### V5-D: application/persistence

Status: local persistence connected

残件:

- cross-tab sequence
- cloud/cross-device repository
- offline reconciliation
- final trace durable delivery

### V5-E: quality trace

Status: implementation verified / production verification pending

残件:

- Issue #89 same-conversation verification
- production secret/TTL/Rules/Worker
- pagination/versioned decoder

### V5-F-I

- external source: pure loader complete / production adapter pending
- real-eval/shadow: harness exists / actual execution pending
- migration: design only
- default cutover/legacy deletion: not started

## 4. Current execution order

```text
PR #107 focused/full verification
→ current-time hard boundary
→ actual AI real-eval
→ browser roleplay
→ generic semantic turn delta / coverage
→ external source production verification
→ migration / shadow / rollback
→ default cutover
```

## 5. Current active records

- [current-time boundary](../tasks/20260731-weekly-planning-midweek-current-time-start-boundary.md)
- [verification/migration/cutover](../tasks/20260731-weekly-planning-stable-v5-verification-and-cutover.md)
- [runtime followups](../tasks/20260731-weekly-planning-runtime-followups.md)
- [cloud session store](../tasks/20260731-weekly-planning-synced-conversation-session-store.md)
- [external source adapter](../tasks/20260731-weekly-planning-external-source-production-adapter.md)
- [trace operations](../tasks/20260731-weekly-planning-trace-privacy-and-lifecycle.md)

## 6. Default cutover禁止条件

- renderer textからquestion/targetを推定する経路が残る
- parser fallbackが存在する
- Graph/PlanningState commitが非原子的
- current-time boundary未実装
- trace split/loss再発
- actual AI/browser未実施
- migration/rollback未検証
- unresolved blocker/major finding

完了foundationはclosed、別trackerへ吸収した旧work unitはsuperseded、rootには現在の独立taskだけを置く。