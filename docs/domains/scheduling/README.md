# Scheduling domain

Status: canonical domain entry point
Updated: 2026-09-04

このdomainは、StudyPlanner内の「時間が確定した予定」のapp-wide ownershipを扱う。

## Canonical contract

- scheduled-event persistence / occurrence projection: [`architecture/scheduled-event-authority.md`](architecture/scheduled-event-authority.md)
- current operational baseline: [`roadmap/current.md`](roadmap/current.md)

Issue #278 は完了・close済み。Phase 1/2 は PR #279、Phase 3 canonical persistence は PR #282 で `main` へ統合された。Phase 3 merge commit は `4cbf7d7b18e337ff8c6903bc37211c544bf01c55`。

Firestore Rules も同merge後に repository-owned WIF workflow から本番へdeployされ、live ruleset read-backまで成功している。scheduled-event migration用のactive implementation branchは現在存在しない。

## Responsibility boundary

このdomainが所有するもの:

- 時間が確定した予定を一つのconcept / persistence authorityとして扱う責任境界
- canonical `ScheduleEvent` の共通予定情報、`busy`、recurrence、source provenance
- `ScheduleOccurrence` のidentity / time semantics / busy semantics
- month / week / day / AI availability が同じ occurrence truth を読むためのprojection contract
- legacy `Plan` / `MonthEvent` から canonical persistence へ移行する際のcutover / recovery invariants

このdomainが所有しないもの:

- Todo の未確定work lifecycle
- TimetableTemplate 自体の編集・学期・隔週ルール
- Weekly Planning 内部の意味解釈・質問・placement policy
- Actual の学習実績集計
- client/server authorityそのもの

それらは各owning domainを維持し、scheduled occurrence または確定予定の保存が必要な場所だけこのdomain boundaryへ接続する。
