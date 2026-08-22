# Stable V5 conversation / Fact Graph cloud session

Status: active / local persistence exists, shared authority pending
Priority: P1 architecture / persistence
Updated: 2026-08-22
Tracking: Issue #47
Architecture dependency: Issue #164

## Current state

同一 browser profile では owner / week scope の local envelope から conversation、Fact Graph、preview、draft、PlanningState 等を復元できる。

未完了なのは shared / multi-device authority であり、localStorage を別の長期正本として増やす方向では実装しない。

## Required contract

- owner + planning scope + conversation を stable identity へ拘束する
- shared revision authority を一つにする
- stale revision の silent overwrite を拒否する
- operation ID 付き retry / reconciliation へ収束する
- multi-tab / multi-device conflict を timestamp-only last-write-wins で消さない
- offline → reload → reconnect を idempotent に扱う
- preview / pending question / Graph revision を矛盾する別 truth に分離しない
- reset / invalidation / account lifecycle を explicit operation として扱う

## Remaining verification

- shared repository schema / rules
- separate-device restore
- multi-client conflict
- offline queue / reconciliation
- local migration / rollback
- retention / account deletion
- Emulator rules / concurrency
- real 2-tab / 2-device verification

storage technology、local replica、offline queue、migration の具体設計は Issue #164 の canonical requirements と整合させる。Issue #47 側だけで別 architecture を確定しない。
