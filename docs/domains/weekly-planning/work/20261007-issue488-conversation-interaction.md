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

## Round 3: E2E-first results (2026-10-08 20:32 JST; corrected 20:45 JST)

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
  | Possible-omission disclosure on the listed completion paths | root-cause direction. Residuals are listed in the contract. **No live evidence:** the notice never fired in either live run, so its only evidence is synthetic tests. |
  | An empty reading with an invalid re-read treated as an unusable message | **provisional (path-limited).** Live B T4 on the same HEAD shows the sibling path still open: a *valid* empty re-read with no act is reported as an unchanged plan. |

- **Live E2E:** production account, preview only. Two runs, on `4b431c34` and on `d645068a`. UI and machine state matched on 39/39 turns in each run.
  - **Passed in both runs:** A, C, F, G, EV, X4.
  - **E:** the scheduling target passed in both runs, but on `d645068a` every preview title read 「903時間」 for a 3-hour task. That is a pre-existing `main` defect: `weeklyPlanningAcceptedMemorySessionProjectionV5.ts` appends the model's free-text `unitLabel`. Not a clean pass.
  - **Passed in only one run:** B, D, X1, X3.
  - **Failed in both runs:** H (a different mode each time), X2 (pre-existing on `main`), X5.
- **Final chain on `d645068a`:**
  - verify passed, 7468 tests;
  - the bundle budget gate fails: JS 2347.6/635.1 KiB against caps of 2207.0/593.8 KiB. Changing the caps is the user's decision;
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
  - retention compares workloads and components by picking included fields, so a new schema field silently escapes the floor;
  - no idempotency owner;
  - uncommitted context carry-over (ACs 3 and 7);
  - save → reload through real persistence has not been run, because no JDK is installed for the Firestore emulator. The in-memory synthetic save/restore passes.

## Round 4: Claude-only team, root causes for the round-3 failures (2026-10-09)
The user directed a Claude-only round: Opus orchestrates and audits, and Sonnet workers implement with fixed file ownership. Codex was not used. Base `e6fdfc6c`. Integration is local commits only.

Workers (all Sonnet 5.5):
- MistyFabre: question lifecycle (X1, X2, X3, H).
- BrightLavoisier: content and reply truthfulness (E, B T4, D T3, X5, wording).
- FrostyLangmuir: synthetic save → reload E2E.

Every delivery was independently audited with probes and fault injection before integration. Two audit findings were fixed before integration:
- the X2 lapse fired on an empty reading;
- the D T3 directive did not fire for the live empty-quote errors.

### What the code now does, and how each change is classified
| Live failure | Change | Classification |
| --- | --- | --- |
| X1: the decline is ignored and the question loops | A typed decline closes the optional invitation for any all-non-study plan, and takes precedence over the manual-entry handoff. A fixed commitment is not asked about progress | Root-cause for the invitation path. The wording is provisional (prompt) |
| X2: an optional proposal blocks the preview forever | A presented proposal lapses when the next turn applies a plan change without deciding it. It is truthful in persisted and model-visible state | Root-cause for the optional-proposal path |
| X3: `work_breakdown` never resolves | It shares one structural-evidence predicate with free-form fields. The B negatives stay | Root-cause for the predicate divergence. The loop family stays provisional (see residuals) |
| H: a consultation became a blocking question | Interaction uncertainties carry a model-declared `blocksPlanning`, honoured only for free-form fields. When the model omits it, the blocking free-form question now ends: the user's bound answer releases it, and the release is disclosed (H-release, `fd6a29fd`) | **Root-cause for the free-form end state** (H-release). The flag stays the first line. Residuals: an act bound to the uncertainty id, a renamed-field re-declaration, effort-only answers, and the T2 question wording |
| E: 「903時間」 | Titles take a trustworthy unit: clock units from the code; digit-bearing labels get the canonical label. Shared fix | Root-cause for clock units and digit echoes. Kanji numerals are a residual |
| B T4: a dropped material statement is reported as "unchanged" | Typed content discarded by binding, with an empty or invalid re-read, is an unusable message | Root-cause for the false claim. The content is still not taken in |
| D T3: restated accepted facts with stale or empty quotes | The single repair is told not to restate a bound accepted entity | Root-cause for the repair stage. Provisional overall |
| X5: a split across named periods is lost | Interaction policy: a total divided across named periods is a split (session duration and one window per period) | Provisional (model compliance) |
| X5/D wording | Typed renderer instructions: no split echo for a one-block preview, no feasibility judgement in a recovery | Provisional (prompt) |

### The three categories required by the Issue policy
- **Faults that can now be detected.** Each item below is a real-controller scripted test, and each fails when its fix is reverted:
  - a proposal or invitation that never ends;
  - a structure question answered by new content, versus replay, rate or shell negatives;
  - a free-form consultation uncertainty, versus known-field controls;
  - amount and unit echoes in titles at all four title sites;
  - an "unchanged" claim after a discarded description;
  - a repair request that lacks the no-restatement directive for the live error shape;
  - a placed split.

  The synthetic save E2E fails on each of these, verified by injecting the fault:
  - a dropped block;
  - a shifted block;
  - duplicates on reload;
  - a lost retry.
- **Duplication and maintenance burden reduced.**
  - One structural-evidence predicate and one known-uncertainty-field constant replace two diverging copies.
  - One unit-display helper replaces four ad hoc title compositions.
  - The save E2E reuses the full-App harness and the production local repository. It adds no new harness framework and no fixture fault modes; faults were temporary mutations.
- **Real E2E confirmation.** Pending: the live A–H/EV/X1–X5 round on the integrated head is next.
  - The save half was confirmed only as a **synthetic isolated save E2E** (not Firestore, not online). It passes 8/8 on desktop and mobile on the branch.
  - The counting run used a scratch, uncommitted merge with origin/main `5e19b3ed`, because #546 changed the save/reload read path.

### Residuals (unresolved)
- **Model-dependent or prompt-only:**
  - a free-form uncertainty that means material can be waived by the model's flag;
  - D T3's first-reading restatement is the model's (the fix is for the repair stage only);
  - the D wording, the X5 echo and the X5 split all depend on model compliance.
- **Question lifecycle:**
  - a required structure question has no end state when the user cannot give structure;
  - a lapsed proposal cannot be re-offered on request;
  - an advisory point that is not a consultation is not mentioned.
- **No-op retry:**
  - **silent loss:** a content-bearing message that the model reads as a shell identical to the accepted state is still reported as unchanged. It cannot be told apart from an acknowledgement until a typed acknowledgement/no-change act exists;
  - every acknowledgement shell costs one re-read call (an acknowledgement act would remove it);
  - the binding's discard set is duplicated in the no-op check;
  - the activity kind is not compared.
