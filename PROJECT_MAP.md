# StudyPlanner Project Map

Status: canonical repository navigation map
Updated: 2026-08-28

この文書は「変更したい責務の正しい入口」を短時間で見つけるための地図である。詳細仕様や実行queueを複製しない。Markdown の配置規則は `docs/DOCUMENT_DICTIONARY.md` が正本である。

## 1. Read order

Repository work:

1. `AGENTS.md`
2. `PROJECT_MAP.md`
3. `docs/README.md`
4. 対象 domain の `README.md`
5. domain canonical contract / current Issue / active work record
6. current code and tests

Weekly planning:

1. `docs/domains/weekly-planning/README.md`
2. `docs/domains/weekly-planning/architecture/current-contract-v5.md`
3. `docs/domains/weekly-planning/architecture/weekly-planning-semantic-ownership-boundary-v5.md`
4. `docs/domains/weekly-planning/quality/test-philosophy.md`
5. `docs/domains/weekly-planning/roadmap/current.md`
6. `docs/domains/weekly-planning/work/README.md` / owning Issue

Client-first/runtime work:

1. `docs/domains/client-runtime/README.md`
2. `docs/domains/client-runtime/spec/client-first-execution-requirements.md`
3. Issue #164

Reporting work:

1. `docs/domains/reporting/README.md`
2. `docs/domains/reporting/spec/learning-report.md`
3. `src/lib/learningReport.ts` / `src/lib/learningReport.test.ts`
4. `src/components/ReportView.tsx`

Product observability / admin analytics work:

1. `docs/domains/product-observability/README.md`
2. `docs/domains/product-observability/spec/console-requirements.md`
3. `docs/domains/product-observability/architecture/telemetry-and-read-model.md`
4. `docs/domains/product-observability/roadmap/current.md`
5. Issue #213
6. current admin / AI metrics / weekly trace code

`docs/archive/` is evidence, not current instruction.

## 2. Application shell

### `src/App.tsx`

Top-level application composition and major navigation. Product surfaces include AI計画、予定、ホーム、教材、時間割 and secondary/admin routes.

Do not move feature-specific domain decisions into `App.tsx`; keep it primarily as composition/routing/orchestration.

### `src/components/`

UI components and interaction surfaces. Examples:

- `AiPlanningView.tsx` / `AiPlanningChatSidebar.tsx`: dedicated AI planning surface
- calendar / home / bookshelf / timetable views
- `ReportView.tsx`: Homeから開く二次導線の学習レポート。表示・interactionのみを担当し、集計ルールは `src/lib/learningReport.ts` を利用する
- `QuickEntryModal.tsx`: generic quick/manual entry surface
- `WeeklyPlanningQuickEntryModal.tsx`: remaining compatibility wrapper; weekly-planning plumbing is tracked by Issue #52
- admin views: current UI surface。service-wide analyticsのmetric semantics、collection scan、pricing、rollupをcomponent内へ実装せず、product-observability query/read modelをconsumeする

UI code consumes application/domain APIs instead of reproducing scheduling, lifecycle, authorization, persistence, reporting aggregation or product-observability aggregation decisions.

### `src/hooks/`

React-level orchestration and state composition. Use for view/application lifecycle coordination, not reusable domain policy.

## 3. General domain and persistence

### `src/domain/`

General deterministic domain rules that are not specific to weekly-planning internals.

### `src/repositories/`

Persistence boundaries. Firestore/local implementations and repository abstractions belong here or in a feature-owned equivalent when the data lifecycle is feature-specific.

Components must not know storage implementation details, fallback ordering or transaction internals.

### `src/services/`

External/service integration and the separate single-event natural-language subsystem.

`src/services/natural-language/` and `naturalLanguagePlanner` are not the semantic authority for Stable V5 weekly planning. Their lexical/rule logic must not be imported as a fallback to reinterpret weekly-planning raw user text.

Current admin data access and AI request metrics also live under services today. Issue #213 will move service-wide observability behavior behind a product-observability application/repository boundary rather than making UI depend on current physical locations.

### `src/lib/`

