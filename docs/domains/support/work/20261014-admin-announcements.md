# In-app announcements

Status: local implementation verified; native CI and permission-gated rollout pending, 2026-10-14 UTC

- Owner: announcements implementation; branch `feat/admin-announcements`, base `90211bdcf39dd9bce66211df129949a5668a0de4`.
- Existing open/closed Issues and PRs searched for announcement / お知らせ titles; none represent this feature. Remote branches inspected after fetch; no overlapping announcement branch.
- Scope: lazy announcement list/detail/read status; administrator draft editing and explicit publication; bounded repository reads; existing enabled-admin authority. HomeTopbar wiring is supplied by the separate streak UI owner. App and PrimaryAppHeader are not owned here.
- Decision: separate administrator draft and published snapshot collections. This prevents draft edits leaking to readers, avoids a new status/order composite index, and preserves one published version until explicit republish. Single shared status documents and static build-time content were considered but do not give the same safe independent draft workflow.
- Read receipts are owner-only; bulk-read uses the newest observed published timestamp, without scanning all announcements. Publishing again creates a new unread version. No listeners, startup reads, push notifications, production content, or new administrator grants.
- Permission boundary: local Rules proposal and emulator tests are authorized. No merge, push upstream, Rules deployment or other production permission change is authorized in this task.
- Next: integrate the verified implementation once, execute native browser/combined Rules gates, and review the production Rules permission change.
- Definition of done: list matches supplied reference intent (category/date/title/unread/back/read-all), admin draft/publish works, access failures/stale writes/account changes are safe, focused and exact-content aggregate/native verification receipts are recorded; production rollout remains separately approval-gated.

## Verified implementation checkpoint — 2026-10-14 UTC

- Implemented: the home bell opens the reference-style category/date/title/unread list, plain-text detail, read-all and Back; `/admin/announcements` supports draft create/edit, explicit preview and publication. The existing enabled-admin guard is reused. Published content and draft content are separate, and individual/bulk receipts are owner-only.
- HomeTopbar's announcement-only patch was provided by its streak-UI owner and applied to this branch; the streak branch intentionally does not duplicate that patch. Neither App nor PrimaryAppHeader is changed here.
- Independent review found a delayed next-page result could undo an acknowledged read-all state in the UI. All receipt merges now preserve the maximum timestamp, including individual receipts. A regression reproduces the out-of-order completion and proves all displayed rows stay read. The correction was independently reread; no other blocker was found in the reviewed draft/public, history and owner-lifetime scope.
- Exact code/test/config diff from base `90211bdcf39dd9bce66211df129949a5668a0de4`: SHA-256 `97efe6d0e9a91b4b9ad223374a09b808eb6a88b34052008833a5b162717e0518` (computed with `git diff --cached -- src firestore.rules scripts tests | sha256sum`; documentation-only receipt changes are excluded). Staged tree before receipt-only updates: `2b9c2286bc81abce1ecbe152f2bdd9a1829112b7`.
- Final local `npm run verify`: exit 0; fresh non-incremental app and Worker checks, 890 test files passed / 11 skipped, 8,480 tests passed / 54 skipped / 1 todo, production build passed. Environment: Node 24.19.0, TypeScript 5.9.3, Vitest 3.2.7, Firebase 12.12.0, Wrangler 4.147.0, installed by this worktree's `npm ci`. Lock SHA-256 `af5b37bbcc990a528621a18f545142430f8b9506460dde03f3f9be80fbb4b9ab`; installed dependency-tree receipt SHA-256 `1ee6d6a6533398d7218ad3de0a2c34d4b62e519c5f4910ef853c4945d084382e`. Environment uses existing `DEV_LAN_HOST=127.0.0.1`, metrics disabled, and a writable isolated Wrangler config directory; no testing shim or dependency mutation.
- Focused component/service/domain/history/admin-route checks passed (32 before the two additional monotonic-merge regressions; those additional checks passed and are included in the 8,480 full-suite result).
- Complete demo auth/Firestore entrypoint: exit 0 with official firebase-tools 15.33.0 and Firestore emulator 1.22.0. It covered draft privacy, ordinary-user write denial, atomic publication, unchanged public content while editing, stale-revision rejection, bounded queries, owner-only receipts, future/backward watermark rejection, republish and unsigned denial, plus existing profile/schedule/class/inquiry/photo regressions. Rules SHA-256 `e1c9ea29eca117b761614a94ac518fa67c0dafbcfc4c491702e3b4ebb985f697`.
- Eight native browser regression cases were added to the existing admin job. Test discovery succeeded; native execution/rendered screenshots are still unverified locally because this environment's browser launch restriction was already confirmed. The shared 1.62.1 runner was used only for discovery; CI's pinned 1.64.0 runner must execute the cases. Component mocks are not native browser proof.
- Known limited recovery behavior: a reloaded/restored detail older than the first 25 rows shows an explicit return-to-list message. It does not fetch drafts, scan every page, or claim the missing detail was restored. Back remains available; reopen the older item after loading its page.
- No upstream push, pull request, merge, production Rules deployment, production announcement or new admin grant has been made. Keep this active branch until review/rollout; no branch deletion is due yet.
- Next: integrate once, run native CI plus combined Rules tests, and obtain the explicit Rules/publishing approval before deployment. Production delivery remains unverified.


