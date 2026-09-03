# AGENTS.md

## Mandatory execution discipline

This section applies to every agent and every repository task. Read it before the first repository, code, GitHub, CI, or tool action. These rules are mandatory and must not be skipped for convenience.

### Adversarial decision protocol

- Do not commit to the first plausible explanation or action when evidence is incomplete.
- Whenever a failure, ambiguity, architectural choice, or operational choice has more than one plausible explanation, generate at least three materially different hypotheses or candidate actions before choosing one.
- For each candidate, identify the evidence that supports it, the evidence that would falsify it, its blast radius, and how directly it can be verified.
- Choose the option with the strongest evidence and the lowest unnecessary risk, not the option that is most familiar or easiest to execute.
- Ask explicitly: "What would make my current interpretation wrong?" Seek disconfirming evidence before acting on a high-impact assumption.
- Do not invent artificial alternatives for a truly deterministic operation, but never treat an uncertain operation as deterministic merely to avoid comparison.

### Repeat-action guard

- Before repeating the same command, tool call, query, test, or write operation, state what materially changed since the previous attempt and why another attempt can produce new evidence.
- If the same operation fails twice under materially identical inputs and conditions, a third identical attempt is prohibited. Change the inputs, inspect the preconditions, or switch to a different evidence source or tool path.
- Treat `skipped`, truncated, incomplete, stale, cached, or missing output as missing evidence, not as evidence that the underlying action succeeded or failed.
- When a tool path is unreliable, compare alternatives such as current repository state, exact diff, another API endpoint, workflow artifacts, test source, static code inspection, or a local reproduction before choosing the next step.
- Never loop on tool discovery or metadata lookup when the needed evidence can be obtained through a more direct route.

### Completion-loop contract

For implementation, repair, CI, review-response, migration, or other work with a concrete completion condition, intermediate progress is not completion.

After every tool result, code/document change, test result, workflow result, review result, or external-state change:

1. Re-evaluate the explicit definition of done and every requested exit criterion against the exact current HEAD/state.
2. If any criterion is unmet, determine the next concrete action and execute it instead of producing a final response.
3. Treat `failed` verification as a loop-back condition: classify the failure, inspect evidence, correct the appropriate layer, and rerun the strongest relevant verification.
4. Treat `queued`, `pending`, or `in_progress` verification as a poll/inspect condition. Continue following it to a terminal state when the result is required for completion.
5. Treat `skipped`, truncated, stale, cached, missing, or cancelled verification as missing evidence unless the skip/cancellation is itself an intentional part of the applicable contract.

Do not stop or produce a final response merely because:

- a fix was committed or pushed
- a pull request was opened or updated
- CI or another asynchronous workflow was started
- some checks passed
- a failure or blocker candidate was identified
- a retry is required
- an external workflow is still running
- substantial time or many tool calls have elapsed
- an intermediate progress summary would be convenient

A failed relevant check cannot be converted into completion by reporting the failure. It must route back to diagnosis and correction unless one of the explicit stop conditions below applies.

A final response is allowed only when one of these conditions is true:

1. All requested completion criteria are satisfied and verified on the exact current state.
2. Further progress requires information, product judgment, approval, credentials, or a permission that only the user or an external owner can provide.
3. A required tool/capability is genuinely unavailable after reasonable alternative evidence/tool paths have been exhausted.
4. A hard external blocker makes further execution impossible in the current turn and cannot be resolved by polling, retrying with changed conditions, inspecting another source, or correcting the implementation/harness.
5. Continuing would require a destructive or history-rewriting action for which this repository policy requires explicit user approval.

Before sending the final response for a concrete implementation/repair task, perform a final completion audit. At minimum ask:

- Is the requested implementation/change actually complete?
- Are all relevant tests, CI gates, browser/visual/quality checks, and reviews in the required terminal state?
- Were failures classified and resolved rather than hidden, weakened, or merely reported?
- Is the active branch/PR based on the intended current base, with the exact diff reviewed?
- Was merge/publish/post-merge verification completed when it is part of the request and safe to perform?
- Is there any known actionable failure, pending required check, unresolved review thread, or unverified regression remaining?

If any required answer is `no`, continue the execution loop instead of responding.

