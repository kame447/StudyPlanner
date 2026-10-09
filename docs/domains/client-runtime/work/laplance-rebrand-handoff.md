# Laplance brand display migration

## Context
- Scope owner: Issue #556, branch `branding/laplance-rebrand-20261010`
- User purchased `laplance.com` via Cloudflare Registrar on 2026-10-10 (JST).
- Public-facing product name changes from **Laplans** to **Laplance**; Japanese reading stays ラプランス.

## In scope
- Browser title and application / iOS home-screen title metadata.
- Visible client, admin, FAQ, settings, legal and help copy, image alternative text.
- Current project documentation and the matching display-name assertions.
- Preserve historical asset names and evidence, because the binary bytes are not being edited.
- Replace the visible static wordmark in the normal header and non-video loading with the already-approved app icon and text-rendered Laplance name, so the image cannot display the old spelling.

## Deliberately unchanged
- GitHub repository `kame447/StudyPlanner`, npm package identifier and other internal StudyPlanner identifiers.
- Cloudflare Pages project names, Cloudflare Worker and Firestore/Firebase project identity.
- Existing URLs, DNS records, OAuth/Firebase authorized origins, CORS/ALLOWED_ORIGIN, stored IDs and user data.
- Existing PNG icons, JPEG wordmark, splash stills and embedded splash-video imagery.
- Historical analysis logs and older handoffs (their recorded product name remains accurate for that release).

## Visual asset follow-up
The shipped legacy wordmark and splash media may contain rasterized old branding. This PR no longer displays the legacy wordmark asset in the header or ordinary loading: it reuses the approved app icon with text-rendered **Laplance**. The startup video and its final still remain unchanged and may still display Laplans; replacing those image/video bytes requires separately approved artwork and visual QA. Do not merely rename files or weaken checksum tests. Maintain compatible filenames until replacement is verified.

## Domain launch follow-up
`laplance.com` is registered but not yet configured as a production URL. A separate migration must link the domain to the active Cloudflare Pages project, configure Firebase authorized domains and any Worker origin restrictions, exercise sign-in/API flows and ensure the legacy URL remains valid until verified.

## Verification
- Confirm all remaining literal `Laplans` occurrences are historical artifacts or internal asset references, not new displayed copy.
- Run brand and startup/component tests; perform full `npm run verify` before publishing the PR.
- Check HTML page title and iOS metadata after deployment.
