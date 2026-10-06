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

## Bootstrap overlap

After accepted consent and the saved week-start preference, `PlannerAppBootstrap` restores authentication/profile and planner state concurrently with the existing memory provider initialization. The provider continues to suppress its children until its existing success/error terminal state; `AppContent`, including weekly-planning hooks and optional view preloads, therefore mounts only after memory settles. Supplied planner state is consumed rather than loaded again. The splash releases only when that content also observes bootstrap termination.

Readiness belongs to the keyed authenticated session. The bootstrap also checks the returned authentication identity against the root owner before dispatching planner reads; a mismatch waits for the root session transition rather than releasing another owner’s surface. Old bootstrap generations cannot publish readiness, notices, or restored identities after a replacement/unmount. Startup notices retain their full dismissal duration until the surface is ready. This does not skip consent, preferences, memory synchronization, planner reads, or error reporting, and does not change memory transaction or AI semantic contracts.

The overlap removes a dependency, not the remaining consent/preferences and slowest-planner-read latency. Compare exact builds in the same authenticated browser; do not promise one-second startup from deferred tests or add overlapping durations.

## Completed schedule-migration gate

Firebase schedule authority now owns the rollout-capability check and current completed-marker decision in one place. Startup uses a server-only marker read. Only an existing current-version completed marker with `fromCache === false` and `hasPendingWrites === false` skips transactional acquisition. This reuses the domain completed-state predicate; it does not claim full schema/owner validation beyond the existing authority contract. The owner-scoped document path remains unchanged.

Missing, migrating, cached/pending-write, metadata-less or unsupported snapshots still go through the existing transaction, including concurrent completion checks. Completed cutover is monotonic under current Rules; no Rules change or persistent client cache is introduced. Only permission denial from the marker capability read permits legacy rollout compatibility. Network/authentication failure and every subsequent transaction/backfill/query failure remain failures, not a reason to fall back to legacy data. The composition wrapper's redundant probe is removed.

The verified mechanism is one clean completed-marker server read instead of a probe followed by a read-only transaction with its verify commit. Missing/migrating paths retain their existing atomic work. This is one shared per-owner gate for plans and month events, not two migrations. End-to-end duration still requires real-browser measurement; do not infer milliseconds from the operation count.

## Readiness is the performance target

The separate read-only previous-schedule screen has been withdrawn. It did not establish a shorter time to usable normal Home and added an unwanted intermediate surface. Existing copies are removed best-effort on startup; no planner data is cleared, hydrated from those copies, or newly captured.

Compare alternatives using the same device, network, account, dataset, build and cache conditions. Record normal Home readiness together with successful required data reads and an ordinary working interaction. First paint, splash disappearance, stale rows or error-only Home are not substitutes. Measure several independent alternatives against a baseline before adopting a speed claim.

### 起動ロゴの寿命

認証未確定から同意・個別設定・bootstrap待ちまで、可視Splashは同じ外側の起動シェルに保つ。内側のセッションはepoch付きで分離するが、認証が確定しただけでSplashを交換しない。通常画面が準備できた時点で初めて表示を切り替える。

PR122の再発監視として、Splashの個数だけでなくcomponent/DOMの同一性をunknown-auth→verified-ownerで検証する。`splash-mounted`はmark-onceなので、診断値が1件であることだけでは再マウント不存在の証明にならない。アカウント切替・サインアウト後の新セッションは別の寿命であり、古いready通知を採用しない。
