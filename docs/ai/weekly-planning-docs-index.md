# weeklyPlanning documentation index

Status: canonical / active
最終更新: 2026-07-24
Reviewed main baseline: `a669b166db30fa3f355371c089062eb5cf4e3987`

## 1. 現行判断に使用する文書

| document | role |
| --- | --- |
| [weekly-planning-stable-v5-runtime-trial-contract.md](weekly-planning-stable-v5-runtime-trial-contract.md) | Stable V5の実環境接続、local persistence、trace continuity、試用方法、rollbackの正本。接続・保存状態で競合する場合に優先 |
| [weekly-planning-current-contract-v5.md](weekly-planning-current-contract-v5.md) | semantic V5の最優先contract。汎用task、availability、AI/core責務、移行規則 |
| [../architecture/weekly-planning-semantic-schema-registry.md](../architecture/weekly-planning-semantic-schema-registry.md) | pre-V5、Alpha、Stable V5、Fact Graph世代、runtime依存、廃止条件の正本 |
| [strategy/weekly-planning-semantic-stable-v5-migration-plan.md](strategy/weekly-planning-semantic-stable-v5-migration-plan.md) | Stable V5統合、migration、shadow、rollback、compatibility gate |
| [strategy/weekly-planning-semantic-stable-v5-implementation-status.md](strategy/weekly-planning-semantic-stable-v5-implementation-status.md) | Stable V5 runtime、local persistence、trace、検証状態の実装status |
| [strategy/weekly-planning-semantic-v5-roadmap.md](strategy/weekly-planning-semantic-v5-roadmap.md) | Stable V5の検証、real-eval、shadow、migration、cutoverのgate |
| [../architecture/weekly-planning-semantic-schema-v5.md](../architecture/weekly-planning-semantic-schema-v5.md) | 意味文書、特定日、profile、scheduler入力の全体構造 |
| [../architecture/weekly-planning-dialogue-architecture-v5.md](../architecture/weekly-planning-dialogue-architecture-v5.md) | SemanticTurnDocument、PlanningFactGraph、generic work item architecture |
| [../architecture/weekly-planning-availability-architecture-v5.md](../architecture/weekly-planning-availability-architecture-v5.md) | availability、fixed commitment、external source、scheduler境界 |
| [tasks/20260722-weekly-planning-generic-semantic-v5-migration.md](tasks/20260722-weekly-planning-generic-semantic-v5-migration.md) | semantic migration streamの作業記録 |
| [tasks/20260722-weekly-planning-external-source-atomic-retry.md](tasks/20260722-weekly-planning-external-source-atomic-retry.md) | 外部予定のsuccess/failure、原子性、retry契約 |
| [tasks/20260722-weekly-planning-specific-date-and-personalization-profile.md](tasks/20260722-weekly-planning-specific-date-and-personalization-profile.md) | 一日計画、例外日、終日休み、個人最適化係数profile |
| [weekly-planning-current-contract-status.md](weekly-planning-current-contract-status.md) | request ownership、preview、approval、storage、trace、personalizationの非競合contract |
| [strategy/weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md) | semantic V5以外のcurrent queue、priority、data governance |
| [../weekly-planning/weekly-planning-spec.md](../weekly-planning/weekly-planning-spec.md) | product goal、UX、planning principles。current contractと競合するhistorical記述は採用しない |
| [../testing/weekly-planning-roleplay-test-plan.md](../testing/weekly-planning-roleplay-test-plan.md) | scenario IDとstrict contract |
| [../testing/weekly-planning-roleplay-status.md](../testing/weekly-planning-roleplay-status.md) | module、production、自動検証、browser coverageのstatus |
| [weekly-planning-pipeline-guide.md](weekly-planning-pipeline-guide.md) | task作成、実装、検証の運用 |

conversation traceを扱う作業では、[../architecture/weekly-planning-conversation-trace.md](../architecture/weekly-planning-conversation-trace.md)と[七視点監査](audits/20260724-trace-conversation-continuity/seven-view-audit.md)も参照する。ただし、Stable V5 runtime contractのidentity、persistence、privacy境界を上書きしない。

## 2. 文書優先順位

