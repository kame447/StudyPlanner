# Repository work documentation

This directory owns cross-cutting work-document conventions and repository-wide operational guidance, not feature-specific active task content.

- [Task guide](task-guide.md)
- [Task brief template](task-brief-template.md)
- [Regression patterns](regression-patterns.md) — durable product/runtime regression classes, representative historical PR evidence, invariants, and verification guidance
- [Tooling operations runbook](tooling-operations-runbook.md) — durable GitHub/CI/tool failure modes, verified workarounds, permission requirements, and cleanup rules

Active feature work belongs under `docs/domains/<owner>/work/` or directly in the owning GitHub Issue when a separate Markdown record adds no durable value.

Completed work belongs in `docs/archive/work/closed/`; superseded work belongs in `docs/archive/work/superseded/`.

Do not create `docs/ai/tasks`, agent-specific queues, retry documents, or a second roadmap for the same execution order. Product/runtime regression knowledge belongs in `regression-patterns.md` only when it is durable and repository-wide. Tool-specific operational knowledge belongs in the runbook only when it is durable and repository-wide; one-off incidents remain in their Issue/PR/Actions evidence.