# Preserve unreadable persisted weekly-planning sessions

Status: active (implementation verified; awaiting parent local integration; not pushed)
Updated: 2026-10-08
Owning Issue: none yet (found during Issue #488; persisted-state validation lineage #164 / #530). Opening an Issue or commenting on #164 is pending the user's decision; until then this record is the ownership checkpoint.

## Scope

- Branch: `fix/weekly-session-preserve-unreadable`; final patch base `d0672c3a` (ownership docs added to main `38dabae3`, production code identical).
- Implementation: CherryHopper. Integration/commits: HardyLamarr. Reviews: CloudyGuericke and TanLangmuir.
- Release unit: preserve unreadable saved conversations independently of Issue #488's format additions. Approved plans remain unchanged. No push, PR, merge or deploy authorized in this campaign.

## Result and contract

An older reader no longer loses a newer or malformed checkpoint through rejected loads, empty autosave, new conversations, direct clears, failed-save fallback or week moves. It writes and verifies an opaque quarantine copy before changing the original key. Quota/size/read-back failures keep the original and protect only that checkpoint. A current reader restores by owner/week without an index when no active conversation exists; a strictly older copy of the same conversation is stale, while other conflicts retain the copy. The authoritative behavior and bounds are in [the current contract](../architecture/current-contract-v5.md).

Synthetic regressions also cover compatibility-only saving without a runtime session and failed cleanup after verified restore. Existing storage/codec/lifecycle tests remain unchanged. Shared stored-conversation metadata uses the exact existing Owned algorithms, with no semantic interpretation changes.

## Verified checkpoint

- Exact implementation snapshot: `/private/tmp/cherryhopper-ws1-zyw3zkdt`; dependencies from package-lock via npm ci; Node 24.20.0, npm 11.19.0.
- Original seven cases failed on exact main38; two subsequent authority/restore-cleanup defects have separate red logs. Focused6: 78/78 in eight files before the final capacity control. Final `VITEST_MAX_FORKS=1 VITEST_MIN_FORKS=1 npm run verify` exited 0: fresh non-incremental app/Worker types, 753 test files / 6,093 tests passed (10 observation files / 45 tests skipped, one existing todo), production build. All 35 retention adversaries passed.
- Initial full run had two unchanged CPU-heavy 5s timeouts; both passed 44/44 with one worker and unchanged deadlines. That first run was invalidated by a code delta and is not final evidence. Final verification uses the campaign lock; it began before the lock protocol arrived and acquired the empty lock while already running.
- Build exit0; unchanged bundle gate exit0: JavaScript raw 2,238,751 / gzip 601,959 bytes (limits 2,240,000 / 602,000). No budget increase or weakened guard.
- TanLangmuir critic PASS on the initial patch and production delta75e87a8c. Real cross-build probes11/13 were rerun on the reviewed delta: a 7,544-byte #488 snapshot is quarantined and later restored byte-identically with its two previews and correct index. The critic's earlier unlocked full-suite counts used longer deadlines and are review findings, not verification evidence.
- Full evidence and final delivery hash: `/Users/Shogo/.agentstack/runtime/issue488-e2e-blocker-campaign-20261007/children/sol-ws1-preserve-unreadable-report.md`. Patch and manifest are adjacent. Parent updates this record after local integration.

## Follow-ups and next action

- The typed recovery status has no production UI consumer. Add a reviewable recovery choice later; never silently replace an active conversation.
- One newest retention slot per owner/week spans both storage kinds, as required. A newer capture replaces that week's older retained copy.
- Retention is capped per entry, with no global cross-week eviction. A synthetic quota-capacity test verifies a normal active-week save while other retained weeks occupy space, when enough storage remains.
- Next: parent and the designated READY reviewers inspect the seven owned paths, close any findings, and parent applies/commits locally. CloudyGuericke's separate READY audit is pending; the exact production delta has TanLangmuir PASS.
