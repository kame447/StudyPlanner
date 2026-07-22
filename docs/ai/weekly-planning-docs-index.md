# weeklyPlanning documentation index

Status: canonical / active
最終更新: 2026-07-22
Current implementation baseline: `82bd8003a4e15180329bed158a5bff3017ac34a7`

## 1. 現行判断に使用する文書

| document | role |
| --- | --- |
| [weekly-planning-current-contract-v5.md](weekly-planning-current-contract-v5.md) | semantic v5移行の最優先contract。汎用task model、AI/core責務、移行規則 |
| [strategy/weekly-planning-semantic-v5-roadmap.md](strategy/weekly-planning-semantic-v5-roadmap.md) | semantic v5移行streamのgate、依存順、merge禁止条件 |
| [../architecture/weekly-planning-dialogue-architecture-v5.md](../architecture/weekly-planning-dialogue-architecture-v5.md) | 汎用SemanticTurnDocument、PlanningFactGraph、generic work item architecture |
| [tasks/20260722-weekly-planning-generic-semantic-v5-migration.md](tasks/20260722-weekly-planning-generic-semantic-v5-migration.md) | 現在の実装scope、チェックリスト、変更・注意点・検証記録 |
| [weekly-planning-current-contract-status.md](weekly-planning-current-contract-status.md) | request ownership、preview、approval、storage、trace、personalization等の非競合contract |
| [strategy/weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md) | semantic v5以外のcurrent queue、priority、data governance、運用依存順 |
| [../weekly-planning/weekly-planning-spec.md](../weekly-planning/weekly-planning-spec.md) | product goal、UX、planning principles。v5 contractと競合するhistorical記述は採用しない |
| [../testing/weekly-planning-roleplay-test-plan.md](../testing/weekly-planning-roleplay-test-plan.md) | scenario IDとstrict contract |
| [../testing/weekly-planning-roleplay-status.md](../testing/weekly-planning-roleplay-status.md) | module、production、自動検証、browser coverageのstatus |
| [weekly-planning-pipeline-guide.md](weekly-planning-pipeline-guide.md) | task作成、実装、検証の運用 |

[../architecture/weekly-planning-dialogue-architecture-v4.md](../architecture/weekly-planning-dialogue-architecture-v4.md)はPR #75以前からの対話・preview設計のhistorical sourceである。semantic pipeline、typed command、exam compatibility、fallbackに関してはv5を優先する。

conversation traceを扱う作業では、[../architecture/weekly-planning-conversation-trace.md](../architecture/weekly-planning-conversation-trace.md)も参照する。ただし、v5 contractのidentity、privacy、retention boundaryを上書きしない。

active文書間でstatus、queue、contractが競合する場合は次の順で読む。

```text
weekly-planning-current-contract-v5.md
→ weekly-planning-semantic-v5-roadmap.md
→ weekly-planning-dialogue-architecture-v5.md
→ active v5 migration task
→ weekly-planning-current-contract-status.md の非競合部分
→ weekly-planning-roadmap.md の非競合queue
→ weekly-planning-roleplay-status.md
→ spec / roleplay test planの非競合部分
→ closed / superseded / audit records
```

## 2. Current queue

semantic v5移行のqueue、gate、依存順は[weekly-planning-semantic-v5-roadmap.md](strategy/weekly-planning-semantic-v5-roadmap.md)を正とする。それ以外のcurrent queueは[weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md)を正とする。このindexではtask一覧を複製しない。

`docs/ai/tasks/`直下には未完了taskだけを置く。完了済みtaskは`tasks/closed/`、契約変更で実行対象外になったtaskは`tasks/superseded/`へ移す。

## 3. 主要な完了記録

- [PR #75: AI-only semantic boundary and seven-audit completion](tasks/closed/20260722-weekly-planning-ai-only-semantic-boundary-and-seven-audit.md)
- [PR #68 final audit fix plan](tasks/closed/20260720-pr68-final-audit-fix-plan.md)
- [trace server-authoritative structural IDs](tasks/closed/20260721-weekly-planning-trace-server-authoritative-ids.md)
- [personalization foundation](tasks/closed/20260718-weekly-planning-personalization-foundation.md)
- [approval persistence and idempotency](tasks/closed/20260716-weekly-planning-approval-persistence-and-idempotency.md)
- [application behavior tests](tasks/closed/20260718-weekly-planning-application-behavior-tests.md)
- [validation session binding](tasks/closed/20260718-weekly-planning-approval-validation-session-binding.md)
- [save side-effect isolation](tasks/closed/20260718-weekly-planning-approval-save-side-effect-isolation.md)
- [in-flight interruption](tasks/closed/20260718-weekly-planning-approval-inflight-interruption.md)
- [restored draft lifecycle](tasks/closed/20260718-weekly-planning-restored-draft-approval-lifecycle.md)
- [user-boundary storage guard](tasks/closed/20260718-weekly-planning-user-boundary-storage-guard.md)

## 4. Historical and superseded records

[weekly-planning-pr5-post-merge-status.md](weekly-planning-pr5-post-merge-status.md)はPR #5時点のhistorical snapshotであり、現在のsemantic ownershipを決めるcontractではない。

次のtaskは現在のproduction契約では実行しない。

- [旧AI/deterministic責務境界](tasks/superseded/20260719-weekly-planning-ai-responsibility-boundary.md)
- [旧rules end-to-end integration test](tasks/superseded/20260719-weekly-planning-rules-end-to-end-integration-test.md)
- [PR #75前のAI semantic ownership task](tasks/superseded/20260721-weekly-planning-ai-semantic-ownership.md)

長大なspec、v4 architecture、過去task、過去PR本文には、typed command、deterministic baseline先行、AIとの属性merge、provider failure時parser fallback、exam専用state/scheduler、close/unmount cancel、旧queue等のhistorical記述が残り得る。これらはv5 contractまたはv5 roadmapと競合する場合に採用しない。

## 5. 運用規則

- semantic v5の実装前後でcurrent contract v5、architecture v5、v5 roadmap、active task MDを確認する。
- 各作業単位の変更、判断、注意点、検証結果をactive task MDへ記録する。
- queueは対応するroadmapだけを正とする。
- historical、closed、superseded、audit文書から直接taskを実行しない。
- task完了時はcompletion recordを`tasks/closed/`へ残し、root taskを削除する。
- 契約変更で不要になったtaskは理由を明記して`tasks/superseded/`へ移す。
- `module implemented`、`production connected`、`automated verified`、`browser verified`、`operationally deployed`を区別する。
- PR merge後はbaseline、contract、roadmap、task placementを同期する。
- 一つの作業streamで不要なbranchを増やさず、既存branchを再利用する。