- **Titles:** kanji-numeral unit echoes.
- **Save evidence:** the in-flight double approval is not exercised through a write gate; real Firestore persistence remains unrun.
- **Pending user decision:** whether to merge origin/main into the integration branch (a local merge was denied by the permission classifier), and the JS/CSS bundle caps.

## Round 4b: fixes for the live round-4 failures (2026-10-09)
Base `f4fa664a`. Independently audited with probes and fault injection, then integrated: W1 MistyFabre (5 commits, `71860db4`) and W2 BrightLavoisier (3 commits, `4a645d47`).

| Live failure | Confirmed cause | Change | Classification |
| --- | --- | --- | --- |
| H-T3: preview cleared, rate re-asked | The accepted 25-page workload sits on a material component, and the model restated it at task level. Binding and provenance compared component placement strictly | One restatement predicate (exact role, per-occurrence, amount, unit; nullable fields tolerated only when null; exactly one match) | Root-cause for the observed direction; **provisional overall** (the reverse direction is open) |
| X2-T3: deadline lost | The first reading was empty. The no-op re-read emitted the out-of-grammar `next_week:weekday:thursday` and could not be repaired: re-reads do not mark the ledger, and the invalid re-read path never used the unspent repair | Repair the invalid final re-read with the turn's single repair | Root-cause for the "repairable re-read lost" class. Accepting the token directly as a grammar tolerance was declined |
| X3-T3: the rate 「1章40分」 dropped | The workload quote covered the rate's digits, so the literal gap stayed under 8 and no audit ran | Workload-quote digit runs beyond its typed numbers earn no coverage | **Provisional** (effort quotes and kanji numerals uncovered; recovery depends on the audit) |
| H-T2: false "may have missed" notice | The live audit listed the consultation as a missing fact. The act carries no quote, so the clause was uncovered | (a) a dropped advisory uncertainty credits its quote (typed); (b) the audit prompt states that consultations are covered | (a) root-cause for the advisory path; (b) provisional. The act-only audit cost is a residual |
| Observability | The abstention reason was persisted only on the literal route | `{route, reason, step}` persisted for every selecting route | Root-cause for the gap |

The contract sentence about which entries mark the repair ledger was wrong (a code/contract mismatch, found by W2 and confirmed by a critic grep). It is corrected: re-reads are not repairs.

**Live confirmation of round 4b:** pending, in the next live round on the integrated head.

## Exam-student persona E2E (2026-10-09, direct user order)
This E2E is **synthetic, isolated and deterministic**:
- the real App, turn runtime, scheduler, preview, approval and local repository;
- a scripted provider double for the AI;
- a fixed clock;
- no non-loopback network.

**Real provider: NOT RUN.** No isolated synthetic calendar exists, and the real account must not be seeded. **Firebase: NOT RUN.**

W4 RedFeynman (Sonnet 5.5, test-only) built it. The fixture has 15 events, 14 life/travel buffers (stored as Plan rows; the product has no buffer type), 9 study items and 1,088 min, plus an overload variant of +720 min (1,808 total). Product fixes were by MistyFabre (B2, B3) and BrightLavoisier (B1), each independently audited with fault injection before integration.

| Stage | Result |
| --- | --- |
| Seed and reload of the existing events and buffers | PASS |
| Bulk request → Fact Graph → scheduler → preview | PASS: 21 blocks / 1,115 min; every requested quantity exact; 0 collisions; deadlines and sleep kept |
| Approve → save → week/day/month → reload | PASS: identical IDs and times; no duplicates after double approval or after an interrupted save and retry |
| Variants (extra midweek lesson; English to the weekend) | PASS: other tasks and commitments preserved |
| Variant math 30→20 (**B1**) | Was RED; **fixed** (canonical order plus a deadline-first retry); now a regression test |
| MonthEvent-backed buffers (**B2**) | Was RED; **fixed** (timed MonthEvents are busy); all-day interim policy awaits the user |
| Overload carries the unmet amount (**B3**) | Was RED; **fixed** (typed shortfall plus an app-owned sentence) |
| Persona daily-load caps and reserve day (**B4**) | **RED**: Sat 315/300, Sun 325/240, reserve day heaviest. The product has no load-balancing or reserve-day notion, so this is product scope and awaits the user |
| Ambiguous request → question; other-owner rows ignored | PASS |

**Can the system finish a usable weekly plan for this persona?** In the deterministic synthetic environment, it plans, saves and reloads 21 blocks with every collision, quantity, deadline and sleep constraint kept. By the canonical oracle it still fails the persona's daily-capacity caps and leaves the reserve day the heaviest (B4), so the answer is a qualified yes. Real-model understanding and Firestore persistence remain unverified.

**Live sanity on code `2c1378a7` (real provider, preview only):**
- A passes, with 4 calls. The extra audit and re-read came from an ordinary literal-gap selection (model quoting variance). The round-4b digit rule cannot fire on a `create_plan` turn, because it is modification-route only.
- D-T3 partially fails: the model omitted one task of 「どっちも夜」 (n=1), in the omission-detection family.
- X5 fails: the model typed the stated 90-minute target as `scope_total`, so the app asks a progress question that repeats (n=1). X5 is now flaky, and a prompt-level fix would be provisional.
- The semantic prompt is unchanged since round 4, so neither failure is a regression from B1–B3.
- Capture caveat: the trace outbox accumulates earlier conversations across runs, so per-turn attribution uses the per-run fetch capture.

**X5 follow-up (code `ef57d18a`, then `87df2e6a`):**
- **The first-turn misreading.** On `2c1378a7`, X5 had read the stated 90 minutes as `scope_total`.
  - Fix: a cap-neutral rewording of the split instruction, "total" → "target" (+3 B, provisional).
  - Live T1 then passed 3/3.
- **A new second-turn failure, in the correction path.** One correction replaced the workload, and another replaced its session length, with an effort that targeted the new workload. The new workload was pruned as a "support stub", leaving no work and causing a progress question.
  - Fix: a correction's own replacement fact is never pruned (`CanonicalCorrectionApplicationV5`). Root-cause for that shape.
  - The r2 shape (replacement ids that dangle) is a disclosed safe failure. It is model variance.
- **Live result on `87df2e6a`:** X5 passed **3/3 on both turns** (2×45, then 2×30). The fixed shape occurred once (r3) and passed.
- **Residuals:**
  - a correction targeting an effort that a dependent migration superseded in the same turn;
  - a stale `total_duration` left beside a corrected target workload.

