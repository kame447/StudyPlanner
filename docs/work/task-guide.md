# Repository task guide

Status: canonical cross-cutting work guide
Updated: 2026-08-22

Task Markdown is optional. Use it only when the owning Issue is not sufficient for durable technical acceptance detail or a long-running checkpoint.

## Read order

1. `AGENTS.md`
2. `PROJECT_MAP.md`
3. `docs/DOCUMENT_DICTIONARY.md`
4. owning domain `README.md`
5. canonical contract / current roadmap
6. owning Issue / active work record / PR

## Placement

Feature/domain-specific active work:

`docs/domains/<responsibility>/work/YYYYMMDD-<slug>.md`

Repository-wide work process/templates:

`docs/work/`

Completed work:

`docs/archive/work/closed/`

Superseded work:

`docs/archive/work/superseded/`

Do not recreate agent-specific queues such as `docs/ai/tasks/`.

## Work-unit rule

One task record owns one primary root cause / responsibility boundary / acceptance unit. Do not create a new task file for every retry, wording change, test fix or review response.

When an Issue already provides the durable state and acceptance criteria, update the Issue rather than duplicating the same queue in Markdown.

## Checkpoint rule

For interruption-prone work, record exact branch/PR/HEAD, completed checks, unresolved evidence, next action and exit criteria. Historical branch/PR names are evidence only after the work finishes.

## Completion

When the work is complete, remove it from the active domain `work/` index and archive the record if it has lasting diagnostic value. If it adds no lasting value, the Issue/PR history may be sufficient; do not preserve redundant execution logs merely because they exist.
