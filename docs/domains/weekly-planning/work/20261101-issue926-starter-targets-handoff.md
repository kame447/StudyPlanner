# #926 selected starter targets — integration handoff

Status: active; owner SharpHopper, parent PurplePasteur. Issue #926 / PR #928 remain the release owners.

- Worktree branch `exp/SharpHopper`, base/HEAD `a5946cc9b82c546f253acfdf466b7ba03a380f14`; uncommitted changes for parent integration into `feat/issue926-vnext-conversation-core`.
- Scope: carry V5's typed selected plan/todo/material turn context into the VNext provider, preserve title/preview/save behavior, enable starter controls, verify scope freshness and the complete trace persistence gate.
- Parent correction: V5 does not persist selected external IDs (`weeklyPlanningPreviewBlocks.ts` sets `materialId: null`). Do not add external identity persistence, materialId projection, todo catalog I/O or repository ports.
- Architecture alternatives: (1) context only with existing strict fact references (selected: V5 behavior, smallest scope, provider/trace tests verify directly); (2) persisted task binding (would require codec/domain changes and change V5 semantics, excluded); (3) attach ID during preview conversion (would lose identity after edits and change saved fields, excluded).
- Disconfirming check: starter dates can validly be beyond the selected week (existing product E2E uses exam +7 and material +12); reject stale owner/week application/checkpoint scope, not target due dates.
- Implemented: shared V5 label-trust instruction and type through boundary, session/provider propagation, external IDs excluded from graph-reference aliases, selected turns bypass focused/Jev shortcuts, hook throw removed and availability true.
- Next: gateway pass-through (coordinating WindyFranklin reservation), focused parity/scope/strict-reference tests, full trace gate, typecheck/full tests/build; record exact results below before handoff.
- Done: all three kinds reach provider; titles and save fields match V5; absence unchanged; stale owner/week rejected; provider request survives trace/outbox/retry/Worker/truncation; required local checks green. No commits, pushes, paid APIs or deployment by child.