**X5 correction-path hardening (`ad92271e`).** Probes 28 and 29 showed that the correction pruning silently deleted turn-created content: a new 60-minute total, and a new 「第3章」 component. The plan stayed unchanged while the reply claimed 「修正しました」 with the confirm button. Now any non-redundant prune rejects the turn as a disclosed recover, and validation directs the one repair for the uninstalled-workload shape (provisional). This is root-cause for "pruning deletes content". Live X5 had already passed 3/3 on `87df2e6a`; the hardening closes the variants that live runs had not hit.

**X5e (`cd4130a6`).** A rename carried by a new task container is no longer pruned silently: the turn becomes a disclosed recover. The legacy control now really runs `legacy_v5`; legacy also rejects the probe-28 shape, a deliberate shared change.

**Live X5 on `ad92271e`:** T2 failed 2/2, both as disclosed recovers (「…今の仮予定は変えていません。」), not silent. The first readings left replacement ids dangling, and the one repair then restated the T1 windows with stale quotes (not grounded in the current text). This is model variance in correction encoding. Neither failure was caused by X5d (no `support-not-installed` error occurred). It remains an open residual: corrections of an accepted total are unreliable when the model leaves replacements dangling, and the D-T3 restatement directive does not cover that error.

**Correction (H):** H is **provisional (model-dependent)**, not root-cause. When the model omits `blocksPlanning:false`, the consultation becomes a blocking free-form uncertainty again. No natural answer can resolve it, because contract line 206 requires new structure, so the loop returns (critic probe 31 on HEAD `641f5dd3`: T2 and T3 repeat the clarification request). The original H test ("a typed answer bound to the consultation target closes it") was removed in round 4 and never re-added. An earlier note that "H moved, then re-added" was inaccurate. Open. The cause is specific to free-form fields: their only resolution criterion is new structure, which a question whose answer is not structure (a consultation answered by a placement or an acknowledgement) can never meet. The X3 residual (the user cannot give structure) is a separate open point: a known structural field's criterion is satisfiable (an amount, content or a time budget). A fix for H does not close it.

**H-release (`adb1a1aa`, `c178ab6e`, `fd6a29fd`).** A blocking free-form question now has a deterministic end. The user's answer act, bound to the question's task, releases it when the reading adds a new placement fact (a time-window constraint or recurrence) on that task, or, after the existing re-read, adds nothing at all. The question is released, not resolved, and the application always says so in a fixed sentence quoting the user. Known structural fields keep the structural rule (see the contract).
- **Before and after (scripted, same shapes; probe `zzTealAuditHRelease`).**
  - Before (`24ee164d`): the same clarification repeated, with no preview, for all four answers: a placement bound to the task or to the uncertainty, and 「うん、それで」 bound to either. 「うん」 cost 3 semantic and 2 renderer calls.
  - After (`fd6a29fd`), answers bound to the task:
    - a placement: preview plus 「「あとこれって1日でまとめて読んでも平気？」については未確定のまま進めます。」;
    - 「うん、それで」: preview plus the same sentence, plus 「この返事からは新しい条件を読み取っていません。条件があれば、あらためて教えてください。」, with 3 semantic and 1 renderer calls.
  - Answers bound to the uncertainty id still leave the question open. Live round 4 bound all 10 answer acts to tasks.
- **The first delivery failed audit on three points, all fixed before integration:**
  - the sentence claimed 「仮予定を作りました」 when another question or a capacity question followed;
  - an empty reply released the question while every reading dropped 「金曜は無理」 (critic probe 33a), so the dropped condition was silent;
  - a model re-declaration from the old quote brought the same question back on the next, unrelated turn.
- **Fault injection (my own, 5 files, 61 tests).** Turning each guard off makes tests fail:
  - the re-raise guard: 1;
  - the nothing-read sentence: 3;
  - the plan-claim wording: 9;
  - the release itself: 14;
  - the known-field guard: 3.
- **Full chain on `fd6a29fd`:**
  - verify passes 7,666 tests, with typecheck and build;
  - every category is green;
  - browser: 439 pass and 8 fail. All 8 also fail on main `22847120` (bookshelf geometry and touch-drag lock); none is weekly planning;
  - weekly-real: 10/10;
  - legacy differential: unchanged from `f12743ab` (0 leaves against the three later legacy snapshots);
  - bundle: JS +5.7 KiB raw and +1.6 KiB gzip against `f12743ab`. The budget was already exceeded, and that policy is the user's decision.
- **Classification.** Root-cause for "a blocking free-form question has no end state when the answer is not structure". It covers every answer path: a new placement, an empty reply, and a re-declaration from history. The renderer instruction line is provisional.
- **Still open:**
  - X3's known-field residual ("the user cannot give structure") has a satisfiable criterion and a different cause;
  - an act bound to the uncertainty id;
  - a re-declaration under a renamed field;
  - effort-only bound answers (the B lesson);
  - a free-form field that means material, which can be released with the disclosure;
  - T2's question sentence, which still claims the meaning was ambiguous (follow-up assigned).

**X5g (`0344abdd`, test only).** A task-level `total_duration` left beside a corrected clock-unit target is **inert for the plan**. A clock workload's estimate is its own amount, and a control graph without the stale total gives identical blocks. Fault injection that makes minute workloads skip that estimate turns the pin RED. Residual: the stale fact stays visible to the model in later summaries.

**H follow-up (`56d4bfbd`, `a4dd115e`).** The free-form question is now asked neutrally. It no longer claims the meaning was ambiguous, and it invites a go-ahead. An entirely empty reading also releases it, with no act needed. The generic consultation notice is no longer doubled.
- **Why the empty reading counts.** Critic probe 34 showed that the invitation was false when the reading carried no act: the identical question came back. The live H r1 T3 reading on `fd6a29fd` was exactly that shape, `conversationActs: []`. The release then adds 「この返事からは新しい条件を読み取っていません。条件があれば、あらためて教えてください。」, so a dropped condition is visible.
- **Audit.** My probe (12 variants) showed:
  - the act-less 「このまま進めて」 releases;
  - the live drop shape under the question releases with the nothing-read sentence;
  - an empty reading with a consultation act stays open.
- **Fault injection.** Turning each guard off makes tests fail: requiring a bound act, 4; allowing any act, 1; consultation suppression off, 1.
- **Chain on `a4dd115e`:**
  - verify passes 7,675 tests; every category is green;
  - browser: 440 pass and 7 fail, all also failing on main;
  - weekly-real: 10/10;
  - legacy differential: unchanged;
  - bundle: JS +1.5 KiB raw.

