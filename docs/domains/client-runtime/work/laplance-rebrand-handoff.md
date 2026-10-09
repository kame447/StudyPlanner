# Laplance brand display migration

## Context
- Scope owner: Issue #556, branch `branding/laplance-rebrand-20261010`
- User purchased `laplance.com` via Cloudflare Registrar on 2026-10-10 (JST).
- Public-facing product name changes from **Laplans** to **Laplance**; Japanese reading stays ラプランス.

## In scope
- Browser title and application / iOS home-screen title metadata.
- Visible client, admin, FAQ, settings, legal and help copy, image alternative text.
- Current project documentation and the matching display-name assertions.
- Preserve historical evidence; replace only the startup media with the newly approved Laplance upload and its own extracted frames.
- Replace the visible static wordmark in the normal header and non-video loading with the already-approved app icon and text-rendered Laplance name, so the image cannot display the old spelling.

## Deliberately unchanged
- GitHub repository `kame447/StudyPlanner`, npm package identifier and other internal StudyPlanner identifiers.
- Cloudflare Pages project names, Cloudflare Worker and Firestore/Firebase project identity.
- Existing URLs, DNS records, OAuth/Firebase authorized origins, CORS/ALLOWED_ORIGIN, stored IDs and user data.
- Existing PNG icons and unused legacy JPEG wordmark.
- Historical analysis logs and older handoffs (their recorded product name remains accurate for that release).

## Approved startup media replacement
The user supplied `laplance_blackhole_1080x1920.mp4` and explicitly requested implementation. The source is now stored unchanged in `src/assets/`; the filename is preserved, while the actual encoded media is 512 × 910, H.264, 5.000 seconds, 839,108 bytes. SHA-256: `30dc9f0d5bab2552168a021bb217f4b00bd34db3ae7053ba7e046d9711c0caa6`.

The poster is extracted at 0.5 seconds and the fallback still from the final frame of this same clip. Both contain the approved artwork, with no generated replacement or added subtitle. Existing full playback, readiness-gated skipping, reduced-motion behavior, autoplay/media failure fallback and portrait/desktop containment remain unchanged. Source imports and the media-contract assertions in the existing browser tests now refer to the new upload. Historical evidence about the old 9-second clip is retained as historical evidence, not a current contract.

Asset replacement verification is in progress on the existing branch / PR #557; do not reuse the previous full-verify result for this changed snapshot.

## Domain launch follow-up
`laplance.com` is registered but not yet configured as a production URL. A separate migration must link the domain to the active Cloudflare Pages project, configure Firebase authorized domains and any Worker origin restrictions, exercise sign-in/API flows and ensure the legacy URL remains valid until verified.

## Verification
- Confirm all remaining literal `Laplans` occurrences are historical artifacts or internal asset references, not new displayed copy.
- Run brand and startup/component tests; perform full `npm run verify` before publishing the PR.
- Check HTML page title and iOS metadata after deployment.
