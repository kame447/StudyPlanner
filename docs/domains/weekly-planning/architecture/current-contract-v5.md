# weeklyPlanning current contract v5

Status: canonical / Stable V5 production baseline
Updated: 2026-10-07

References:
- [Domain index](../README.md)
- [Learning consultation/advice requirement](../spec/learning-consultation-and-advice.md)
- [Semantic ownership](weekly-planning-semantic-ownership-boundary-v5.md)
- [Availability architecture](weekly-planning-availability-architecture-v5.md)
- [Scheduling policy](../policies/scheduling.md)
- [Human grounding policy](../policies/human-grounding.md)
- [Adaptive memory policy](../policies/adaptive-memory.md)
- [Test philosophy](../quality/test-philosophy.md)
- [Current roadmap](../roadmap/current.md)

## Runtime baseline

Stable V5 is the sole production weekly-planning runtime.

```text
raw user utterance + relevant conversation + typed machine state
→ AI semantic interpretation
→ schema / evidence / reference / payload-value validation
→ deterministic formal binding / canonical Fact Graph
→ deterministic proposal / repair / readiness / question / scheduler decision
→ AI dialogue renderer
→ preview
→ deterministic approval / save / persistence
```

There is no production semantic rollback path to a legacy parser/interpreter/runtime selector. The conversation architecture switch ([below](#runtime-conversation-architecture-mode-issue-488-comparison-switch)) does not reintroduce one: it selects between two Stable V5 conversation-interaction variants with the same semantic authority (one AI owner of raw Japanese, same Fact Graph/planner/approval), not a legacy parser or runtime.

Issue #246 defines a planned pre-scheduling consultation/advice extension in [learning-consultation-and-advice.md](../spec/learning-consultation-and-advice.md). Until that runtime implementation is merged and verified, the flow above remains the production baseline. The requirement document must not be read as evidence that consultation routing or AdviceProposal state already exists in production.

## Ownership

AI owns natural-language meaning and natural realization of typed dialogue decisions.

Deterministic application owns schema/evidence/reference validation, canonical IDs, binding, revision/idempotency, Fact Graph lifecycle, question/confirmation necessity, repair agenda, proposal lifecycle, readiness, scheduler/placement safety, preview freshness, approval/save, persistence/recovery and deterministic calculation.

After the semantic boundary, raw Japanese must not be reinterpreted by regex, keyword, dictionary or legacy parser as semantic truth.

For the planned Issue #246 extension, whether a user turn semantically asks for learning consultation/advice is also a natural-language meaning decision. Deterministic routing may consume a validated typed consultation contribution, but must not establish that meaning by a second raw-text keyword/regex router.

## Semantic delta

AI output is a current-turn semantic delta, not an accepted-state snapshot. Past facts are not recopied without current evidence. Formal IDs, revision, lifecycle mutation and scheduler decisions are not AI-owned.

When a validated turn explicitly corrects a planning window, canonical staging must not implicitly supersede its still-active target before the correction transaction validates it. Apply the explicit correction first, then reconcile the single-active-window invariant within the semantic commit before scheduling or persistence. Stale revisions, unknown or already-terminal targets, and invalid replacements still reject atomically with the original graph unchanged. Implicit window replacement and repair of historical duplicate active windows retain their existing behavior when no new explicit window correction is present.

Provider failure, malformed output, validation failure or repair failure does not authorize legacy-parser fallback. Semantic repair is at most once where this contract permits it.

## Acceptance and recovery validation

Provider deltas and persisted Fact Graphs use different envelopes. `weeklyPlanningSemanticBaseValidatorV5.ts` and its extension wrapper own provider keys, local IDs, evidence, references and cross-field semantic checks. `weeklyPlanningFactGraphValidatorV5.ts` owns saved graph IDs, provenance, revision, lifecycle and references. Do not validate a saved fact by pretending it is an entire provider object, or require provider-only fields on historical saved facts.

Both adapters call the same value validators for task/context/component payloads, quantities, effort, recurrence, temporal/date rules, planning windows, availability, relations, source requests, uncertainty and correction/decision intent payloads. These kernels validate existing typed values; they do not interpret raw text, resolve calendar policy, grant approval, or decide scheduling. Absence (`no_additional_constraint`) and daily capacity are distinct availability variants. Reduced saved date rules and legacy optional extension fields retain their own envelope contracts. Exact fields, allowed values and compatibility cases are owned by types and executable tests, not a second schema copied into this document.

A schema-shaped but invalid value must not become accepted state merely because it came from another provider or from storage. The semantic validators return a rejected result with errors; normal repair/fallback policy still owns the next action and must revalidate repaired output. Unknown values must not silently become a different relation, source action or acceptance/rejection decision. Uncertainty field/reason remain nonempty free strings. Correction removal forbids a replacement, while modification/replacement requires an addressable replacement. Saved reference kinds retain the availability-correction compatibility adapter; the canonical writer continues to exclude proposal decisions from the persisted planning graph. Recovery does not grant approval authority. This does not introduce a partial-commit feature or make every unresolved fact invalid: supported `unknown`, nullable and symbolic representations remain accepted where their existing contract permits them.

`prepareWeeklyPlanningStableV5Checkpoint` validates the graph before traversing or encoding it. Checkpoint reading routes through the graph parser before hydration, so saved input is revalidated rather than trusted as previously accepted. Validation covers stored historical facts too; filtering removed/superseded facts for scheduling is a separate step. Regression tests use canonical writers and real checkpoint preparation/save/load, preserving valid historical representations while rejecting malformed values. These entry gates complement downstream fail-closed scheduler checks; they do not replace them.

## Time semantics

Natural-language time meaning belongs to AI; calendar arithmetic and scheduler-facing temporal compilation belong to the deterministic application.

The request clock is distinct from UI `selectedDate`. New future-plan blocks must not be placed before the deterministic `notBefore` boundary.

A relative date can remain symbolic at the semantic boundary and be resolved deterministically from captured calendar context. Do not let renderer wording or current UI navigation become the source of date truth.

For accepted active date constraints used by movable-work placement, the application resolves supported date expressions and compiles task/component applicability into scheduler-facing absolute hard date bounds and preferred placements before downstream distribution/placement. Downstream placement consumes that compiled representation rather than independently re-resolving the same deadline / earliest-start / latest-end / preferred-window meaning from raw semantic facts. Task-level constraints may apply to component work; component-specific constraints must not leak to sibling components. Removed or superseded facts must not remain effective through a downstream re-read.

Unresolved or contradictory hard date constraints fail closed at scheduler-input compilation rather than being silently weakened.

A consultation answer may suggest a date, but an AI-generated suggested date is not an accepted temporal fact. It becomes scheduler-relevant only after explicit user adoption and normal Stable V5 binding/lifecycle processing.

## Quantity roles

Workload quantity roles are not interchangeable.

- `scope_total`: the whole bounded scope when one actually exists
- `completed`: already completed quantity
- `remaining`: remaining quantity supported or derived from accepted facts
- `target`: quantity the user wants this planning operation to accomplish/schedule
- `declared` / `unknown`: quantity whose planning role is not yet sufficiently resolved

Important consequences:

- `scope_total` and `completed` may deterministically imply a `remaining`, but they do not automatically choose the user's planning `target`.
- `completed` work is not rescheduled.
- if a specific `target` exists for the same planning scope, scheduler compilation must not blindly schedule all `remaining` in addition to that target.
- corrections to total/completed/target must invalidate stale derived progress consistently.
- input order must not change the converged bounded-progress truth.
- open-ended work must not receive an invented total merely to make arithmetic or scheduling easier.

For consultation questions containing calculable quantities, deterministic calculation remains the numeric authority. An answer model may explain a computed result but must not silently replace application-owned arithmetic with its own value.

## Work decomposition / atomicity

Task decomposition is typed semantic state, not a scheduler guess.

Current semantic representation distinguishes concepts such as:

```text
atomic
| decomposed
| needs_breakdown
```

Scheduler-facing work items distinguish at least:

```text
splittable
| atomic
| unknown
```

Rules:

- atomic work must not be divided solely because a placement window is shorter.
- only work represented as splittable may be mechanically chunked by scheduler policy.
- unknown/needs-breakdown is not permission to infer splittability from raw task text or subject keywords.
- when work structure is required for a safe/meaningful plan, the semantic/dialogue boundary resolves it before scheduler use.

## Fact Graph / lifecycle

Canonical commit is atomic. Validation failure leaves accepted state unchanged. Correction/replacement/supersession is explicit lifecycle; no-op does not create an unnecessary revision.

Derived facts remain derivations with source/basis. A correction to their basis must not leave stale derived truth active.

Planned consultation advice does not enter the canonical planning Fact Graph merely because an answer was generated. Advice remains advisory state until the user adopts a defined scope and deterministic promotion creates normal planning contributions.

## Repair agenda / dialogue progression

Not every uncertainty blocks the same boundary.

Deterministic application classifies what must be repaired now versus what can be deferred. A low-impact/non-blocking uncertainty may remain in a repair agenda while another required question is handled first, but deferred work must reopen before the boundary it can affect.

Defer/pass-over is not silent deletion of uncertainty and does not convert it into accepted fact.

See [Human Grounding Policy](../policies/human-grounding.md).

Consultation must not be implemented by sending the user through the normal planning slot-question sequence. When Issue #246 is implemented, the consultation contract owns which missing information is material to a useful recommendation; only recommendation-changing/blocking gaps should trigger targeted questions.

## Proposal / readiness / scheduler

A proposal is not a command.

```text
application candidate
→ renderer presents it
→ AI interprets the user response
→ application accepts / rejects / modifies
→ accepted policy may affect scheduling
```

Unaccepted proposals do not affect scheduling. Readiness, question necessity, authoritative occupied sources, placement and feasibility are application decisions.

When the resulting Stable V5 planning horizon is exactly seven days, scheduling uses six normal placement days plus a seventh reserve day and prioritizes normal days before reserve. The default/fallback horizon is not an unconditional seven-day cap: applicable hard temporal bounds can require a longer usable horizon, and the scheduler still enforces the compiled hard bounds across that horizon. Detailed horizon, balancing and scoring behavior is owned by current scheduler policy, not semantic truth.

Issue #246 extends the same proposal principle to AI-generated study advice. Advice acceptance means only that a user has adopted a scope into planning intent; it is not preview approval or save authorization. Promotion must return to the normal Stable V5 readiness/scheduler/preview path instead of letting the advice branch call the scheduler or persistence layer directly.

## Pending question presentation binding

The pending question (`lastQuestionContext`) is application state; the assistant text that shows it is presentation only. When a Stable V5 turn commits a message that presents a pending question, the turn controller binds that question to the committed assistant message: turn ID, message ID, the planning-state revision after the commit, the committed graph revision, and the machine-known accompaniments the renderer was given with it (response source, current-turn grounding mode, self-repair notice, counts of proposed/contested grounding interpretations, preview promotion control). The binding is written only through the accepted commit and is replaced or removed by every later commit.

The freshness is computed once per turn at turn start (`pendingQuestionPresentation`) and every consumer reads that single value: the semantic public state (`pendingQuestion` is offered to the model only when fresh, with the revision of the presenting commit rather than the current graph), the focused contextual shortcut, the contextual binder, the no-op retry and proposal decisions. Authorization continues to read the raw previous state conservatively. A later turn may treat the pending question as the one the user is replying to only when the binding is `fresh`: the turn-start planning-state revision equals the bound revision (no failed turn, approval message, appended message, edit or clear happened in between), the latest message is the bound assistant message, and the graph revision is unchanged. A missing binding (sessions saved before binding existed), a malformed binding, or any mismatch fails closed. Freshness says only that the question context is still the one committed with the latest message; the consumer must still re-validate that its target (for example a proposal) is active and unsuperseded. Two limits are part of the contract:

- Presentation evidence. With `responseSource: deterministic_fallback` the application's typed question text was shown. With `ai` the renderer echoed this question's typed action contract and passed validation, but whether its free text actually asks the question is not verified, and must not be inferred from the text with regex or keywords. A consumer that depends on the text having asked the question must treat the rendered text as untrusted context and cover non-presenting renders in its evaluation.
- Scope. Freshness is local to the planning state held by the submitting client. It does not detect a newer checkpoint written by another tab or device; that is the existing last-writer boundary of the conversation store, not something the binding resolves.



The binding is not semantic input. It is excluded from the semantic model's public state summary and from renderer input, and it grants no approval, save, scheduler or lifecycle authority.

## Conversation interaction: three responsibilities (Issue #488)

The turn is described by three responsibility boundaries inside the one Stable V5 pipeline. They are **not** three LLM services and there is no outer conversation orchestrator or tool loop.

```text
semantic / conversation interpretation   (the one AI owner of raw Japanese)
  planning delta + typed conversationActs
↕
deterministic interaction / application controller
  typed acts + machine state + presentation freshness → turn outcome
↕
deterministic planner / persistence
  Fact Graph, readiness, scheduler, preview, approval, save
```

- **Typed conversational acts.** The semantic document may carry additive, non-exclusive `conversationActs` next to the planning delta: `answer_pending_question`, `ask_about_pending_question`, `topic_shift`, `resume_topic` and `consultation_request`. An ordinary planning turn has none. An act is discourse metadata of the current turn: only its kind and an optional topic reference (an existing active task/component id). It carries no quoted evidence (the application knows which turn it belongs to), no planning payload and no authority: it never feeds authorization, readiness, preview, approval or save, and a missing or wrong act can only degrade a turn into an ordinary non-mutating one. Mixed turns keep both the planning contribution and the act. `consultation_request` is only a handoff marker for Issue #246; no consultation runtime exists in production and the application states that the request was not answered.
- **Acts are validated apart from the planning delta (one response, two parts).** Every existing planning validator (schema, evidence/provenance, references, numeric safety, correction/decision targets) applies to the planning delta unchanged; act problems are never planning errors. A malformed entry (unknown kind, extra key, malformed target, non-array or oversized list) is dropped on its own (fail closed); an unknown topic reference degrades to "no topic". When the planning delta is still unusable after the single permitted repair (or the repair call itself fails), a valid self-sufficient act from those responses carries the turn as an accepted document with an EMPTY delta (`conversationOnly`): nothing from the rejected planning part is applied, and when it carried planning content the renderer is told those details were not taken in. A bare `answer_pending_question` never carries a turn. No second model call is made. The work-breakdown response contract (a pending breakdown question requires the target task to be restated) does not apply to a response without any planning content, so an explanation request is never rejected merely because it changes nothing.
- **Interaction outcome.** The application decides `apply`, `explain_pending_question`, `aside`, `resume_pending_question` or `recover` from typed acts and machine state only (never raw text). It may redirect which open question is presented when the user names an existing topic, or keep presenting the question the user asked about, but never pulls forward an issue the repair policy deferred this turn and never names a topic that is not an active fact of this conversation. `explain` is valid only for a fresh, unchanged pending question: in a mixed turn whose other details would change which question comes first, the asked-about question stays presented while it is still open, so the details are taken in and the question is still explained (a question that is stale, answered or deferred is not kept, and the turn is ordinary). An `aside` keeps the machine question but neither re-presents nor re-binds it; `resume` re-presents explicitly. A result carrying a preview is always `apply` (so an explanation or aside next to a kept preview is answered as an ordinary preview/status turn; a separate product decision). The narrow focused answer route has no channel for acts, so in the interaction architecture it falls back to the general interpretation when the message also asks for advice, asks about the question or changes the topic (still one semantic owner). A conversation-only turn behaves like an empty planning turn: it can complete a preview the user had already authorized, never authorize one.
- **Communication context (deterministic WHAT, renderer HOW).** With the outcome the application hands the renderer a typed `communication` context: the goal of the reply (`ask_question`, `report_status`, `present_preview`, `explain_question`, `acknowledge_aside`, `resume_question`, `clarify_turn`), machine-owned purpose codes saying why the planner needs what the question asks (`questionPurposes`, plus `laterNeeds` for other open questions), whether the reply asks the question, the typed status reason (`ready_to_create_preview` / `preview_unchanged`, reported by routing), the application-owned preview disclosure (work that did not fit), `planningDetailsNotApplied` and `consultationDeferred`. Every question code maps to a purpose (compiler-checked). Corrections reach the renderer as typed before/after data, removals made in this turn as `removedThisTurn`, and facts accepted in this turn as `currentTurnGrounding` (shared with legacy); when an acknowledgement of them is required it opens the reply and the goal (for example the explanation) follows it. None of this is prose and none of it is derived from raw text; the renderer must not decide the goal from the user message. It may acknowledge the user's words, but it does not explain a question unless the goal is `explain_question` (act accuracy and reply naturalness are evaluated separately).
- **Renderer writes every reply; the emergency wording and one authoritative statement.** Ordinary turns, explanations, asides, resumes, statuses, previews and semantic-failure recoveries are all written by the renderer from that context. Its prompt forbids describing the app's internals. Its output is rejected (one repair, then fallback) when it uses internal system/process vocabulary that neither the user said nor a plan label contains (machine keys and enum values of the plan data never count; snake_case codes always do), when it must ask the question (`askQuestion`) but contains no question (the question is bound to the reply as presented), or when it names work the scheduler left entirely out of a preview. Which work did not fit is scheduling truth, not wording: the application states it in its own sentence next to the rendered preview reply (`weeklyPlanningPreviewOmissionDisclosure.ts`), so no reply can claim such work is included. Only when the renderer cannot run (provider failure or outage gate, unexpected failure) or its output fails validation does the user see the short emergency wording of `weeklyPlanningInteractionFallbackText.ts`, composed from the same typed context around the application-typed question text (the shared typed question, date-interpretation and correction texts); it takes no routing status or preview sentence as input (typecheck-enforced), so such a sentence can never reach the user verbatim. These fixed texts are the interaction architecture's only fixed conversational Japanese and contain no internal vocabulary: the source-scan test checks them against its own stricter list plus the renderer output validator's list.
- **No-op retry.** A schema-valid empty delta under a pending question is retried (bounded) only when it is a contradiction (`answer_pending_question` without any delta, or no act at all); a self-sufficient act (explain / topic shift / resume / consultation) is a valid result and triggers no completeness retry.
- **One turn dispatch pool.** Every provider dispatch of a turn (focused routes, generic call, repair, completeness/dense audit, renderer) draws from one turn-scoped pool (`WEEKLY_PLANNING_TURN_AI_DISPATCH_LIMIT`, renderer reserve 1). Stages do not own stacking retry allowances. Exhaustion keeps an already valid semantic result and never becomes a connectivity failure; renderer exhaustion falls back to the emergency wording. Outage gate: while the turn's latest provider dispatch has failed, the enforced (interaction) pool refuses the renderer, so a turn that continues after a provider failure (for example a conversation-only rescue after the repair call failed) uses the emergency wording instead of waiting on the provider that just failed; semantic stages are never gated and a later successful dispatch reopens it. A failed renderer repair dispatch always ends in the fallback (shared adapter fix).
- **Conversational recovery.** A provider failure or a semantic/validation/canonicalization failure keeps the accepted graph, preview and machine state exactly (the retained state is the turn-start snapshot). Recovery is a typed `recover` outcome, not an application-written paragraph. Only when the previous question's presentation was `fresh` and the application has typed text for it is that same question re-presented and its presentation rebound to the recovery message; otherwise nothing is re-presented and no binding is written (fail closed). A semantic failure is rendered like any reply (`clarify_turn`: say briefly and naturally that the message could not be used, then the retained question or an invitation to continue); a provider failure is not rendered (the same provider just failed) and shows the short emergency wording: with a re-presented question it asks only that question (one request), otherwise it asks for a resend. Neither asks to resend after a semantic failure, invents a content question, explains the app's processing or exposes validator/provider payloads. The projected result and trace describe the retained state; they do not claim questions were cleared.
- **Proposal decisions.** A decision on a learning-strategy proposal changes its status only when it targets the proposal of the fresh presented question. This tightens the earlier "any pending proposal" behavior: a collective decision no longer settles a proposal the user was not shown (relevant to the Issue #152 V09 note); the other proposal stays pending until its own question is presented.

Deferred (not part of this change): generic evidence references and replay of a failed utterance (relative-date replay would need the original request clock), a durable freshness-reason diagnostic, and the Issue #246 consultation runtime.

## Runtime conversation architecture mode (Issue #488 comparison switch)

Two conversation architectures exist side by side so the Issue #488 interaction model can be compared honestly with what it replaced. The mode changes **conversation interpretation and presentation only**; neither mode weakens Fact Graph validation/provenance, revision/idempotency, scheduler/preview safety, explicit save approval or owner/chat isolation, and `legacy_v5` is the pre-#488 *conversation* architecture, not an older checkout (unrelated main/security fixes are kept).

- `interaction_v1` — the three-responsibility model above. **Default for new conversations.**
- `legacy_v5` — the Stable V5 conversation/control flow as of `ee07697e`.

**One policy owner, no mixtures.** `weeklyPlanningConversationArchitecture.ts` defines the typed mode and the capability policy derived from it (`conversationArchitecturePolicy`); there is no per-feature toggle, so a conversation can never run a mixture. `weeklyPlanningConversationArchitecturePreference.ts` is the only module that reads `VITE_WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_DEFAULT`, `VITE_WEEKLY_PLANNING_ARCHITECTURE_SWITCH_ENABLED` and the browser preference (a source-scan test enforces this). The mode is decided once per turn by the turn controller and then travels as a typed value in the turn input (`conversationArchitecture`): executor → Stable V5 runtime → semantic pipeline/normalizer input, validation input, dialogue render input. Nothing downstream inspects env, storage or query strings.

**Invariant the codecs rely on.** Loading materializes `legacy_v5` for a stored state that has an admitted turn (`conversationRequestSequence`, intake state, drafts or preview candidates) but no field, so the stored and in-memory forms are identical (the AI-planning module-reload readback compares them). In production an unpinned state acquires such turn-derived content only through `begin_turn` (which pins) or through codec hydration; draft blocks come only from turn-produced previews. A future non-turn path that adds such content must pin, or it reintroduces a readback mismatch (`load → serialize` round-trip identity is tested for pinned and pre-field-with-turn states). A state with no admitted turn (empty, or only an appended notice) stays unpinned.

**Session pinning.** `PlanningState.conversationArchitecture` (`'legacy_v5' | 'interaction_v1'`, strictly validated by both codecs; no free text) is written by the reducer at the first admitted turn (`begin_turn`) and never rewritten. Therefore it survives reload, chat A → B → A snapshots and week/session persistence. An empty conversation is unpinned; a new conversation (`reset_session`, new chat) captures the then-current default exactly once, at its first turn. Changing the preference or the build default never touches an existing conversation. A stored checkpoint that has an admitted turn (`conversationRequestSequence > 0`, an intake state, drafts or preview candidates) but no field was authored under the old architecture and hydrates as `legacy_v5` (never silently migrated into interaction semantics); a state without any admitted turn (empty, or only an appended notice) stays unpinned so its stored and in-memory forms are identical. The preference (`studyplanner.weeklyPlanning.conversationArchitecturePreference.v1`, `{version:1, architecture}`) is a per-device default for new conversations only, is honoured only while the evaluation gate is on, and is not planning state.

**Legacy fidelity map (what `legacy_v5` restores).**

| #488 change | `legacy_v5` |
| --- | --- |
| provider schema + meaning rule `conversation_acts` | pre-#488 schema/prompt without `conversationActs` |
| response validation / pre-parse | `conversationActs` is an unknown key (old rejection); no `conversationActs: []` in the empty-envelope rewrite; no act-target check |
| pending question in the public state | raw previous machine question stamped with the current graph revision; no freshness gate |
| no-op completeness retry | old eligibility (no self-sufficient-act suppression) |
| interaction decision / outcome / named-topic redirect | bypassed (no `interactionOutcome`) |
| renderer | raw `currentUserMessage` decides "explain" (old system prompt, prompt line and repeated-question repair text); no typed communication context, no aside path, no internal-vocabulary or disclosure output check; correction acknowledgement passed as the prewritten sentence |
| act contract / work-breakdown response contract | no acts at all; an empty planning delta under a pending work-breakdown question is still rejected (pre-#488) |
| failure presentation | fixed pre-#488 messages (`weeklyPlanningLegacyFailurePresentation.ts`, the only place the old generic wording lives), old projection ("questions cleared"), no retained/rebound state on `fail_turn`, no rendering of failures |
| fixed application texts | routing status/preview sentences, provisional-capacity system message, duplicate-submission and unexpected-failure wording exactly as before #488 (interaction shows none of them) |
| renderer adapter repair failure | shared robustness fix, not an architecture difference: a failed repair dispatch ends in the deterministic fallback in both architectures (before, it rejected the turn) |
| turn dispatch pool | counted, not enforced |
| proposal decisions | any pending proposal may be decided |
| question rebinding | every committed turn rebinds (unchanged controller path; the freshness gate was what #488 added) |

Fidelity is proven against the pre-#488 tree, not asserted: hashes of the provider schema, meaning rules, base messages, renderer prompt and public-state summary were produced from `git archive ee07697e` and are pinned in `weeklyPlanningConversationArchitectureOracle.test.ts`, and the dual-mode integration suite pins the historical control flow (for example the exact legacy explanation call sequence). If an unrelated main change intentionally alters a shared boundary, confirm it applies to both architectures and then refresh the oracle hash.

**Evaluation-only UI gate.** With `VITE_WEEKLY_PLANNING_ARCHITECTURE_SWITCH_ENABLED=1` (default off; production UI unchanged) App Settings → 週間計画AI shows a selector (`旧Stable V5` / `新Interaction V1`, "次の新規AI計画会話から適用") and the AI planning surface shows a compact strip with the mode the current conversation's next turn will run (its pin; for an old unpinned conversation with an admitted turn `旧Stable V5`; `未固定` and the mode the first send will pin for an empty one) and the latest turn's metrics. The setting can be changed at runtime without a rebuild.

**Measurement (identical in both architectures, observation only).** `weeklyPlanningTurnMeasurement.ts` records, per turn: architecture, request/turn id, wall-clock ms from user-turn admission to the commit/failure dispatch (injectable monotonic clock), provider dispatches (total/semantic/renderer, counted at the provider-client choke point independently of whether the pool is enforced, plus refused count), status (`committed`/`failed`/`discarded`), interaction outcome (null in legacy) and an architecture-neutral result kind (`preview`/`question`/`status`/`failure`), failure code, and whether a pending question was presented / re-presented. Records are in memory only (last 20, no user text, no storage, no network) and never feed back into interpretation. The local debug trace carries `conversationArchitecture` and `aiDispatchUsage` (enum + counters); they are deliberately not durable-diagnostic fields: a persisted turn stays attributable through its persisted provider request (the legacy schema/prompt has no `conversationActs`).

**Code rollback hazard.** Builds from before this switch have strict codecs that reject any `PlanningState` carrying `conversationArchitecture`: the weekly storage codec loads it as an empty conversation (and the next save can overwrite it); the session/chat codec makes the snapshot unreadable. Because hydration materializes the key, merely opening an old conversation on the new build can write `conversationArchitecture` at its next checkpoint, after which a pre-switch build cannot read it. Only conversations that were opened or ran a turn on a build with the switch carry the field; empty/untouched ones do not.

**Rollback / comparison semantics.** Rolling back is switching the next new conversation to `legacy_v5` (or setting the build default); existing conversations keep their mode. Measurements compare conversations of different modes on the same scenario; they are not planning truth and are not a substitute for the real-model/human gate.

## Availability

Existing StudyPlanner plans and timetable are authoritative busy sources in current production. Accepted hard availability/life constraints and the request-time `notBefore` boundary reduce candidate space; preferences/personalization do not create free time.

Required-source failure is not equivalent to a successfully loaded empty source. Sleep end does not necessarily imply study-available start.

See [Availability Architecture](weekly-planning-availability-architecture-v5.md) and [Scheduling Policy](../policies/scheduling.md).

A consultation answer may consume a deterministic capacity/availability summary when it materially affects advice. The answer model does not become an independent owner of free-time calculation or feasibility.

## Human grounding and memory

Application-only knowledge is not automatically shared ground. Current-week acceptance, durable preference and observed learning evidence are distinct states. One week-local acceptance is not promoted to a durable preference without the required scope/consent.

Authoritative app data may be used as grounded known context so the user can be asked for additions/deltas rather than forced to restate known facts. Renderer must not invent fields absent from that data.

AI-generated consultation advice is not durable user memory. If the user separately expresses durable meaning such as `今後もこの方法でやりたい`, the existing user-context/memory authority owns that promotion.

## Planned consultation/advice boundary — Issue #246

The following is a planned extension, not a current production guarantee.

```text
raw user turn
→ AI semantic interpretation
→ validated consultation contribution
→ deterministic context assembly
→ bounded source-grounded consultation context
→ separate learning-advice answer purpose
→ validated advisory result
→ deterministic conversation-scoped advice lifecycle
→ user sees advice

user later accepts/modifies/rejects
→ AI interprets response/reference meaning
→ deterministic advice identity/revision binding
→ accepted scope is promoted into normal Stable V5 planning contributions
→ existing readiness / scheduler / preview / approval / save
```

Non-negotiable boundary:

```text
AI advice
≠ accepted Fact Graph truth
≠ scheduler command
≠ preview approval
≠ saved Plan
≠ durable memory
```

Exact state/schema details and future phases are owned by [Learning Consultation and Advice Contract](../spec/learning-consultation-and-advice.md), not duplicated here.

## Preview / approval / save

Preview is unsaved and bound to owner, conversation, graph revision and source facts. A semantic change after preview requires a fresh preview. AI output alone cannot bypass approval/save.

If saving only part of an approved batch succeeds, the remaining draft snapshot keeps a versioned local recovery receipt containing the available frozen batch payloads and original operation membership/identity. Previously acknowledged items may lack payloads in an older partial snapshot only when the retained operation records their saved Plan IDs. Both compatibility and Stable V5 checkpoint boundaries validate and retain it; their compact representation stores each payload once and resolves unique remaining-block references before validation. A retry rechecks owner, current revision, conversation/runtime and assumptions against the original batch; it never constructs a new operation from a smaller remainder. Confirmed items disappear from the preview, while unresolved payloads stay unchanged until retry or explicit session reset. A failed finalization retains the completed receipt so the next attempt only finalizes, without re-saving items. Clearing a session does not undo already committed Plans.

The receipt is recovery evidence, not approval authority or AI input. Its frozen draft payloads remain in owner-scoped local session/chat storage and are excluded from approval trace and outcome telemetry to avoid duplicating titles, memo and material details. Existing operation IDs, item results and counts remain the diagnostic evidence. Server Plan/item identity and atomic-save rules are unchanged. Historical remainder-only snapshots that already lost the original batch cannot be reconstructed unambiguously; this does not claim retroactive recovery for them.

Pending assumptions, deferred repair that still affects preview/save, stale source revisions or unaccepted proposals must not silently become saved truth.

Consultation advice is upstream of preview. Displaying or persisting advice alone must not create a preview. A preview can be produced only after accepted advice scope has been promoted and normal readiness requirements are satisfied.

## Persistence / trace / security

Persisted/session state is owner- and conversation-bound. The public conversation-import facade accepts unknown input and owns canonical codec validation before runtime hydration, controller reset or state/storage mutation. Invalid or oversized snapshots return false without changing the current session; callers do not need to pre-parse or remember an internal validation sequence. In-memory recovery snapshots use the same compact wire representation for size validation as storage, without silently trimming imported messages. Trace is diagnostic evidence, not authorization or planning truth. Untrusted stored strings remain data rather than instructions.

Saved component ancestry must reference components in the same task and contain no parent cycles. Provider-local and canonical stored IDs share the same cycle policy; each boundary owns reference/ownership diagnostics. Historical removed or superseded facts retain their valid parent links, with lifecycle availability evaluated separately. Invalid ancestry is rejected before checkpoint/import acceptance rather than repaired by dropping links.

Saved workloads may have no component, or reference a component of their own task. Temporal constraints and recurrence facts target their own task or one of its components, including in retained history; date rules continue to target their containing task. Live effort estimates must target a task, component or workload owned by that same task. Explicitly removed/superseded effort facts retain correction provenance: a historical estimate can keep its original task while its referenced replacement workload has been rebased. Preserve that terminal history and its existing target references; do not reactivate it or rewrite it to satisfy a live-fact constraint. Lifecycle status tags must be literal supported strings, not values accepted through string coercion.

A single owner/application-lifetime chat facade owns the active index and checkpoint/navigation ordering; UI surfaces consume its immutable index and typed outcomes instead of rebuilding snapshot/index steps. The live application state remains the sole unsaved conversation authority. A view-only remount reconnects to that session without re-importing older disk state. Unavailable index or active-snapshot reads are distinct from an absent store: initialization must bind successfully before checkpoint writes can adopt an existing chat. Retry reattempts that binding, while an explicitly confirmed new conversation may preserve an unreadable old chat without overwriting it.

A completed preview edit must update its restorable chat snapshot before control returns to navigation; rendering frames are not a persistence boundary. An authoritative empty conversation must replace an older non-empty chat snapshot, while a pending or invalid chat-snapshot update must not overwrite it. Chat export may explicitly include a validated empty checkpoint; the ordinary session-store policy may still omit empty checkpoints. Empty state and unavailable export are distinct outcomes. If a required snapshot/index write fails, keep live state, report a retryable failure and block conversation replacement. Optional search-cache failure does not invalidate snapshot success. Ordinary surface navigation remains available because the live session outlives the view; a dirty-only document-exit warning cannot guarantee recovery after a forced reload/browser kill. Destination validation and runtime ownership checks precede index writes; delete cleanup follows a successful index update. Session-generation and lifetime checks also revoke callbacks across A→B→A owner changes and application unmount.

The direct Stable V5 session-save API rejects an invalid graph without overwriting the existing checkpoint bytes. This is not an application-wide promise to retain an old checkpoint: `saveOwnedWeeklyPlanningState` deliberately clears that Stable checkpoint and persists compatibility state when the direct save returns false. Valid empty-state removal and quota-compaction policies also remain separate. Keep tests and reports explicit about which storage boundary they establish.

When consultation is implemented, advice/context/retrieval strings remain untrusted data. If prompt, request/response, trace or persisted session fields change, the feature-local `src/features/weeklyPlanning/AGENTS.md` trace persistence gate applies.

### AI runtime module recovery

The application loads the AI-turn runtime before OCR, clearing the composer, or beginning a turn. A module-load failure keeps input local and permits one explicit code-only retry; it never retries OCR, provider execution, approval, or persistence. Awaited preflight is bound to committed planner inputs and the current owner/chat/state lifetime, including A→B→A transitions. It must not admit a retained request after those inputs change.

Planner collections are admitted through the owner/reset and accepted-projection lease supplied with those exact arrays, as defined by [Planner read projection recovery](../../client-runtime/architecture/planner-read-projection-recovery.md). Check that lease against live readiness before and after module preflight and again after OCR at admission; becoming ready on a newer projection never validates an older request. A revoked lease must produce a data-changed explanation while retaining exact input and the attachment, with no automatic resend or module-recovery misclassification. Pending read recovery disables submission while leaving the draft and conversation accessible. This adds no cancellation guarantee after turn admission.

A separate explicit reload action first checkpoints and re-reads the canonical chat snapshot/index, then verifies a small per-tab recovery capsule in sessionStorage. The capsule is versioned, bound to owner/chat/conversation/week/state revision, limited to 2 MiB of serialized data and 30 minutes, and contains exact composer text, projected starter metadata, and supported original image bytes. Revalidate the durable chat and current lifetime after asynchronous image serialization and immediately before reload. Quota, invalid data, oversized images, or failed checkpoint/read-back keep the current editable draft and block reload, with copy/reattach guidance. The ordinary 15 MiB attachment limit does not imply that every attachment fits this recovery capsule.

Restore only after canonical chat hydration, without overwriting a nonempty composer. Consume the exact capsule only after its draft has rendered. Revalidate restored starter references against the current catalog before OCR or submission; do not silently drop an unavailable target. Restoration never automatically sends a turn. The capsule is transient UI recovery, not Fact Graph authority, a durable conversation store, or diagnostic trace data. Preflight failures occur before turn admission and create no provider request/turn diagnostic; tests verify that boundary. Other lazy-loaded app surfaces and already-admitted runtime failures are separate responsibilities.

## Testing

Deterministic tests own deterministic invariants. Model-dependent semantic/dialogue behavior uses the real-API/human-review gate defined under `quality/`. Exact completed Japanese wording is not a universal oracle.

Version-independent safety scenarios are maintained in [regression-scenarios.md](../quality/regression-scenarios.md). Historical V4/task documents may supply evidence, but current guarantees must be expressed through current tests/contracts rather than relying on archive text alone.

Issue #246's unimplemented acceptance/test matrix remains in its canonical requirement until production implementation exists. Do not list unimplemented consultation behavior as a current regression guarantee solely because the requirement has been documented.

## Execution ownership

Execution order is owned only by [the current roadmap](../roadmap/current.md). Do not duplicate the current queue in this contract.