For long-running or asynchronous tasks, use the following state transition model unless the task defines a stricter one:

`INSPECT → IMPLEMENT → VERIFY → { failure: DIAGNOSE → IMPLEMENT, running: POLL → VERIFY, success: FINAL_AUDIT → { incomplete: IMPLEMENT/VERIFY, complete: DONE } }`

- `failure` never transitions directly to `DONE`.
- `running` never transitions directly to `DONE` when that result is part of the definition of done.
- Intermediate commentary should state the current failure or next action briefly and then continue execution; do not turn an intermediate status report into an implicit handoff.
- If a task is interrupted, resume from the last durable verified checkpoint and re-fetch mutable repository/CI state before acting; do not reconstruct completion from chat memory.

### Durable checkpoint rule

For multi-turn, long-running, high-risk, or interruption-prone work, maintain a durable checkpoint in the current canonical task/roadmap document, the owning GitHub Issue, or an appropriate `docs/domains/<responsibility>/work/*-handoff.md` file. The checkpoint should contain, when relevant:

- active branch and pull request
- exact verified HEAD
- completed changes
- checks already run and their exact result
- unresolved failures or competing hypotheses
- the next concrete action
- the explicit definition of done / exit criteria

Update the checkpoint after meaningful milestones and before intentionally handing off incomplete work. Repository evidence is the source of truth; chat memory is not.

### Verification discipline

- Re-fetch mutable state immediately before a write when concurrent changes are possible.
- Verify the exact changed code, not just the intended patch.
- For code changes, use the strongest applicable independent checks: type checks, unit/integration tests, production build, CI, browser regression, rendered UI inspection, and exact diff review.
- A green unrelated check cannot compensate for a failing relevant check.
- If a test fails, classify the cause before editing: production defect, stale/incorrect contract, harness/environment defect, or infrastructure/transient failure.
- Never weaken a test, hide an error, or change an assertion solely to make CI green.

### Explanation and reporting clarity

- When explaining implementation, architecture, bugs, refactors, or progress to the user, start with product concepts, responsibility boundaries, data flow, and observable behavior.
- Do not make raw variable, function, class, file, or internal field names the primary explanation unless the user explicitly asks for code-level detail.
- Prefer plain domain language first, such as "the current bookshelf data is passed directly into the planning turn", before introducing implementation identifiers.
- Introduce concrete identifiers only after the concept is clear and only when they improve traceability, debugging, or review.
- If a technical term or acronym is necessary, explain its meaning on first use unless the user has already established that vocabulary.
- Progress and final summaries should prioritize: what was wrong, what responsibility or flow changed, why the new structure is safer or clearer, and what remains. Put low-level implementation names after that explanation rather than in place of it.
- Do not oversimplify away important behavior or uncertainty. The goal is conceptual clarity first, implementation detail second.

## Project overview

This project is a study planning support web app.

The app helps users:

- create study plans for month / week / day
- record actual study activity
- compare plan vs actual
- reduce input burden using AI-assisted natural language editing
- receive AI-based feedback and scores for learning habits

This repository should prioritize a clean MVP first.

## Instruction roles

- This file defines stable product, architecture, safety, and repository hygiene principles.
- `docs/DOCUMENT_DICTIONARY.md` defines where documentation belongs and which lifecycle/authority rules apply.
- Each responsibility's `docs/domains/<responsibility>/README.md` is the current documentation entry point for that domain.
- The current canonical roadmap and active Issue/work records define active scope, priority, checkpoint, and the next implementation step.
- For task progress and execution order, follow the current roadmap/Issue rather than inferring status from this file or from historical task documents.
- `docs/archive/` is historical evidence and never overrides current code, tests, or canonical domain documentation.

## Documentation governance

- Organize current Markdown first by responsibility, then by document type and lifecycle, as defined in `docs/DOCUMENT_DICTIONARY.md`.
- Do not create canonical top-level buckets named after an agent, audience, tool, or vague activity such as `ai`, `testing`, `strategy`, `design`, `misc`, or `notes`.
- Feature-specific test policy belongs to the feature/domain that owns the behavior; historical audits belong in `docs/archive/`.
- Active technical records belong in the owning domain's `work/` directory or the owning GitHub Issue. Repository-wide work templates/rules belong in `docs/work/`.
- Completed work moves to `docs/archive/work/closed/`; superseded work moves to `docs/archive/work/superseded/`.
- Do not duplicate the same decision across a contract, status file, guide, and roadmap. Pick one owner and make other documents reference it.
- Canonical filenames should remain stable when practical. Date-prefixed filenames are appropriate mainly for active work/checkpoints and historical evidence.
- When moving a canonical document, update `docs/README.md`, the owning domain README, `PROJECT_MAP.md`, affected root entry files, and Issue references in the same logical change.

