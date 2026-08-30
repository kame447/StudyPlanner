# Repository work documentation

This directory owns cross-cutting work-document conventions and repository-wide operational guidance, not feature-specific active task content.

- [Task guide](task-guide.md)
- [Task brief template](task-brief-template.md)
- [Regression patterns](regression-patterns.md) — durable product/runtime regression classes, representative historical PR evidence, invariants, and verification guidance
- [Refactoring patterns](refactoring-patterns.md) — durable structural failure patterns, refactor escalation criteria, preferred responsibility boundaries, and linked regression classes
- [Tooling operations runbook](tooling-operations-runbook.md) — durable GitHub/CI/tool failure modes, verified workarounds, permission requirements, and cleanup rules

For a product/runtime bug, start with `regression-patterns.md`. If the root cause is structural — duplicated authority, dependency-direction drift, state-lifecycle fragmentation, compatibility-runtime duplication, or similar — continue into `refactoring-patterns.md` before choosing a local patch versus a structural refactor.

Active feature work belongs under `docs/domains/<owner>/work/` or directly in the owning GitHub Issue when a separate Markdown record adds no durable value.

Completed work belongs in `docs/archive/work/closed/`; superseded work belongs in `docs/archive/work/superseded/`.

Do not create `docs/ai/tasks`, agent-specific queues, retry documents, or a second roadmap for the same execution order. Product/runtime regression knowledge belongs in `regression-patterns.md` only when it is durable and repository-wide. Repository-wide structural refactoring knowledge belongs in `refactoring-patterns.md` only when it is backed by actual StudyPlanner evidence. Tool-specific operational knowledge belongs in the runbook only when it is durable and repository-wide; one-off incidents remain in their Issue/PR/Actions evidence.