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
- `legacy_v5` restores the pre-#488 conversation architecture at every boundary #488 touched (schema/prompt/validation, pending-question binding, no-op retry, interaction layer, renderer prompt, failure presentation, dispatch pool enforcement, proposal decisions); unrelated main changes are kept. Fidelity oracle: `git archive ee07697e` hashes (pinned in the oracle test). One-time evidence, not a repo test: on 2026-10-07 (at `e2817d1f`) a differential replay of five scripted scenarios (13 turns: explanation, semantic failure then answer, aside then short reply, provider outage, first-turn failure) through the pre-#488 tree and `legacy_v5` gave 0 differences in provider call sequences, per-call request hashes, messages, states and freshness; an independent reviewer harness (10 scenarios / 25 turns) confirmed 0 differing leaves for both architectures.
- Default for new conversations: `interaction_v1` (optional build default `VITE_WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_DEFAULT`). Old checkpoints with content hydrate as `legacy_v5`; changing the default never flips an existing conversation.
- Evaluation gate `VITE_WEEKLY_PLANNING_ARCHITECTURE_SWITCH_ENABLED=1` (off by default): Settings selector ("次の新規AI計画会話から適用") and an AI-planning strip with the pinned mode and the latest turn's mode / elapsed ms / AI dispatches / outcome-or-failure.
- Measurement: shared, in-memory, observation only (no persistence, no external telemetry). Debug trace carries `conversationArchitecture` + `aiDispatchUsage`; not durable fields (persisted requests stay attributable through their schema).
- Not done here: live Computer Use measurement (parent), paid real-model evaluation, any claim about which architecture is better.

## Natural conversation repair (2026-10-07, interaction_v1 only)

Measured in the real UI: 「なんで時間が必要なの？」 under a pending question became `stable_v5_normalization_rejected` (2 semantic calls, 0 renderer) and showed an application paragraph about internal processing instead of an answer.

- Root cause (deterministic replay of the measured state): the pending question was a work-breakdown clarification, and the work-breakdown response contract required every response to restate the target task. A perfect explanation document (act only, no planning content) was therefore rejected on both attempts (`document:work-breakdown-target-task-required`); the act shared the document's all-or-nothing validation; the failure path bypassed the renderer. Fact-style constraints on the act itself (topic id restricted to tasks/components while the prompt showed the pending uncertainty id; mandatory quoted evidence) also reproduce the same signature.
- Decision (compared with keeping all-or-nothing validation and with a second classifier call): one response, two independently validated parts. Acts lose quoted evidence and fact-style rejection (malformed entries dropped, unknown topic degraded); a valid self-sufficient act carries a turn whose planning delta stays unusable after the single repair, with an empty delta; a response without planning content is exempt from the work-breakdown target requirement. No second semantic owner or model call.
- Presentation: deterministic code hands the renderer a typed communication context (goal, question purpose codes, later needs, status reason, disclosure, flags; corrections as typed before/after). The renderer writes every interaction reply, including semantic-failure recovery; provider failures are not rendered. Internal vocabulary in renderer output is rejected (one repair). `weeklyPlanningInteractionFallbackText.ts` is the only fixed conversational Japanese of the interaction architecture (emergency only). A source scan classifies every Japanese literal of production weekly-planning code.
- Legacy: byte-identical oracle hashes; all changes are interaction-gated.
- Independent read-only audits (verification, fixed-prose, semantic safety) found no blocker. Follow-ups taken in: mixed turns (new detail + "why?") keep the asked-about fresh question presented while it is still open, and the explanation instruction/repair let the required acknowledgement of the new detail come first instead of competing with it (a compliant reply was otherwise rejected); the emergency composer no longer accepts routing prose; fixed emergency wording is checked against the renderer validator's vocabulary list too; regression tests for stale-question explanation acts, foreign/removed topic ids, an adversarial rejected response next to a valid act, and the rescued turn under a pending unclear-detail question.
- Second independent review round (dispatch/performance, semantic security, legacy/trace/tests, conversation surface, architecture, adversarial dialogue): no P0/blocker. Fixed:
  - renderer repair rejection escaping the fallback (shared adapter fix, both architectures);
  - renderer dispatched right after a provider outage (interaction outage gate);
  - omitted-work disclosure contradictable (now an application sentence);
  - internal-word exemption fooled by machine keys/snake_case (values-only exemption, wider list);
  - a question bound without being asked (askQuestion requires a question);
  - focused short-answer route dropping a second act (interaction fallback instruction);
  - pure removals invisible to the reply (`removedThisTurn`);
  - purposes missing for many question codes (compiler-checked map);
  - two requests in one provider-failure bubble, and wording issues.

  Tests contributed by the parallel test agents (semantic safety; request fingerprints and gate-off UI) were reviewed and integrated.
- Contract: [current-contract-v5.md](../architecture/current-contract-v5.md#conversation-interaction-three-responsibilities-issue-488); scenarios DIALOGUE-007, 009, 013, 014.

## Deferred

- Real-model and Gemini/human evaluation of the new renderer wording and of act emission accuracy (deterministic tests prove contracts only).
- The application-typed question texts reused as the interaction emergency question (shared with legacy, e.g. 「…の意味を一つに決められませんでした」) are emergency-only in interaction but still mechanical; changing them requires an interaction-only copy to keep legacy fidelity.
- The composer's error banner shows the raw message of an unexpected (non-controlled) exception; provider/semantic failures never reach it. UI-scope follow-up.
- Generic evidence references; replay of a failed utterance (relative dates would need the original request clock); edit/resend remains the fallback.
- Durable freshness reason in the persisted turn diagnostic (only presence of the offered `pendingQuestion` is persisted; `interactionOutcome` and the freshness status stay in the in-memory debug trace by design).
- Issue #246 consultation runtime (`consultation_request` is only a marker; the user is told it was not answered).
- Recent-turn window change mentioned in the Issue body.
- Real-model accuracy of act emission (needs the real-API gate; not run here).
- Product decisions left open by the second review: an explanation or aside next to a kept preview is answered as an ordinary preview/status turn; an unknown named topic and no topic both resume the current question; several acts in one turn follow a fixed precedence (resume > explain > untargeted aside) rather than temporal/retraction meaning.
- Not done: making `conversationArchitecture` required at every turn boundary (absent = interaction default), and a measured fallback rate per goal for the real-model gate.