## Product priorities

Priority order:

1. Make the app usable with a small but complete MVP
2. Keep input simple and low-friction
3. Make plan vs actual comparison easy to understand
4. Keep the UI responsive for both desktop and mobile
5. Preserve architecture flexibility for future backend migration
6. Leave room for future sharing and mobile app support

## MVP scope

You should implement only the MVP unless explicitly asked otherwise.

MVP includes:

- email authentication
- create / edit / delete plans
- month / week / day views
- record one actual entry per plan
- compare planned vs actual
- natural language AI-assisted add/edit flow
- simple score visualization
- short AI feedback comments

Not in MVP unless explicitly requested:

- advanced sharing permissions
- complex recurrence rules
- real-time collaboration
- push notifications
- native mobile app
- complex analytics dashboards
- multi-actual-per-plan workflows

## UX principles

- The app must feel easier than typical calendar/task apps
- Avoid cluttered screens
- Do not show all information at once
- Use progressive disclosure:
  - month view first
  - then week
  - then day
- Optimize for readability on both desktop and mobile
- Favor simple forms and fast editing
- AI suggestions should be reviewable before applying changes

## UI expectations

### Month view

- show monthly overview
- display daily target study time
- display main events such as exams, school events, cram school events
- allow selecting week 1, week 2, etc.

### Week view

- this is the most important comparison view
- show planned schedule as the base layer
- show actual study activity as an overlay or clearly comparable secondary layer
- make it easy to understand mismatches between plan and actual

### Day view

- show detailed plan items
- allow quick actual input
- allow natural language edits
- show AI feedback and simple scores

## Data model guidance

Keep the initial schema minimal.

### Plan

Recommended minimal fields:

- id
- user_id
- title
- subject
- date
- start_time
- end_time
- type
- memo

### Actual

Recommended minimal fields:

- id
- plan_id
- actual_start_time
- actual_end_time
- subject
- note

Rules:

- start with one actual record per plan
- keep the schema extensible for future multi-actual support
- include user_id wherever needed for future multi-user safety
- design for future group/shared support, but do not implement it now

## Architecture rules

- Use TypeScript
- Keep components small and composable
- Separate UI layer, domain logic, and data access
- Do not tightly couple the app to one backend provider
- Create a repository/service abstraction for auth and data access
- Keep AI-related logic separate from UI rendering logic
- Prefer predictable, maintainable code over clever shortcuts
- Follow SOLID principles where they improve responsibility boundaries and dependency direction
- Encapsulate related behavior by responsibility and change reason, then expose a small stable facade/application API to callers
- Do not make callers know singleton selection, fallback ordering, storage implementation details, or internal condition trees
- Prefer explicit state/transition types such as discriminated unions over unrelated nullable flags when practical

## Natural language scheduling rules

Stable V5 is the production baseline for weekly planning.

### Ownership boundary

AI owns semantic interpretation of raw user language and conversation context, including:

- task / component meaning
- workload and quantity role
- dates, weekdays, time periods, and temporal intent
- corrections and short contextual answers
- authorization intent
- structured semantic candidates

Deterministic code owns:

- schema / evidence / reference validation
- formal binding and canonical IDs
- Fact Graph lifecycle
- revision and idempotency
- whether clarification or confirmation is required
- question priority and progression policy
- readiness
- scheduling and placement safety
- preview freshness
- approval and save
- persistence, recovery, and safety boundaries

### Required constraints

