# AI navigation and diagnostic visibility

Status: local candidate verified; browser validation and publication pending.

- Branch: `fix/ai-navigation-diagnostics-20261013`
- Integration base: `05c78b6fa0d708c39e7ca5ceb1703ca80f7509a9` (advanced from `e44f4b4154608a4ebd41399b8f41d6f6dce7431c`; the four upstream approval files are untouched).
- No new remote Issue or PR. Open PR/branch search found no owner for this request; related historical PRs #537 and #558 are merged. Keep this local branch until publication is decided.
- Scope: first-entry code loading, owner-scoped AI presentation lifetime and ordinary-user diagnostic visibility. AI interpretation/controller/approval/persistence contracts and #488 remain untouched. Contact content has a separate owner.

## Findings and changes

A failing real-App regression confirmed that navigation remounted the AI presentation, losing its draft/attachment and repeating starter-catalog reads. AI was also absent from optional post-startup preloading. Repeated chat initialization or network chunk downloads were not established: chat initialization is idempotent and React.lazy caches the module. Production-device latency remains unmeasured.

The visited AI presentation now survives ordinary navigation for the current owner and is discarded on sign-out/account replacement. It uses the current planner-owned catalog snapshot. Inactive UI releases viewport listeners, preview scroll locks and the microphone, dismisses nested confirmations and revokes unadmitted OCR/code waits. Already-admitted turns can finish for their existing owner/chat; late callbacks cannot submit another turn or revive a consumed attachment. Return scroll follows a new answer only when the reader had been following the conversation end.

Optional AI code preload retains the existing startup gate. Cold entry uses a local AI status; return navigation retains the same composer. The shell and view share one explicit active-owner/route/settings condition, replacing CSS inference from hidden descendants without adding another state source.

Support no longer contains timing controls. Query-enabled production timing UI requires current verified administrator status; development keeps explicit query diagnostics. Normal URLs perform no new identity/admin lookup. Anonymous bounded measurement remains independent of panel access; no authorization policy, credentials or Rules changed.

## Final local verification

The final active-shell snapshot passed `npm run verify` on 2026-10-13: fresh non-incremental app/Worker checks, 833 test files passed / 11 skipped, 7,664 tests passed / 54 skipped / 1 todo, and production build. Before/after identity receipts match all 2,402 source inputs, 19,305 installed files (362 package manifests), generated Worker types, tools and selected environment inputs. Node was v24.19.0. Subsequent checkpoint editing is documentation-only; runtime/test hashes are checked against this snapshot before commit.

- Verified source/test manifest SHA-256: `1bafb65c9c2e37fbc6d4dc3562a204b6c163463a37374bf63415eb469495bfd5` (sorted compact JSON of path → content SHA-256).
- Independent review has no remaining blocking finding, including owner disposal, pending-provider completion, fallback viewport, sidebar dismissal and admin identity changes. Its focused checks passed, including the final shell-class transition tests.
- The unchanged asset guard passes every CSS, individual-JavaScript and appearance limit. Largest CSS is 424,972 bytes against 425,000; total CSS is 492,741 against 493,000.
- Aggregate JavaScript remains over the existing limits: raw 2,344,547 / limit 2,265,000; gzip 631,648 / limit 610,000. Main05c78 CI run 38357434643, artifact 11794085377 already reports 2,342,881 / 631,147. Candidate deltas are +1,666 / +501 bytes, with a Node22 CI versus Node24 local caveat; this is not a same-installed causal comparison. Largest CSS is 22 bytes below that baseline; total CSS is 62 bytes above it. Thresholds are unchanged.
- An earlier frozen candidate passed full verification but added a largest-CSS failure. The explicit active-shell state fixed the fragile layout inference; the final source received a new full verification. Earlier proof is not substituted for the final result.
- Browser specifications collect successfully: 24 Chromium cases across four affected files and 13 WebKit-mobile cases across two. Collection is not execution. Local Chromium socket EPERM and missing WebKit libraries prevent real browser validation; desktop/mobile geometry and browser history behavior remain unverified.

Raw logs and complete before/after manifests are retained outside the publication diff. No dependency, build configuration or budget limit changed.

## Remaining exit criteria

1. Owner decision on the inherited aggregate-JavaScript budget failure; do not describe the whole quality gate as green.
2. Publication approval, then exact-head Chromium/WebKit browser CI for draft/attachment/history retention, cold entry, inactive Home layout and diagnostic visibility.
3. Review and integrate only after the applicable checks are terminal. No remote push, PR or merge was performed for this candidate.
