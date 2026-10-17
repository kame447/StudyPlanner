# Optional delivery acceptance: native CI correction

Status: local acceptance corrections and scoped announcement focus repair for PR #729; native rerun pending.
Base: `50908b6030a187b7ae1a63f33c268f4ee8e899bd`, matching the published PR content at `22db200e8290f5ba51fd4170a20e4b5728fbe400`.
Scope: existing Admin, Announcements and Day/Timetable/Report delivery acceptance. The only runtime change reuses the existing dialog-focus hook in the announcement failure dialog. No new framework, timeout increase or case deletion.

## Native evidence and classification

The first Chromium and Firefox runs each failed the same eleven delivery cases. WebKit reached later focus and Admin recovery assertions, exposing additional behavior rather than the same failure points. Two separate settings layout failures are tracked by their owner.

Three initial hypotheses were compared: production recovery/retry defect, incorrect fixture/asset/transport assertion, or transient runner failure. Deterministic failures on both engines, actual snapshots, emitted production assets, and native network/action traces support the second explanation:

- Day/Report: the fixture stored no plans, actuals, todos or materials. Home correctly rendered GettingStarted instead of the populated dashboard containing those buttons. Native screenshots show the setup screen and no failed view request. Seed one current-owner plan on the fixed date and require the populated dashboard before testing its real entrypoints.
- Announcements CSS: the emitted asset is `announcements-<hash>.css`, while the test intercepted `AnnouncementsPage-<hash>.css`. The trace shows the real stylesheet returning 200. Match the actual stylesheet and retain the required error dialog, focus, geometry, Back/Forward, same-document and data assertions.
- Initial JS requests: Vite appends a modulepreload link and then performs the foreground dynamic import. An immediately failed preload can therefore produce two transport attempts for one lazy evaluation. The Timetable trace records the two failures before the first Home click, and zero requests on its second entry. Assert one unique failed asset, one or at most two initial JS transports (CSS exactly one), then require the exact count to remain unchanged on cached reentry. Pending-request cases retain their exact one-request assertion.
- Admin reload: the trace shows a second document and successful signed-out guarded entry after the explicit reload button. Playwright's installed fixed clock replaces Performance entries with empty arrays, so indexing the navigation entry threw. Require two observed document requests, a per-document initialization counter of two, the disappearance of an old-document-only marker, the exact Admin URL and the real guarded entry instead.

What would disconfirm this classification: a request after cached reentry, a missing/escaped local failure dialog after the correct asset is blocked, new document loads without the explicit Admin reload, changed saved data, or an unavailable genuine populated-dashboard entry. These remain failures, not tolerated conditions.

WebKit-specific follow-through:

- Its native failure dialog lost in-document focus after Tab. Reuse the existing `useDialogFocus` helper rather than adding a second focus implementation. A new actual-root forward/reverse-Tab regression fails before the two-line wiring change and passes after it. Native assertions retain Tab containment and add reverse-Tab focus. Existing Escape/history and owner retirement are unchanged.
- After an inspector-aborted Admin JS import, WebKit loaded a new document but rejected the same module without making a new JS request. The trace therefore does not support a claim that reload clears this inspector-injected failure. Exercise temporary server delivery failure with an actual HTTP 503/no-store response instead, and require a fresh successful asset response after the explicit reload plus the existing signed-out guard. Inspector-abort recovery remains a documented limitation; this fixture does not establish every browser/network recovery mode. No production cache-busting or automatic retry is introduced.

## Verification and exit criteria

- Actual native Chromium traces/screenshots and matching Firefox failure logs inspected; production asset names and installed Playwright clock source checked.
- Exact browser seed function executed against isolated in-memory storage: one current-owner plan with the fixed date, unchanged empty actuals.
- Three spec syntax checks and diff whitespace check pass.
- Actual-root focus regression: 1 red before repair, then 5 related files / 18 tests pass including failure lifecycle, pending dismissal, navigation, style and existing focus-hook boundaries. Fresh app typecheck is recorded in the local receipt.
- All 72 definitions in these three specs remain collected across four browser projects. Collection is not execution.
- No new local browser launch was attempted; the existing launch restriction remains in force.

Next: independent diff review, publisher composition into the existing PR, then native CI on the exact new head. Completion requires the related delivery tests to pass on the configured browser matrix without masking production failure. Until then these corrections are locally inspected, not a verified native fix.

## Standard Chromium Bookshelf transport follow-up

The standard Chromium first attempt failed only the Bookshelf final request-count
assertion (expected 1, received 2); its retry passed, which remains a failed
`failOnFlakyTests` gate until corrected and rerun. The stored trace shows both JS
requests during the first entry (357064.852 and 357083.808 ms), before Home
(357163.248 ms) and cached reentry (357260.156 ms). No new JS request followed
reentry. The same initial preload/import distinction therefore applies to this
fixture. Production retry/guard failure, incorrect transport-count assumption,
and a transient runner failure were compared; exact action/network evidence
supports the second explanation. A request after reentry would falsify it.

The immediate-failure case now requires one unique failed asset, bounds initial
transports to 1–2, records that count at the first fallback, and requires exact
zero additional requests on cached reentry and return. All Home, retained data,
no-reload, no-retry-button and document assertions remain. The pending-failure
case is unchanged. No runtime code changes. Syntax and exact browser test
collection are checked locally; native execution remains the PR CI gate.
