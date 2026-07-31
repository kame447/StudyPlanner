# 週間計画 AI ロードマップ

Status: canonical / active
最終更新: 2026-07-31

- Runtime contract: [../weekly-planning-stable-v5-runtime-trial-contract.md](../weekly-planning-stable-v5-runtime-trial-contract.md)
- Current status: [../weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
- Semantic V5 queue: [weekly-planning-semantic-v5-roadmap.md](weekly-planning-semantic-v5-roadmap.md)
- Active-task inventory: [../audits/20260731-weekly-planning-active-task-inventory.md](../audits/20260731-weekly-planning-active-task-inventory.md)
- Semantic handoff audit: [../audits/20260731-weekly-planning-semantic-state-handoff-seven-audit.md](../audits/20260731-weekly-planning-semantic-state-handoff-seven-audit.md)

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

各段階を同一視せず、過去headの成功結果を現在headへ自動継承しない。

## 2. 現在の実装基盤

### Semantic/runtime

実装済み:

- AI-only initial semantic interpretation
- strict schema / max one repair
- Fact Graph V5 / lifecycle / active read view
- generic scheduler input / deterministic dialogue / preview
- staged Graph commitとexisting approval/save bridge
- rendererへの会話・Fact context
- renderer prompt/raw response/fallback/final decisionのtrace persistence

PR #107で実装中:

- `明日`planningWindow omission repair
- machine-readable pending question
- exact target short-answer binding
- renderer typed action contract

未完了:

- generic semantic turn delta
- generic lifecycle applier
- evidence coverage registry
- actual AI/browser verification

### Application/persistence

実装済み:

- application request ownership
- stale discard
- close/reopen continuity
- local owner/week/conversation envelope
- conversation、Graph、messages、preview、draftのreload復元

未実装:

- cloud authoritative repository
- cross-tab sequence reservation
- cross-device conflict/offline reconciliation

### Trace

実装・自動検証済み:

- server-authoritative IDsとsame-handle recovery
- Stable V5 debug transport
- redaction/HMAC/admin export
- request/entry size batching
- prompt contextのpersistent outbox/Worker保持

未完了:

- production secret/TTL/Rules/Worker deploy
- Issue #89 post-merge verification
- abrupt-close final-turn durability
- pagination/versioned decoder

### Approval / Personalization

Approval core idempotencyは実装済みだがproduction Rules/TTL/multi-client未確認。Personalization foundationは実装済みだがobservation以降は未実装。

## 3. Current queue

`docs/ai/tasks/`直下のcurrent task recordは次の8件だけとする。

### P0: scheduler safety

1. [current-time start boundary](../tasks/20260731-weekly-planning-midweek-current-time-start-boundary.md)

### P1: adoption/runtime integrity

2. [Stable V5 verification and cutover](../tasks/20260731-weekly-planning-stable-v5-verification-and-cutover.md)
3. [Stable V5 runtime followups](../tasks/20260731-weekly-planning-runtime-followups.md)

### P1-P2: production boundaries

4. [cloud conversation session store](../tasks/20260731-weekly-planning-synced-conversation-session-store.md)
5. [trace production privacy/lifecycle/scalability](../tasks/20260731-weekly-planning-trace-privacy-and-lifecycle.md)
6. [approval operational rollout](../tasks/20260731-weekly-planning-approval-operational-rollout.md)
7. [external source production adapter](../tasks/20260731-weekly-planning-external-source-production-adapter.md)

### P2+: learning/personalization

8. [personalization rollout](../tasks/20260731-weekly-planning-personalization-rollout.md)

旧日付の8件は、内容を現在化した上で上記へ置換済みであり、root queueとして使用しない。

## 4. 依存順

```text
PR #107 semantic handoff verification
→ current-time hard boundary
→ Stable V5 actual AI/browser verification
→ external source adapter verification
→ migration/shadow/rollback
→ default cutover decision
```

Structural semantic path:

```text
machine pending question
→ exact target short-answer binding
→ generic semantic turn delta
→ generic lifecycle applier / coverage registry
```

Cloud/personalization:

```text
cloud conversation/Graph repository
→ observations
→ reset validity propagation
→ time-decayed aggregate
→ personalized ordering
```

Parallel operations:

```text
trace production deploy + Issue #89 verification
approval Rules/TTL/multi-client verification
```

## 5. Decision gates

### AI semantic ownership

raw user textの初期意味構造化はAIだけが担当する。deterministic coreはschema、reference、revision、target binding、conflict、readiness、scheduler、saveを管理する。provider failureでparserへfallbackしない。

直前の質問種別と対象はrenderer textから逆推定せず、machine pending questionを正とする。

### Current-time safety

明示開始がない当日計画ではrequest時刻より前へ配置しない。

### Session / trace authority

conversation、Graph revision、pending questionを同じsession revisionで保持する。same logical conversationに対するtrace handle/sequenceを継続し、Issue #89確認前にproduction完了としない。

### Default cutover

次が残る場合、Stable V5をdefaultへしない。

- PR #107 verification red
- current-time boundary未実装
- actual AI/browser未実施
- renderer textが状態遷移へ影響する
- trace split/loss再発
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

merge時に完了taskの移動とcanonical文書同期を同じgateで確認する。