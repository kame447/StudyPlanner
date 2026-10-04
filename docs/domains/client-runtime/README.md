# Client Runtime

Status: canonical domain index
Updated: 2026-10-05

This domain owns client-first execution, local/runtime capability boundaries, synchronization authority and the conditions under which work may move from server-mediated execution toward the client.

Canonical requirements:

- [Client-first execution requirements](spec/client-first-execution-requirements.md)

Supporting architecture:

- [Local planner storage access](architecture/local-planner-storage-access.md) owns the bounded local-fallback command/compensation queue and its explicit concurrency limits

- [Planner read projection recovery](architecture/planner-read-projection-recovery.md) owns local read freshness, retry and consumer leases; it does not redefine the parent requirements or their rollout status

Execution tracking:

- Issue #164

The requirements document is the specification; the Issue is the work-state owner. Do not duplicate the full requirements under a generic task directory.

Client-first does not imply client-authoritative shared state. Authentication, owner isolation, reconciliation, cross-device consistency and server-side security boundaries remain explicit requirements.