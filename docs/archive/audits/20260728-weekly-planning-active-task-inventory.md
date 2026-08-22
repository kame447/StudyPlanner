# weeklyPlanning active task 全件棚卸し

Status: complete / placement synchronized / final automated verification passed
Date: 2026-07-28
Branch: `agent/trace-empty-session-seven-audit`

## 1. 監査範囲

`docs/ai/tasks/`直下のtask record 18件を全件確認した。次はtaskではないため配置変更対象外とする。

- `.gitkeep`
- `codex-task-guide.md`
- `task-brief-template.md`

判定は、task本文のStatusだけでなく、現行roadmap、semantic V5 roadmap、current contract、merge済みPRの変更範囲、現在の実装と未検証項目を照合して行った。

配置規則:

```text
実装・必要検証が完了したwork unit
→ tasks/closed/

未完了だが別の現行taskへ統合し、旧分割のまま実行しないwork unit
→ tasks/superseded/

現在も独立して実行する問題
→ tasks/ root
```

PRがmerge済みという理由だけではclosedにしない。逆に、実装済みtaskをbrowser verificationだけのためにrootへ残さず、残る検証を現行verification/operations taskへ移管する。

## 2. 判定・配置結果

### 2.1 closedへ移した5件

| task | 判定根拠 | 残件の移管先 |
| --- | --- | --- |
| `20260716-weekly-planning-controller-ui-responsibility-split.md` | PR #50とPR #86でapplication/controller責務を分離 | browser/cutover確認はStable V5 verification task |
| `20260716-weekly-planning-entrypoint-request-ownership.md` | request envelope、stale discard、IME、focusを実装・自動検証済み | 実browser確認はStable V5 verification task |
| `20260722-weekly-planning-external-source-atomic-retry.md` | atomic success/failure、retry、validationをPR #77で実装・自動検証済み | production adapter task |
| `20260722-weekly-planning-specific-date-and-personalization-profile.md` | task date rule、scheduler input、profile schema v2を実装・自動検証済み | real-eval/cutoverとpersonalization rollout |
| `20260727-weekly-planning-trace-empty-session-recovery.md` | focused 46、trace full 79、typecheck、typecheck:build、build、diff checkがfinal headで成功 | post-merge admin確認はtrace production taskとIssue #89 |

### 2.2 supersededへ移した8件

| task | 統合先 | 理由 |
| --- | --- | --- |
| `20260716-weekly-planning-consultation-reset-and-invalidation.md` | `20260728-weekly-planning-personalization-rollout.md` | cloud session・observation・profile invalidationと同じtransaction chainで実装する |
| `20260716-weekly-planning-history-feature-extraction.md` | 同上 | planning/outcome observation、version、validity、retentionを一元管理する |
| `20260716-weekly-planning-longitudinal-personalization-data-governance.md` | 同上 | foundation済み部分と未実装operationが混在していた |
| `20260716-weekly-planning-user-profile-time-decay.md` | 同上 | observation schema前提の後続phaseである |
| `20260716-weekly-planning-personalized-placement-scoring.md` | 同上 | profile aggregation後の後続phaseである |
| `20260716-weekly-planning-trace-scalability-and-schema-migration.md` | `20260716-weekly-planning-trace-privacy-and-lifecycle.md` | pagination、decoder、archive、indexはtrace operationと同じ保存境界で扱う |
| `20260722-weekly-planning-generic-semantic-v5-migration.md` | `20260728-weekly-planning-stable-v5-verification-and-cutover.md` | runtime接続済みで、残件はreal-eval、migration、shadow、cutoverである |
| `20260722-weekly-planning-v5-date-real-eval.md` | 同上 | Alpha/V2専用記録をStable V5 actual AI evalへ統合した |

### 2.3 rootに残して現状へ修正した5件

| task | 現在残る問題 |
| --- | --- |
| `20260716-weekly-planning-midweek-current-time-start-boundary.md` | Stable V5 schedulerが現在時刻より前を除外していない |
| `20260716-weekly-planning-synced-conversation-session-store.md` | 別端末・cloud revision・offline conflictが未実装 |
| `20260716-weekly-planning-trace-privacy-and-lifecycle.md` | production deploy、TTL、削除、pagination、privacy/legal、Issue #89 post-merge確認が未完了 |
| `20260718-weekly-planning-approval-operational-rollout.md` | production Rules/TTL、Emulator、multi-client確認が未完了 |
| `20260724-weekly-planning-runtime-followups.md` | cross-tab、grounding、final trace durability、source semantics、reset cleanupが未完了 |

### 2.4 rootへ追加した統合task 3件

| task | 役割 |
| --- | --- |
| `20260728-weekly-planning-personalization-rollout.md` | observation、reset propagation、time decay、score、consent/retentionを依存順で一元管理 |
| `20260728-weekly-planning-stable-v5-verification-and-cutover.md` | actual AI real-eval、browser roleplay、migration、shadow、rollback、default cutoverを一元管理 |
| `20260728-weekly-planning-external-source-production-adapter.md` | atomic loaderを実calendar adapterとproduction metricsへ接続 |

## 3. 整理後のroot task一覧

`docs/ai/tasks/`直下のtask recordは次の8件だけである。

1. `20260716-weekly-planning-midweek-current-time-start-boundary.md`
2. `20260716-weekly-planning-synced-conversation-session-store.md`
3. `20260716-weekly-planning-trace-privacy-and-lifecycle.md`
4. `20260718-weekly-planning-approval-operational-rollout.md`
5. `20260724-weekly-planning-runtime-followups.md`
6. `20260728-weekly-planning-personalization-rollout.md`
7. `20260728-weekly-planning-stable-v5-verification-and-cutover.md`
8. `20260728-weekly-planning-external-source-production-adapter.md`

## 4. Trace empty-session最終verification

2026-07-28、利用者環境でfinal branch headを実行した。

```text
focused verification:
  Test Files 5 passed
  Tests 46 passed

trace directory full:
  Test Files 18 passed
  Tests 79 passed

npm run typecheck:
  passed

npm run typecheck:build:
  passed

npm run build:
  passed

git diff --check origin/main...HEAD:
  passed (no output)
```

Buildのdynamic/static importと500KB chunk warningは非blockerである。Test中のcursor persistence warningとinjected write failureは失敗回復fixtureで意図的に発生し、全assertionは成功した。

## 5. 同期結果

- [x] 18件すべてを分類
- [x] closed 5件を移動
- [x] superseded 8件を移動
- [x] root継続5件を現行contractへ更新
- [x] 統合task 3件を追加
- [x] roadmapをactive 8件へ同期
- [x] semantic V5 roadmapを同期
- [x] docs indexを同期
- [x] current contract statusを同期
- [x] trace focused/full/typecheck/typecheck:build/build/diff checkがfinal headでgreen
- [x] trace implementation taskをclosedへ移動
- [ ] main deploy後にIssue #89のsame-conversation admin確認

Issue #89は最後の実環境確認が完了するまでopenを維持する。