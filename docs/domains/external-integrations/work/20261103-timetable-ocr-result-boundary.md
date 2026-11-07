# 時間割OCRの結果整形と通信の分離

Status: active, locally verified candidate; publication/integration not performed
Owner: external integrations [#187](https://github.com/kame447/StudyPlanner/issues/187)
Branch: `refactor/timetable-ocr-result-boundary`
Base: `a4c441baace2e96cec7eded05a6e29120257955c`
PR: none; no publication or integration with other candidates is requested.

## Scope and boundary

`src/lib/timetableOcrImport.ts` combines pure candidate normalization/editing rules with image payload preparation, Firebase authentication and HTTP transport. Keep every existing export/import path compatible. Extract only the candidate types, normalization and title helpers to a pure domain module, and let the editing dialog use that module. Leave endpoint, authentication, quota/error messages, image conversion, saving and mock-result export unchanged. Do not tighten existing weekday, period or time acceptance.

Compared alternatives: retaining the combined module preserves behavior but leaves editing coupled to transport; extracting the pure candidate boundary removes that dependency and enables tests without Firebase; a generic provider/service abstraction adds indirection without a second implementation, so it is excluded.

Before implementation, current Issue #187 and comments, OCR pull requests and local/remote OCR branches were rechecked. No active implementation owns this extraction; earlier #362/#699/#711 have different completed scopes. The existing external-integrations owner is reused without a new Issue or PR.

## Verification plan and checkpoint

1. Add characterization tests against the original public module and run normalization, HTTP/error boundary and editing/save-lifetime suites before moving code.
2. Extract unchanged pure logic; retain public re-exports and test compatibility, with a direct domain import that cannot initialize transport dependencies.
3. Run the same tests and fresh app/Worker type checks, production build and exact diff review. No lint script is configured.
4. Report the isolated local candidate, exact tested snapshot, passing/failed/unrun checks and remaining publication gates. Do not merge other candidates or publish.

Current checkpoint: local extraction and scoped verification are complete. The candidate remains isolated from the other refactoring branches. Next, if publication is requested, review this branch and run full verification and applicable CI against the resulting publication content.

### Characterization checkpoint

- Original production source remains byte-identical to base (SHA-256 `d96b0bb86b09d5aa0e3d47a8599bd8ecb1c4c378259743ca91c69925959edadf`).
- `DEV_LAN_HOST=127.0.0.1 npm run test:run -- --no-file-parallelism src/lib/timetableOcrImport.test.ts src/lib/timetableOcrImport.request.test.ts src/services/userFacingExternalBoundaries.test.ts src/components/TimetableOcrImportDialog.saveLifetime.test.tsx src/hooks/usePlannerDataState.timetableOcrSaveLifetime.test.tsx`: exit 0, 5 files / 75 tests. The added tests fix normalization, title rules, all six function exports, original type imports, successful authenticated transport and missing-auth/config behavior.
- The first test startup failed at sandbox LAN-interface discovery before running tests. The existing command-scoped `DEV_LAN_HOST` override resolved it without code/config edits.
- Initial fresh app typecheck was killed (exit 137); a memory-bounded attempt was intentionally interrupted (130) when concurrent integration verification was reported. Neither is success. Heavy type/build verification waits for that independent run to finish.
- Logs are local under `/tmp/studyplanner-ocr-before*.log`; no external APIs or real user data were used.


### Local result — 2026-11-03

- Test-first commit: `f71dc539074141aa09047ab1018071088bbadff2`, source tree `88041c72c8b5845f06c33c3ca61d85c048e129bb`.
- Extraction commit: `442a7a106b332fe9fa97cd8e2a3f46b38f81d8e3`. Final tested source tree, including removal of one terminal blank line: `84b72a2953d9924f540bc853ea736c815a07f664`.
- `src/domain/timetableOcrResult.ts` owns the existing candidate types, normalization and two title helpers. It has only a type import from the shared domain types. Characterization tests import it directly and reject any attempted Firebase, proxy-config or image-transport initialization.
- `src/lib/timetableOcrImport.ts` retains all six function exports and four public type imports through the original path. Image payload preparation, endpoint building, token acquisition, HTTP/JSON handling, quota/failure guidance and the mock-result export are unchanged.
- The editing dialog changes only its import path. Pure types/rules were compared byte-for-byte with base (apart from terminal blank-line normalization); the entire endpoint/transport/mock implementation remains byte-identical.

Verification, all exit 0:

- Before extraction: 5 files / 75 tests, plus fresh app and Worker type checks at the test-first commit. The owning worktree was temporarily detached at that commit for the type check, then returned to the extraction branch.
- After extraction: the same 5 files / 75 tests passed. After final whitespace cleanup, widened verification passed 7 files / 101 tests, adding Firebase timetable ownership and TimetableView editor-lifetime coverage.
- Final `npm run typecheck:full`: fresh non-incremental app and Worker checks, including normal runtime-type generation. Command environment: `NODE_OPTIONS=--max-old-space-size=1536 WRANGLER_HIDE_BANNER=true WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/studyplanner-ocr-after-wrangler.log npm_config_update_notifier=false`. The earlier post-extraction check also passed; final source whitespace cleanup was followed by this fresh run.
- `DEV_LAN_HOST=127.0.0.1 NODE_OPTIONS=--max-old-space-size=1536 npm_config_update_notifier=false npm run build`: production build succeeded (19.09s). Vite's large-chunk warning was reported; the independent `node scripts/ci/check-bundle-budget.mjs` gate passed unchanged limits.
- Exact diff/whitespace checks passed. No lint script is configured.

Environment and input identity:

- Node 24.22.1, TypeScript 5.9.3, Vitest 5.0.5, Vite 6.4.4, Wrangler 4.151.0. Existing shared installed dependencies were used, with no install/update.
- Installed package name/version/manifest inventory was byte-identical before/after verification: SHA-256 `51f6f72a85686bb09fbd51dfddbb98571aeaf4d9aa87d20b908480a1a1c54ab5`; installed `.package-lock.json` SHA-256 `c908e6dee185d9e60f99675e9b9f44657be21ebe2142a7025fd117b651e1d049`.
- Worker config SHA-256 `0b7bab6933e962286e5ce21f10d8d2400fb320fddf1141df8146d682dab986c8`; generated runtime types SHA-256 `5ff046b2157430d5bf7583382b49e71dde28bc0a4d3ce482daecfda686ee5514`.
- Remote main was rechecked and remains base `a4c441baace2e96cec7eded05a6e29120257955c`.

Limits and next step: this is a local, isolated candidate, not a full integration pass or a published change. Full test suite/`npm run verify`, browser/visual tests, CI and live OCR were not run for this candidate. No Issue/PR was created, no branch was pushed/deleted, and no other candidate was merged. Keep the branch/worktree while a publication or integration decision is pending.
