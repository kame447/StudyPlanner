# Support inquiries and announcements

Status: canonical domain entry point

Support owns the authenticated `/contact` submission, read-only `/admin/inquiries` inbox, and administrator-authored in-app announcements. It is independent of planner persistence, AI conversation traces and product analytics. The contact flow neither requests nor copies email addresses; existing sign-in and email verification policies are unchanged.

## Contract

- A submission contains a random receipt ID, authenticated author UID, plain-text body (1–2000 characters), schema version and server timestamp. Optional photos use schema 2 with at most three immutable SHA-256/type/size/dimension descriptors; image bytes and public URLs never enter Firestore. The form tells the author what is sent and warns against entering secrets.
- Firestore Rules enforce owner-bound creation and receipt reads. Only enabled administrators can list inquiries; lists require a limit of at most 26. Clients cannot update or delete inquiries, including administrators.
- A transaction reads the receipt first. Identical replay acknowledges the original document without writing. A different owner/content cannot overwrite the receipt. If a transaction fails (including a same-ID concurrent commit denied before SDK retry), one authenticated server receipt read confirms success only when the exact expected fields, owner, body, schema, timestamp and optional attachment descriptors match; missing, mismatched or unreadable receipts keep the failure. The UI locks pending/unknown-outcome content and retries using the same ID; switching accounts clears the prior form and ignores late acknowledgement. One owner-scoped in-memory draft retains text and photo Files during same-document navigation; its auth subscription remains active while the contact screen is hidden. Logout or owner change clears it and fences late completions. Session storage contains only owner/receipt ID and immutable photo metadata, never message text or image bytes. Reload performs a read-only server reconciliation; accepted text is not resubmitted. Missing receipts allow re-entering text under that same receipt ID, and a late accepted receipt is reconciled without overwriting it. Offline/unconfirmed reads require explicit retry. No automatic send occurs. If session storage is unavailable, only same-document recovery is available.

- New submissions atomically update one owner-scoped cooldown document. Rules require the receipt and gate to reference each other, reject gate-only writes/deletion, and allow at most one new inquiry per account per 60 seconds. Concurrent distinct submissions cannot both succeed. This is per-account abuse prevention, not an IP/global rate limiter or a defense against mass account creation.
- Under no transaction contention, a new send performs two explicit document reads and two document writes; successful replay performs one explicit receipt read and no writes. A failed transaction adds at most one explicit reconciliation read. Rules perform additional dependent reads and transaction retries can add cost. Admin pages request at most 26 documents to show 25 and determine continuation; cursor timestamp precision and document ID ordering are preserved. There is no polling, full scan, count query, profile/email enrichment, automatic telemetry copy or extra global data listener.
- The inbox is read-only. Replies, ticket status, notifications and automatic account/data deletion are outside this feature. No automatic retention/deletion job is added; existing account/data handling obligations also apply to these inquiry records and cooldown records.

## Public-page navigation

Settings support links to contact/legal pages and their return links navigate within the current document. A started planner, its authenticated bootstrap, unsaved forms and active study session remain mounted while public pages are shown. Native Back/Forward preserves settings history. A direct public URL is accessible without planner startup; returning from that entry still goes through normal authentication, consent and profile gates. Direct public pages restore the saved theme using the same preference hook until the planner becomes its owner. Leaving an inquiry unmounts its view while retaining the owner-fenced draft and pending operation in memory; returning shows the same receipt state and never automatically starts a second send.

## Rollout and verification

Publish and verify the dedicated Firestore Rules before exposing the form. The existing WIF Rules deployment is the supported path; no new secret, backend service, custom index or migration is needed. A local/preview instance without Firebase does not pretend to submit messages.

