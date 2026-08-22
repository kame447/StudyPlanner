# StudyPlanner Project Map

Status: canonical repository navigation map
Updated: 2026-08-22

この文書は「変更したい責務の正しい入口」を短時間で見つけるための地図である。詳細仕様や実行queueを複製しない。

## 1. Read order

Repository work:

1. `AGENTS.md`
2. `PROJECT_MAP.md`
3. 対象domainのcanonical docs
4. current Issue / `docs/ai/tasks/README.md`
5. current code and tests

Weekly planning:

1. `docs/ai/weekly-planning-current-contract-v5.md`
2. `docs/ai/weekly-planning-current-contract-status.md`
3. `docs/ai/strategy/weekly-planning-roadmap.md`
4. `docs/architecture/README.md`
5. `docs/testing/README.md`

Historical docs are evidence, not current instructions.

## 2. Application shell

### `src/App.tsx`

Top-level application composition and major navigation. Product surfaces currently include AI計画、予定、ホーム、教材、時間割 and secondary/admin routes.

Do not move feature-specific domain decisions into `App.tsx`; keep it primarily as composition/routing/orchestration.

### `src/components/`

UI components and interaction surfaces. Examples include:

- `AiPlanningView.tsx` / `AiPlanningChatSidebar.tsx`: dedicated AI planning surface
- calendar / home / bookshelf / timetable views
- `QuickEntryModal.tsx`: generic quick/manual entry surface
- `WeeklyPlanningQuickEntryModal.tsx`: remaining compatibility wrapper; its weekly-planning plumbing is tracked by Issue #52
- admin/report views

UI code should consume application/domain APIs instead of reproducing scheduling, lifecycle, authorization, or persistence decisions.

### `src/hooks/`

React-level orchestration and state composition. Use for view/application lifecycle coordination, not reusable domain policy.

## 3. General domain and persistence

### `src/domain/`

General deterministic domain rules that are not specific to weekly-planning internals.

### `src/repositories/`

Persistence boundaries. Firestore/local implementations and repository abstractions belong here or in their feature-owned equivalent when the data lifecycle is feature-specific.

Do not let components know storage implementation details, fallback order, or transaction internals.

### `src/services/`

External/service integration and the separate single-event natural-language subsystem.

`src/services/natural-language/` and `naturalLanguagePlanner` are not the semantic authority for Stable V5 weekly planning. Their lexical/rule logic must not be imported as a fallback to reinterpret weekly-planning raw user text.

### `src/lib/`

Small reusable deterministic helpers and cross-cutting utility logic. Domain-changing policy should not be hidden here merely to avoid creating a feature module.

### `src/types/`

Shared application/domain types. Prefer feature-local types when a contract is owned by one feature.

## 4. Weekly planning feature

Canonical root: `src/features/weeklyPlanning/`

Read its local `AGENTS.md` before modifying weekly-planning code.

### `semantic/`

AI semantic boundary and typed semantic document processing.

Owns model-facing semantic contracts, validation/repair integration, canonical semantic representation helpers, binding support, and Fact Graph semantic lifecycle pieces.

Rule: natural-language meaning is AI-owned. Deterministic code may validate and mechanically transform represented meaning but must not re-read raw Japanese with regex/keywords to choose a different semantic truth.

### `intake/`

Request/conversation input collection and accepted intake state boundaries.

### `pipeline/`

Turn execution/pipeline composition between semantic intake and deterministic application stages. Avoid turning this directory into a second owner of decisions already owned by semantic/planning/dialogue layers.

### `planning/`

Deterministic planning decisions: readiness, proposal lifecycle, work projection/compilation, approval contracts and related state decisions.

### `scheduling/`

Availability resolution, session chunking, placement candidates/scoring and schedule generation from already accepted typed state.

Scheduling may use deterministic constraints and explicit typed preferences. It must not silently infer user semantic preferences from raw task text.

### `dialogue/`

Deterministic decision of what needs to be communicated/asked plus the boundary that lets AI render that typed decision naturally.

Rendered Japanese is presentation, not machine state.

### `preview/`

Unsaved preview/candidate projection and preview metadata/freshness boundaries.

### `application/`

Session/application orchestration, approval/save boundary and feature-level application APIs. This is the preferred caller-facing facade for lifecycle operations.

### `trace/`

Observability only. Current schema v2 uses bounded turn diagnostics; trace failure must not change the planning result. Privacy/retention is tracked by Issue #45 and production recovery by #89.

### `evals/`

Real-model/evaluation harnesses and observation scenarios. Evaluation fixtures are not production semantic rules.

### `personalization/` and `profiling/`

Typed personalization policy, observations/calibration, profile derivation and related deterministic scoring. Keep explicit preference, current-session state and observed profile distinct.

### `parsing/`

Legacy/mechanical parsing helpers still present in the codebase. Presence of this directory is not permission to use raw-text parsers as Stable V5 semantic authority. Before adding or retaining a parser, prove that it is mechanical representation/compatibility rather than a semantic choice already owned by AI.

### `chat/` / `config/`

Conversation-support and feature configuration helpers. Do not place independent domain ownership here merely because the caller is chat/UI.

## 5. User planning context

`src/features/userPlanningContext/` owns owner-scoped durable planning context infrastructure.

Durable preference is not the same as current-week acceptance or observed learning evidence. Cloud/shared authority and long-term rollout remain coordinated through Issue #47 and client-first architecture Issue #164.

## 6. Major safety boundaries

### AI

AI may interpret language and render typed dialogue decisions. AI does not own formal IDs, revision/lifecycle, readiness, scheduler placement, approval or save.

### Preview / approval

Preview is unsaved and revision-bound. Approval/save is an explicit deterministic boundary. Multi-device uniqueness production rollout remains Issue #51.

### Trace

Trace is best-effort diagnostic evidence, never authorization or planning truth.

### Persistence

Client-first execution does not mean client-authoritative shared state. Storage/reconciliation changes must align with Issue #164.

## 7. Tests

- unit/integration/component/property tests: primarily `src/**/*.test.*`
- browser/E2E: `tests/e2e/`
- current testing docs: `docs/testing/README.md` and `docs/ai/testing/`
- CI: `.github/workflows/ci.yml`
- Browser Regression: `.github/workflows/browser-regression.yml`

Do not use a green unrelated check to justify a changed responsibility boundary.

## 8. Documentation ownership

- `README.md`: first-time product/development overview
- `AGENTS.md`: repository-wide stable execution and architecture rules
- `PROJECT_MAP.md`: current code navigation
- `docs/ai/`: weekly-planning contract/status/roadmap/task/audit material
- `docs/architecture/`: current architecture supplements plus explicitly historical stubs
- `docs/testing/`: test-document index and historical roleplay records
- `docs/weekly-planning/`: product-intent documentation; current runtime details remain subordinate to `docs/ai/`

Active task list: `docs/ai/tasks/README.md`.

Completed/superseded files must not re-enter the execution queue only because they contain an old `Status: active`, branch name or PR number.

## 9. Change-location rule

Choose the directory by change reason, not by current caller:

- visual interaction → `components/`
- React lifecycle coordination → `hooks/`
- natural-language meaning → weekly `semantic/`
- readiness/proposal/work decision → weekly `planning/`
- placement/availability → weekly `scheduling/`
- dialogue action/realization boundary → weekly `dialogue/`
- unsaved candidate → weekly `preview/`
- approval/session orchestration → weekly `application/`
- observability → weekly `trace/`
- persistence → repository/feature-owned persistence boundary

If the same decision is recomputed in multiple directories, identify the single owner and make the other layers projections/facades rather than adding reconciliation logic.