- Do not reinterpret raw Japanese text with regex, keywords, dictionaries, or a legacy parser to establish semantic truth.
- Do not restore the old normalize → tokenize → clause parser → AST → IR pipeline as a production semantic authority.
- Deterministic routing may use machine state and validated typed AI output, but it must not infer user intent from ad-hoc lexical heuristics.
- Do not add more raw-text regex rules to compensate for semantic routing or interpretation failures.
- Provider failure, malformed output, validation failure, or AI repair failure must not fall back to a legacy natural-language parser.
- Semantic repair may be performed at most once where the current Stable V5 contract permits it.
- AI must not choose formal lifecycle mutations, readiness, question priority, scheduler placement, approval, or save.
- Renderer output is presentation only. Do not infer machine state or pending targets back from rendered Japanese text.
- Keep current saved-data migration/read compatibility separate from semantic runtime compatibility. Existing data compatibility is not permission to reintroduce legacy semantic execution.
- Prefer small typed semantic/application boundaries and stable facades over central orchestrators that expose internal implementation details.

Canonical weekly-planning documentation lives under `docs/domains/weekly-planning/`:

- `docs/domains/weekly-planning/README.md`
- `docs/domains/weekly-planning/architecture/current-contract-v5.md`
- `docs/domains/weekly-planning/architecture/weekly-planning-semantic-ownership-boundary-v5.md`
- `docs/domains/weekly-planning/quality/test-philosophy.md`
- `docs/domains/weekly-planning/roadmap/current.md`

Historical task files, audits, legacy architecture documents, old branch names, or stale `Status: active` markers under `docs/archive/` must not override the current Stable V5 contract.

## Responsive design rules

- Desktop and mobile must both work well
- Avoid layouts that break on narrow screens
- Build mobile-friendly interactions from the start
- Treat responsiveness as a core requirement, not a later enhancement

## AI behavior rules

AI should support the user, not silently override user intent.

Allowed AI roles in MVP:

- semantically interpret natural language schedule additions and edits
- structure user language into validated typed candidates
- interpret contextual corrections, short answers, and authorization intent where required by the active contract
- render deterministic application decisions into natural user-facing language
- suggest structured fields from loose input
- compute or generate user-facing study feedback only where the feature contract explicitly assigns that responsibility to AI
- generate short actionable advice

AI must:

- present suggestions in a reviewable way before final apply when the product flow requires review
- avoid making destructive changes without the deterministic confirmation/approval boundary
- prefer simple, understandable outputs
- never become the authority for scheduler placement, formal state transitions, idempotency, approval, or persistence

## Coding style

- Prioritize clarity
- Use descriptive names
- Avoid unnecessary abstraction early
- Add comments only where they help understanding
- Keep files reasonably scoped
- Follow existing project conventions once established
- A large file is not automatically wrong, but split it when it owns independent responsibilities or independent reasons to change
- Do not refactor only to move code between files; improve responsibility, encapsulation, dependency direction, or testability
- Remove dead compatibility surfaces only after verifying they have no production, test, migration, or persisted-data responsibility

## Test audit policy

When a test fails during refactoring or feature work, classify the cause before changing assertions:

1. implementation defect → fix production code
2. stale or incorrect test contract → fix the test against the current canonical contract
3. harness boundary issue → fix the harness

Never delete or weaken a regression solely to obtain green CI. AI wording and one exact semantic phrasing should not be treated as universal truth unless a deterministic UI contract explicitly requires exact text.

## GitHub workflow policy

This section applies whenever ChatGPT performs Git or GitHub work in this repository.

### Mandatory pre-flight check

Before creating or modifying an Issue, branch, commit, or pull request, the agent must:

1. Read this `AGENTS.md`, including this entire GitHub workflow policy.
2. Inspect the current repository state and relevant diff.
3. Search existing open and closed Issues, pull requests, and branches for the same logical task.
4. Classify the work as investigation/backlog, active implementation, or a reviewable change.
5. Reuse the existing Issue, branch, and pull request whenever they already represent the same logical task.

The agent must not perform a GitHub write action until this pre-flight check is complete.

### Concurrent-work guard

Before the first implementation write, and again whenever interrupted work is resumed, the agent must determine whether the same logical task is already being worked by another chat or agent using repository evidence rather than chat memory.

