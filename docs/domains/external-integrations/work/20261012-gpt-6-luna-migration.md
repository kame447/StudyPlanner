# Internal GPT-6 Luna migration

Status: local full verification passed; PR publication and test-environment validation approved; not deployed
Updated: 2026-10-12 20:55 UTC

## Current result

Internal model defaults, supported-request handling, current evaluation workflow pins and versioned usage pricing have been changed locally to GPT-6 Luna. The exact integrated runtime inputs passed fresh app/Worker typechecks, 7,238 tests in 813 files and a production build. API availability, Japanese semantic quality, latency and total cost have not yet been measured on the new model. Repository-Node CI and production verification remain separate.

## Ownership and scope

- Branch: `feat/gpt-6-luna-migration`
- Base / initial HEAD: `819d5bac3791b0d0aac2a6b1fd977fe73256edf6` (remote main verified 2026-10-12 UTC).
- Existing open and closed Issue / PR and branch searches found no active GPT-6 Luna migration owner; a fresh 20:49 UTC read still shows the same remote main. PR #124 is historical GPT-5.6 Luna standardization, not an active migration. No new Issue or PR has been published.
- Scope: internal OpenAI defaults / purpose routing, request compatibility, checked-in allowlist, current evaluation workflow defaults, observational model-family classification, and versioned usage pricing.
- Keep Chat Completions with structured outputs; production calls do not use function-calling tools. The official model page supports this API and structured outputs. The Chat Completions function-calling restriction does not apply to these requests.
- Preserve omitted reasoning configuration, output budgets, typed semantic validation, approval/save ownership, Jev flags, Gemini OCR, explicit development overrides, archived evidence, and frozen historical evaluation contracts.
- No upstream push, main change, merge, deployment, credentials or production data/config change has been made. Publication and production activation require the integration owner's authorization check. A paid experiment requires its own bounded protocol, budget and receipt before execution.

## Boundaries with the parallel Jev evaluation

