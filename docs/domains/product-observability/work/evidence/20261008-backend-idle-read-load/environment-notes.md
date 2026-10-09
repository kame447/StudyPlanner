# Shared executor and verification limits

The final run uses one Vitest worker, a fresh environment without credentials, an isolated HOME/npm cache, disabled telemetry, and offline package resolution. Type generation, TypeScript state and build output are local to the independent backend worktree. No dependency installation or package-source mutation was performed. The manifest records 336 lock entries: 237 present packages, 99 platform-optional absent packages, no required missing package and no version mismatch.

The inherited Vite configuration does use a shared result-order cache beneath the existing `node_modules/.vite/vitest/` installation. This is an explicit exception to otherwise per-worktree generated output. The integration owner accepted keeping the in-progress run unchanged after inspection; the cache was not presented as isolated.

Installed Vitest 3.2.7 was inspected directly:

- `dist/chunks/cli-api.DVe0nWUx.js` ResultsCache (around lines 5307–5377) persists only per-file `duration` and `failed`; runFiles (around lines 9630–9660) executes `pool.runTests`, then updates/writes this cache.
- `dist/chunks/coverage.DfSpMS-b.js` BaseSequencer.sort (around lines 3470–3498) uses it to order unknown/failed/slow tests first, without removing tests or substituting previous pass results.
- `vitest --help --cache` and `dist/chunks/cac*.js` show supported boolean `--no-cache`; `--cache.dir` explicitly throws as deprecated. For a future standalone focused/test-stage run, `--no-cache` avoids this result-cache read/write without changing source. Appending it to `npm run verify` is not equivalent because that script ends in the build command.

Other verification work was running on the same executor. Separate, unrelated full runs observed timeout failures and were stopped by their owner. This backend run is judged solely by its own terminal log and input/package comparison; no success is inferred from another run. Cache metadata and shared load can change ordering/timing, but neither permits skipped, timed-out or stale tests to be reported as passed.
