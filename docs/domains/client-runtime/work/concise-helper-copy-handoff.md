# Concise UI helper copy

Status: active, consolidated local candidate
Owner: Issue #483 (https://github.com/kame447/StudyPlanner/issues/483)
Updated: 2026-10-13

## Ownership and source

- Review candidate branch: `ui/concise-helper-copy`, initial base/HEAD `819d5bac3791b0d0aac2a6b1fd977fe73256edf6`.
- The root requested one review unit for two local helper-copy changes. The original branches/worktrees and commits are preserved: bookshelf `fe3acfefaec3cd9f5db6d305243b3fa2650d99ba`, manual entry `c52b106f063432e457fb490aa5826903e6df9f73`.
- Current main, open PR list, Issue #483's latest comments, and original source diffs were rechecked. No new Issue or remote PR is created. Historical PR #529 is merged; this candidate covers the remaining copy only. All unrelated UI/AI/metadata/observability/Todo/theme work remains excluded.
- The new branch is the consolidated review candidate, not a second publishing path. Retain originals until the integration owner accepts it; no branch deletion is part of this step.

## Exact scope

- Bookshelf display: remove the statement that registered structure can be hidden; retain that registered items remain while hidden.
- Book cover: replace the descriptive upload sentence with the supported JPEG / PNG / WebP formats. Retain search/manual-entry guidance and the exact file accept list.
- Manual plan editor: remove the sentence describing the form as minimal. Retain repeat-edit scope/limitations and validation errors.
- Stopwatch/timer: remove only their basic measuring/countdown descriptions. Retain both explanations of how applying a measurement fills record times.
- No changes to behavior, accessible labels, handlers, state, CSS, permission, persistence, errors or test infrastructure. Existing bookshelf assertions are additive and retained.

## Verification checkpoint

The local candidate is ready for integration review. Earlier 70/66 focused results remain historical; the result below is a fresh combined-content run.

- Both source patches applied cleanly to the exact base. The 5 changed source/test files match their original commits byte-for-byte. An independent base-to-candidate whitelist check proves that the production delta is exactly five allowed text transformations across four components; all other production bytes remain unchanged. The fifth file adds three bookshelf assertions without removing or weakening any assertion.
- `npm run verify` ran once and returned exit 0: fresh non-incremental app and Worker typechecks, 812 files passed / 10 skipped, **7,223 tests passed / 45 skipped / 1 todo**, and production build 5.04 seconds. Skipped/todo are not counted as successes.
- Command-only environment: `DEV_LAN_HOST=127.0.0.1`, `CLOUDFLARE_CF_FETCH_ENABLED=false`, `WRANGLER_HIDE_BANNER=true`, `npm_config_update_notifier=false`, `npm_config_offline=true`, `VITEST_MAX_FORKS=2`, `VITEST_MIN_FORKS=1`, `VITEST_MAX_THREADS=2`, `VITEST_MIN_THREADS=1`. Existing offline/type-generation options were read from the tooling runbook; no runner, timeout, assertion, dependency or production setting was changed.
- Before/after identity: all 2,367 source input hashes identical; 235 installed locked package versions match the lockfile and all installed package.json hashes remain unchanged. Shared node_modules was not modified. Source manifests and installation manifests are retained with the complete log.
- Tools: Node 24.19.0 / npm 11.9.0 / TypeScript 5.9.3 / Vitest 3.2.7 / Vite 6.4.3 / React and react-test-renderer 18.3.1 / Wrangler 4.147.0.
- The Worker runtime types were newly generated and typechecked, SHA-256 `c96c8ed5d4ba9748b9b191362998ccf92a7a7ae97a7f8c4a7bce008b1fedef79`.
- The log includes a nonfatal Wrangler diagnostic-log directory error (`/home/agent/.config/.wrangler`, ENOENT). Runtime type generation itself completed, wrote the file above and returned success, followed by successful Worker tsc and tests. The full captured aggregate log is retained; the separate Wrangler debug log is not claimed as available. Vite's existing large-chunk warning also remains; no budget threshold was changed.
- `git diff --check` passed. Built JS assets contain all five intended retained guidance statements and none of the five removed/replaced sentences. This confirms compiled copy, not browser appearance.
- Combined source diff SHA-256: `a5ed97d9d862824222c8c0085d845ae3db783f8d6388d11ef2ed4207f2c8a4ae`.
- Complete aggregate log SHA-256: `e1c539ec6d64f1950a8d148384904404c0f1b5693b094a5518f75afd5b63c70a`.
- After verification, only this checkpoint was updated. Production, tests, configuration, dependencies and generated inputs remain the verified snapshot.

The original two worktrees remain clean at their original commits. Next: the root reviews this single candidate and obtains any publication/acceptance authorization needed.

Browser/visual, remote CI, push, PR, main merge and deployment remain outside this local acceptance. Completion for this worker is a clean, locally verified consolidated candidate with any unrun checks explicitly reported.
