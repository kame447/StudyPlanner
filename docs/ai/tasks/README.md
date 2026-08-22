# Active task index

Status: canonical index / unfinished records only
Updated: 2026-08-22

この directory 直下には未完了 task だけを置く。実行優先順位は `../strategy/weekly-planning-roadmap.md` と各 open Issue を正とし、この index は task の所在を整理するために使う。

## Active records

- Issue #89 — trace production recovery
  - `20260728-weekly-planning-trace-production-recovery.md`
- Issue #51 — approval production / multi-device rollout
  - `20260731-weekly-planning-approval-operational-rollout.md`
- Issue #47 — cloud conversation / Fact Graph session authority
  - `20260731-weekly-planning-synced-conversation-session-store.md`
- Issue #47 — personalization observation / aggregate / safe ordering
  - `20260731-weekly-planning-personalization-rollout.md`
- Issue #45 — trace privacy / lifecycle / production governance
  - `20260731-weekly-planning-trace-privacy-and-lifecycle.md`
- Issue #164 — client-first execution requirements
  - `20260822-client-first-execution-requirements.md`

## Placement rules

- completed → `closed/`
- replaced / deferred → `superseded/`
- audit evidence → `../audits/`
- durable architecture / policy → `../strategy/` or canonical contract

Issue だけで十分な backlog 項目のために重複 task を増やさない。current task が存在する場合は Issue と task を相互参照し、同じ要求を複数 Markdown へ全文複製しない。
