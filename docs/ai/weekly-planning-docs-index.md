# weeklyPlanning documentation index

Status: canonical / active
最終更新: 2026-07-22
Current implementation baseline: `48fe92669b016c2e96463578df86dc79589ddc01`

## 1. 現行判断に使用する文書

| document | role |
| --- | --- |
| [weekly-planning-current-contract-status.md](weekly-planning-current-contract-status.md) | 確定済みproduct decision、現在の責務境界、実装statusの読み方 |
| [strategy/weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md) | current queue、priority、decision gate、依存順 |
| [../weekly-planning/weekly-planning-spec.md](../weekly-planning/weekly-planning-spec.md) | product goal、UX、planning principles。current contractと競合するhistorical記述は採用しない |
| [../architecture/weekly-planning-dialogue-architecture-v4.md](../architecture/weekly-planning-dialogue-architecture-v4.md) | architectureとmodule ownership。semantic ownershipはcurrent contractを優先する |
| [../testing/weekly-planning-roleplay-test-plan.md](../testing/weekly-planning-roleplay-test-plan.md) | scenario IDとstrict contract |
| [../testing/weekly-planning-roleplay-status.md](../testing/weekly-planning-roleplay-status.md) | module、production、自動検証、browser coverageのstatus |
| [weekly-planning-pipeline-guide.md](weekly-planning-pipeline-guide.md) | task作成、実装、検証の運用 |

conversation traceを扱う作業では、[../architecture/weekly-planning-conversation-trace.md](../architecture/weekly-planning-conversation-trace.md)も参照する。ただし、current contractのidentity、privacy、retention boundaryを上書きしない。

active文書間でstatus、queue、contractが競合する場合は次の順で読む。

```text
weekly-planning-current-contract-status.md
→ weekly-planning-roadmap.md
→ weekly-planning-roleplay-status.md
→ spec / architecture / roleplay test planの非競合部分
→ docs/ai/tasks/直下のactive task
→ closed / superseded / audit records
```

## 2. Current queue

current queue、priority、blocked状態、依存順は[weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md)だけを正とする。このindexではtask一覧を複製しない。

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

[weekly-planning-pr5-post-merge-status.md](weekly-planning-pr5-post-merge-status.md)はPR #5時点のhistorical snapshotであり、PR #75後のsemantic ownershipを決めるcurrent contractではない。

次のtaskは現在のproduction契約では実行しない。

- [旧AI/deterministic責務境界](tasks/superseded/20260719-weekly-planning-ai-responsibility-boundary.md)
- [旧rules end-to-end integration test](tasks/superseded/20260719-weekly-planning-rules-end-to-end-integration-test.md)
- [PR #75前のAI semantic ownership task](tasks/superseded/20260721-weekly-planning-ai-semantic-ownership.md)

長大なspec、architecture、過去task、過去PR本文には、deterministic baseline先行、AIとの属性merge、provider failure時のparser fallback、rules production経路、close/unmount cancel、旧queue等のhistorical記述が残り得る。これらはcurrent contractまたはroadmapと競合する場合に採用しない。

## 5. 運用規則

- queueはroadmapだけを正とする。
- historical、closed、superseded、audit文書から直接taskを実行しない。
- task完了時はcompletion recordを`tasks/closed/`へ残し、root taskを削除する。
- 契約変更で不要になったtaskは理由を明記して`tasks/superseded/`へ移す。
- `module implemented`、`production connected`、`automated verified`、`browser verified`、`operationally deployed`を区別する。
- PR merge後はbaseline、contract、roadmap、task placementを同期する。
- 一つの作業streamで不要なbranchを増やさず、既存branchを再利用する。
