# 週間計画 Stable V5 マージ・整理・リファクタ順序

Status: active / Phase 3 legacy cleanup
Date: 2026-08-11
Issue: #108
Baseline merge: PR #109
Cleanup branch: `cleanup/weekly-planning-legacy-removal`

## 目的

Stable V5主要経路を基準線として固定し、「legacy削除」「リファクタ」「新規改善」を混ぜない。

順番を変更しない。

```text
1. PR #109 merge-readiness確定        完了
2. PR #109をmainへsquash merge       完了
3. legacy / 過去経路削除             進行中
4. Stable V5挙動不変リファクタ       未着手
5. 7視点でゼロベース再棚卸し        未着手
6. 新規会話品質改善・機能追加        未着手
```

## 非交渉ルール

- Phase 3とPhase 4を同じPRへ混ぜない。
- Phase 3では利用者向け挙動を意図的に改善しない。
- Phase 4では原則public behaviorを変えない。
- AI意味理解責務をdeterministic parserへ戻さない。
- AIの自然さ・意味理解に固定期待文面を置く自動testを復活させない。
- 旧経路は名前ではなくdependency reachabilityと現在のmigration/test-support必要性で分類する。
- cleanup/refactor中に見つけた新しい仕様問題はPhase 5 backlogへ記録する。データ破壊・security・save不整合等のBLOCKERだけは例外。

## Phase 1: merge-readiness — 完了

PR #109の機能追加を凍結し、実API主要経路、preview訂正、re-preview、no-op、checkpoint、approval境界、typecheck、full Vitest、build、dependencyを監査した。

## Phase 2: merge — 完了

PR #109は監査済みheadをsquash mergeした。merge後main CIもgreen確認後にPhase 3へ進んだ。

## Phase 3: legacy / 過去経路削除 — 進行中

独立branch / PRで実施する。構造改善を混ぜない。

分類:

```text
A. productionから到達不能かつ現行test-supportにも不要
   → 削除

B. productionから到達不能だがobservation/test-supportに必要
   → 残す。Phase 4で隔離・命名整理可能

C. productionが参照、または既存data migrationに必要
   → legacyという名前だけでは削除しない
```

### 完了済みcleanup batch

- weeklyPlanningTurnExecutorの到達不能legacy branch削除
- old interpreter / parser fallback / semantic V1/V2 cluster削除
- fixed runtime mode selector / runtime mode change event削除
- runtime modeを前提にした設定・test injection削除
- production-unreachable semantic/cutover prototype群削除
- prototypeだけを検証していた旧test / foundation entry削除
- obsolete fixed real-API quality eval / model comparison workflow削除済みを再確認
- current docsをStable V5 sole runtime前提へ更新

各大規模batchはtargeted regressions、typecheck、conversation foundation、full regression、production buildがgreenになった後だけbranchへ固定している。

### Phase 3で残すもの

- human-guided observation checkpoint helper
- trace in-memory repository等の現行test-support
- 旧保存dataを安全に読むmigration decoder
- approval ledger / owner migration
- current trace/exportが既存formatを読むために必要なdecoder
- productionから現に参照されるStable V5 core

### Phase 3終了前の確認

- production reachabilityを再計算する。
- runtime mode / old interpreter / parser fallback / semantic experiment markerを再検索する。
- production-unreachable non-testがB分類だけであることを確認する。
- obsolete canonical migration/status docsを削除する。
- current docs内に`default runtime=legacy`等の廃止済み前提が残らないことを確認する。
- full CI、typecheck、buildをgreenにする。
- cleanup PRを7視点監査する。

## Phase 4: 挙動不変リファクタ — Phase 3 merge後のみ

mainのcleanup mergeとmain CI成功後に新branchを作る。

重点対象:

- semantic orchestration / focused vs generic semantic
- prompt責務とbudget
- validator chain / evidence validation
- existing entity binding / canonicalization / no-op detection
- Fact Graph mutation / revision / idempotency
- readiness / scheduler / preview lifecycle
- application executor / reducer / persistence
- dialogue decision / renderer contract
- fixture builder / 重複test setup
- `Legacy`等の歴史的命名が現行coreに残る場合のrename

受け入れ条件:

- public contractを変えない。
- AI意味理解責務を変えない。
- prompt budgetを悪化させない。
- deterministic regressionを減らさない。
- productionへ削除済みlegacy dependencyを再導入しない。

## Phase 5: 7視点再棚卸し

cleanup + refactor後のmainを新基準線としてゼロベース監査する。

1. AI意味理解責務 / orchestration / prompt
2. state / Fact Graph / revision / idempotency
3. dialogue / pending question / renderer
4. scheduler / preview / correction / approval / save
5. test妥当性 / 古い期待 / 過学習
6. trace / checkpoint / persistence / recovery
7. CI / dependency / deployment / operational safety

古いroadmapの未完了項目を無条件に引き継がず、現コードと現在のプロダクト目標からbacklogを再構成する。

## Phase 6: 新規改善

Phase 5で確定したbacklogだけから着手する。partial semantic acceptance、clarification lifecycle、cloud session、external source、personalization、focused semantic拡大等の優先順位はPhase 5で決める。

## 完了条件

このtaskはPhase 5の再棚卸し結果がcanonical roadmapとcurrent statusへ反映された時点で完了する。
