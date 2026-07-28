# 週間計画 汎用意味モデル Stable V5 ロードマップ

Status: canonical / active post-runtime-integration queue
最終更新: 2026-07-28

- [Runtime trial contract](../weekly-planning-stable-v5-runtime-trial-contract.md)
- [Current contract](../weekly-planning-current-contract-v5.md)
- [Implementation status](weekly-planning-semantic-stable-v5-implementation-status.md)
- [Migration plan](weekly-planning-semantic-stable-v5-migration-plan.md)
- [Active-task inventory](../audits/20260728-weekly-planning-active-task-inventory.md)
- [Verification/cutover task](../tasks/20260728-weekly-planning-stable-v5-verification-and-cutover.md)
- [Trace empty-session completion](../tasks/closed/20260727-weekly-planning-trace-empty-session-recovery.md)

## 1. 到達済みruntime

```text
自然文
→ Stable V5 AI Semantic Normalizer
→ strict runtime validation / max one repair
→ WeeklyPlanningSemanticDocumentV5
→ direct lifecycle canonicalizer
→ WeeklyPlanningFactGraphV5
→ active fact read view
→ generic scheduler input
→ deterministic readiness / dialogue / preview scheduler
→ existing preview / approval / Plan save
```

Feature flagで既存UIへ接続済み。browser内ではconversation、PlanningState、Fact Graph、preview、draftを一体復元する。Graph更新はrequest単位にstageし、PlanningState commit受理後だけfinalizeする。default runtimeはlegacyである。

## 2. Gate status

### V5-A: schema/document generation

Status: complete

- Stable semantic document、JSON Schema、validator、normalizer
- generic task/component/workload/effort/temporal/recurrence/relation
- availability、fixed commitment、source request
- non-consecutive date、weekday set、task date eligibility
- provider failure fail closed、parser fallback禁止

Remaining adoption check:

- actual AI real-eval

### V5-B: Fact Graph lifecycle/transaction

Status: runtime connected

- active/superseded/removed lifecycle
- formal IDs/revision/diff
- request-scoped staged Graph
- active read viewとscheduler input
- correction/decision transaction modules

Remaining:

- proposal decisionのproduction ledger適用
- dependent fact batch termination
- cloud/server Graph repository
- old-state migration decoder

### V5-C: dialogue/scheduler

Status: runtime connected

- deterministic missing priority/question policy
- explicit create authorization
- accepted fact diff
- preview gate
- existing plan/timetable/fixed commitment/availability
- task date eligibility
- partial preview禁止
- insufficient capacity atomic rejection

Remaining:

- request時刻より前へ配置しないhard boundary
- accepted fact acknowledgement grounding
- full browser roleplay
- external source production adapter

### V5-D: application/persistence

Status: local persistence connected

- conversation/Graph/messages/preview/draft local envelope
- owner/week/conversation/revision validation
- request/turn/controller sequence recovery
- clear conversationとreset sessionの分離
- stale async result discard
- application lifecycle/turn/side-effect separation

Remaining:

- cross-tab sequence coordination
- cloud/cross-device repository
- offline conflict/reconciliation
- final trace durable outbox

### V5-E: quality trace

Status: implementation and automated verification complete / post-merge browser verification pending

Completed:

- frontend/Worker event catalog drift修正
- debug document/string/token limits整合
- request entry/byte batching
- zero-count identity persistence
- server handle reuse after failed append
- empty artifactの未export除外
- focused 46 tests passed
- trace full 79 tests passed
- typecheck、typecheck:build、production build、diff check passed

Remaining:

- main deploy後のsame-conversation admin viewer確認
- Issue #89 close判断
- production secret/TTL/Rules/Worker rollout

### V5-F: external source

Status: pure loader complete / production adapter pending

- atomic success/failure
- empty success区別
- bounded retry
- partial result非公開
- owner/shape validation

Remaining:

- production calendar adapter
- pagination/auth/metrics
- browser verification

### V5-G: real-eval/shadow

Status: harness exists / Stable V5 actual execution pending

Remaining:

- production schemaによるactual AI eval
- date、short answer、correction、availability、source、authorization、preview coverage
- sampling/timeout/retention/privacy gate
- read-only production shadow invocation

### V5-H: persisted migration

Status: design documented / implementation not started

- versioned old envelope decoder
- deterministic migration input
- idempotent atomic persist
- dry-run report
- rollback fixture

raw conversationをAIへ再投入してSemanticDocumentを作り直さない。

### V5-I: default cutover/legacy deletion

Status: not started

- cutover rehearsal
- rollback verification
- default runtime decision
- observation period
- legacy runtime dependency deletion

## 3. Current execution order

```text
current-time hard boundary
→ Stable V5 actual AI real-eval
→ browser roleplay
→ external source production adapter verification
→ accepted-fact grounding
→ old-state migration/dry-run
→ read-only shadow
→ rollback rehearsal
→ default cutover decision
→ observation period
→ legacy deletion
```

Cloud path:

```text
cloud conversation/Graph repository
→ cross-device conflict handling
→ proposal/observation persistence
→ personalization rollout
```

Parallel production operation:

```text
trace production deploy + Issue #89 post-merge verification
```

## 4. Current active records

Semantic V5 streamで参照するroot task:

- [current-time boundary](../tasks/20260716-weekly-planning-midweek-current-time-start-boundary.md)
- [verification/migration/cutover](../tasks/20260728-weekly-planning-stable-v5-verification-and-cutover.md)
- [runtime followups](../tasks/20260724-weekly-planning-runtime-followups.md)
- [cloud session store](../tasks/20260716-weekly-planning-synced-conversation-session-store.md)
- [external source production adapter](../tasks/20260728-weekly-planning-external-source-production-adapter.md)
- [trace production operations](../tasks/20260716-weekly-planning-trace-privacy-and-lifecycle.md)

次のrecordsはcurrent root queueではない。

- `tasks/closed/20260727-weekly-planning-trace-empty-session-recovery.md`
- `tasks/superseded/20260722-weekly-planning-generic-semantic-v5-migration.md`
- `tasks/superseded/20260722-weekly-planning-v5-date-real-eval.md`
- `tasks/closed/20260722-weekly-planning-specific-date-and-personalization-profile.md`
- `tasks/closed/20260722-weekly-planning-external-source-atomic-retry.md`

## 5. Default cutover禁止条件

次のいずれかが残る場合、defaultをStable V5へ変更しない。

- parser fallbackが存在する
- AIがmissing/readiness/scheduler/saveを直接決定する
- GraphとPlanningState commitが非原子的
- request/current-time identityが不安定
- current時刻より前へ配置する
- same conversation traceが実環境で分裂またはappendされない
- external failureを予定0件として扱う
- actual AI eval未実施
- browser roleplay未実施
- migration/rollback未検証
- unresolved blocker/major audit finding

## 6. 完了記録の扱い

feature implementation、runtime connection、verification、production adoptionを一つのtaskへ混ぜない。完了済みfoundationはclosed、別current trackerへ吸収した旧work unitはsupersededへ置く。rootには現在独立して実行するtaskだけを置く。