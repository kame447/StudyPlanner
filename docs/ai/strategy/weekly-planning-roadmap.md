# 週間計画 AI ロードマップ

Status: canonical / active
最終更新: 2026-07-28
Reviewed branch baseline: `51809873980d9ded953fd6f0614547b79fe71182`

- Runtime contract: [../weekly-planning-stable-v5-runtime-trial-contract.md](../weekly-planning-stable-v5-runtime-trial-contract.md)
- Current status: [../weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
- Semantic V5 queue: [weekly-planning-semantic-v5-roadmap.md](weekly-planning-semantic-v5-roadmap.md)
- Active-task inventory: [../audits/20260728-weekly-planning-active-task-inventory.md](../audits/20260728-weekly-planning-active-task-inventory.md)
- Current trace audit: [../audits/20260727-stable-v5-trace-empty-session-seven-audit.md](../audits/20260727-stable-v5-trace-empty-session-seven-audit.md)

## 1. Statusの読み方

```text
module implemented
→ runtime connected
→ local persistence connected
→ automated verified
→ browser verified
→ cloud synced
→ operationally deployed
→ default enabled
```

各段階を同一視しない。過去commitの成功結果を現在headへ自動継承しない。

## 2. 現在の実装基盤

### Semantic/runtime

実装済み:

- AI-only initial semantic interpretation
- Stable V5 strict schema / validator / one repair
- direct lifecycle canonicalizer / Fact Graph V5
- active read view / generic work item / scheduler input
- deterministic readiness / dialogue / preview scheduler
- existing preview / approval / Plan save bridge
- feature-flagged runtime mode and rollback boundary

### Application/persistence

実装済み:

- application request ownership
- request/week/revision stale discard
- close/reopen session continuity
- clear conversationとreset sessionの分離
- owner/week/conversation-bound local envelope
- conversation、Graph、messages、preview、draftのreload復元
- application lifecycle、turn application、side effect分離

未実装:

- cloud authoritative conversation/Graph repository
- cross-tab sequence reservation
- cross-device conflict resolution

### Trace

実装済み:

- server-authoritative structural IDs
- owner-scoped server handle continuity
- Stable V5 debug stage transport
- redaction、HMAC subject、admin export
- current branchでempty-session root causesを修正

未完了:

- current branch final automated verification
- production secret/TTL/Rules/Worker deploy
- final-turn durable delivery
- pagination/versioned decoder
- production admin/browser verification

### Approval

実装・自動検証済み:

- transaction idempotency
- deterministic Plan ID
- operation/item ledger
- recovery/fail-closed boundary

未完了:

- production Rules/TTL
- Emulator concurrency
- 2tab/2device verification

### Personalization

Foundation実装済み:

- account-linked profile schema
- week-start setting
- origin/confidence/scope/expiry
- profile v2 placement parameter schema

未実装:

- planning/outcome observations
- reset validity propagation
- time-decayed aggregate
- personalized candidate ordering
- production governance

## 3. Current queue

`docs/ai/tasks/`直下のtask recordは次の9件だけをcurrent queueとする。

### P0: current blocker

1. [trace empty-session recovery](../tasks/20260727-weekly-planning-trace-empty-session-recovery.md)
   - implementation complete
   - first verification: focused 65 passed、trace full 1 failed、typecheck 1 error
   - two test-contract fixes applied; rerun required
   - greenになるまでPR ready/merge禁止

### P0: scheduler safety

2. [current-time start boundary](../tasks/20260716-weekly-planning-midweek-current-time-start-boundary.md)
   - Stable V5 schedulerが当日の現在時刻より前へ配置し得る
   - request-scoped clock snapshotとearliest placement boundaryを実装する

### P1: adoption/runtime integrity

3. [Stable V5 verification and cutover](../tasks/20260728-weekly-planning-stable-v5-verification-and-cutover.md)
   - actual AI real-eval
   - browser roleplay
   - old-state migration/dry-run
   - shadow/rollback/default cutover
4. [Stable V5 runtime followups](../tasks/20260724-weekly-planning-runtime-followups.md)
   - cross-tab sequence
   - accepted-fact grounding
   - final trace durability
   - trace source semantics
   - reset cleanup

### P1-P2: production boundaries

5. [cloud conversation session store](../tasks/20260716-weekly-planning-synced-conversation-session-store.md)
6. [trace production privacy/lifecycle/scalability](../tasks/20260716-weekly-planning-trace-privacy-and-lifecycle.md)
7. [approval operational rollout](../tasks/20260718-weekly-planning-approval-operational-rollout.md)
8. [external source production adapter](../tasks/20260728-weekly-planning-external-source-production-adapter.md)

### P2+: learning/personalization

9. [personalization rollout](../tasks/20260728-weekly-planning-personalization-rollout.md)

旧分割taskはclosedまたはsupersededへ移動済みであり、current queueとして使用しない。

## 4. 依存順

```text
trace empty-session recovery green
→ current-time hard boundary
→ Stable V5 actual AI/browser verification
→ external source adapter verification
→ migration/shadow/rollback
→ default cutover decision
```

Cloud/personalization:

```text
cloud conversation/Graph repository
→ planning/outcome observation
→ reset validity propagation
→ time-decayed aggregate
→ personalized ordering
```

Parallel production operations:

```text
trace secret/TTL/access/pagination
approval Rules/TTL/multi-client
```

cross-tab sequence coordinationはcloud session authority設計と整合させる。browser lockとserver revisionの二重正本を作らない。

## 5. Decision gates

### AI semantic ownership

raw user textの初期意味構造化はAIだけが担当する。deterministic coreはschema、reference、revision、conflict、readiness、feasibility、scheduler、saveを管理する。provider failureでparserへfallbackしない。

### Current-time safety

明示開始がない当日計画ではrequest時刻より前へ配置しない。personalization scoreでこの境界を変更しない。

### Session authority

現在はlocal envelopeだけが実装済み。別端末/cloud revision/offline conflictを実装するまでcloud syncedと記載しない。

### Trace authority

logical conversationに対するlocal session identity、server handle、entry sequenceを継続する。session/startだけ成功したempty artifactを実活動として表示しない。current trace taskがgreenかつmain deploy後のadmin確認が完了するまでIssue #89をcloseしない。

### Default cutover

次が残る場合、Stable V5をdefaultへしない。

- automated verification failure
- current-time boundary未実装
- actual AI real-eval未実施
- browser roleplay未実施
- trace split/loss
- migration/rollback未検証
- unresolved blocker/major audit finding

## 6. Task placement rule

```text
completed work unit
→ tasks/closed/

unfinished work absorbed by another current task
→ tasks/superseded/

independent current execution target
→ tasks/ root
```

browser/production verificationだけが残る過去implementation taskをrootへ放置しない。未実装workをclosedへ偽装しない。root一覧を変更する場合はroadmap、semantic roadmap、docs index、task inventoryを同じ変更で同期する。