```text
weekly-planning-stable-v5-runtime-trial-contract.md
→ weekly-planning-current-contract-v5.md
→ weekly-planning-semantic-schema-registry.md
→ weekly-planning-semantic-stable-v5-migration-plan.md
→ weekly-planning-semantic-stable-v5-implementation-status.md
→ weekly-planning-semantic-v5-roadmap.md
→ schema / dialogue / availability architecture V5
→ active V5 tasks
→ weekly-planning-current-contract-status.md の非競合部分
→ weekly-planning-roadmap.md の非競合queue
→ roleplay status
→ spec / test planの非競合部分
→ closed / superseded / audit records
```

## 3. 現在の実装状態

Stable V5 direct document、strict response schema、prompt、validator、normalizer、Fact Graph V5、lifecycle、resolver、generic scheduler input、deterministic dialogue、preview schedulerを実装し、既存UIへfeature flag付きruntimeとして接続済みである。PR #77とPR #78は`main`へ統合済みであり、defaultは環境変数で変更されない限りlegacyである。

2026-07-23以後、Stable V5のconversation、Fact Graph、preview、draftはownerとweekへ拘束してlocalStorageへ同時保存される。Graph persistenceは「未実装」ではなく、同一browser profile内のlocal persistenceまで完了している。

PR #82では、同じlogical conversationがreload、runtime再初期化、idle timeout、remote repository再生成によって別physical trace sessionへ分割される問題を修正する。physical trace continuity、sequence、turn index、request dedupe、server-issued handleをconversationへ拘束する。

未完了は次である。

```text
別端末を含むcloud authoritative session store
revision conflict / offline sync / local migration
Stable V5実AI real-eval
実browser roleplay
read-only production shadow
旧state migration decoder
default cutover
Alpha runtime依存削除
trace本番TTL・削除・限定閲覧・privacy/legal review
```

## 4. Current queue

semantic V5移行のqueue、gate、依存順は[weekly-planning-semantic-v5-roadmap.md](strategy/weekly-planning-semantic-v5-roadmap.md)を正とする。schema世代と廃止条件はschema registry、Stable V5のmigrationとrollbackはmigration planを正とする。

それ以外のqueueは[weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md)を正とする。local persistence完了を、cloud synced conversation session store完了と同一視しない。

`docs/ai/tasks/`直下には未完了taskだけを置く。完了済みtaskは`tasks/closed/`、契約変更で実行対象外になったtaskは`tasks/superseded/`へ移す。

## 5. 主要な完了・監査記録

- [PR #75: AI-only semantic boundary and seven-audit completion](tasks/closed/20260722-weekly-planning-ai-only-semantic-boundary-and-seven-audit.md)
- [PR #68 final audit fix plan](tasks/closed/20260720-pr68-final-audit-fix-plan.md)
- [trace server-authoritative structural IDs](tasks/closed/20260721-weekly-planning-trace-server-authoritative-ids.md)
- [trace conversation continuity seven-view audit](audits/20260724-trace-conversation-continuity/seven-view-audit.md)
- [personalization foundation](tasks/closed/20260718-weekly-planning-personalization-foundation.md)
- [approval persistence and idempotency](tasks/closed/20260716-weekly-planning-approval-persistence-and-idempotency.md)

## 6. Historical and superseded records

`weekly-planning-pr5-post-merge-status.md`はPR #5時点のhistorical snapshotであり、現在のsemantic ownership、Stable V5 persistence、trace continuityを決めるcontractではない。

次のtaskは現在のproduction契約では実行しない。

- [旧AI/deterministic責務境界](tasks/superseded/20260719-weekly-planning-ai-responsibility-boundary.md)
- [旧rules end-to-end integration test](tasks/superseded/20260719-weekly-planning-rules-end-to-end-integration-test.md)
- [PR #75前のAI semantic ownership task](tasks/superseded/20260721-weekly-planning-ai-semantic-ownership.md)

長大なspec、V4 architecture、過去task、過去PR本文には、parser fallback、exam専用state、close/unmount cancel、Graph memory-only、会話非永続化、PR #77 Draft等のhistorical記述が残り得る。current V5 contractまたはruntime trial contractと競合する場合に採用しない。

## 7. 運用規則

```text
module implemented
runtime connected
local persistence connected
automated verified
browser verified
cloud synced
operationally deployed
```

上記を同一視しない。各作業でcanonical contract、implementation status、roadmap、active task、audit記録を同期する。PR merge後はbaseline、status、queue、task placementを更新する。一時verification workflowは結果記録後に削除する。
