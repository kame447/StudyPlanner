# Client Runtime

Status: canonical domain index
Updated: 2026-10-08

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

The requirements document is the specification; the Issue is the work-state owner. Do not duplicate the full requirements under a generic task directory.

Client-first does not imply client-authoritative shared state. Authentication, owner isolation, reconciliation, cross-device consistency and server-side security boundaries remain explicit requirements.

## Scheduled Home decoration

The ordinary pixel classroom/study scene derives its decorative student state from the displayed occurrence and the existing Home display clock. It is empty before the start. An occurrence already active on mount or return starts seated; only a start boundary observed in the current scene lifetime produces a short entry-and-seat transition. Motion disabled or reduced-motion uses a static seated state. Date, end, occurrence, owner and unmount changes cancel obsolete entry. No Plan, Actual or persistent animation flag is written; companion, cozy and minimal styles keep their existing behavior.

Regression coverage protects live entry and seating, initial active mounts, reload/navigation, hidden-page return, both local timezones, motion changes, interruption and unchanged storage. Completed implementation evidence belongs in the [scheduled-student release record](../../archive/work/closed/20261007-pixel-scheduled-student.md).

## Active UI/runtime work

These bounded UI/application checkpoints do not change the client/server authority of Issue #164:

- [Unplanned study start](work/unplanned-study-start-handoff.md): explicit linked/unplanned targets, existing timer and Actual admission; no second storage authority
