# Client Runtime

Status: canonical domain index
Updated: 2026-10-09

This domain owns client-first execution, local/runtime capability boundaries, synchronization authority and the conditions under which work may move from server-mediated execution toward the client.

Canonical requirements:

- [Client-first execution requirements](spec/client-first-execution-requirements.md)

Supporting architecture:

- [Timetable owner identity](architecture/timetable-owner-identity.md) owns account-qualified canonical term IDs and bounded legacy-reference repair

- [Actual action admission](architecture/actual-action-admission.md) owns cross-surface record/material admission, immutable edit evidence, and committed reservations

- [Local planner storage access](architecture/local-planner-storage-access.md) owns the bounded local-fallback command/compensation queue and its explicit concurrency limits

- [Planner read projection recovery](architecture/planner-read-projection-recovery.md) owns local read freshness, retry and consumer leases; it does not redefine the parent requirements or their rollout status

Execution tracking:

- Issue #164
- [Deferred DayNote startup scope](work/20261009-day-note-startup-scope.md) — Issue #542; scoped verification snapshot, preserving full-read and DayNote recovery contracts
- [Firestore read load and startup investigation](work/20261008-firestore-read-load-and-startup.md) — Issue #542; verified local candidate, separated mock/Emulator/cost evidence, with browser acceptance and the separately tracked first-save Rules repair still open

The requirements document is the specification; the Issue is the work-state owner. Do not duplicate the full requirements under a generic task directory.

Other active client-runtime work:

- [Complete the Laplans startup video](work/laplans-video-completion-handoff.md): the successor to merged PR #545, under Issue #483; readiness-gated skip and full playback by default.
- [Laplans startup video](work/laplans-video-splash-handoff.md): isolated local presentation change under UI Issue #483; verification evidence and remaining browser/release gates are tracked in this one handoff.

Client-first does not imply client-authoritative shared state. Authentication, owner isolation, reconciliation, cross-device consistency and server-side security boundaries remain explicit requirements.
