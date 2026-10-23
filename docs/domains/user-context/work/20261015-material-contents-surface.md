# Saved material contents editor surface

Status: active local candidate; publication pending
Owner: UI umbrella #483, original material-entry requests 21/22
Base: main `576cf5b5e815c75d2d655b88ac4fbe4250834e78`
Branch: `fix/material-contents-opaque-surface`

## Scope and evidence

The saved table-of-contents editor inherits the shared translucent modal surface. Existing 390px mobile WebKit evidence visibly mixes the underlying material title, progress and date into the editor's text. The saved editor is separate from the creation dialog, which already uses an opaque surface.

Make only this editor's background opaque in light and dark themes. Retain its size, spacing, controls, save/cancel behavior and the existing opaque pixel-theme frame. Do not change shared modal tokens, the creation dialog or other bookshelf sheets.

The shared alpha surface is the direct cause visible in both code and the existing image. A stronger overlay would also dim unrelated content, while backdrop blur would not guarantee that background colors disappear. A scoped opaque editor surface has the smallest responsibility and change boundary.

## Verification and remaining work

- Existing Issue, open/closed pull requests and branch names were checked before starting. Earlier nested editing (#681), retired FAQ (#680), stale timer (#675) and Actual source (#683) changes are already on the current base; none is recreated.
- Extend the existing 390/1280px editor browser cases with rendered background alpha and red/blue backdrop invariance across standard/pixel and light/dark appearances. Keep their field geometry and cancel/reopen assertions.
- Run related material unit tests, fresh application/Worker types, production build, browser-spec collection and exact diff inspection.
- Runtime browser results and new rendered images are required before this surface can be called visually verified. Publication and CI remain a separate approval boundary.

## Local checkpoint — 2026-10-15

- Product change: two editor-specific background declarations, eight CSS lines. Standard light uses white and standard dark uses the same opaque dark surface as material creation. Existing pixel paper/frame rules remain authoritative. No TypeScript, persistence or shared token changes.
- Related material tests: 9 files / 60 tests passed, including nested edit/save/reopen, cancellation, photo review and material study status.
- Fresh application and generated Worker type checks passed. The initial Worker command also exited 0 but could not write its diagnostic log to the default home path; the supported `WRANGLER_LOG_PATH` was redirected to the workspace and a fresh generation/check then completed without that diagnostic error.
- Production build passed in 6.78 seconds. Existing large-chunk warnings remain. No lint script is configured.
- Existing Chromium and mobile WebKit specs each collect both viewport cases. Each case now checks standard/pixel × light/dark backgrounds, alpha 255, editor opacity 1 and identical interior pixels against verified red/blue overlay backgrounds. The optional pixel stylesheet is loaded through the actual saved-preference path before the checks. Existing field geometry and cancel/reopen assertions are retained.
- Browser execution and new images are not verified locally: the parent confirmed native execution is blocked by the environment's socket restriction and instructed not to retry. The existing CI is the next visual acceptance gate after publication approval.
- This is a local review candidate only. No new remote Issue/PR, push, merge or branch deletion has been performed. UI umbrella #483 remains the owning Issue; the completed nested-editing PR is not reopened.
- Independent read-only diff review found no blocking issue. The screenshot probe position and render stability still require the existing browser CI; source review and test collection do not establish visual acceptance.
