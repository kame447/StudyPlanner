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

## Runtime architecture switch (comparison instrument)

Added so the parent can measure the old and new conversation architectures in the real UI. Contract: [current-contract-v5.md](../architecture/current-contract-v5.md#runtime-conversation-architecture-mode-issue-488-comparison-switch).

- Choice: one typed mode, resolved once per turn and pinned on `PlanningState.conversationArchitecture` (rejected: build flag only — cannot compare in one running app and has no conversation identity; per-feature toggles — incoherent mixtures, N storages/UIs).
- `legacy_v5` restores the pre-#488 conversation architecture at every boundary #488 touched (schema/prompt/validation, pending-question binding, no-op retry, interaction layer, renderer prompt, failure presentation, dispatch pool enforcement, proposal decisions); unrelated main changes are kept. Fidelity oracle: `git archive ee07697e` hashes + differential replay (13 turns, 0 differences).
- Default for new conversations: `interaction_v1` (optional build default `VITE_WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_DEFAULT`). Old checkpoints with content hydrate as `legacy_v5`; changing the default never flips an existing conversation.
- Evaluation gate `VITE_WEEKLY_PLANNING_ARCHITECTURE_SWITCH_ENABLED=1` (off by default): Settings selector ("次の新規AI計画会話から適用") and an AI-planning strip with the pinned mode and the latest turn's mode / elapsed ms / AI dispatches / outcome-or-failure.
- Measurement: shared, in-memory, observation only (no persistence, no external telemetry). Debug trace carries `conversationArchitecture` + `aiDispatchUsage`; not durable fields (persisted requests stay attributable through their schema).
- Not done here: live Computer Use measurement (parent), paid real-model evaluation, any claim about which architecture is better.

## Deferred

- Generic evidence references; replay of a failed utterance (relative dates would need the original request clock); edit/resend remains the fallback.
- Durable freshness reason in the persisted turn diagnostic (only presence of the offered `pendingQuestion` is persisted; `interactionOutcome` and the freshness status stay in the in-memory debug trace by design).
- Issue #246 consultation runtime (`consultation_request` is only a marker; the user is told it was not answered).
- Recent-turn window change mentioned in the Issue body.
- Real-model accuracy of act emission (needs the real-API gate; not run here).