Small reusable deterministic helpers and cross-cutting utility logic. Domain-changing policy should not be hidden here merely to avoid creating a feature module.

`src/lib/learningReport.ts` owns deterministic user-facing report aggregation/projection for the reporting domain. Its output must preserve the report invariant that selected-period actual total, trend-bucket total and breakdown total are the same filtered Actual set.

Legacy/general report helpers remain in `src/lib/reportAnalytics.ts`; new user-facing learning report behavior should not be reimplemented inside JSX.

Current `src/lib/adminAnalytics.ts` is legacy/current admin aggregation evidence, not the future owner of service-wide telemetry semantics. Issue #213 defines the migration away from browser-side full-collection analytics.

### `src/types/`

Shared application/domain types. Prefer feature-local types when one feature owns the contract.

## 4. Product observability

Canonical documentation root: `docs/domains/product-observability/`

Current implementation is distributed across admin components, `src/services/adminDataService.ts`, `src/lib/adminAnalytics.ts`, AI client metrics, AI proxy, and weekly-planning trace adapters. Do not infer future ownership from those current physical locations.

Issue #213 establishes the target boundary:

- lightweight product activity telemetry
- AI/API request metrics
- weekly-planning typed outcome projection
- opaque actor correlation
- server-side aggregation / rollup
- bounded admin read models
- cross-page drill-down
- restricted diagnostic adapters / Debug Bundle

Product observability is observation only. It must not become planner data authority, weekly-planning lifecycle authority, authorization source or user-facing report authority.

Detailed weekly-planning trace remains owned by the weekly-planning feature and is consumed through a restricted adapter.

## 5. Weekly planning feature

Canonical code root: `src/features/weeklyPlanning/`

Canonical documentation root: `docs/domains/weekly-planning/`

Read the feature-local `AGENTS.md` before modifying weekly-planning code.

### `semantic/`

AI semantic boundary and typed semantic document processing.

Owns model-facing semantic contracts, validation/repair integration, canonical representation helpers, binding support and Fact Graph semantic lifecycle pieces.

Natural-language meaning is AI-owned. Deterministic code may validate and mechanically transform represented meaning but must not re-read raw Japanese with regex/keywords to choose a different semantic truth.

### `intake/`

Request/conversation input collection and accepted intake-state boundaries.

### `pipeline/`

Turn execution/pipeline composition between semantic intake and deterministic application stages. It must not become a second owner of decisions already owned by semantic/planning/dialogue layers.

### `planning/`

Deterministic planning decisions: readiness, proposal lifecycle, work projection/compilation, approval contracts and related state decisions.

### `scheduling/`

Availability resolution, session chunking, placement candidates/scoring and schedule generation from already accepted typed state.

Scheduling may use deterministic constraints and explicit typed preferences. It must not silently infer semantic preferences from raw task text.

### `dialogue/`

Deterministic decision of what must be communicated/asked plus the boundary that lets AI render the typed decision naturally.

Rendered Japanese is presentation, not machine state.

### `preview/`

Unsaved preview/candidate projection and preview metadata/freshness boundaries.

### `application/`

Session/application orchestration, approval/save boundary and feature-level application APIs. This is the preferred caller-facing facade for lifecycle operations.

### `trace/`

Weekly-planning diagnostic observability only. Trace failure must not change the planning result. Privacy/retention is tracked by Issue #45 and production recovery by #89.

Service-wide product analytics does not move into this directory. Product-observability consumes trace through a diagnostic adapter and consumes typed weekly-planning outcomes without reinterpreting trace content.

### `evals/`

Real-model/evaluation harnesses and observation scenarios. Evaluation fixtures are not production semantic rules.

### `personalization/` and `profiling/`

Typed personalization policy, observations/calibration, profile derivation and deterministic scoring. Keep explicit preference, current-session state and observed profile distinct.

### `parsing/`

Legacy/mechanical parsing helpers still present in the codebase. Presence of this directory is not permission to use raw-text parsers as Stable V5 semantic authority. Before adding or retaining a parser, prove that it is mechanical representation/compatibility rather than a semantic choice already owned by AI.

