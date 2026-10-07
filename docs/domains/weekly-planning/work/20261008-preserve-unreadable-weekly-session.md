# Preserve unreadable persisted weekly-planning sessions

Status: active (local implementation; not pushed)
Updated: 2026-10-08
Owning Issue: none yet (found during Issue #488; persisted-state validation lineage #164 / #530). Opening an Issue or commenting on #164 is pending the user's decision; until then this record is the ownership checkpoint.

## Scope
- Branch: `fix/weekly-session-preserve-unreadable`, base main `38dabae3` (worktree `WeeklySessionPreserve`, local only).
- Defect (reproduced, critic probe 11): an older build that opens a session snapshot it cannot read deletes it. `application/weeklyPlanningStableV5SessionStorage.ts` calls `removeItem` on a codec reject. The active-session index is reset, and the next save keeps the in-progress conversation (previews, drafts, history) gone. Approved plans are unaffected.
- Release unit: this fix ships and is deployed on main before Issue #488's persisted-format additions.

## Owners and next action
- Implementation: CherryHopper (patch relative to `38dabae3`).
- Adversarial review: CloudyGuericke, TanLangmuir.
- Integration and commits: HardyLamarr.
- Next action: quarantine unreadable snapshots under a key that no reader or writer overwrites (bounded). Restore them on roll-forward only when no active conversation exists for that owner and week; otherwise keep them quarantined with a typed recovery signal. Cross-build tests.
