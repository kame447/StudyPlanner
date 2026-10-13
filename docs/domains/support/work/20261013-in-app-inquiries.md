# In-app inquiries

Status: local implementation verified; release gates pending
Branch: `feat/in-app-inquiries`
Initial base: `e44f4b4154608a4ebd41399b8f41d6f6dce7431c`
Reconciled base: `05c78b6fa0d708c39e7ca5ceb1703ca80f7509a9` (four unrelated AI approval files preserved unchanged)
Remote Issue/PR: none; title, collection-name, contact/in-app scope and branch checks found no existing owner. No remote writes or deployment were performed.

## Scope and decision

The authenticated `/contact` form now creates an email-free inquiry, and the read-only `/admin/inquiries` inbox shows bounded pages. Existing account sign-in is unchanged. The canonical contract and exact lifetime/cost/security limits are in [the domain README](../README.md).

Compared alternatives: a new Worker API adds another authenticated write boundary and service-account path; putting inquiries into telemetry confuses privacy/retention and content ownership; a dedicated Firestore collection with narrow Rules and a typed service is the smallest isolated path. The implementation chooses that collection and a transactionally linked per-owner cooldown record. Admin replies, status management, attachments, notifications, automatic deletion and production test submissions remain out of scope.

## Completed local checks

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

## Remaining release gates and next action

1. Obtain publication permission; keep this branch local until then. Reconcile any newer main before integration.
2. Run actual Firestore Rules emulator regression through the existing CI entrypoint. It includes first-write missing documents, forged owners/timestamps/extra fields, non-admin and cross-user denial, immutable receipt retry, atomic cooldown bypass denial and same/distinct concurrent requests. Local emulator tooling is absent, so these semantics are still runtime-unverified.
3. Run the existing Admin Overview Render suite, including desktop/mobile light/dark contact/inbox, unknown-response retry, real sidebar routing and access revocation. Local browsers are blocked; no browser pass or visual approval is claimed.
4. Resolve or explicitly accept the existing aggregate JavaScript budget issue under the repository's separate process. Do not raise thresholds as part of this inquiry feature.
5. Only after authorized review/merge, deploy and read back the Firestore Rules using the existing WIF workflow before exposing the new form. No new secret, Worker deployment, custom index or migration is required. No live test inquiry has been created.

Completion means the required Rules/browser/budget/review/deployment gates are satisfied on the authorized final integration. The local green checks alone do not establish production delivery.
