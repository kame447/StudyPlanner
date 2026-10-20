# Planner projection transition boundary

Status: locally verified; not published
Updated: 2026-10-20
Base: `22e42203a4df82b5432d4290b7b5ea3a4246b8c9`
Branch: `refactor/domain-boundaries-20261020`
Publication: no remote branch or PR created

## Responsibility correction

The React application hook previously owned both asynchronous command coordination
and the collection rules for applying accepted recurring-plan changes. The existing
`src/domain/plannerDataTransforms.ts` facade now owns those pure compatibility-view
transitions. The hook still owns admission, accepted-read freshness, repository calls,
optimistic operation settlement and independent functional React state updates.

This implements AGENTS.md's UI/domain separation without changing the scheduled-event
persistence authority or inventing a second canonical store. The canonical contract
remains [Scheduled event authority](../architecture/scheduled-event-authority.md).

## Preserved behavior

- Plan updates replace by persisted ID and sort by date/time, including stable ties.
- Actual restoration replaces by persisted ID; ordinary linked Actual save replaces
  by plan occurrence, while standalone Actual identity remains its own ID.
- A recurring mutation removes deleted plans, explicit Actual deletions and Actuals
  linked to deleted plans before applying its upserts. Upserts win over deletions.
- Unrelated records and their object references are retained; inputs are not mutated.
- The hook keeps current-state functional updates rather than applying captured arrays.
- No admission, recurrence generation, ordering authority, persistence, schema, AI
  semantic interpretation, approval or saved-data compatibility policy changed.

## Alternatives and disconfirmation

Keeping the rules in the hook preserves behavior but mixes domain transition policy
with React coordination. Moving the entire async command would cross admission and
recovery ownership unnecessarily. The selected pure extraction is bounded and directly
characterized, rather than introducing a new generic command/reducer framework.

Deleted-ID sets are now derived during the updater. The mutation is constructed locally,
awaited by the repository and never mutated by the caller after publication. Repository
implementations consume the arrays without retaining later mutation callbacks. The
original upsert arrays were already read inside the queued updater. Changing that
ownership contract later would require an explicit immutable command snapshot.

## Verification and remaining work

- Focused six-suite run: 124 tests passed, including projection invariants, existing
  timetable/material transforms, recurring mutation generation, recurring hook lifetime,
  Actual admission and Plan Undo recovery.
- New domain tests cover duplicate-ID winner, equal-time sorting, occurrence versus
  standalone identity, delete-before-upsert precedence, dependent removal and frozen inputs.
- First full verify: fresh app/Worker types passed, 1,054 suites / 10,503 tests
  passed; one suite could not archive historical commit
  `070d25cbe14796aebb8168ac5425c93e3506df1c` because this isolated clone lacked it.
  This was a fixture prerequisite failure, not a changed-code assertion. Build
  was not reached. Fetching that exact commit restored the fixture; its 31 tests
  then passed without modifying source or the harness.
- Clean final `npm run verify`: exit 0 on implementation commit
  `2167a9fcc1981fabb454f804eb874c1ed702dca9`. Fresh non-incremental app and Worker
  checks passed; 1,055 test files / 10,534 tests passed (12 files / 67 tests
  skipped, 1 todo); production build passed in 13.85 seconds. Source/test and
  lockfile hashes matched before and after the run. No source changes followed.
- Independent review found no blocking production issue. No browser UI or visual
  layout changed. Live browser/production behavior was not newly exercised.
- Verification environment: Node 24.19.0, TypeScript 5.9.3, Vitest 3.2.7,
  React 18.3.1, Vite 6.4.3, Wrangler 4.151.0; installed dependency inventory
  succeeded. `DEV_LAN_HOST=127.0.0.1` uses the existing Vite override for this
  environment. The final run disabled Wrangler telemetry/error reports/skills
  prompts and Cloudflare capability fetching with `DO_NOT_TRACK=1`,
  `WRANGLER_SEND_METRICS=false`, `WRANGLER_SEND_ERROR_REPORTS=false`,
  `WRANGLER_HIDE_BANNER=true`, `WRANGLER_NO_SKILLS_UPDATE_PROMPTS=true`, and
  `CLOUDFLARE_CF_FETCH_ENABLED=false`; logs used an explicit temporary local path.
  No dependency or lockfile change.
- Existing open PRs and remote branches were inspected; no competing projection
  extraction was found. Issue #437's read/write reconciliation guarantees remain intact;
  this refactor does not claim to close its broader remaining investigation.
