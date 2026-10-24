# Initial consent legal-page navigation

Status: local candidate; two red regressions corrected; independent source review has no blocker; not published.
Base: 5b1e7c84072f5d245ca8c1298cfadfacd19368a8.
Branch: fix/initial-consent-public-navigation.

## Scope
The initial consent screen uses ordinary links to terms/privacy even though its root already provides retained same-document public-page navigation. Verify and connect those two links to that existing owner. Keep explicit consent, native modified-click behavior, and standalone links intact. Do not change auth, policy persistence, or public routing.

## Alternatives and checks
- Leave document navigation: loses the mounted confirmation state and restarts startup; inconsistent with the existing retained public-page owner.
- Open new tabs: changes the product interaction and does not reuse its return/history behavior.
- Reuse PublicPageLink: minimal two-link integration, directly testable with the real consent screen and public boundary. Selected if the regression reproduces.

## Verification
- Actual consent screen plus PublicPageBoundary: terms/privacy links failed both new interception assertions before the change; the 17 existing cases passed. The first red attempt threw because an ordinary anchor has no React handler; the final red uses optional invocation and fails the intended preventDefault assertion.
- After the two-link change: 24 related tests across PublicPageBoundary, its theme boundary, and InitialPrivacyConsentScreen pass. They cover retained component identity/check state, Back/Forward/explicit Home, no automatic consent/save/logout, and existing modified-click/standalone behavior.
- First test startup failed in optional LAN discovery (`uv_interface_addresses`); subsequent local checks use the existing DEV_LAN_HOST=127.0.0.1 configuration, without binding a browser server or changing network policy.
- Fresh non-incremental app types passed; production build passed in 5.22 seconds. No Worker runtime changes and no full-suite invocation, per the latest related-only user direction.
- Native browser/real provider/production performance measurements remain unverified. Previously denied local browser capability was not retried.

Next: preserve the reviewed local candidate for publication approval and later native validation. No publication or main merge in this task. Type/build and independent source review are complete; browser acceptance remains pending.

## Native regression prepared
Existing native coverage showed the consent appearance and legal-link hrefs, but did not follow legal pages from the initial consent screen. Added one logical case to the existing `appearance-startup.spec.mjs`; its original three cases are byte-preserved. The existing configs collect the addition once in Chromium and once in mobile WebKit.

The new case uses the existing startup harness with a synthetic policy verdict/write counter. Production consent/public components and native clicks verify both terms/privacy round trips, Back/Forward/Home, original document and checkbox node, checked state, zero accept calls and the required policy state. It finally unchecks and confirms that acceptance remains disabled. It prepares a screenshot attachment but has not run in a browser. Syntax and both exact collections pass. No runner/config, timeouts, product bytes, or existing case changes; the previous type/build and 24 component results remain applicable. Independent supplement source review has no blocker; native execution remains pending.
