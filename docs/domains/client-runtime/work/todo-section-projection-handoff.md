# Todo section projection boundary

Status: locally characterized before/after; independent review and integration gates pending
Updated: 2026-11-03

## Ownership and alternatives

- Local branch: `refactor/todo-section-projection`.
- Base: `1fdff6dffa45b12a232c1b842a5c24d9248d12ba`.
- Scope: `TodoView.tsx`, its completed-section regression suite, and `src/lib/todoViewModel.ts`.
- Current main and all 18 open PR path sets were checked; no scope overlap.
- Historical audit retained Todo duration, lifetime and admission boundaries. Those remain unchanged. The earlier single-expression `compareUnsetTodos` wrapper remains inline; this change does not restore it.
- Actual-editor mutation consolidation was rejected because close/settlement semantics differ. Previously retained Bookshelf revision and OCR validation responsibilities were not reopened.

## Responsibility change

The component formerly owned both pure section selection/order and the mutable
editor/scheduling/pending-operation lifecycle. `groupTodoTasks` now owns the
cohesive pure projection with its three private comparison helpers. React keeps
memoization, disclosure limits, event handlers and all writes. No generic sorting
framework, extra validation, state machine or repository abstraction is added.

Owner/archive filtering, open/scheduled grouping, active-only pin priority,
missing-date/time defaults, locale comparison, descending behavior and equal-due
update ordering are unchanged. Sorting operates on filtered arrays, retaining
original task references and leaving input order untouched. Memo dependencies
remain `[sortDirection, todos, userId]`; markup and event lifetimes are untouched.

## Evidence and release gate

A public component characterization was added before production edits for owner
and archive filtering, scheduled tasks, completed pin behavior, missing due time,
equal-deadline update ties, both sort directions and no writes/input mutation.
Together with existing pin/disclosure/stable-equal-order and save/recovery tests:

- Before extraction: 4 component/integration files, 73 tests passed.
- After extraction: the same 4 files, 73 tests passed.
- Logs: `/tmp/client-todo-proof/before.log`, `/tmp/client-todo-proof/after.log`.
- App typecheck and independent source review are recorded by the integration owner.
- Full final-content integration verification, native CI and any applicable browser checks remain release gates. These focused results are not production UI verification.
- Revert the single logical change to roll back; no persisted schema or data migration.
- External publication remains held pending explicit permission following a prior upstream-push denial on the separate study-record candidate. No push or PR creation is part of this local task.
