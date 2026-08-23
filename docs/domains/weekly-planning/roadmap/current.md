# 週間計画 roadmap

Status: canonical / execution order
Updated: 2026-08-23

Current contract: [../architecture/current-contract-v5.md](../architecture/current-contract-v5.md)
Human grounding policy: [../policies/human-grounding.md](../policies/human-grounding.md)
Adaptive memory policy: [../policies/adaptive-memory.md](../policies/adaptive-memory.md)
Test philosophy: [../quality/test-philosophy.md](../quality/test-philosophy.md)
Active work: [../work/README.md](../work/README.md)

## Completed baseline

PR #109, #112, #113, #120, #127, #129, #130, #132, #140–#151, #154, #155 and #157 established Stable V5 production ownership, legacy semantic-runtime isolation, Fact lifecycle, scheduler/preview/approval boundaries and conversation-quality hardening.

PR #162 merged the primary UI and dedicated AI-planning surface without changing semantic ownership.

PR #166 merged cross-cutting browser, visual, accessibility, runtime and test-intelligence QA automation. It is infrastructure shared across the product rather than weekly-planning feature ownership.

## Current priority: Issue #152

Attack the current boundary before adding more implementation: direct/stored prompt injection, durable-context poisoning, provenance, renderer integrity, nonsense/no-op, Unicode/delimiter and numerical/resource abuse.

```text
current main / contract refresh
→ threat case inventory
→ attack + evidence
→ owning layer classification
→ targeted deterministic regression
→ generalized fix
→ relevant Real API / browser verification
→ canonical docs sync
→ final CI / Browser Regression
→ Issue #152 close decision
```

## Independent scopes

- Issue #52: remove remaining weekly-planning plumbing from generic QuickEntry; dedicated AI surface already exists.
- Issue #45/#89: trace privacy/lifecycle and production recovery.
- Issue #47: personalization/cloud authority rollout.
- Issue #51: multi-device approval uniqueness.
- Issue #128: saved-preview migration/compatibility.
- Issue #160: AI usage/cost observability.
- Issue #164: client-first execution, owned by the separate [client-runtime domain](../../client-runtime/README.md).

## Architecture direction

One semantic/application decision has one owner. Renderer, compatibility and trace project upstream typed decisions instead of recomputing them. Prompt/file count is not the primary complexity measure; duplicated decision ownership is.
