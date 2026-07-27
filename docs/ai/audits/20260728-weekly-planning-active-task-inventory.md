# weeklyPlanning active task 全件棚卸し

Status: complete / placement changes in progress
Date: 2026-07-28
Branch: `agent/trace-empty-session-seven-audit`
Reviewed branch baseline: `c0c728c726eb47587eac2782704673b45ad44a4a`

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

PRがmerge済みという理由だけではclosedにしない。逆に、実装済みtaskをbrowser verificationだけのためにrootへ残さず、残る検証を現行verification taskへ移管する。

## 2. 判定結果

### 2.1 closedへ移す4件

| task | 判定根拠 | 残件の移管先 |
| --- | --- | --- |
| `20260716-weekly-planning-controller-ui-responsibility-split.md` | PR #50でapplication orchestrationを抽出し、PR #86でsession lifecycle・turn application・side effectを分離した | browser/cutover確認はStable V5 verification task |
| `20260716-weekly-planning-entrypoint-request-ownership.md` | implementation record上、module・production connection・automated verificationが完了。request envelope、stale discard、IME、focusを実装済み | 実browser確認はStable V5 verification task |
| `20260722-weekly-planning-external-source-atomic-retry.md` | atomic success/failure、retry、validation、scheduler failure contractをPR #77で実装・自動検証済み | production adapterは新しいadapter task |
| `20260722-weekly-planning-specific-date-and-personalization-profile.md` | task date rule、曜日集合、resolver、scheduler input、profile schema v2のfoundationをPR #77で実装・自動検証済み | real-eval/cutoverとpersonalization rolloutへ分離 |

### 2.2 supersededへ移す8件

| task | 統合先 | 理由 |
| --- | --- | --- |
| `20260716-weekly-planning-consultation-reset-and-invalidation.md` | `20260728-weekly-planning-personalization-rollout.md` | cloud session・observation・profile invalidationと同じtransaction chainで実装する必要がある |
| `20260716-weekly-planning-history-feature-extraction.md` | 同上 | planning/outcome observationだけを単独着手せず、version・validity・retentionを一つのrolloutで管理する |
| `20260716-weekly-planning-longitudinal-personalization-data-governance.md` | 同上 | foundation済み部分と未実装の同意・TTL・削除・aggregationが混在している |
| `20260716-weekly-planning-user-profile-time-decay.md` | 同上 | observation schema未実装のため独立実行不能で、rollout phaseへ統合する |
| `20260716-weekly-planning-personalized-placement-scoring.md` | 同上 | profile aggregation後のphaseであり、独立root taskとして現在実行しない |
| `20260716-weekly-planning-trace-scalability-and-schema-migration.md` | `20260716-weekly-planning-trace-privacy-and-lifecycle.md` | pagination、decoder、archive、indexはtrace production operationの同じ保存境界で扱う |
| `20260722-weekly-planning-generic-semantic-v5-migration.md` | `20260728-weekly-planning-stable-v5-verification-and-cutover.md` | feature-flagged runtime接続は完了し、残件はreal-eval、browser roleplay、migration、shadow、cutoverである |
| `20260722-weekly-planning-v5-date-real-eval.md` | 同上 | Alpha/V2専用の旧評価記録であり、現在はStable V5全体のactual AI evalへ統合する |

### 2.3 rootに残して現状へ修正する6件

| task | 現在残る問題 |
| --- | --- |
| `20260716-weekly-planning-midweek-current-time-start-boundary.md` | Stable V5 preview schedulerが09:00開始のdate windowを使い、request時刻より前を除外していない |
| `20260716-weekly-planning-synced-conversation-session-store.md` | Stable V5 session/Fact GraphはlocalStorageのみで、別端末・cloud revision・offline conflictが未実装 |
| `20260716-weekly-planning-trace-privacy-and-lifecycle.md` | production secret、TTL、Rules/Worker deploy、削除確認、pagination、decoder、privacy/legal reviewが未完了 |
| `20260718-weekly-planning-approval-operational-rollout.md` | production Rules/TTL、Emulator、multi-client transaction確認が未完了 |
| `20260724-weekly-planning-runtime-followups.md` | cross-tab sequence、dialogue grounding、final trace durability、source semantics、reset cleanupが未完了 |
| `20260727-weekly-planning-trace-empty-session-recovery.md` | 実装済みだが、初回検証でtrace full test 1件とtypecheck 1件が失敗。修正後の再検証前 |

### 2.4 新しくrootへ置く統合task 3件

| task | 役割 |
| --- | --- |
| `20260728-weekly-planning-personalization-rollout.md` | observation、reset propagation、time decay、score、consent/retentionを依存順で一元管理 |
| `20260728-weekly-planning-stable-v5-verification-and-cutover.md` | actual AI real-eval、browser roleplay、migration、shadow、rollback、default cutoverを一元管理 |
| `20260728-weekly-planning-external-source-production-adapter.md` | 完了済みatomic loaderを実calendar adapterとproduction metricsへ接続 |

## 3. 整理後のroot task一覧

整理後、`docs/ai/tasks/`直下のtask recordは次の9件だけとする。

1. `20260716-weekly-planning-midweek-current-time-start-boundary.md`
2. `20260716-weekly-planning-synced-conversation-session-store.md`
3. `20260716-weekly-planning-trace-privacy-and-lifecycle.md`
4. `20260718-weekly-planning-approval-operational-rollout.md`
5. `20260724-weekly-planning-runtime-followups.md`
6. `20260727-weekly-planning-trace-empty-session-recovery.md`
7. `20260728-weekly-planning-personalization-rollout.md`
8. `20260728-weekly-planning-stable-v5-verification-and-cutover.md`
9. `20260728-weekly-planning-external-source-production-adapter.md`

`20260727-weekly-planning-trace-empty-session-recovery.md`は自動検証が全てgreenになった時点でclosedへ移し、rootは8件になる。

## 4. 今回のverification failure

利用者が実行した検証結果:

- focused trace: 9 files / 65 tests passed
- trace directory full: 18 files中1 file failure、79 tests中1 test failure
- `npm run typecheck`: 1 error
- `npm run typecheck:build`: passed
- `npm run build`: passed

失敗原因:

1. runtime debug stage testの独自`decodeBase64`が、新contractの`.`区切りを除去していなかった
2. remote repository testのfixture helperがunion型を返し、`internal_event`へnarrowされていなかった

production実装を戻さず、testを共通decoderと明示的`WeeklyPlanningTraceInternalEventEntry`へ合わせる。再検証が完了するまでcurrent trace taskをclosedへ移さない。

## 5. 完了条件

- 18件すべての配置が本監査表と一致する
- root task 9件のStatus、残件、依存関係、完了条件が現行Stable V5へ更新される
- closed/superseded recordが移管先を明示する
- roadmap、semantic V5 roadmap、docs indexが同じroot一覧を参照する
- trace test修正後にfocused/full/typecheck/typecheck:build/build/diff checkを再実行する
- redの状態でcurrent trace task、Issue #89、PRを完了扱いにしない