Unit/component tests own validation, idempotent retry, auth lifecycle and bounded pagination. The existing `test:firestore-rules` entry runs `scripts/ci/firestore-inquiry-rules.mjs` against the demo emulator for actual authorization, timestamp, rate and concurrency semantics. This script mirrors the small client transaction/reconciliation algorithm; production `submitInquiry` itself is covered by service unit tests (it is not directly loaded into that emulator script). The existing Admin Overview Render configuration includes `support-inquiries.spec.mjs` with fixture service data for desktop/mobile light/dark layouts and interrupted/error flows. Fixture browser tests are not production Firebase delivery proof.

## Private photo boundary and rollout

The existing Worker serves `/support-inquiries/attachments/capabilities` and authenticated `PUT`/`GET /support-inquiries/attachments/{receipt}/{slot}`. The capability remains unavailable unless a private `INQUIRY_ATTACHMENTS` R2 binding and the Firebase project/API configuration exist. No R2 bucket, public endpoint, permission or billing change is made by this code change. Provisioning/binding requires separate approval; deploy and verify schema-2 Rules through the existing WIF path before enabling photos. An unconfigured deployment keeps text submission working and explicitly marks photos unavailable.

Only the accepted receipt owner can upload, and each slot accepts the exact original SHA-256, media type, byte count and dimensions. Replays cannot allocate keys or replace content. Every read requires a currently enabled administrator and receipt access under caller-token Firestore Rules. No public URLs, arbitrary remote fetches, AI transmission or service-account privilege expansion is used. The API validates bounded JPEG/PNG magic, headers and structure, byte size (5 MiB), dimension (8192px) and pixel count (24 million). This is not a full pixel decoder, malware scanner or metadata stripping step; original resolution and embedded metadata are retained, and the picker warns the user accordingly.

Text acceptance and image transfer are separate states. Interrupted transfers retry only the same fixed slots. Reload asks for the original images again; partial reselection is retained and reordered into original slots. The admin inbox fetches bytes only on explicit open, uses revocable Blob URLs, and drops image viewers on page loading/error, close, unmount or admin-access loss. Requests/responses disable caching. The feature adds no object-retention/deletion automation; private objects remain subject to existing account/data handling obligations and require an approved operational lifecycle before enabling production storage.

Active photo execution and exact receipts: [private inquiry photos](work/20261013-private-inquiry-photos.md).

Active execution and exact receipts: [in-app inquiry work record](work/20261013-in-app-inquiries.md).


## Announcements

The home bell lazily opens an opaque full-screen announcements page. The current planner stays mounted behind the native modal surface; list/detail Back and Forward use the existing same-document history notification boundary. The surface is keyed by authenticated user, and account changes discard late reads/writes and do not restore a different user's history entry. This is in-app publication, not a push-notification service.

Administrators reuse the existing enabled-admin guard and `/admin/announcements` navigation. Drafts live in `announcement_drafts`, readable/writable only by enabled administrators. Editing a draft does not change the public version. Explicit preview and publication atomically copies the checked revision to `announcements`; signed-in users can read only that published collection. Stale saves/publishes fail and identical retries do not create new revisions or publication timestamps. There is no new admin grant, anonymous access, deletion, email/phone collection, or automatic distribution outside the app.

The published and administrative repositories read 26 records to display 25, using timestamp precision plus document-ID cursors. No new listener, polling, startup read, custom index or whole-collection scan is introduced. Each visible page reads its owner-only summary and at most 25 owner-only individual receipts. Bulk-read advances one monotonic timestamp through the newest observed publication; older unloaded pages are therefore covered without fetching them. Later publications, including revised publications of the same notice, remain unread. Failed read-state persistence is visible and never silently treated as success.

Rollout is approval-gated: merge of `firestore.rules` automatically triggers production WIF deployment, so the Rules diff must be reviewed and authorized before merge. Deploy and verify Rules before exposing the feature. Local component/service tests and emulator authorization are separate from native browser/production delivery proof. The existing admin browser job includes the announcement list/detail, theme/viewport, error, owner-switch and publish-preview regressions.

Active implementation and exact verification receipts: [announcements work record](work/20261014-admin-announcements.md).
