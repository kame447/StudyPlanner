# Issue #488 conversation interaction layer

Status: active-work record (implementation complete on branch; integration owned by the parent)
Updated: 2026-10-07

Owning Issue: [#488](https://github.com/kame447/StudyPlanner/issues/488). Contract: [current-contract-v5.md](../architecture/current-contract-v5.md#conversation-interaction-three-responsibilities-issue-488).

## Decision

Additive typed `conversationActs` in the existing semantic call + a deterministic interaction decision + renderer typed outcome (option B). Rejected: fixing only the no-op retry/freshness (cannot distinguish an aside or carry mixed turns) and an outer conversation orchestrator/LLM/tool loop (second semantic owner of the same utterance, no tool surface in the client, widens the injection surface).

## Behavior changes to be aware of

- Production now consults question-presentation freshness once per turn; stale/unbound/malformed presentations bypass the focused shortcut.
- Failure turns retain the accepted state and re-present the same typed question only when it was fresh; failure prose no longer asks an unrelated generic question. A semantic failure never asks to resend the same text or rephrase; a provider failure gives resend guidance and never invents a content question.
- Proposal decisions apply only to the fresh presented proposal. The Issue #152 V09 "collective decision" test was changed accordingly: a collective decision settles only the presented proposal.
- One turn-scoped AI dispatch pool replaces stacking per-stage retry allowances.

## Deferred

- Generic evidence references; replay of a failed utterance (relative dates would need the original request clock); edit/resend remains the fallback.
- Durable freshness reason in the persisted turn diagnostic (only presence of the offered `pendingQuestion` is persisted; `interactionOutcome` and the freshness status stay in the in-memory debug trace by design).
- Issue #246 consultation runtime (`consultation_request` is only a marker; the user is told it was not answered).
- Recent-turn window change mentioned in the Issue body.
- Real-model accuracy of act emission (needs the real-API gate; not run here).
