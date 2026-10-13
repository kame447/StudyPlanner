# In-app inquiries

Status: PR published; narrow CI repair locally verified and awaiting publication
Branch: `feat/in-app-inquiries`
Initial base: `e44f4b4154608a4ebd41399b8f41d6f6dce7431c`
Reconciled base: `05c78b6fa0d708c39e7ca5ceb1703ca80f7509a9` (four unrelated AI approval files preserved unchanged)
Remote PR: [#612](https://github.com/kame447/StudyPlanner/pull/612), draft. Published HEAD `979db97f05c5e94201bed5672564e20b34d0ee32` has the identical tree (`32122f01c08ae7db1b7d2c15b50f7178dd034c90`) as local `d452c20f9d1155a76a2c7ccdf8b8cbf0561f193e`. Publication and browser CI were authorized; merge/deployment remain outside that approval. No production submission was made. No prior owning Issue/PR was found before creating this feature.

## Scope and decision

The authenticated `/contact` form now creates an email-free inquiry, and the read-only `/admin/inquiries` inbox shows bounded pages. Existing account sign-in is unchanged. The canonical contract and exact lifetime/cost/security limits are in [the domain README](../README.md).

Compared alternatives: a new Worker API adds another authenticated write boundary and service-account path; putting inquiries into telemetry confuses privacy/retention and content ownership; a dedicated Firestore collection with narrow Rules and a typed service is the smallest isolated path. The implementation chooses that collection and a transactionally linked per-owner cooldown record. Admin replies, status management, attachments, notifications, automatic deletion and production test submissions remain out of scope.

## Initial implementation milestone (before CI repair)

Final frozen runtime/test/config snapshot based on `05c78b6fa0d708c39e7ca5ceb1703ca80f7509a9`:

- Focused form/service/admin-shell/route tests: 5 files, 36 passed.
- `npm run verify`: exit 0. Fresh application and Worker typechecks, 832 test files passed / 11 skipped; 7,666 tests passed / 54 skipped / 1 todo; production build succeeded. The skipped external/emulator checks are not treated as passed.
- Explicit-entry Vite build of the updated browser harness succeeded. Its inquiry fixture mounts the production AdminApp, uses isolated auth/admin/service boundaries, and includes real sidebar navigation plus live access revocation. This is build evidence, not executed browser evidence.
- `git diff --check` succeeded. Independent source review found no demonstrated Rules/production defect; its earlier browser-harness bypass finding was corrected before the final full run.
- Every tracked/untracked source/config file, all 19,305 installed dependency files, generated Worker types, tools and relevant environment values matched before/after verification. Node was v24.19.0; repository CI uses its own `.node-version`.
- Build guard thresholds were unchanged. All CSS guards pass. Compared with the exact `05c78b6` CI artifact, this feature adds 10,508 raw / 2,880 gzip JS and 192 raw / 42 gzip CSS; largest CSS is unchanged. The two aggregate JS budget violations already exist on the baseline and remain violations; feature growth is not hidden or counted as a pass. Comparison uses the exact-head CI artifact, not a new same-environment local baseline build.

Local evidence is in the sibling `in-app-inquiries-evidence-20261013/` directory: `verify.log`, `identity-before.json`, `identity-after.json`, `identity-comparison.json`, `budget-final.json`, `budget-comparison.json`, and `harness-final-build.log`. Runtime/test/config inputs were not changed after the final full run; only this documentation checkpoint was finalized.

- Verification log SHA-256: `6b4085f752f7573bfead7e03931aa421553fd36fc1d78e51ee7d4fb52c033e9e`
- Sorted full source-file manifest SHA-256: `618e369628285b8f20954b0d82ef5905bf9df230ea24943992beb6aaecb23523`
- Before-run identity receipt SHA-256: `6811e1d208c45b6df48d777b0672f3e00ce076442222ca96441898fa097dca61`
- Installed-files manifest SHA-256: `3b9fceeeda854dc9c1e7c383f2c7b894071f6a67f4b26284027612adbfe057b2`

## CI findings and narrow repair

The initial PR CI found two product defects and one test-suite boundary defect. Real Firestore emulator evidence showed that a fresh single transaction succeeds, while simultaneous same-ID callers can produce one permission denial before the SDK retries its stale transaction, despite one matching immutable receipt already existing. The service now reconciles a failed transaction only through an authenticated server read of that exact receipt with exact schema/owner/body/timestamp validation. Missing/mismatched/unreadable receipt and auth changes remain failures. Rules are unchanged; no update permission was relaxed.

The browser run passed 51 tests, including actual AdminApp sidebar routing and access revocation, but the unknown-response retry test could no longer find the exact textarea label after typing. The label wrapped the controlled textarea, whose DOM text joined the label text during React rendering. The label is now a separate associated element. The exact-label assertion remains, with additional accessible-name and retained-value checks.

The complete existing demo auth/Firestore entrypoint passed locally after the reconciliation repair, using isolated official firebase-tools 15.33.0 and Firestore emulator 1.22.0. It verifies fresh single submission, both same-ID callers succeeding, immutable retry, exactly one distinct concurrent submission, owner isolation, and enabled/disabled admin access. The Rules harness mirrors the client algorithm; direct production service unit tests separately verify reconciliation failures and auth changes. This is not a claim that the emulator imports the production TypeScript service.

Repair evidence is persisted in `inquiries-pr612-ci/`: `rules-diagnostic.log` (first-write/race diagnosis with receipt/gate readback), `rules-repair.log` (full emulator exit 0), and focused service/form tests. Independent source review found no blocking defect in the repair. The frozen repair passed `npm run verify`: exit 0, fresh application/Worker typechecks, 832 test files passed / 11 skipped; 7,675 tests passed / 54 skipped / 1 todo; production build succeeded. Focused form/service/inbox tests passed 33/33. `repair-verification/identity-comparison.json` confirms every source/config input, all 19,305 installed files, generated Worker types, tool identity and relevant environment were identical before/after. Verify log SHA-256: `8c261698620082a489b06dd8ae9329cdceace888ed9f4e869d2e9e1eda769713`. Only this documentation checkpoint was updated after verification. The repair adds 234 raw / 84 gzip JS and no CSS compared with the initial inquiry snapshot; all CSS/per-chunk guards pass, while the pre-existing two aggregate JS guards still fail unchanged. The feature total vs exact main05 CI artifact is +10,742 raw / +2,964 gzip JS and +192 raw / +42 gzip CSS.

The generic Browser Regression failure artifact also confirms the production app splash was displayed at the fixture URL. This is a server/config boundary defect, not permission to skip inquiry behavior. Test collection is checked independently for both configurations and the dedicated suite remains mandatory.

## Remaining release gates and next action

1. Update the same PR with this locally verified repair and verify its exact remote tree. Parent owns publication.
2. Follow the updated exact-head CI to terminal results, especially the real Rules emulator and Admin Overview Render retry/accessibility test. Initial UI Regression Matrix passed. Initial Browser Regression passed all 577 production-preview tests but also mistakenly collected seven inquiry tests requiring the dedicated admin fixture server. Those seven failed against the wrong server; the generic config now excludes only this exact spec, while Admin Overview Render retains all seven cases (52 total). The final shared-config snapshot passed a fresh `npm run verify` (exit 0): 832 test files passed / 11 skipped; 7,675 tests passed / 54 skipped / 1 todo; fresh app/Worker typechecks and production build succeeded. `final-verification/identity-comparison.json` shows no input/tool/dependency/environment changes during the run. Final log SHA-256: `1b18eea86fc72571d2d12b76712dc8c49f3a2c23703b499854c69261328a8bd1`. Only this checkpoint prose changed afterward. Test collection was checked with CI-matching Playwright 1.64.0; this listing did not launch a browser. Local browsers remain blocked, so the label repair is not yet browser-verified.
3. Resolve or explicitly accept the existing aggregate JavaScript budget issue under the repository's separate process. Do not raise thresholds as part of this inquiry feature. Initial aggregate CSS checks passed.
4. Only after authorized review/merge, deploy and read back the Firestore Rules using the existing WIF workflow before exposing the new form. No new secret, Worker deployment, custom index or migration is required. No live test inquiry has been created.

Completion means the required Rules/browser/budget/review/deployment gates are satisfied on the authorized final integration. Local green checks alone do not establish production delivery.
