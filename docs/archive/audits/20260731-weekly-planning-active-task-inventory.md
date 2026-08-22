# weeklyPlanning active task 全件棚卸し

Status: complete / root task placement reviewed
Date: 2026-07-31
Branch: `agent/stable-v5-tomorrow-dialogue-consistency`
PR: #107

## 1. 監査方針

`docs/ai/tasks/`直下のcurrent queue 8件を、task本文、現行コード、merge済みPR、open Issue、2026-07-31の七視点監査と照合した。

配置規則:

```text
実装と必要検証が完了したwork unit
→ tasks/closed/

別の現行taskへ吸収され、単独では実行しないwork unit
→ tasks/superseded/

独立した未完了条件が残るwork unit
→ tasks/ rootへ残し、ファイル日付と本文を現在化
```

古い日付だけを理由に未完了taskをclosedへ移さず、merge済みという理由だけでも完了扱いにしない。

## 2. 判定結果

### 2.1 今回closedへ移すtask

なし。

現在rootにある8件はいずれも、コードまたはproduction operationに未完了条件が残る。

### 2.2 root継続・2026-07-31版へ更新するtask

| 新task record | 残る問題 |
| --- | --- |
| `20260731-weekly-planning-midweek-current-time-start-boundary.md` | 当日計画をrequest時刻より前へ配置し得る |
| `20260731-weekly-planning-synced-conversation-session-store.md` | cloud正本、別端末復元、offline/conflict処理が未実装 |
| `20260731-weekly-planning-trace-privacy-and-lifecycle.md` | production secret/Rules/TTL、pagination、Issue #89確認が未完了 |
| `20260731-weekly-planning-approval-operational-rollout.md` | production Rules/TTL、Emulator、複数client確認が未完了 |
| `20260731-weekly-planning-runtime-followups.md` | generic semantic turn delta、coverage、cross-tab、末尾trace、reset cleanupが未完了 |
| `20260731-weekly-planning-personalization-rollout.md` | observation以降の学習pipelineとproduction governanceが未実装 |
| `20260731-weekly-planning-stable-v5-verification-and-cutover.md` | PR #107検証、actual AI/browser、migration/shadow/rollback/cutoverが未完了 |
| `20260731-weekly-planning-external-source-production-adapter.md` | production calendar adapter、pagination/auth/metricsが未接続 |

### 2.3 2026-07-31 semantic handoff監査の反映

PR #107で次を実装中である。

- `lastAssistantMessage`の部分一致によるquestion code推定を廃止
- question code、target fact、graph revisionを持つmachine pending question
- exact targetへのshort-answer binding
- rendererの`actionId`、`actionKind`、`questionCode`一致検証
- `明日`planningWindow omissionの一度だけのrepair

次はPR #107で完了扱いにしない。

- 全semantic fieldを扱うgeneric `SemanticTurnDelta`
- generic lifecycle applier
- evidence coverage registry
- cross-tab/server-authoritative sequence
- Issue #89 production verification

これらは更新後のruntime followups、cloud session、trace operations、verification/cutoverへ残す。

## 3. 削除・移動方針

次の旧root recordsは、新しい2026-07-31版を作成した後にrootから削除する。

- `20260716-weekly-planning-midweek-current-time-start-boundary.md`
- `20260716-weekly-planning-synced-conversation-session-store.md`
- `20260716-weekly-planning-trace-privacy-and-lifecycle.md`
- `20260718-weekly-planning-approval-operational-rollout.md`
- `20260724-weekly-planning-runtime-followups.md`
- `20260728-weekly-planning-personalization-rollout.md`
- `20260728-weekly-planning-stable-v5-verification-and-cutover.md`
- `20260728-weekly-planning-external-source-production-adapter.md`

これは完了移動ではなく、同一taskのcurrent record更新である。

## 4. 同期対象

- [ ] 8件のtask recordを2026-07-31版へ置換
- [ ] canonical roadmapを同期
- [ ] semantic V5 roadmapを同期
- [ ] current contract statusを同期
- [ ] PR #107本文を監査・構造修正scopeへ更新
- [ ] focused/full/typecheck/build後に検証状態を更新

## 5. 結論

2026-07-31時点でroot taskに「実装済みなのに閉じ忘れた独立task」は確認できなかった。問題は、未完了taskが古い日付と古い依存記述のまま残っていたことである。8件すべてを現在版へ置換し、今後は完了work unitをmerge時に`closed/`へ移すことをmerge gateへ含める。