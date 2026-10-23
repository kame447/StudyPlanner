# Month-event save range validation

Status: active local investigation; no published Issue or PR
Branch: `fix/month-event-save-range`
Base/initial HEAD: `1b828e77254351c2c799ff6e0b605e9fc25daacf`

## Scope and ownership

The existing month-event editor permits a later end date with an earlier or equal
clock time. Its persistence hook still rejects every non-positive same-day clock
difference before considering dates. Investigate that specific mismatch through
the real hook and canonical local ScheduleEvent repository. Do not change Actual
editors (PR #650), persistence schemas, Firestore/cache, AI or other writers.

Current open/closed Issues and PRs, all 134 remote branch names, and the latest
#437 comments were inspected before implementation. #437 owns save/read ordering;
this range-validation defect is a distinct candidate requiring an independent
Issue if reproduced. PR #191 already established multi-day editing and is closed.
No active branch or PR represents this exact save-validation scope.

## Evidence plan

1. Prove valid multi-day drafts are rejected by the unchanged hook while its
   editor validator accepts them; use real canonical persistence and reload.
2. Distinguish hook rejection from repository loss or UI date normalization.
3. If reproduced, reuse the existing range validator at the hook boundary rather
   than introduce a separate duration policy. Keep same-day/invalid-range guards.
4. Run focused UI/hook/persistence regressions and types, review the exact diff,
   then coordinate full verification with the integration owner.

No live data or provider calls. Native browser execution is not yet verified;
known local Chromium startup socket EPERM will not be retried. Upstream push,
PR publication and merge remain outside this local task until approval.

## Reproduction and minimal correction

Unchanged production main failed five of seven real-hook/canonical-repository
cases: next-day earlier end time, next-day equal time, a three-day range and an
existing edit were rejected; an end date before the start date was persisted.
The two same-day invalid-time controls passed. Baseline raw output is retained at
`/workspace/shared/month-event-range-baseline.log` in the local work environment.

The correction imports and uses the existing editor validator in `saveMonthEvent`
with a trimmed title for validation only. Stored metadata, repository authority,
IDs, selection, optimistic settlement and retry behavior are unchanged. The
production delta is five additions and eight deletions in one file. Keeping the
old clock-only check demonstrably fails; duplicating the date condition creates
another divergent policy; changing repository time semantics is unnecessary.

Focused feedback first passed 112 tests in six files. Expanded controls include
same-day positive/24:00, missing endDate compatibility, next-date midnight, blank
and whitespace titles, and real editor input → hook → canonical save → reload.
An initial optional-endDate assertion expected undefined, but the unchanged
canonical projection normalizes it to the start date; the test now asserts that
existing documented compatibility contract without changing production code.

Two native browser cases at 390px and 1280px cover create, edit to next-day equal
clock, canonical identity/data, reload and rendered range. Syntax and Playwright
discovery pass; browser execution remains unverified in this environment. These
cases will run in the existing Chromium Browser Regression suite on publication.
No cross-browser job list, timeouts, assertions or bundle budgets are changed.

The parent accepted this local correction and requested publication remain paused.
A new Issue is not yet created; Issue #437 is not used to misclassify this distinct
validation defect as another completed read/write-order fix.

## Final local verification — 2026-10-14

Verified source HEAD `a6fc1886ff7db2958904e93d5d80918c6dce38e5`, tree
`5798fae45bf4a84a7d6bcfa7bc6ae1035f9c9888`, based on current main
`1b828e77254351c2c799ff6e0b605e9fc25daacf`. Independent parent review found no
blocking issue in the production change, trimmed-title validation, persistence
rejection, identity preservation or reload assertions.

- Focused: 119 passed tests across six files, including the 14 new range/editor
  cases. Native syntax and discovery selected the two new 390px/1280px cases;
  discovery is not browser execution evidence.
- Final `npm run verify`: exit 0, fresh non-incremental app/Worker typechecks,
  8,663 passed tests / 914 passed files, production build 5.46 seconds.
  54 skipped tests / 11 skipped files and one todo remain separate.
- Command environment: `CLOUDFLARE_CF_FETCH_ENABLED=false`,
  `WRANGLER_SEND_METRICS=false`, `DO_NOT_TRACK=1`, `DEV_LAN_HOST=127.0.0.1`,
  `VITEST_MAX_FORKS=2`, `VITEST_MIN_FORKS=2`. Node 24.19.0, npm 11.9.0,
  Vitest 3.2.7, Wrangler 4.147.0, Miniflare 5.20261001.0-alpha and
  workerd 1.20261001.1 were used. No runner, assertion, timeout or budget changed.
- An earlier full attempt was interrupted by rejection of Miniflare's fixed
  `https://workers.cloudflare.com/cf.json` metadata request. It remains incomplete
  evidence. Read-only inspection of the installed source confirmed the existing
  runbook's command-local false option returns bundled `fallbackCf` without that
  request. The authorized safer run regenerated Worker runtime declarations and
  ran all checks. It does not prove real request geography. Generated declarations
  match the prior generated bytes (SHA-256 `c96c8ed5d4ba9748b9b191362998ccf92a7a7ae97a7f8c4a7bce008b1fedef79`).
- All 2,640 tracked source inputs and 19,490 installed immutable dependency files
  matched before/after. Two test-generated dependency-cache files changed only
  their random segment path and have identical bytes. The existing compatibility
  test produced 217 source files matching immutable revision `070d25cb`, plus its
  bundle; all 218 generated files were preserved outside the worktree. They are
  outputs, not new test inputs. This final checkpoint addition is documentation only.
- Separate bundle gate: seven existing main violations remain. With the same
  dependencies, base/candidate total JavaScript raw is 2,485,381/2,485,082 bytes,
  gzip 677,846/677,754; largest gzip 260,394/260,313 (limit 260,000). CSS is
  byte-identical. This candidate reduces JavaScript raw by 299 and gzip by 92
  bytes; it does not introduce the seventh violation or claim budget success.

Raw focused, baseline, both full-attempt logs, generated-input evidence and
before/after identity receipts are preserved in the local verification packet.
The normal Wrangler log-directory warning is nonfatal; final command exit and
all full-check summaries establish completion of the local verification.

## Remaining adoption gates

No new Issue, remote branch, PR, push or merge was created. No branch was deleted.
The local implementation is ready for the coordinator's publication decision;
independent native browser execution and published-head CI remain unverified.
Current upstream Actual validation PR #650, its cancelled ref update, production
Firestore/data, Jev and other owners remain untouched. Use one new bounded Issue
for this specific range-validator mismatch if publication is approved; do not
close #437 or reopen the completed UI-only PR #191 to represent this defect.