## Existing bundle-budget gate

The final budget command exits 1 for six existing aggregate/largest-asset limits. This is not a passing quality gate. An archive of exact base `90211bdc` was built once using the same installed application dependencies, Node and build environment; its build passed, and its budget command failed the same six limits. No threshold or configuration was changed, and capacity optimization remains outside this feature.

- JavaScript total: base 2,429,076 raw / 657,904 gzip bytes; feature 2,446,865 / 664,752; increase 17,789 / 6,848.
- JavaScript largest chunk: base 883,697 / 252,113; feature 885,245 / 252,691; increase 1,548 / 578. Most feature code is demand-loaded.
- CSS total: base 505,635 / 86,091; feature 508,261 / 87,045; increase 2,626 / 954.
- Largest CSS chunk is unchanged: 433,224 raw / 70,723 gzip bytes.

The baseline archive did not create another Git branch or change either dependency manifest. Exact result receipts are retained with the local feature artifacts; the existing capacity issue remains separate from this announcement implementation.


## Browser-suite routing follow-up

After commit `39bff1fe`, independent CI-selection review found the dedicated announcement harness cases were also selected by the ordinary app's Browser Regression configuration. The ordinary configuration now excludes `announcements.spec.mjs`, matching the existing inquiry harness boundary. The dedicated Admin Overview Render job remains its only owner. Discovery confirms zero announcement cases in the normal suite and all eight in the admin suite. This is a test-routing configuration correction, not a native test pass. The 8,480-test full receipt above precedes this one-line routing follow-up; final combined-content verification is owned by the integration task.

## Native publication follow-up — 2026-10-14 UTC

Publication and subsequent verified main/Rules rollout were explicitly approved on 2026-10-14, superseding the earlier pending-authorization checkpoint above. PR #646 was opened with remote head `90865039cd0540f5bc72233b7bc868993b00da30`; its tree `e75db3f40b60b3de8749ef052714c33b775d08bb` exactly matches local `0c7cb46b`. Connector-created commit metadata differs, but ordered parent topology and root tree were verified after fetch.

- Native Admin run `38549979439`, job `115805294923`, executed all 65 cases: 61 passed and four list/detail viewport cases failed. At both 375/1440px and light/dark, the dialog was exactly 15px narrower than the viewport. The existing document-level `scrollbar-gutter: stable` reserved space under the 100%-width full-screen dialog. This is a genuine layout failure, not a capacity-budget failure or an accepted screenshot change.
- The correction is scoped to `html`/`body` only while `.announcements-page[open]` exists: release the reserved gutter and lock background scrolling, leaving the dialog itself as the vertical scroll owner. Closing/unmounting automatically restores the original root styles. Existing width/no-horizontal-overflow assertions are unchanged; native tests now also check the root scroll lock and restoration.
- Focused component/navigation/admin/CSS-contract validation passed 15 tests. Discovery still selects eight announcement cases in the dedicated Admin suite. No local native launch was repeated; corrected rendering and all eight complete flows remain pending exact-head GitHub CI.
- The published head's core CI `38549979625` passed, including private drafts, atomic publication, bounded reads, owner-only receipts and existing Rules regressions. The layout follow-up changes no Rules, services or permissions.
- A local verification attempt discovered a preserved historical Worker copy under ignored `artifacts/announcements/j1-old-worker`, outside Vitest's generated-cache exclusion. All 15 failed files belonged to that extra copy; no product file failed. The copy was moved intact outside this worktree, the failed receipt retained, and a clean-discovery full verification was required. No test exclusion or threshold was changed.
- Clean-discovery `npm run verify` passed: 891 files / 8,482 tests, 11 skipped files / 54 skipped tests / 1 todo, fresh non-incremental app/Worker checks and production build (5.82s), exit 0. The feature code/test tree was `18b250a274d7016586024a20790474d2dc07ccc4` before this receipt-only documentation. Follow-up diff SHA-256 from local `0c7cb46b` over source/tests/config is `1561951f9254d227f45065ca6974703ff557f0441b733a221144b4e9e24ba1f9`. Installed dependency identity remains `1ee6d6a6533398d7218ad3de0a2c34d4b62e519c5f4910ef853c4945d084382e`, with unchanged lock `af5b37bbcc990a528621a18f545142430f8b9506460dde03f3f9be80fbb4b9ab` and Node 24.19.0. This does not replace pending native rerun evidence.