- Re-fetch the owning Issue and inspect its latest durable checkpoint, recent comments, active branch/PR references, exact HEAD/base, and stated next action.
- Search current open pull requests and branches for the same logical task, including branches whose names do not contain the Issue number.
- Treat an active checkpoint, recent unmerged implementation, or an explicitly active branch/PR for the same scope as occupied work. Do not create a parallel branch/PR or independently implement the same scope.
- Resume an existing active branch only when the user's request clearly hands off or continues that work, and only after re-fetching its current HEAD and diff. Never assume a remembered branch state is current.
- When taking ownership of a task that has no active owner, immediately record the active branch, pull request if one exists, exact base/HEAD, scope, and next action in the owning Issue or canonical work checkpoint so other agents can detect it before writing.
- If another agent's active work overlaps materially in files, responsibility, or acceptance criteria, do not race it. Reuse the existing owner path or leave the overlapping scope untouched until ownership is resolved.
- Distinct concurrent tasks may proceed only when their responsibility boundaries and release units are genuinely separate; sharing a nearby file alone is not sufficient evidence of conflict, but shared semantic ownership or the same acceptance criterion is.
- Repository evidence is the coordination source of truth. A missing memory of another chat is never evidence that no one else is working on the task.

### Issue, branch, and pull request roles

- Use an Issue for bugs, investigation, design decisions, backlog, verification tracking, operational work, and tasks that are not yet implementation-ready.
- Create a branch only when active implementation begins.
- Create a pull request only when there is a coherent, reviewable diff that is intended to be merged.
- A draft pull request is allowed only when early collaboration or review of a real implementation diff is necessary. Do not use draft pull requests as execution logs, retry records, or placeholders.
- Verification-only work should normally stay in an Issue checklist or GitHub Actions run. Do not create a pull request solely to run tests.
- Create a documentation pull request only when canonical repository documentation actually needs to change.

### One logical task, one branch, one pull request

- One logical task should use at most one active Issue, one active branch, and one active pull request.
- Continue fixes, review responses, CI repairs, and implementation retries on the same branch and pull request.
- Do not create `-v2`, `-v3`, `-retry`, `-fix`, or equivalent replacement branches or pull requests for the same task merely because an attempt failed.
- If replacement is exceptionally necessary because the original branch is corrupted, unsafe, or based on the wrong history, close the old pull request, delete the old branch, link the replacement from the Issue, and state why replacement was unavoidable.
- Before opening a new pull request, explicitly confirm that an existing Issue or pull request cannot represent the work.

### Pull request granularity

- Keep pull requests small enough to review, but group changes that share the same root cause, acceptance criteria, and release unit.
- Do not split every wording change, assertion, test adjustment, or retry into a separate pull request.
- Do not combine unrelated product changes merely to reduce the pull request count.
- Prefer one complete pull request over a chain of partial, superseded pull requests.

### Branch lifecycle

- Use stable, descriptive branch names tied to the task, without version suffixes for retries.
- After a pull request is merged, delete its head branch.
- When work is abandoned, close the pull request, update the Issue with the outcome, and delete the branch.
- Do not keep temporary verification, patch-application, or superseded branches after they are no longer needed.
- Keep the repository limited to `main`, currently active implementation branches, and explicitly justified long-lived branches.


### Branch deletion fallback when direct GitHub deletion is unavailable

- Prefer the native Git or GitHub branch-delete operation whenever the current tool surface exposes it.
- If the current GitHub connector does not expose a branch-delete write, but GitHub Actions and repository contents writes are available, a one-shot GitHub Actions workflow may be used as a fallback only for an already-authorized branch-cleanup task.
- Before creating the workflow, re-fetch the current branch list and verify every deletion target individually. Each target must be merged or explicitly abandoned, must have no active pull request that still needs the branch, and must not be `main`, the default branch, an active implementation branch, a justified long-lived branch, or a Dependabot branch unless the user explicitly requested that specific deletion.
- Put deletion targets in an explicit allowlist. Never use a wildcard, prefix sweep, age-based heuristic, or broad pattern that could catch an active branch.
- Give the one-shot workflow only the minimum required permission (`contents: write`) and delete branches with an explicit command such as `git push origin --delete -- <branch>`.
- Wait for the cleanup workflow to reach a terminal successful state, then re-fetch the remote branch list and verify that every intended target is absent and every protected/active branch is still present.
- Remove the one-shot cleanup workflow immediately after successful verification and verify that the temporary workflow file is absent from the current `main` tree.
- Branch deletion remains a destructive operation. If deletion was not already explicit in the user's request or the currently authorized cleanup task, ask before deleting anything.
- Do not use this fallback to bypass branch protection, repository rulesets, required reviews, force-push restrictions, or any other safety boundary, and do not extend it to history rewriting.