### `chat/` / `config/`

Conversation-support and feature configuration helpers. Do not place independent domain ownership here merely because the caller is chat/UI.

## 6. User planning context

`src/features/userPlanningContext/` owns owner-scoped durable planning context infrastructure.

Durable preference is not the same as current-week acceptance or observed learning evidence. Cloud/shared authority and long-term rollout remain coordinated through Issue #47; client-first execution belongs to the separate `docs/domains/client-runtime/` responsibility and Issue #164.

## 7. Major safety boundaries

### AI

AI may interpret language and render typed dialogue decisions. AI does not own formal IDs, revision/lifecycle, readiness, scheduler placement, approval or save.

### Preview / approval

Preview is unsaved and revision-bound. Approval/save is an explicit deterministic boundary. Multi-device uniqueness production rollout remains Issue #51.

### Trace

Trace is best-effort diagnostic evidence, never authorization or planning truth.

### Product observability

Telemetry and analytics are best-effort observation, never product authority. Lightweight analytics must remain separable from raw diagnostic content. Management UI reads typed read models and does not make browser-side full scans the canonical analytics design.

### Persistence

Client-first execution does not mean client-authoritative shared state. Storage/reconciliation changes must align with Issue #164.

### Reporting

学習レポートは既存のPlan/Actual/教材情報を決定論的に集計するprojectionであり、LLMを数値・評価の正本にしない。ReportViewは保存・スケジューリング・意味解釈を所有しない。

## 8. Tests

- unit/integration/component/property tests: primarily `src/**/*.test.*`
- reporting aggregation: `src/lib/learningReport.test.ts`
- product observability contracts / rollups: future implementation under the Issue #213-owned feature/application boundary
- browser/E2E: `tests/e2e/`
- weekly-planning quality policy: `docs/domains/weekly-planning/quality/`
- CI: `.github/workflows/ci.yml`
- Browser Regression: `.github/workflows/browser-regression.yml`

Do not use a green unrelated check to justify a changed responsibility boundary.

## 9. Documentation ownership

Documentation placement is defined only by `docs/DOCUMENT_DICTIONARY.md`.

- `README.md`: first-time product/development overview
- `AGENTS.md`: repository-wide stable execution and architecture rules
- `PROJECT_MAP.md`: current code/navigation map
- `docs/README.md`: documentation entry point
- `docs/domains/<owner>/`: current specification/architecture/policy/quality/roadmap/work for one responsibility
- `docs/work/`: repository-wide task process/templates only
- `docs/archive/`: historical evidence only

Do not recreate audience/tool buckets such as `docs/ai/`, `docs/testing/`, `strategy/`, `design/` or agent-specific queues. A testing policy for weekly planning belongs to the weekly-planning domain because that feature owns the quality contract.

Active work belongs either in the owning GitHub Issue or in the owning domain's `work/` directory when a durable technical checkpoint is necessary.

Completed/superseded records move to `docs/archive/work/` and never re-enter the execution queue merely because they contain an old `Status: active`, branch name or PR number.

## 10. Change-location rule

Choose the directory by change reason, not by current caller:

- visual interaction → `components/`
- React lifecycle coordination → `hooks/`
- learning-report aggregation/projection → `src/lib/learningReport.ts` under the reporting domain contract
- service-wide telemetry / analytics metric semantics / rollup / admin read model → product-observability domain
- natural-language meaning → weekly `semantic/`
- readiness/proposal/work decision → weekly `planning/`
- placement/availability → weekly `scheduling/`
- dialogue action/realization boundary → weekly `dialogue/`
- unsaved candidate → weekly `preview/`
- approval/session orchestration → weekly `application/`
- weekly-planning diagnostic trace → weekly `trace/`
- persistence → repository/feature-owned persistence boundary
- documentation → `docs/domains/<responsibility>/<document-type>/` according to `DOCUMENT_DICTIONARY.md`

If the same decision is recomputed or documented as authoritative in multiple places, identify the single owner and make the other layers projections/references rather than adding reconciliation logic.