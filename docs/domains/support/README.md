# Support inquiries

Status: canonical domain entry point

Support owns the authenticated `/contact` submission and read-only `/admin/inquiries` inbox. It is independent of planner persistence, AI conversation traces and product analytics. The contact flow neither requests nor copies email addresses; existing sign-in and email verification policies are unchanged.

## Contract

- A submission contains a random receipt ID, authenticated author UID, plain-text body (1–2000 characters), schema version and server timestamp. The form tells the author what is sent and warns against entering secrets.
- Firestore Rules enforce owner-bound creation and receipt reads. Only enabled administrators can list inquiries; lists require a limit of at most 26. Clients cannot update or delete inquiries, including administrators.
- A transaction reads the receipt first. Identical replay acknowledges the original document without writing. A different owner/content cannot overwrite the receipt. If a transaction fails (including a same-ID concurrent commit denied before SDK retry), one authenticated server receipt read confirms success only when all four expected fields, owner, body, schema and timestamp match; missing, mismatched or unreadable receipts keep the failure. The UI locks pending/unknown-outcome content and retries using the same ID; switching accounts clears the prior form and ignores late acknowledgement. The receipt ID and draft live only in that form instance; navigation/reload clears them and never automatically resends. Re-entering the same text after a reload creates a new inquiry, so the retry guarantee must not be described as cross-reload deduplication.
- New submissions atomically update one owner-scoped cooldown document. Rules require the receipt and gate to reference each other, reject gate-only writes/deletion, and allow at most one new inquiry per account per 60 seconds. Concurrent distinct submissions cannot both succeed. This is per-account abuse prevention, not an IP/global rate limiter or a defense against mass account creation.
- Under no transaction contention, a new send performs two explicit document reads and two document writes; successful replay performs one explicit receipt read and no writes. A failed transaction adds at most one explicit reconciliation read. Rules perform additional dependent reads and transaction retries can add cost. Admin pages request at most 26 documents to show 25 and determine continuation; cursor timestamp precision and document ID ordering are preserved. There is no polling, full scan, count query, profile/email enrichment, automatic telemetry copy or extra global listener.
- The inbox is read-only. Replies, ticket status, attachments, notifications and automatic account/data deletion are outside this feature. No automatic retention/deletion job is added; existing account/data handling obligations also apply to these inquiry records and cooldown records.

## Public-page navigation

Settings support links to contact/legal pages and their return links navigate within the current document. A started planner, its authenticated bootstrap, unsaved forms and active study session remain mounted while public pages are shown. Native Back/Forward preserves settings history. A direct public URL is accessible without planner startup; returning from that entry still goes through normal authentication, consent and profile gates. Direct public pages restore the saved theme using the same preference hook until the planner becomes its owner. Leaving an inquiry still disposes that form and never automatically resends a pending request.

## Rollout and verification

Publish and verify the dedicated Firestore Rules before exposing the form. The existing WIF Rules deployment is the supported path; no new secret, backend service, custom index or migration is needed. A local/preview instance without Firebase does not pretend to submit messages.

Unit/component tests own validation, idempotent retry, auth lifecycle and bounded pagination. The existing `test:firestore-rules` entry runs `scripts/ci/firestore-inquiry-rules.mjs` against the demo emulator for actual authorization, timestamp, rate and concurrency semantics. This script mirrors the small client transaction/reconciliation algorithm; production `submitInquiry` itself is covered by service unit tests (it is not directly loaded into that emulator script). The existing Admin Overview Render configuration includes `support-inquiries.spec.mjs` with fixture service data for desktop/mobile light/dark layouts and interrupted/error flows. Fixture browser tests are not production Firebase delivery proof.

Active execution and exact receipts: [in-app inquiry work record](work/20261013-in-app-inquiries.md).
