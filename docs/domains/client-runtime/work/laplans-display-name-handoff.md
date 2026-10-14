# Laplans display-name and icon alignment

Status: locally verified; pull request and deployment checks pending
Updated: 2026-10-09

## Scope

The visible product name becomes Laplans in the page title, Home Screen title, settings, FAQ, legal/support pages, Home accessibility text and Admin. Only the product name changes in legal text; operator identity, consent versions and legal meaning stay the same.

The user reviewed and approved the supplied square symbol and iPhone-sized icon. The browser uses 32px and 192px PNG icons, and Apple touch devices receive a 180px PNG. The supplied full Laplans wordmark is used in the shared logo and ordinary loading screen; the Admin monogram is L. Startup video and still images are unchanged.

This change does not introduce a manifest, service worker or launch-mode change. Application behavior and existing data remain unchanged.

## Supplied assets

- Approved square symbol master: 440 × 440. The original 440 × 437 image is preserved without cropping or recoloring; edge rows fill the three extra rows.
- PNG derivatives: 32 × 32 (1,979 bytes), 192 × 192 (35,844 bytes), and 180 × 180 (32,322 bytes). All are RGB PNGs without alpha, and HTML declares their actual sizes and MIME type.
- The full wordmark is the original supplied JPEG, 1206 × 1231, 96,471 bytes. Its bytes are unchanged.
- The existing 3.1:1 logo frame and responsive dimensions are preserved. CSS shows the complete symbol, Laplans text and tagline within that frame.
- Regression tests check asset checksums, image dimensions, HTML references and the visible/accessibility names.

## Local verification

The final runtime and test source was verified after recovery of the working environment:

- Nine focused files: 37 tests passed, including icon bytes, branding, settings, Admin, startup and initial setup screens.
- Fresh non-incremental app TypeScript check passed.
- Production build passed in 16.29 seconds. All eight existing bundle guards passed: total JavaScript 2,252,685 bytes and CSS 484,881 bytes. No dependency, workflow or threshold changed.
- All 237 installed package versions matched the lockfile. A 2,285-file source snapshot was unchanged after browser verification; later documentation edits do not alter that tested source.
- Playwright 1.62.1 with Chrome Headless Shell 155.0.8059.39 and WebKit 26.5 read the built titles and all icon declarations. Six icon fetch/decode checks returned HTTP 200, PNG MIME, exact original bytes and declared dimensions.
- Wordmark verification passed 48 conditions: both browser engines × widths 320/390/1280 × light/dark × login/consent/week-start/static-loading. Checks cover original JPEG bytes, successful decode, complete logo bounds, frame ratio, intended visible image area and horizontal overflow against the previous image/CSS control.
- Representative mobile light/dark and desktop loading screenshots were visually inspected. Independent source and asset review found no unresolved issue.
- WebKit login at width 320 retains an existing 322px page width under both old and new logos. The logo itself remains within the viewport; this existing page-width behavior is not claimed as fixed here.

These local checks are not full CI or real-device acceptance. The exact published head still needs the repository's full CI/browser/visual gates and deployed asset verification.

## Home Screen acceptance

HTML and icon publication does not prove an already-added Home Screen icon has refreshed. Apple documents the icon declarations but does not promise that existing icons update automatically.

After deployment, first verify the served HTML and icon bytes. On an actual iPhone, inspect Safari's Add to Home Screen preview for the Laplans name and supplied symbol. Keep the old shortcut and its website data until the new entry's sign-in and expected data/settings are verified. Do not clear website data or delete the old entry as the first troubleshooting step. Actual installed-icon refresh and physical-device acceptance remain unverified.

Public references:
- [Apple web-app configuration](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)
- [WebKit Home Screen support](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [WebKit Safari 17.2](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/)
