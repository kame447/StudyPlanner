# Stable V5 runtime followups — superseded omnibus

Status: superseded / decomposed
Updated: 2026-08-22

This file replaces an old omnibus active task that mixed semantic delta work, cross-tab coordination, trace delivery, reset cleanup and other independent concerns.

The semantic / dialogue portions were subsequently implemented through later Stable V5 hardening and PR #157-era work. Remaining independent concerns already have explicit owners:

- Issue #45 — trace privacy / lifecycle
- Issue #47 — cloud session / personalization
- Issue #51 — approval multi-device uniqueness
- Issue #89 — trace production recovery
- Issue #164 — client-first persistence / sync / authority architecture

Do not reopen the old omnibus task. Use the current Issue and `tasks/README.md` to locate unfinished work.
