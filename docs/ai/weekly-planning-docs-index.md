# weeklyPlanning documentation index

Status: canonical / active
最終更新: 2026-07-28
Current branch: `agent/trace-empty-session-seven-audit`

## 1. 現行判断に使用する文書

| document | role |
| --- | --- |
| [weekly-planning-stable-v5-runtime-trial-contract.md](weekly-planning-stable-v5-runtime-trial-contract.md) | Stable V5 runtime mode、browser persistence、conversation identity、rollbackの正本 |
| [weekly-planning-current-contract-v5.md](weekly-planning-current-contract-v5.md) | AI/core責務、semantic V5、scheduler、storage、traceの最優先contract |
| [weekly-planning-current-contract-status.md](weekly-planning-current-contract-status.md) | request ownership、preview、approval、trace、personalization、cloud sessionのstatus overlay |
| [strategy/weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md) | 全体current queueと依存順 |
| [strategy/weekly-planning-semantic-v5-roadmap.md](strategy/weekly-planning-semantic-v5-roadmap.md) | Stable V5 verification、migration、shadow、cutover queue |
| [strategy/weekly-planning-semantic-stable-v5-implementation-status.md](strategy/weekly-planning-semantic-stable-v5-implementation-status.md) | Stable V5実装到達点と未完了gate |
| [../architecture/weekly-planning-semantic-schema-registry.md](../architecture/weekly-planning-semantic-schema-registry.md) | semantic/Fact Graph世代と廃止条件 |
| [../architecture/weekly-planning-semantic-schema-v5.md](../architecture/weekly-planning-semantic-schema-v5.md) | Stable V5 documentとscheduler入力構造 |
| [../architecture/weekly-planning-dialogue-architecture-v5.md](../architecture/weekly-planning-dialogue-architecture-v5.md) | Fact Graph、dialogue、generic work item architecture |
| [../architecture/weekly-planning-availability-architecture-v5.md](../architecture/weekly-planning-availability-architecture-v5.md) | availability、fixed commitment、external source境界 |
| [../architecture/weekly-planning-conversation-trace.md](../architecture/weekly-planning-conversation-trace.md) | trace privacy、retention、admin exportの基礎契約 |
| [audits/20260727-stable-v5-trace-empty-session-seven-audit.md](audits/20260727-stable-v5-trace-empty-session-seven-audit.md) | 空session重複の七視点監査 |
| [audits/20260728-weekly-planning-active-task-inventory.md](audits/20260728-weekly-planning-active-task-inventory.md) | root task 18件の全件分類と配置正本 |
| [../testing/weekly-planning-roleplay-test-plan.md](../testing/weekly-planning-roleplay-test-plan.md) | roleplay scenarioとstrict contract |
| [../testing/weekly-planning-roleplay-status.md](../testing/weekly-planning-roleplay-status.md) | module、production、自動、browser verification status |

v4以前のarchitecture、旧task、過去PR本文はhistorical sourceである。現行contractと競合する記述をcurrent判断へ使用しない。

## 2. 読む順序

```text
weekly-planning-stable-v5-runtime-trial-contract.md
→ weekly-planning-current-contract-v5.md
→ weekly-planning-current-contract-status.md
→ weekly-planning-semantic-schema-registry.md
→ weekly-planning-semantic-stable-v5-implementation-status.md
→ weekly-planning-semantic-v5-roadmap.md
→ weekly-planning-roadmap.md
→ active-task-inventory.md
→ 対象active task
→ historical closed/superseded records
```

## 3. active task root

`docs/ai/tasks/`直下のtask recordは次の8件だけをcurrent execution targetとする。

### P0-P1 safety / adoption

1. [20260716-weekly-planning-midweek-current-time-start-boundary.md](tasks/20260716-weekly-planning-midweek-current-time-start-boundary.md)
   - current time以前へ配置し得るhard-safety gap
2. [20260728-weekly-planning-stable-v5-verification-and-cutover.md](tasks/20260728-weekly-planning-stable-v5-verification-and-cutover.md)
   - actual AI eval、browser roleplay、migration、shadow、rollback、cutover
3. [20260724-weekly-planning-runtime-followups.md](tasks/20260724-weekly-planning-runtime-followups.md)
   - cross-tab、grounding、final trace durability、source semantics、reset cleanup

### P1-P2 production boundaries

4. [20260716-weekly-planning-synced-conversation-session-store.md](tasks/20260716-weekly-planning-synced-conversation-session-store.md)
   - cloud authoritative conversation/Fact Graph repository
5. [20260728-weekly-planning-external-source-production-adapter.md](tasks/20260728-weekly-planning-external-source-production-adapter.md)
   - verified atomic loaderのproduction adapter接続
6. [20260716-weekly-planning-trace-privacy-and-lifecycle.md](tasks/20260716-weekly-planning-trace-privacy-and-lifecycle.md)
   - secret、deploy、TTL、delete、access、pagination、decoder、Issue #89 post-merge確認
7. [20260718-weekly-planning-approval-operational-rollout.md](tasks/20260718-weekly-planning-approval-operational-rollout.md)
   - Rules、TTL、Emulator、multi-client verification

### Later personalization

8. [20260728-weekly-planning-personalization-rollout.md](tasks/20260728-weekly-planning-personalization-rollout.md)
   - observation、reset validity、time decay、score、governance

`codex-task-guide.md`と`task-brief-template.md`はtask recordではないためrootに置く。

## 4. 直近closed record

[closed/20260727-weekly-planning-trace-empty-session-recovery.md](tasks/closed/20260727-weekly-planning-trace-empty-session-recovery.md)

最終確認:

```text
focused: 5 files / 46 tests passed
trace full: 18 files / 79 tests passed
typecheck: passed
typecheck:build: passed
production build: passed
git diff --check: passed
```

main deploy後の管理者viewer確認だけをtrace production operations taskとIssue #89へ移管した。

## 5. placement rule

```text
実装・必要検証が完了
→ tasks/closed/

未完了だが別の現行taskへ統合済み
→ tasks/superseded/

現在独立して実行する問題
→ tasks/ root
```

browser/production verificationだけが残る場合、過去のimplementation taskをrootへ残さず、現行verification/operations taskへ移管する。未実装内容を虚偽のclosedへ移さない。

## 6. 運用規則

- module implemented、runtime connected、local persisted、automated verified、browser verified、cloud synced、operationally deployedを区別する。
- 実行していないtest、build、real-eval、browser verificationを成功済みと書かない。
- runnerがstep開始前に失敗した場合はexecution infrastructure failureとcode test failureを区別する。
- trace変更時はconversation ID、local session ID、server handle、request ID、entry sequence、privacy、retention、server authorityを一つの結合境界として監査する。
- root taskを追加する場合はroadmapと本indexを同じ変更で更新する。
- task完了または統合時は同じ変更で`closed/`または`superseded/`へ移す。
- main merge後にbaseline、verification evidence、active task一覧を更新する。