**Live H on `fd6a29fd` (real provider, preview only, 2 runs).** In both runs the model honoured the consultation with `blocksPlanning` set, so no question was asked and **the release path has not run live yet**.
- **r1 T3 failed:** the first reading was entirely empty, which is never re-read when no question is pending. The Wednesday-night placement was dropped behind 「今の仮予定の候補はそのままです」.
- **r2 T3 passed:** the first reading was a task shell, which is re-read, so Wed 17:00–18:15 was recovered.
- **Cause:** whether a reading is re-read depends on the shape the model happened to choose. Assigned as x6: re-read an empty reading under a plan, and state 「この返事からは新しい条件を読み取っていません…」 whenever the final reading is empty.

**x6: empty readings (`6eb978e3` through `39c3547b`, parent `80af22a3`).** Under an accepted plan, an entirely empty first reading is now re-read once, as a task shell already was. An empty final reading says 「この返事からは新しい条件を読み取っていません。条件があれば、あらためて教えてください。」 once.
- **Audit:** two deliveries were rejected before integration.
  - v1 put the creation-authorization exception inside the shared predicate. That changed legacy eligibility, and under a free-form question it brought back the identical invitation for 「このまま作って」.
  - v2 still flipped the B-T4 contradiction re-read (critic probe 35, row 30).
  - v3: the 36-row table equals `a4dd115e` except the two intended rows.
- **Before and after (scripted):**
  - the live r1 shape now recovers the Wednesday-night placement; before, it took 1 call and was dropped;
  - an empty or acknowledgement reply now shows the sentence, at 2 calls instead of 1;
  - the live r2 shell shape recovers in both.
- **Fault injection over the whole directory:**
  - re-read off: 9 failures;
  - exception applied to re-reads: 2;
  - fact off: 7;
  - double sentence: 10.
- **Chain on `80af22a3`:**
  - verify passes 7,701 tests; every category is green;
  - browser: 440 pass and 7 fail, all also failing on main;
  - weekly-real: 10/10;
  - legacy differential: unchanged;
  - bundle: JS +0.2 KiB.
- **Live H on `80af22a3` (2 runs).** T1 and T2 passed in both, with the consultation deferred and no question.
  - r1 T3 failed, with a disclosure: the first reading was a shell, and the re-read and the repair both mis-referenced ids, so the reply was 「その変更は使えませんでした…今の仮予定は変えていません」.
  - r2 T3 passed: Wed 17:00–18:15.
  - An empty first reading did not recur, so x6's live path is still unexercised.
  - Observation: see the deferred-consultation wording residual below.

**x7: a nested fact that targets its own task's public id (`6c23a105`, `167751ca`).**
- The live failure: H r1 on `80af22a3`. The re-read's only invalid reference was a constraint whose `targetLocalId` was its own containing task's `existingPublicId`. The single repair then broke the effort reference, so the turn failed with a disclosure.
- The fix: the existing interaction-only raw projection, already bridging an effort to its accepted workload, now also rewrites a nested constraint, effort or recurrence that targets its own containing task to that task's localId. That referent is the only one possible. Another task's id, an absent task or a component stays invalid and still goes to the repair. It is a projection, not a repair: only a diagnostic is recorded, and the ledger is untouched.
- Before and after (scripted): the live shape went from a disclosed recover (3 calls, repair spent) to applied (2 calls); the first-reading variant from a recover to applied (1 call). Another task's id is repaired in both versions.
- Fault injection: projection off, 6 failures; widened to any task id, 3.
- Chain on `167751ca`: verify passes 7,715 tests; every category is green; browser 438 pass and 9 fail, all also failing on main; weekly-real 10/10; legacy unchanged.

**Live H on `167751ca` (2 runs).**
- r1 T3: both readings were a bare task shell (the model dropped 「水曜の夜にまとめて」 twice), so the plan stayed unchanged. **For the first time live, the drop was disclosed:** the bubble ends with 「この返事からは新しい条件を読み取っていません。条件があれば、あらためて教えてください。」 (`nothingRead=true`). On `fd6a29fd` the same drop showed only 「候補はそのままです」.
- r2 T3: passed, Wed 17:00–18:15.
- **H T3 over 6 live runs** (`fd6a29fd` ×2, `80af22a3` ×2, `167751ca` ×2): 3 passed and 3 failed, with these causes:
  - an empty reading, now re-read and disclosed (x6);
  - a self-reference rejected, now projected (x7);
  - a model drop, now disclosed.
- No run asked a blocking question at T2, so the free-form release path is still unexercised live.

**Residual: deferred-consultation wording (prompt-level).** The renderer instruction for `consultationDeferred` says to give no verdict, feasibility or numeric judgement, and not to say "cannot judge". In 4 of the 6 live T2 replies the model broke it:
- 「…判断できません」 once;
- 「…収まる見込みです」 or a minute figure three times.
The statements agree with the preview, so no false plan is claimed. A deterministic check of free text would need text matching, so this stays a prompt-compliance residual.

**Live round 5 (`167751ca`, all 14 scenarios, scripts verbatim from round 4; run Friday 10/09, 21:40–21:50 JST): 7 of 14 pass strictly.**
- **Pass:** A, F, G, H, X1, X3, EV.
  - H T3 placed Wed 17:00–18:15.
  - EV's repeated window question at T2 is legitimate, since no work had been given yet.
- **Fail, but disclosed to the user:**
  - B T4: 「青チャートのこと」 reads as a shell whose context label binding discards, so the B-T4 unusable message shows. The material is still not taken in (a known residual).
  - C T2: a correction's replacement fact was never emitted (a dangling `replacementLocalId`), and the repair stayed invalid, so the turn recovered. C T3 then recovered its deadline through the re-read.
  - D T3: the model dropped 「どっちも夜」 in both readings. The re-read ran, and **the nothing-read sentence was shown**, the second live disclosure from x6.
  - E T3: the weekend constraints targeted a workload rather than the task, and the repair repeated it. That is not the self-reference shape; widening a workload constraint to the task would change meaning, so it is not projected.
  - X5 T2: dangling replacements; after the repair, correction application rejected the turn.
