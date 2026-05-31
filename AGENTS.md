# AGENTS.md

## Project overview

This project is a study planning support web app.

The app helps users:

- create study plans for month / week / day
- record actual study activity
- compare plan vs actual
- reduce input burden using AI-assisted natural language editing
- receive AI-based feedback and scores for learning habits

This repository should prioritize a clean MVP first.

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

## Natural language scheduling rules

- Keep natural language schedule parsing in a staged pipeline
- Preserve the separation:
  - normalize
  - tokenize
  - clause parsing
  - AST building
  - IR lowering
  - compile
  - validate
- Do not collapse multiple stages into ad-hoc postprocessing
- Keep old planner / fallback paths until the new pipeline is safely integrated
- Prefer incremental extension over large rewrites
- Keep parser outputs reviewable and debuggable through assumptions, diagnostics, and unresolved fields
- Do not expose advanced recurrence UI/behavior beyond MVP unless explicitly requested

## Responsive design rules

- Desktop and mobile must both work well
- Avoid layouts that break on narrow screens
- Build mobile-friendly interactions from the start
- Treat responsiveness as a core requirement, not a later enhancement

## AI behavior rules

AI should support the user, not silently override user intent.

Allowed AI roles in MVP:

- parse natural language schedule additions
- parse natural language schedule edits
- suggest structured fields from loose input
- compute simple study feedback and scores
- generate short actionable advice

AI must:

- present suggestions in a reviewable way before final apply
- avoid making destructive changes without confirmation
- prefer simple, understandable outputs

## Coding style

- Prioritize clarity
- Use descriptive names
- Avoid unnecessary abstraction early
- Add comments only where they help understanding
- Keep files reasonably scoped
- Follow existing project conventions once established

## Git operation policy

Codex must not perform Git write operations.

Do not run the following commands unless the user explicitly asks for that exact command in the current message:

- git add
- git commit
- git reset
- git restore
- git checkout
- git switch
- git merge
- git rebase
- git cherry-pick
- git stash
- git clean
- git pull
- git push
- git mv
- git rm

Codex may run read-only Git commands for investigation:

- git status
- git diff
- git diff --stat
- git log
- git show
- git branch
- git rev-parse

Before making changes, Codex should inspect the current diff when relevant.
After making changes, Codex should report changed files and leave staging, committing, reverting, and pushing to the user.

Codex must not remove `.git/index.lock` automatically.
If a Git lock file exists, Codex should stop and tell the user instead of deleting it.

## Verification rules

Before finishing a task:

- ensure the app builds
- run lint if configured
- run tests if present
- summarize what changed
- list any unfinished or deferred items
- note any assumptions made

## Definition of done

A task is done only if:

- the requested feature is implemented
- the UI works on desktop and mobile sizes
- code is consistent with architecture rules
- basic verification has been performed
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