### Tooling incident knowledge and Ready-for-review fallback

- Before repeating or inventing a workaround for a GitHub/CI/tool failure, search `docs/work/tooling-operations-runbook.md` for a verified failure signature and safe fallback.
- When a recurring or expensive-to-rediscover tooling failure is resolved, update that runbook with the symptom, cause, permissions, workaround, cleanup, and verification rather than leaving the knowledge only in chat or transient logs.
- For PR Ready-for-review, use the normal GitHub operation first. If it fails and a re-fetch proves the PR is still `draft=true`, follow the runbook fallback instead of creating a replacement PR or repeatedly calling the same broken mutation.
- The currently verified one-shot GitHub Actions fallback for the observed Ready mutation requires `pull-requests: write` and `contents: write`, must be scoped to the exact intended PR, and must be removed immediately after `draft=false` is verified.
- Treat this fallback as an integration workaround, not as the default PR flow; re-check current GitHub/tool behavior before assuming the historical failure still applies.

### Firestore Rules deployment capability

- Production Firestore Rules deployment is already automated by `.github/workflows/deploy-firestore-rules.yml` using GitHub OIDC, Google Cloud Workload Identity Federation, short-lived credentials, and the Firebase Rules API. Do not introduce a static service-account JSON key or `FIREBASE_TOKEN` workaround.
- Before asking the user to create Google Cloud credentials, GitHub secrets, or manual Firebase deployment steps, inspect the current workflow, `docs/work/tooling-operations-runbook.md`, and recent `Deploy Firestore Rules` runs. Treat the existing WIF path as the default supported deployment mechanism unless current evidence proves it is broken.
- When `firestore.rules` changes on `main`, follow the deployment workflow to a terminal state and verify the WIF authentication step, Rules API deployment, production ruleset read-back, and repository SHA-256 match. A queued or partially successful run is not completion.
- Only stop for user action when the current WIF/IAM configuration genuinely requires permissions or account changes that cannot be completed through the available repository/tooling path. Report the exact failing step and the minimum manual action required.

### Required reporting

When finishing GitHub-related work, report:

- which existing Issue, branch, and pull request were reused
- whether any new Issue, branch, or pull request was created and why it was necessary
- which branches should be deleted or were deleted
- any remaining work that belongs in an Issue rather than another pull request

## Git operation policy

ChatGPT may perform the ordinary Git write operations needed to complete a user-requested implementation and publishing workflow after the mandatory pre-flight check. The user does not need to restate or approve each routine command individually.

Before making or publishing changes, inspect the current state and relevant diff. Keep commits and pushes limited to the active logical task and report what was published.

Ask before a destructive or history-rewriting operation that is not already explicit in the user's request, including discarding worktree changes, hard reset, force push, rewriting shared history, or deleting a branch.

Do not remove `.git/index.lock` automatically. If a Git lock file exists, stop and tell the user instead of deleting it.

## Verification rules

Before finishing a task:

- ensure the app builds
- run lint if configured
- run tests if present
- summarize what changed
- list any unfinished or deferred items
- note any assumptions made

For documentation-only changes, application build/test execution is optional when no code/config/runtime behavior changed; instead verify exact diff, canonical path integrity, current-reference searches, and relevant Markdown links.

## Definition of done

A task is done only if:

- the requested feature/change is implemented
- applicable UI behavior works on desktop and mobile sizes
- code/documentation is consistent with architecture and responsibility rules
- appropriate verification has been performed
- changed files and follow-up work are summarized

## Constraints

- Do not overbuild beyond the requested MVP
- Do not introduce large dependencies without clear justification
- Do not implement advanced recurrence yet
- Do not implement advanced sharing yet
- Do not add unnecessary visual complexity
- Do not replace the intended progressive month → week → day structure

## When unsure

If requirements are ambiguous:

- choose the simpler MVP-friendly option
- preserve future extensibility
- document assumptions clearly in the final summary