[Issue #305](https://github.com/kame447/StudyPlanner/issues/305) continues to own Jev rollout, [#333](https://github.com/kame447/StudyPlanner/issues/333) Japanese paired evaluation and [#335](https://github.com/kame447/StudyPlanner/issues/335) the affected safety regression gate. The user's request to check and replace suitable decisions is an instruction to investigate and implement supported replacements; it is not evidence that Jev is faster, cheaper or more accurate on the new baseline.

Checked-in global and per-purpose Jev settings remain off with zero canary. Actual deployed Worker bindings have not been read back during this migration. The new renderer-claim-verification experiment is a separate purpose and acceptance question; it does not inherit evidence from the existing semantic replacement units or the semantic-layer dispatch-reduction metric.

[Issue #488's existing integration checkpoint](https://github.com/kame447/StudyPlanner/issues/488#issuecomment-6110706145) remains separate: main has 20 adopted units and four pending release PRs, with the previous model evidence preserved. Its 58 observed / 98 reserved / 98 maximum dispatch accounting is frozen. Do not spend its unused reservations on this migration, relabel old GPT-5.6 results as GPT-6, or reprice historical receipts with the new rates.

## Sources

- [Official GPT-6 Luna model contract and pricing](https://developers.openai.com/api/docs/models/gpt-6-luna), checked 2026-10-12: Standard text per million tokens USD 0.10 input / 0.01 cached input / 0.125 cache writes / 0.50 output. Above 272,000 input tokens has different rates; the existing estimator remains fail-closed there.
- [Current migration guidance](https://developers.openai.com/api/docs/guides/latest-model), [reasoning defaults](https://developers.openai.com/api/docs/guides/reasoning) and [Chat Completions request/usage contract](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create): preserve the effective reasoning setting, omit unsupported sampling fields, and keep completion budgets inclusive of reasoning. Independent source/request review found no incompatible fields in the local implementation. The unchanged 800-token default and 4096-token Worker cap remain unmeasured on real GPT-6 responses.

## Verification checkpoint

`DEV_LAN_HOST=127.0.0.1 npm run verify` completed with exit 0 at 20:51 UTC: fresh app/Worker typechecks, 813 passed test files / 7,238 passed tests, 10 skipped files / 45 skipped tests / 1 todo, then production build in 4.56 seconds. Skips and todo are not passes. The 2,040-input runtime manifest SHA-256 is `08a1afdeb5c1cca273d6e0944822198b01b7067469c5ce62b719149a10e313e7`; a post-documentation recheck found no changed runtime inputs. The log SHA-256 is `f05e8df560aa63b8df35bc5586717b3285492b40fb77b21401cb4dee1b89385f`.

Dependency installation succeeded (`npm ci`, then `npm ls --depth=0`, both exit 0): Node 24.19.0, npm 11.9.0, TypeScript 5.9.3, Vitest 3.2.7 and Wrangler 4.147.0; unchanged lockfile SHA-256 `af5b37bbcc990a528621a18f545142430f8b9506460dde03f3f9be80fbb4b9ab`. The installed 362-package identity SHA-256 is `14e23132bf0ec5593ac3efdd6e00496233713b63e778ce88b209aeb29637af18`. The repository declares Node 22.23.0, so the local Node 24 result does not substitute for that CI environment. Browser, real-provider and deployment gates were not run by this command.

Next: finalize the local commit, publish the reviewable PR and validate the exact commit in repository-Node CI and the test environment. The user approved that scope at 20:54:27 UTC, including parallel GPT-6 and Jev comparison work. This supersedes the 20:52 pending question, which replaced the broader 20:51 question after detecting the external Cloudflare Pages deployment side effect. Main merge and production switching remain on hold until the web and AI-server rollout is explained and approved together; Jev production activation is excluded. Record applicable live-model/browser results separately, and admit each paid run only after its exact harness and bounded budget review. Continue directly on dot's server without launching or delegating to Codex. Do not repeat the full local run solely for documentation edits; re-run affected checks if runtime inputs change.

## Deployment boundary

The existing [Cloudflare Pages check](https://github.com/kame447/StudyPlanner/runs/114958503666) on main `819d5bac` succeeded at 18:48 UTC for deployment `57dc5330-4c18-4526-bb67-9deccb7a43b1` (`57dc5330.studyplannner.pages.dev`). This proves an external deployment side effect on main push; the production-branch setting and current `laplance.com` delivery have not been verified (the HTML read returned 403). Do not describe automatic production publication as confirmed. Main merge still cannot be treated as a code-only action. No current GitHub workflow contains a Worker-deploy step; `npm run deploy:worker` is a separate operation, and external Worker Builds configuration is unknown. Therefore, do not assume the frontend model/allowlist and Worker model/allowlist switch atomically or that Worker deployment is impossible. Verify the coordinated order, compatibility window and rollback before production switching. The migration does not change Firestore Rules or its path-gated deploy workflow.

## Exit criteria

- Effective checked-in runtime defaults and allowlists select GPT-6 Luna consistently.
- Both direct and Worker requests retain supported structured-output contracts and bounded output budgets, with no accidental temperature addition.
- Current usage identifies GPT-6 Luna as Luna and prices known complete text usage using a distinct version; GPT-5.6 historical estimates and evidence remain unchanged.
- Focused tests and final full verification pass on the integrated content; remaining live/rollout limits are explicit.

## 2026-10-13 rollout-compatibility amendment

- Worker-first deployment temporarily accepts both explicit `gpt-6-luna` and legacy `gpt-5.6-luna` requests. All known-purpose routes continue selecting GPT-6 Luna. This prevents supported retained-tab and purpose-less direct calls from failing solely because their old model was removed from the allowlist. No arbitrary model is enabled.
- The Worker must be upgraded and its active version and nonsecret bindings read back before new Pages clients are shipped. A rollback Worker must preserve the explicit-model compatibility window and any accepted wire schema.
- This change alone does not validate GPT-6 provider access, Japanese conversation quality, current Worker source parity, Cloudflare secret preservation, Jev shadow/canary or production save/reload; each requires independent evidence.
- A preexisting JS bundle-budget failure must be reported separately and cannot be marked green solely because it predates this patch.