- **Fail, silent (lost context):** X2. The T1 rate 「物理は1問6分くらい」 was read as `duration_per_unit 6` with unitCode `minute`, which should be `problem`. The rate is ignored, and the app re-asks 「1問あたり何分」. Assigned as x8.
- **Inconclusive:** X4. 「金曜までに」, said on Friday at 21:49, leaves almost no time, so the insufficient-capacity question is correct for the run time.
- **No failure traces to this round's changes** (H-release, the neutral question, x6, x7).
- The dangling-replacement family appeared in 2 of 14 runs (C, X5). The proposed X5f repair directive is blocked on the user's directive-cap decision.
- Round 4 on `f4fa664a` passed 11 of 14 with a different mix of failures. With single samples per scenario, the difference is within model variance; it is not evidence of a regression.

### Completion status against the user's merge-order decision (Issue #488 body, 2026-10-09, Stage 1)
Integration HEAD for app code: `167751ca` (docs since then only). E2E is **not complete**.

| Completion chain step | Evidence | Kind | Status |
| --- | --- | --- | --- |
| Natural input → confirmation and correction → constraint-respecting preview | Live round 5 (14 scenarios, preview only) | Real provider, real screen | Partial: 7 of 14 strict. Failures are below |
| Explicit approval → persistent save → week/day/month reflection → reload match → no duplicates on resend or double approval | W3 `weekly-real-save-reload`, 8/8 | Production App, runtime and gateway, with a scripted provider; production **local** repository (browser localStorage) | Verified only at the local-repository boundary |
| The same chain through Worker and Firestore | — | — | **Unverified.** A real save on the authorized account is forbidden (it would touch the user's data), and no isolated Firestore environment or dedicated account with cleanup is authorized |
| The same chain with the real provider | — | — | **Unverified** for the same reason. Live runs never press 「この内容で仮予定にする」, 「この内容で保存」 or 「予定を追加」 |

**Representative paths:**
- **Exam student:** W4 is 28/2. Both failures are B4: the persona's daily caps are not given to the product, so they are a product decision, not a user-stated constraint.
- **Fixed events only:** X1 and EV pass live.
- **Normal study:** A and G pass live. **F fails** (question/answer meaning mismatch: owner's comment #10; x11 assigned).
- **Mixed input:** D fails live, with a disclosure (model drop).
- **Date and quantity corrections:** C and X5 fail live, with a disclosure (dangling replacements; X5f is blocked on the directive-cap decision).
- **Re-question loops:** H passes in 4 of the last 7 runs, and each failure cause is fixed or disclosed. X2 fails silently (x8 in progress). X3 passes.

**Gates on the exact code `167751ca`:**
- verify passes 7,715 tests; every category is green; the legacy differential is unchanged;
- browser: 9 failures, all also failing on main `22847120` (environment);
- size: JS 2373.0 KiB raw / 642.8 KiB gzip, **over the cap and not raised**.

**Size gate attribution (measured 2026-10-09; each tree built with `npm run build` and its own `scripts/ci/check-bundle-budget.mjs`):**

| Tree | JS raw | JS gzip | Caps in that tree |
| --- | --- | --- | --- |
| Fork point `22847120` (merge-base) | 2,240,846 | 602,673 | 2,260,000 / 608,000. Passes |
| `origin/main` `dfcfd300` (39 commits ahead of the fork) | 2,257,414 | 607,571 | 2,260,000 / 608,500. Passes, with 2,586 B and 929 B of headroom |
| Branch `167751ca` | 2,429,928 | 658,213 | 2,260,000 / 608,000. **Fails** |

- **Cause:** this Issue. The branch adds +189,082 B raw and +55,540 B gzip over the fork point:
  - the eager `index` chunk, +111,429 B;
  - the lazy weekly-planning runtime chunk, +76,630 B;
  - other chunks, about +1 KB.
- **Content:** about +10,000 lines (+575 KB of source text) across 147 non-test files. This is the interaction architecture itself: completeness re-reads, repairs, focused answers, disclosures, retention and dispatch budgets, and turn measurement.
- **Not resolved by a cap raise.** The user's decision forbids passing by an easy raise. The budget counts all JS chunks, so code splitting would not reduce the total.
- **The resolution needs a user decision:**
  - (a) a measured, justified cap change before merge;
  - (b) a reduction in Stage 3 (for example, removing the legacy architecture's shipped duplicate paths or production-only debug projections), which is a large refactor and therefore deferred until E2E works;
  - (c) both.

**x8: a per-unit rate the estimate ignored (`6a84bb6b`, `4676aa63`, parent `71a80196`).**
- **Cause:** validation accepted a `duration_per_unit` whose unitCode did not match its workload, and estimation then ignored it without a word. The app re-asked for the rate (live round 5, X2).
- **Invariant (root-cause):** when the app re-asks for a rate that it accepted but could not use because of its unit, it says so, quoting the user's own words: 「「…」は、この作業の単位（問）と合わなかったため使えませんでした。」. A predicate shared with estimation decides this.
- **Projection (provisional, never silent):** a rate typed with a clock unit and exactly one counted workload as its target is used as minutes per counted unit, and the app always states it: 「「物理は1問6分くらい」は、問あたり6分として使いました。」. That makes a wrong reading visible and correctable. The 「1時間で10ページ」 mis-encoding is pinned with its sentence.
- **Audit:**
  - a projection replaced by a repair that drops the rate makes no false claim;
  - fault injection fails 7 tests with the projection off, 8 when it is silent, and 3 with the disclosure off;
  - W4 is 28/2 and W3 8/8, with identical call counts.
- **Chain on `71a80196`:**
  - verify passes 7,738 tests; every category is green;
  - browser: 439 pass and 8 fail, all also failing on main;
  - weekly-real: 10/10;
  - legacy differential: unchanged;
  - bundle: JS +3.2 KiB raw.
- **Live on `71a80196`:**
  - X2 passed 2 of 2: the rate was used, and a preview came at T2 with physics at 105 min. The model typed the unit correctly both times, so the projection did not run.
  - H passed 1 of 1.
- **Residual:** a repair that drops the user's rate entirely still leads to a re-ask with no notice. That is the repair-drop class, separate from the ignored-rate class.

**x9a: same-turn corrections no longer depend on their order (`04effefd`, `53f50f47`, `af851076`; contract `62dda69d`).**
- **Cause (live round 5, X5 T2, the X5c "r1 variant" now seen live):** correction 1 replaced the workload, and its dependent migration superseded the session effort. Correction 2 then named that superseded effort, so the turn was rejected; the reverse order had applied.
- **Fix:** a correction whose target this transaction's own dependent migration superseded is applied to the migrated fact. Any other superseded target is still rejected, pinned at the unit level with the earlier gates bypassed.
- **Explicit shared fix:** legacy changes for the live order only, from a rejection to an apply. Legacy pins establish this, because the legacy oracle has no such scenario.
- **Fault injection:** retarget off, 4 failures; widened retarget, 1.
- **Chain on `62dda69d`:**
  - verify passes 7,746 tests; every category is green;
  - browser: 441 pass and 6 fail, all also failing on main;
  - weekly-real: 10/10;
  - W4 is 28/2 and W3 8/8, with identical call counts.

**Live on `62dda69d`:** X5 passed 2 of 2, and C passed 1 of 1.
- X5 T2 gave 2×30.
- C T2 applied 20 pages and the Friday deadline (10/16) together, after one repair.
- C T3, 「10月16日まで」, restates the deadline that is already applied. The reply keeps the plan and adds the nothing-read sentence. That is true, since nothing new was read, but the invitation to restate conditions is slightly unnatural here: a minor wording residual.

In round 5, both C and X5 had failed on the date and quantity correction path; in these three runs they pass. The dangling-replacement recovery (x9b) is still in progress for the C T2 shape round 5 saw.

**Bundle: module-level cause analysis and reduction proposals (measured 2026-10-09; not implemented, and the limit is not relaxed).**

Method: `vite build --sourcemap` of `ea0d871a` and of the fork point `22847120`. Every minified byte is attributed to its source file through the sourcemaps (a scratch script; no new dependency).

- **Total JS growth: +199,737 B, almost all weekly planning:**
  - `semantic` +115,014;
  - `dialogue` +42,540;
  - `application` +29,930;
  - feature root +6,441;
  - `trace` +3,316;
  - everything else about +2 KB.
- The growth splits into 58 new source files (108,923 B) and 96 grown files (+94,819 B); 7 files shrank (−4,005 B).
- Weekly planning is 890 KB of the 2.44 MB.
  - 443 KB of it sits in the **eager** `index` chunk, which is a startup-cost problem;
  - 435 KB sits in the lazy runtime chunk.
  - Code splitting would not change the budget, which counts all JS.

| Category (weekly planning) | Bytes now | Growth |
| --- | --- | --- |
| Model-facing prompt, policy, schema and instruction modules (14 files) | 68,426 | +21,434 |
| Focused-call modules (11 files) | 56,617 | +20,081 |
| Completeness, retry, repair and preservation modules (14 files) | 78,090 | +33,496 |
| Trace and diagnostics (22 files; trace persistence is a required gate) | 103,242 | +4,951 |
| App-owned Japanese UI text (8 files; must stay) | 16,528 | +7,835 |

**Reduction proposals.** Estimates are minified bytes. All except R5 are Stage-3 work under the user's merge-order decision: none is done before E2E works.
- **R1. Assemble model-facing prompts server-side,** in the AI proxy Worker, keyed by a prompt version; the client keeps its typed inputs and validators.
  - Estimate: −40 to −60 KB.
  - Needs a Worker deploy and an architecture decision (the user's).
- **R2. Share one typed focused-request helper** (request building, response-format plumbing, trace recording) across the 11 focused-call modules.
  - Estimate: −10 to −20 KB.
  - Fault detection must transfer before any test is removed.
- **R3. Consolidate the completeness, retry and repair attempt bookkeeping** (14 modules).
  - Estimate: −10 to −20 KB.
- **R4. Retire the `legacy_v5` code paths** once the user accepts `interaction_v1`.
  - The code is interleaved through architecture flags, so a stubbed build must measure the saving; it is likely tens of KB.
  - Needs the user's decision, because legacy compatibility is a current requirement.
- **R5. Move eager weekly-planning imports out of the startup chunk.** This improves startup but does not change the total-JS budget, so it is not counted as a reduction.

**Assessment:** R1–R3 together are about −60 to −100 KB raw against a +169,928 B raw overage, and the gzip overage is +50,213 B. Without R4, or a measured and justified budget decision by the user, the gap does not close. The gate stays failing and attributed to this Issue.

**Live round 6 (`ea0d871a`, all 14 scenarios, scripts verbatim, preview only; run Friday 10/09, 22:50–23:00 JST): 9 of 14 pass.**
- **Pass:** A, B, C, E, F, G, X1, X3, X5. B T4 took in 「青チャート」 as a material, so the reply 「青チャートですね」 is true.
- **Fail, disclosed:**
  - D T3: both readings were bare task shells. The model dropped 「1回1時間くらいで2回に分けたい。どっちも夜がいい」 (which task is meant is ambiguous). Nothing-read was shown.
  - X2 T3: the model dropped 「物理は木曜日までに」. Nothing-read was shown, and the plan already meets the wish (physics on Tuesday).
- **Fail, silent:** H T2.
  - The 25-page correction's replacement fact was missing from a reading with no task entry, so x9b did not take it and the generic repair failed.
  - A `consultation_request` act sent the turn down the conversation-only route.
  - The app recorded `planningDetailsNotApplied: true`, but on the AI-rendered path only the renderer prompt carries that fact, and the reply did not say it.
  - T3 planned the old 30 pages.
  - Assigned: x10 makes the disclosure app-owned; x9c extends the recovery to a reading with no task entry when the target task is unambiguous.
- **Wording:**
  - EV T4 「特にない」 got 「…今日はこれで大丈夫です。この返事からは新しい条件を読み取っていません。条件があれば…」. That is true but awkward after a decline (minor).
  - Renderer wording for a deferred consultation still varies; this is prompt-level.
- **Inconclusive:** X4. 「金曜までに」 at Friday 22:58 leaves only tonight, so the capacity question is consistent with the run time.
- **Same session, scripted and mock evidence on `ea0d871a`:** W4 is 28/2 (B4 only), W3 is 8/8, and the call counts are identical to the previous head. The chain is green except 8 browser failures, all baseline.

**Correction (owner's Issue #488 comment #10, 2026-10-09): F is a failure, not a pass.**
- **What went wrong:** in F, the app asked about **past progress**: 「卒研は、今どのくらいまで終わっていますか？」 in round 5, 「今の進み具合は、だいたい何割くらいですか？」 in round 6. It then promoted the reply 「合計2時間くらい」 to the **future** 2-hour target without confirmation. A preview existing is not the user's meaning acquired.
- **Corrected strict counts:** round 5 is **6/14**, and round 6 is **8/14**.
- **Root cause, from the code:** `stableV5MissingSchedulableWorkQuestion` always asks a progress question (`existing_target_progress`, a completion percentage when there is no `scope_total`), even for an unbounded task where planning needs the future amount for the window. The next answer's binding does not check the presented question's typed purpose.
- **Assigned as x11:**
  - typed question purposes;
  - the first question asks for the future amount;
  - no promotion of an answer whose meaning does not match the presented purpose (confirm instead);
  - the owner's regressions (a) to (d), plus the original F script pinned as the pre-fix failure;
  - then a real-provider re-check.
- **Same family, seen live earlier:** X5 r3 asked 「今、どのくらい進んでいますか？」 after a workload was lost.

### Owner's dialogue-text requirements (Issue #488 comment #10 edited 2026-10-09T14:15:36Z; comment #11 2026-10-09T14:19:37Z, which takes priority)
- **F, the question itself:**
  - Asking the total first (「…合計どれくらい時間を使いたいですか？」) is also rejected. Internal slot order is never projected onto questions.
  - Check the calendar and propose when possible; ask only for what planning needs and the calendar does not know.
  - The pending question **holds** its target meaning (progress, availability, wish, per-session or days). An answer whose meaning does not match is never promoted.
  - A per-day 「1時間くらい」 is never a weekly total.
  - F stays a failure until re-run on the real provider, multi-turn.
- **No fixed text on the normal path.** Only a minimal technical-error text is allowed when the AI cannot generate.
  - The owner's audit names the app-appended notices on the AI-rendered branch: omission, constraint, capacity shortfall, retained preview, possible omission, not-applied, nothing-read and rate notices. It also names the `RuntimeQuestions` intent texts and the non-technical fallback texts.
  - The direction: structured context goes to the AI, which writes the text, the order and the proposals; the app **verifies** each reply against the facts, and on failure regenerates, confirms meaning, or stops with a clear error.
  - Validators and the trust boundary are not relaxed, and no falsehood may return.
- **Status of this round's safety sentences:** the nothing-read (x6), rate (x8), not-applied (x10), free-form release and recovered-omission (x9b) sentences remain as **interim guards against silent loss**, not the final design.
  - They stay until a verified replacement exists. Removing them first would bring back the falsehoods the owner forbids.
  - x11 (an app question asking the planned total) is **halted** as superseded.
  - A read-only fixed-text inventory (normal path versus failure-only, with call conditions) and a design proposal for verified AI-written text are assigned. The critic builds an independent inventory for comparison.

**Parent policy for verified AI-written dialogue** (2026-10-09; the user re-confirmed comments #10 v2 and #11 in chat).
- **Audit baseline.** MistyFabre's read-only inventory, which I verified:
  - the normal path has exactly **8 app-appended notices**, at `weeklyPlanningStableV5TurnDialogue.ts:549-568`;
  - `RuntimeQuestions` and fallback texts appear only on the failure path in interaction mode;
  - but **which question is asked, and for what purpose, is chosen deterministically** (`StableDialoguePolicy` priority order, then `DialogueContext` intent, then `CommunicationContext` purposes). The renderer only words it, so the content is fixed;
  - the pending question persists no purpose, the next answer binds by task identity only, and the stated-time-budget projection promotes a task-level `total_duration` to a target.
- **P1:** on the normal path every user-visible sentence is AI-written from structured context. Fixed text is used only for a technical stop, is minimal, and claims nothing about the plan.
- **P2:** each turn carries typed `mustConvey` and `mustNotClaim`. The reply is verified by a typed envelope, deterministic literal checks (numbers, ids and user quotes, with no Japanese parsing) and an independent verifier for semantic facts. Failure leads to one regeneration, then a technical stop. The notices migrate fact by fact, and each appender is removed only after its replacement passes RED/GREEN, fault injection (an omitting or contradicting renderer must never pass) and a live check.
- **P3:**
  - The app supplies structured planning needs: missing information, calendar-known availability, accepted and rejected facts with their sources, and candidate drafts.
  - The AI chooses to ask, offer choices or propose, and declares a typed purpose. The app validates it and holds it on the pending question.
  - The next answer binds within that purpose; a mismatch leads to confirmation. Per-day, per-week and total stay distinct.
- **P4:** validators, the trust boundary, the approval and save boundary, legacy, and the gates stay as they are.
- **Assigned (design notes first, no production edits):** MistyFabre owns P3 and the F flow, with a codec analysis for holding the purpose. BrightLavoisier owns the P2 verification and the notice migration. Shared files go to the parent as hunks.

**Acceptance criteria for this redesign:**
1. A normal-path reply contains no app-appended fixed sentence.
2. Every typed safety fact of the turn is conveyed and verified. A missing or contradicted fact is never a pass: it ends in regeneration, then a technical stop.
3. No false claim of saved, applied, complete or constraints met.
4. No question has a fixed order or template. Nothing the calendar knows is asked, the total is never asked first, and examples are not used as patterns.
5. The pending question holds its purpose, and a mismatched answer is never promoted.
6. F, from a vague intent and multi-turn on the real provider, reaches a concrete proposal with few questions, with no invented amount, with changes accepted midway, and with the preview consistent with the accepted facts. The approve/save boundary is safe.
7. Tests judge purpose, interpretation and final plan, not exact strings.
8. Gates run on the exact code, and the validators are not relaxed.

**Amendments after the design notes and the critic's review** (2026-10-09 23:40 JST; each claim below was checked in code).
- **Design notes:** MistyFabre `children/MistyFabre-p3-design.md` (P3, `exp/MistyFabre-x11p`) and BrightLavoisier `children/BrightLavoisier-x11p-p2-design.md` (P2, `exp/BrightLavoisier-x11p-p2`). The critic's independent inventory agrees on the 8 appenders and the failure-only texts.
- **P1, technical stop:** it is a controlled failure. The projection returns `failure`, so the turn-start state is kept and the staged graph and context are discarded (critic M2: a stop after a finalized turn would silently lose every `mustConvey` fact, and a resend could apply twice). Pins: two verification failures leave the revision unchanged; a resend applies once; the held question binding survives the stop.
- **P2:**
  - The typed self-declaration (`conveys`/`claims`) is dropped: it verifies nothing and adds a false-regeneration path. Literal checks, the independent verifier and the existing validators decide.
  - The verifier runs on the existing `weekly_planning_renderer` purpose with its own prompt; the AI proxy rejects unknown purposes (`workers/ai-proxy/src/modelPolicy.ts`), so a separate purpose would need a worker deploy.
  - The regeneration is the existing single repair slot (one per turn across format and fact reasons; at most 4 renderer-stage calls). The dispatch limit stays 8 until measured.
  - The "no invented number" check is enabled only after its false-failure rate is measured offline on fixture corpora.
- **P3:**
  - The purpose is held in the existing optional `intent` string (`purpose:<enum>`), with no codec key: a new key would make an older client drop the whole session. Intents that already have readers stay byte-identical.
  - **Binding rule (critic M4):** the held or AI-declared purpose is never given to the semantic reader, which reads the question as shown. A binding needs a positive match between the reading's own typed role and scope and the held purpose; an amount with no scope or role goes to confirmation. The held purpose only demotes, so a wrongly declared purpose costs at most one confirmation, never a binding.
- **P4 amendment (critic M1):** `INTERNAL_PROCESS_TERMS` rejects 「反映していません」 and 「保留」, which would make the AI's own not-applied statement impossible. When such a notice is migrated, the term is allowed only while that notice's typed fact is present in the turn. This is a declared validator change, pinned in both directions.
- **Criteria amendments:**
  - criterion 1 also covers standalone app messages in the AI conversation, pending the owner's decision on the save receipt (critic M3);
  - **criterion 9:** live runs report the technical-stop count per round, and a stop is never a pass.
- **Started (RED first; no live run; parent integrates):**
  - MistyFabre S1: held purpose, decode-on-read for old states, and the purpose guard. This alone stops F's silent promotion but does not make F pass.
  - BrightLavoisier P2 slice 1: the capacity shortfall written by the AI and verified, the stop as a controlled failure, and the fault-injection harness.
  - S2/S3 and the later notices wait for review. Each slice reports request bytes and the gzip bundle delta (the bundle already fails its cap).
- **Owner decisions pending:**
  - whether the save/approval receipt may stay a deterministic app message;
  - the verifier's extra call on turns with a semantic notice (the nothing-read and retained-preview notices alone appeared up to 8 of 39 turns in round 5 and 3 of 39 in round 6; the other semantic notices were not counted);
  - a separate verifier purpose (needs a worker deploy);
  - UI-label tokens inside AI text;
  - the duplicate-submission message.

**P2 slice 1: the capacity shortfall is AI-written and verified** (integrated 2026-10-10 00:03–00:08 JST: `3a5c0cdd`, `67d3ad67`, `9d236e09`, `e45fea8a`; BrightLavoisier).
- **What changed:**
  - On the capacity question, the reply states the figures and the unmet work in its own words, and the app's shortfall sentence is no longer appended. The typed fact is `mustConvey: shortfall`.
  - The reply is checked by deterministic number and label checks (thousands separators, full-width digits, 時間/分/半 equivalence) and then by an independent verifier call on the existing renderer purpose. The verifier gets the defined fact and a defined forbidden-claim list (`plan_fits`, `plan_complete`, `saved`).
  - On failure, the single repair slot regenerates once. A second failure is a **technical stop**: a controlled failure that keeps the turn-start state, discards the staged turn, re-binds the turn-start question, and shows one constant that says only that the message was not taken and asks for a resend.
  - Legacy is unchanged.
- **Gate (agreed with the critic: no notice that depends on the verifier is retired before a real-provider adversarial corpus run).**
  - The corpus is synthetic and labelled: 25 replies for one fixture fact (correct 5, paraphrased 4, omitted 5, contradicted 6, vague/partial 5), run twice through the production pipeline, plus the verifier alone on the omitted set. That was 33 real-provider calls on the authorized preview account, with credentials kept in the browser.
  - **Result: 0 false passes, 0 false fails, 0 nondeterministic cases, 0 errors.** The five contradicted replies that pass the literal checks (「全部入りました」, 「無理なく収まりました」, only one item unmet, 「保存しました…追加済み」, 「不足はありません」) were all rejected by the verifier in both runs. The verifier alone also rejected all five omitted replies.
  - **Limits:** a single fixture fact, and no vague reply that carries every figure and label (the literal checks caught every vague case).
  - **Process note:** the commits were integrated about two minutes before this result. No chain, rerun or live run happened in between (critic MAJOR, accepted).
- **Fault injection.** The critic caught 12 of 12, including stop-binding, binding-dropped and commit-the-stop faults; a scan found no test passing on an unasserted stop. Mine caught 4 of 4 after the forbidden-claim pins.
- **Cost:** one more AI call on each capacity-question turn (2 of 39 turns in each of live rounds 5 and 6, both in X4).
- **Next:** the chain; W4/W3 with technical-stop and verifier-call counts; live X4 plus the full set. The migration is accepted only after the live check.
- **Correction (2026-10-10 00:11 JST): the gate above did not hold, and slice 1 is withdrawn** (`50fc25ad` reverts the four slice commits, restoring the application's shortfall sentence).
  - **Why the first run was weak (critic):** only 5 of its 16 expected-fail replies reached the verifier; the literal checks rejected the rest first.
  - **Second run:** the verifier alone, twice each, on all 16 expected-fail replies plus 5 held-out replies the critic wrote before seeing any result (42 calls). All five were labelled fail beforehand, including one that drops 「ほか1件」.
  - **Result:** all 16 corpus replies were rejected. Of the held-out replies, the swapped pairing, the hedged fit and the 「入れておきました」 claim were rejected. **Two passed in both repeats:** the plan total presented as the time of the unmet work, and the unmet count dropped.
  - **What happens next:**
    - the verifier is fixed without tuning on the held-out texts;
    - the five held-out replies become regression cases;
    - the next gate needs a fresh held-out set that the verifier's author has not seen;
    - the result is recorded as a smoke gate, not a measured rate.
- **P2 slice 1 v5 re-integrated after its gate (2026-10-10 00:22 JST)**, fast-forwarded to `7324f710` (`7b70c3f6`…`7324f710`).
  - **Verifier fix, written in general terms with no example texts:**
    - the plan total is defined as the whole plan's need, never the unmet amount;
    - when further unmet items exist, the reply must say so;
    - the literal checks require their count;
    - a per-code handler registry also defines `declared_amount_waiting`, which nothing produces yet.
  - **Gate:** a fresh held-out set written by the critic and never shown to the verifier's author (two different facts, one with no further items; 15 replies, 11 expected fail; hashes verified before the run). The verifier ran alone, twice each, plus the full regression set (corpus v1, the author's six regression replies, the critic's first five held-out replies). That was 66 real-provider calls on the authorized preview account, run against copies of the exact v5 modules **before** integration.
  - **Result:** 0 false passes for the verifier alone and for the whole pipeline, on both held-out facts and on the regression set; 0 nondeterministic cases; 0 errors.
    - One false fail, by design: a reply that says 「など」 without the count of further items now fails the literal check.
    - Recorded as a **smoke gate**, not a measured rate. Any re-tuning needs another fresh set.
  - Typecheck is clean and the 32 focused tests pass. The chain, the W4/W3 reruns and the live X4 check follow; the migration is accepted only after the live check.
