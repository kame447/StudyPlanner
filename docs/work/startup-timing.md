# Local startup timing

Use `?startupTiming=1` on the application URL to opt into an in-memory diagnostic panel. Open “起動計測（端末内のみ）” after startup. A normal URL has no panel or measurements. Reload starts a new recording; no database, localStorage, cookies, network telemetry, or trace payload is added by this instrumentation.

Rows contain only an anonymous sequence number, a fixed phase name, milliseconds from this page's monotonic performance clock, duration, and a pending/success/error/cancelled outcome. The recorder is capped at 80 rows and stops accepting new spans after the first visible Home observation. Existing pending spans may finish. No account IDs, schedule contents, request URLs, tokens, results, or raw error messages are retained. Startup timing is intentionally separate from AI conversation traces; it does not alter trace fields or retention.

## Interpretation

- `splash-mounted`: first committed splash effect, not an exact pixel-render timestamp
- `auth-session`, `consent`, `preferences`: observed pending intervals at the React boundaries. Resolution can lead to onboarding or a signed-out view; success does not mean consent was granted
- `memory`: context repository initialization, including transaction wait
- `profile`: authentication repository restore, including its profile read/required write
- `plans`, `actuals`, `day-notes`, `month-events`, `todos`, `subjects`, `materials`, `templates`, `terms`, `periods`: separately measured repository calls. These already run in parallel; do not sum them to infer critical-path duration
- `timetable-write`: canonicalization persistence call after the initial reads, not the pure transformation's CPU time
- `bootstrap`: profile plus planner initialization. Error outcomes preserve the existing error handling/release behavior
- `home-visible`: first animation-frame observation of a connected, laid-out Home with no splash. It approximates first usable Home, not a browser paint or complete image/font load metric

A Home layout may contain recovery/error UI; inspect bootstrap/read outcomes before saying schedules loaded successfully. A run starting signed out includes human login time and must not be compared with an authenticated reload.

Compare the first splash point to Home and inspect the spans between them. Record the exact deployed commit, browser/device and whether this is a new tab or a reload. Asset cache warmth, Firebase cache warmth and existing login are separate conditions. Production runs and development StrictMode's repeated effects are not equivalent; cancelled spans identify effect cleanup. Logged-out/onboarding runs legitimately have no `home-visible` point. A failed phase does not make the application successful merely because its splash ends.

The panel adds opt-in observation overhead, so do not present sub-millisecond differences as a user-visible speedup. Unit/deferred and synthetic local-repository browser fixtures verify measurement, error identity and ordering, not actual Firebase or mobile latency. Never put private screenshots/fixture replacements into public Issues. Publish only a manually reviewed phase timing summary with environment context.
