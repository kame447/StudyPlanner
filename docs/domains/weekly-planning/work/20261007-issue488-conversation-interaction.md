# Issue #488 conversation interaction layer

Status: active-work record (campaign integration and final evaluation owned by the parent)
Updated: 2026-10-08

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
- Presentation: deterministic code hands the renderer a typed communication context (goal, question purpose codes, later needs, status reason, disclosure, flags; corrections as typed before/after). The renderer writes every interaction reply, including semantic-failure recovery; provider failures are not rendered. Internal vocabulary in renderer output is rejected (one repair). `weeklyPlanningInteractionFallbackText.ts` owns emergency composition; the shared typed question/correction text and application-owned omitted-work/unmet-condition disclosures are also fixed wording. The application disclosures appear next to normal as well as emergency replies. A source scan classifies every Japanese literal of production weekly-planning code.
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
- Real UI / real provider E2E (Computer Use, 2026-10-07, on this branch at `50c90af6`) found merge blockers outside the conversation layer and some in it. Fixed by focused agents and integrated here, each with production-controller regressions:
  - C: a correction lost to an echoed rate citation, plus a stale preview kept;
  - D: an accepted session length ignored by the scheduler;
  - A: plan-wide preferred hours ignored;
  - F: the scope question looping because a stated time budget had no schedulable work.

  Presentation fixes:
  - recovery never re-asks what the user just said;
  - preview/status replies never describe candidate contents or claim new or changed candidates without a new preview;
  - an unanswered consultation is not phrased as a refusal.

  The extra time is intentional allocation; arithmetic and disclosure are owned by the [scheduling policy](../policies/scheduling.md#estimated-effort-and-allocated-time).
- Contract: [current-contract-v5.md](../architecture/current-contract-v5.md#conversation-interaction-three-responsibilities-issue-488); scenarios DIALOGUE-007, 009, 013, 014.

## Real E2E blocker campaign (2026-10-07–08)

Documentation checkpoint starts at `b7e971ee` on the existing `feat/issue488-conversation-interaction` branch and includes subsequent B/latency/persistence/label integration through `dc439466`, with canonical documentation integrated as `2f9ae953`, including main reconciliation `7a50d2df`. This round follows the first-pass `e34b3c02` fixes; no new Issue/PR/replacement branch or production deployment was created. Current behavior is owned by the [interaction contract and fidelity map](../architecture/current-contract-v5.md#conversation-interaction-three-responsibilities-issue-488), [scheduling policy](../policies/scheduling.md) and [A–G regression catalog](../quality/regression-scenarios.md#8-real-ui-ag-campaign-regression).

| Finding | Root cause / integration checkpoint |
| --- | --- |
| A: accepted 20:00 preference placed at 14:35 | A task-scoped start-only window collapsed to a date-only preference; `3d9cb5a8` preserves clock shape, unresolved-preference questions, midnight hard availability and soft-available ranking |
| A/G: non-recurring weekday preference vanished outside the plan | Request-clock weekday resolution could precede the accepted planning week; shared `494f99e8` asks its date scope rather than reinterpreting it, and in-window weekdays ask nothing |
| A/G: repaired full request lost work/constraints | Date-range repair taught unsupported `..` (`78b400db`, interaction-only); localized date errors were missing from conservation checks (`3d9cb5a8`, shared preservation) |
| B: effort answer could preview with material identity still pending | Any delta retired the pending uncertainty; `757c8f77` uses exact-target/dimension resolution in contextual binding and commit reconciliation, including unknown free-form fields |
| C: old preview remained after accepted correction/added conditions | Keeping a repair preview checked supersession only; `5f926c38` adds basis invalidation and unchanged-status gating; `6070bf4f` connects actual-condition claims and proves corrected preview provenance |
| D: text implied evening/split that the actual slots did not satisfy | Renderer saw accepted preferences without actual-placement evidence; `7527d1d9`, `ef3d7a51`, `2baf8749`, `6070bf4f` supply typed evidence, output gates and application disclosure |
| D: per-session hour replaced the total, and both-task preference reached one task | Semantic interpretation faithfully emitted the wrong total/scope; interaction-only `500173e0` instructs session_duration/count without replacing total and distributes collective preferences to every referenced task, with at most 350 bytes of documented prompt growth |
| D: page/problem work ignored the session length and called a computable violation unverified | Shared `ab3d2e6e` applies whole-unit session caps before margins, preserves true slice cost/ranges/cap references, and reports an indivisible over-cap unit as not_satisfied |
| D: other countable units and unsplit fallback hid applicable session evidence | Shared `8de553d4` extends whole-unit caps to all positive integer content counts, preserves atomic/fractional/time-unit paths, and judges unsplit blocks by actual length with the session source fact |
| D/E: split sessions became one back-to-back block | Preferred-slot search ignored placed siblings; shared `1b69667c` prefers unused eligible days while preserving safety/reserve and same-day fallback; condition evidence also covers soft availability and alternative-window unions |
| D/E/G: candidate count sounded like separate previews and the reply repeated margin arithmetic | Interaction prompt `2c266f44` defines one preview containing N blocks and leaves estimate/margin wording to the application display; legacy prompt unchanged |
| A: reply echoed an omitted/unaccepted time condition | `6ad6a3dc` / `3d344a19` instruct interaction replies to acknowledge only typed acceptedFacts; unaccepted times/days/amounts may be queried, never echoed. Legacy fingerprints are unchanged; live compliance remains a model-evaluation gate |
| A (final live run on `2f9ae953`): 「平日は20時以降」 rejected the first turn | A task date field has no weekday-set form; the model wrote 「平日」 there and its one repair invented a task recurrence, which the preservation guard correctly rejected. `8aae7738` lets an interaction repair restate the fact per weekday (union kinds only) or move availability scope into `recurrenceKind`/`days`, and restores legacy's pre-#488 unguarded date repair that `3d9cb5a8` had changed for both architectures |
| A (final live run on `916e547f`): the per-weekday repair still failed | The provider had also bound the bookshelf material id to the task itself; the parse-stage date error hid that binding error until after the one repair. Review of `8aae7738` also found that the guard compared the raw first response with the projected repaired document, could move an already typed availability scope (busy Tuesday to Friday) and rejected valid grouped or clock-flagged restatements. `014dd730` compares the provider documents of both responses, keeps typed availability scope, groups date-only-different facts, and treats a first-turn task bookshelf id with a matching label as a new task when exactly one task in the response cites it (`730d165c` follow-up: two citing tasks would otherwise double the work). A second review found that a split `excluded_date` weekday set would leave next week's Wednesday open, because a date rule's weekday token is its next occurrence from the request date; the restatement is limited to preferred windows. Parse-stage errors still hide later-stage errors from the single repair, and a single-weekday date rule outside the planning week remains a pre-existing gap |
| C (final live run on `d7b85616`): the 20-page correction was rejected and the reply invited promoting the old 30-page preview | The first response omitted the replacement and deadline; the one repair added the deadline as 「金曜日」 (a new representation error). Interaction repairs now carry a canonical-date reminder, and an unusable turn no longer passes the promotion control to the renderer. The correction itself still depends on one valid repair |
| D (final live run on `fa6347e6`): 「1回1時間くらいで2回に分けたい。どっちも夜がいい」 came back as accepted-task shells only and the reply said the preview was unchanged | The no-op re-read applied only under a pending question. Interaction now re-reads once when an act-less response names accepted tasks without content; acknowledgement turns that name tasks pay that one extra call. Two components citing one bookshelf id are no longer both projected |
| E (final live run on `65f178e0`): 「土日にまとめてやる感じでも大丈夫？」 got 「まとめて進める形については、今の候補のままです」 | The typed consultation evidence was sent together with `statusReason=preview_unchanged`, and the renderer led with the unchanged report. An evidenced consultation turn no longer carries that status reason; wording quality remains a model gate |
| H (final live run on `b3204cdd`): 「じゃあ水曜の夜にまとめて」 was placed Wednesday 09:00 | The first response put 「夜」 on an allowed_date rule; the repair cleared the period and the evening meaning was lost silently. Interaction repairs now keep a date rule's time of day as a separate preferred/avoid window. Recover replies that still offer the promotion control get one repair (review of `fa6347e6`) |
| C (live run on `8c4ef790`): the first document kept only the task, so the reply asked about the bookshelf's remaining 530 pages instead of the stated 30 pages | The coverage audit required a predicted missing effort; a new task with no work item was not audited. The audit now also covers that predicted re-ask. The same run's correction turn wrote 「金曜日」 as this week's 2026-10-09 (temporal intent the model owns) |
| B (final live run on `d7b85616`): material-confirmation loop (T4–T6) and lost T3 rate | The `material_identity` need targeted the material component, which only a new task-level material component could retire; relabel was ignored, self-bound modify and dependent-holding remove were rejected. NimbleKepler's patch makes the relabel a typed identity answer and binds a public-id rate reference for one accepted same-unit workload to the task. Review (TanLangmuir/SturdyEdison) found the task-scoped rate would widen to later same-unit work; NimbleKepler's follow-up commits it on the exact workload and rebases correction/decision intents. Trace persistence of the projection marker and rebased-id evidence are follow-ups |
| B (live run on `dc38e978`): T4 still re-asked the material | This run's need targeted the task (free-form field), the model added the right new material component but also sent it as the replacement of the task; the canonical owner rejected the kind mismatch after validation, with no repair left. Interaction validation now reports the mismatch so the one repair keeps the component without the correction |
| B (final live runs on `64436073`): 「青チャートのこと」 after the preview was lost (run 1: shells only, reported unchanged; run 2: `stable_v5_canonicalization_rejected`) | Neither run raised a material question (provider variance), so the material was named after the preview. Run 2's relabel of the bound material was dropped as a binding-only shell and re-read as a no-op; the re-read replaced the component by a new one, which the canonical owner cannot apply, after validation. Interaction now treats a pure relabel without an open question as the material's identification (new version, dependents moved), and reports uncorrectable replacement kinds at validation for the one repair |
| B (live run on `b2fbd121`): T1 asked the material, T3's pace kept no preview, but T4 「青チャートのこと」 was rejected after the one repair | The answer cited the bookshelf id on a new material component of the accepted task (outside the new-task projection) and added a remove-the-task correction carrying a replacement; the repair only cleared the replacement. A task with no material yet now accepts the bookshelf citation as its new material, and that repair is told to keep the task and add the named fact without a correction. Review of `b2fbd121` (SturdyEdison) tightened the no-question relabel: its label must be evidenced by its own current-turn source, and any same-turn uncertainty about the task blocks it |
| B (live run on `48a42eec`): T3 「1問3分くらい」 rejected after the one repair | The first document failed parse-stage checks (empty task fields), which hid a workload id sent as a second task's existingPublicId; the repair fixed only what it was shown. The same masking caused earlier A and C rejections. A second (staged) repair was tried and withdrawn: AGENTS.md allows at most one semantic repair. Residual; follow-up: on a parse-stage failure, a lenient diagnostic parse computes the post-parse errors so the single repair sees both stages. Reviews of `48a42eec` case-fold the relabel label-evidence gate (`focus` → `FOCUS GOLD`) |
| B/D (live runs on `c82e89cf`): naming a material in the follow-up re-read | Listing a material component among the re-read's typed fields helped one B run record 「青チャート」, but both D re-reads then added spurious material components quoting 「どっちも夜がいい」 (one also lost the split). Reverted: the generic re-read must not suggest a field the user did not mention. B's shell-only T4 stays a provider-variance residual (reported unchanged, truthfully) |
| D (live runs on `91e560cb`/`4c757093`): 「1回1時間くらいで2回に分けたい。どっちも夜がいい」 not applied | On `91e560cb` the first response was task shells and the re-read, which encoded the request but targeted accepted workloads by public id, was dropped (reported unchanged, truthfully). `4c757093` sent such an invalid re-read to the turn's one repair; live, the repair re-grounded restated workloads in the current text, they became new duplicate workloads and the pace was asked again. Reverted: repairing a re-read can turn restatements into new facts. Residual: the shell-only follow-up is provider variance; the reply stays truthful |
| C (live runs on `d7b85616`/`8c4ef790`): 「金曜日までに」 for a next-week plan | Pre-existing: hard weekday tokens resolved to the next occurrence from the request date, and a hard bound before the window produced a false capacity shortfall. StellarLeeuwenhoek's shared fix resolves them inside the accepted window and asks when a resolved bound (even an absolute model-chosen 10/09) is outside it; parent added the unresolved-horizon guard. Persisted resolved-date snapshots are a follow-up |
| A (live run on `cf6afe48`): first turn rejected again | 「平日」 in the task dateExpression again; the repair split it but returned a correction delta that dropped the window, pages and pace. Most failing live A first turns share that first-response shape, so the interaction meaning rule now names the weekday-set representation (+140 B, interaction budget 450 B, five interaction fingerprints refreshed) |
| A (live run on `e9b62a50`): no repair, but five undated preferred windows | The weekday limit was silently lost ("every day after 20:00"). The rule now names the weekday token (`3c033805`), and interaction validation rejects facts that differ only by localId so the one repair dates them (TanLangmuir's structural net). A weekday-set schema slot would remove this class |
| D/E: unmet conditions rejected required ACK, or consultation asserted unchecked feasibility | Interaction-only `56ab49e7` adds neutral accepted-fact ACK and one repair per dedicated rejection reason; strict feasibilityClaim is checked against consultation evidence. `dc439466` removes the exact-task scope exception because aliases/「も」 can name an unmet task; task-label stripping only avoids mistaking a task name for a condition claim |
| E: weekend consultation got a non-answer | Blanket advice prohibition and no bounded evidence; `ef3d7a51` adds accepted-plan-only advice and standalone consultation aside routing; hypothetical alternatives remain unassessed |
| F: total-time request repeated scope questions | First-pass `fec2c009` projects a quantity-less task's time budget; `a56e53e2` resolves known time windows independently of work projection, and `d0a53449` verifies the six-turn next-week/night/60-minute-session sequence and retained material-identity blockers |
| A/B/D/G: 60-minute estimate shown as 70 with no reason | Intentional allocation had no visible basis; `1592fbfa` carries estimate/margin/rounding evidence to preview UI, `cd2a47f3` admits that evidence through checkpoint validation/reload, and `36cf485e` formats sub-hour margin labels correctly |
| A/C: schema-valid first document omitted stated pace/conditions | Interaction-only `ca8164a1` selects the existing AI completeness audit using literal leaf-citation gaps plus typed missing-effort prediction; failure retains the initial valid document, and complete/time-budget work is not audited by this route |
| Latency: repeated semantic/renderer repairs | A bookshelf id was bound as an active graph component and an ACK stayed only in metadata; `3148f379` projects exact owner-scoped new-material references and validates composed accepted-fact acknowledgements (interaction-only) |

Verification checkpoints, not a final live-model claim: `6070bf4f` passed `npm run verify` (fresh app/Worker types, 768 files / 6116 tests, production build). `b7e971ee` passed the dedicated scripted desktop/390px browser campaign (10/10); the parent recorded a legacy differential against `ee07697e` with 10 scenarios and zero differing leaves. These fixed-scope checks do not prove every newly shared scheduling input identical to the old tree or a later integrated HEAD verified. At `d0a53449`, the parent also recorded 483 weekly-planning files / 3032 tests green; at `ab3d2e6e`, 487 files / 3091 weekly-planning tests and the critic's page/minute session-cap probe passed. Final combined verification, broad browser/real-provider reruns and a short Gemini/human naturalness judgment remain with the integration owner.

The controller/trace suites retain actual requests, interpreted state and display decisions through failed append, persistent outbox retry and Worker preparation, including byte limits, a future-field sentinel and explicit large-value truncation. A development trace outbox `trace ownership mismatch` was independently reproduced before this campaign: the direct development repository expects owner-bearing legacy entries while receiving V2 diagnostics. It is separate operational work; this campaign does not claim it fixed or hide its failed upload as a successful remote trace.

All campaign code at this documentation checkpoint is integrated through `014dd730` (weekday-set date repair and provider-document repair preservation after the final live A runs): MAJOR-2 gains repair/ACK handling in `56ab49e7` and conservative alias-safe claim checking in `dc439466`, the countable-unit cap extension in `8de553d4`, the initial page/problem correction in `ab3d2e6e`, coverage auditing in `ca8164a1`, and temporal/F in `a56e53e2` / `d0a53449`. Current deployment/issue-close readiness is not established by that implementation checkpoint. Sibling-session spacing and both condition-projector review findings are integrated in `1b69667c`; repeated registered-material-id behavior is covered by `9bfad1ad`. Final verification must follow all integrated corrections, rather than reuse the earlier green snapshot.

The critic also identified release/acceptance gaps that this campaign does not close: new `conversationArchitecture` and shared `allocationBreakdown` data is unreadable by particular older strict readers (see the [rollback hazards](../architecture/current-contract-v5.md#runtime-conversation-architecture-mode-issue-488-comparison-switch)); no reader-first rollout or old-tab migration has been implemented. The A–G/H campaign is not the full Issue #488 acceptance matrix: recent-context expansion/compaction, failure-reason reuse and broader anaphora evidence remain unproven. No issue-close or release-ready claim follows from this campaign without the owning Issue's scope/evidence reconciliation. The single live consultation-feasibility assertion despite `not_evaluated` evidence prompted the strict metadata/repair fix in `56ab49e7`; the final real-provider gate must still verify natural wording and accepted-plan scope, not just a metadata value. Fixtures now use synthetic material ids (`6f12dd9b`).

## Deferred

- Real-model and Gemini/human evaluation of the new renderer wording and of act emission accuracy (deterministic tests prove contracts only).
- The application-typed question texts reused as the interaction emergency question (shared with legacy, e.g. 「…の意味を一つに決められませんでした」) are emergency-only in interaction but still mechanical; changing them requires an interaction-only copy to keep legacy fidelity.
- The composer's error banner shows the raw message of an unexpected (non-controlled) exception; provider/semantic failures never reach it. UI-scope follow-up.
- Generic evidence references; replay of a failed utterance (relative dates would need the original request clock); edit/resend remains the fallback.
- Durable freshness reason in the persisted turn diagnostic (only presence of the offered `pendingQuestion` is persisted; `interactionOutcome` and the freshness status stay in the in-memory debug trace by design).
- Full Issue #246 advice/proposal/adoption runtime and hypothetical-alternative feasibility. Bounded accepted-plan consultation is now implemented; it does not adopt advice or run a hypothetical scheduler.
- Recent-turn window change mentioned in the Issue body.
- Real-model accuracy of act emission (needs the real-API gate; not run here).
- Product decisions left open by the second review: an explanation or aside next to a kept preview is answered as an ordinary preview/status turn; an unknown named topic and no topic both resume the current question; several acts in one turn follow a fixed precedence (resume > explain > untargeted aside) rather than temporal/retraction meaning.
- Not done: making `conversationArchitecture` required at every turn boundary (absent = interaction default), and a measured fallback rate per goal for the real-model gate.
- Campaign work still needs the final combined HEAD gates and real-provider/mobile recheck. The final integrated code now includes countable-unit caps and dedicated claim/feasibility repairs; richer preview prose beyond the existing typed evidence remains deferred. Repair-call reductions have deterministic/live-response replay evidence, not a universal latency bound.

## Round 2 checkpoint (2026-10-08) — code-only resume confirmed by the user
- Branch `feat/issue488-conversation-interaction`. The integration tip `e3f74a04` is closing tip `2d4930bf` with main `3a1e60b9` (#529–#532) merged in.
- #530's shared persisted-state authority (`weeklyPlanningStateCodec.ts`) now carries `allocationBreakdown` and `conversationArchitecture`. #532's lifecycle cases run under both architectures.
- Scope:
  - live B, D and E reliability: B material answer (NimbleKepler); D duration targets and omission audit (StellarLeeuwenhoek); D stated budget versus bookshelf scope (TanYukawa); E consultation what-if evidence (SturdyEdison);
  - renderer action token (PinkBoltzmann);
  - bundle audit (RockyFranklin).
- Excluded: no accounts, data seeding or approve/save, and no push, PR, merge or deploy.
- Live E2E: preview-only on the user's account, approved directly by the user.
- The old-build deletion fix is its own release unit: `fix/weekly-session-preserve-unreadable` on main `38dabae3`. It must be deployed before this branch.
- Rules: at most one semantic repair per turn; `legacy_v5` byte-identical; one semantic patch integrated at a time, each followed by the scripted A–H suite and the legacy differential.

## Round 2 handoff checkpoint (2026-10-08): handoff to a fresh orchestrator (user-directed)

- **Code baseline: `584a64ab`.** This docs commit leaves the code unchanged.
  - Since `e3f74a04`: renderer short action token; exact-public-id duration binding; consultation what-if evidence for an alternative placement; evidenced preview-creation claims; the WS1 merge (`bdcf2325`, unreadable persisted sessions are quarantined, never deleted); the fixed-event-only handoff to 「予定を追加」 with two non-mutating acts; and the repeat-request and consultation follow-ups.
  - Scripted gates: `npm run verify` green (824 files / 6,926 tests); boundary categories, weekly-real Playwright and the extended legacy differential all unchanged; main browser suite green except the 2 known macOS geometry cases and load-only timeouts that pass alone.
  - Bundle gate: fails (JS 2291.1 / 618.9 KiB against 2187.5 / 587.9 KiB).
- **Real-provider evidence differs from the scripted evidence.** Live EV on `584a64ab` still loops.
  - The model raised a planning-window uncertainty ("tasks"). Replacing the window rejected the correction (active dependent), or left that uncertainty active on the superseded window. Neither the event nor 「特にない」 can resolve it.
  - The settled fix direction: invalidate a window-targeted uncertainty when the window changes, keep it when the window is identical; interaction-only suspension when a projected compile has no movable work; a write-result invariant only (never the load validator); load tolerance for dangling references. It is unintegrated WIP.
  - Live A–H have not been re-run on any round-2 tip. Save/reload and the exam-student persona E2E have not been performed.
- **Unintegrated work at handoff, all frozen as patches with checkpoints:**
  - EV window fix (WIP);
  - B focused material/pace answer v4 (WIP; v1–v3 rejected by review);
  - D(b) re-read retention v2 (review MAJOR open: components and category are not compared);
  - D run-2 audit complement (prototype);
  - WS1 size reduction (WIP).
- **Release blockers:**
  - WS1 on current main (`da2e60e9`) exceeds the main bundle caps by +722 raw / +437 gzip;
  - #488 exceeds them by about +100 KB / +30 KB;
  - per the user's handoff direction, caps may be adjusted only with separately measured performance evidence, and no number is pre-approved;
  - ACs 3 and 7, and parts of 2 and 4, remain unmet. No close claim.
- **Full handoff with ownership, artifacts, commands and decisions:** `handoff-to-fresh-orchestrator-20261008.md` in the campaign runtime directory (`issue488-e2e-blocker-campaign-20261007`). The previous orchestrator writes no further code; the next one reuses this branch and Issue.

## Round 2 resume checkpoint (2026-10-08 13:26 JST): ownership transferred to a fresh parent

- **Owner:** the user resumed the work under a new single parent and integration owner. The previous orchestrator released ownership and writes nothing further; its children stay frozen and read-only.
  - Same branch (local only) and same Issue.
  - Code-only, local commits only: no push, PR, remote merge, deploy, GitHub comment, credential/production-setting change, account creation, data seeding, or approve/save/reload of real data.
  - Live E2E stays preview-only on the authorized account.
- **Exact state at resume:** branch HEAD `53b54d04` (docs-only over the verified code `584a64ab`), clean.
  - `main` is now `22847120` (#537, #538 and #539 merged after the handoff).
  - #539 raised the aggregate JS caps to 2,260,000 raw / 608,000 gzip bytes. WS1's fit and #488's overrun must be re-measured against these caps.
- **Decisions taken at resume:**
  - **Window-replacement equality rule:** typed payload, no clock.
    - An identical window keeps a window-targeted uncertainty, with its id.
    - The same canonical kind with a different value invalidates it.
    - A cross-kind change or a free-text named-period difference counts as unknown and keeps the question. A question is never hidden.
  - **Already-dangling window uncertainties** (written by main and by `584a64ab`): reconciled by the same rule at the next write, together with any pending question bound to them. Loading still tolerates them in both architectures.
  - **Question wording becomes its own work item:** separate existing-schedule, new-registration and study-task questions by typed intent; no abrupt 「作業」 and no internal terms. No surface-wide replacement.
- **Team:** independent implementers for:
  - the event-window loop;
  - the material/pace answer;
  - re-read retention plus the budget complement;
  - question wording;
  - release/bundle measurement.
  - Separate cross-model auditors review them. Each implementer delivers a patch from its own worktree; only the parent integrates and runs the full chain.
- **Integration order:**
  1. merge `main`;
  2. the event-window loop fix, then a live re-run of that scenario;
  3. material/pace;
  4. re-read retention, then the budget complement;
  5. question wording;
  6. the WS1/bundle decision;
  7. final quiet-machine chain and live A–H plus the event scenario (preview only).
- The detailed live checkpoint (agent names, models, states, hashes) is `tealgoodall-checkpoint.md` in the campaign runtime directory.

## Round 2 resume progress (2026-10-08 14:50 JST)

- **Integrated as local commits**, each after an independent cross-model audit PASS on the exact patch:
  - `9622bbf9`: merge of `main` `22847120`;
  - `63b7b113`: material/pace focused answer, plus the one-semantic-repair ledger;
  - `d282d62a`: intent-aware question wording;
  - `299d5d06`: two stale wording assertions;
  - `9ea3b882`: event-window loop fix, plus the quantity-role pace carry. The carry is a documented shared fix that also applies to legacy.
- **Verification so far:**
  - The full chain on `d282d62a` was green apart from the stale assertions, which are now fixed. Browser failures there are only the macOS-environment cases that also fail on `main`, plus load-sensitive specs that pass alone. The legacy differential is unchanged.
  - The full chain on the new tip runs next.
- **Release:**
  - The reader-first fix that preserves unreadable sessions is ready on its own branch as a merge with current `main`. It is verified, independently audited, and fits main's recalibrated caps. Push, pull request and merge await the user.
  - #488 exceeds the JS totals. Measured cold-start cost and a cap option are in the bundle report, for the user to decide.
- **Open:**
  - re-read retention v4.1, plus the budget complement;
  - the empty-invitation decline follow-up;
  - a live re-run of the event scenario and live A–H. These are blocked at the moment: the production Firestore project returns `resource-exhausted`, so the app cannot pass its first-use check.
- **Not in this round:** the unmet ACs 3 and 7 (anaphora across turns; test-fixed recent-context retention). `STABLE_V5_RECENT_TURN_LIMIT` is still 4.

## Round 3: E2E-first results (2026-10-08 20:40 JST)

Judged by the user's standard: a passing scenario is a provisional confirmation. A fix is root-cause only when it names the common cause and holds on every affected path. Issue #488 is **not complete**.

- **New local commits since 14:50 JST:** `ad1e7784`, `9d1d63f7`, `b448cefe`, `8dcb6ca8`, `35c89d76`, `4b431c34`, `d645068a`, `97149799`. The final HEAD is `97149799`, docs-only on top of `d645068a`.
  - The Codex implementers and the cross-model auditors hit the Codex usage limit, so their frozen work was recovered and completed by the integration owner.
  - The only review of the completed code was by a read-only critic of the same model family. The report states this independence limit.
- **Fixes:**

  | Fix | Classification |
  |---|---|
  | Replacement-correction repair guidance | provisional; fails safe |
  | Numeric literal-coverage bound | provisional; literal-span detection |
  | Re-read retention on every interaction route, not only short turns (found by the independent ChatGPT audit) | root-cause for interaction; legacy dense is unresolved |
  | What-if adoption guard and the app-owned unchanged-preview sentence | the app-owned sentence is root-cause for that claim; other output guards stay provisional |
  | Possible-omission disclosure on the listed completion paths, and an empty reading with an invalid re-read treated as an unusable message | root-cause direction; residuals are listed in the contract |

- **Live E2E:** production account, preview only. Two runs, on `4b431c34` and on `d645068a`. UI and machine state matched on 39/39 turns in each run.
  - **Passed in both runs:** A, C, E, F, G, EV, X4.
  - **Passed in only one run:** B, D, X1, X3.
  - **Failed in both runs:** H (a different mode each time), X2 (pre-existing on `main`), X5.
- **Final chain on `d645068a`:**
  - verify passed, 7468 tests;
  - every category passed;
  - weekly-real 10/10;
  - the browser failures are only environment-specific or load-sensitive ones;
  - the legacy differential shows no difference.
- **Unresolved common causes:**
  - omission detection that relies on literal text and length;
  - truthfulness of claims the renderer words itself;
  - question resolution that enumerates per-field answer shapes, with no expiry for optional or inapplicable questions (X1, X2, X3, H);
  - a reading with neither a delta nor a conversation act accepted as "unchanged" (B);
  - a presentation title built from the model's free-text unit label (「903時間」);
  - legacy dense re-read loss;
  - no idempotency owner;
  - uncommitted context carry-over (ACs 3 and 7);
  - save → reload through real persistence has not been run, because no JDK is installed for the Firestore emulator. The in-memory synthetic save/restore passes.
