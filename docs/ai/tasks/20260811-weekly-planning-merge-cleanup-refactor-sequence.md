# 週間計画 Stable V5 マージ・整理・リファクタ順序

Status: active / Phase 4 behavior-preserving refactor
Date: 2026-08-11
Issue: #108
Baseline merge: PR #109
Legacy cleanup merge: PR #112
Refactor branch: `refactor/weekly-planning-stable-v5-boundaries`

## 目的

Stable V5主要経路を基準線として固定し、「legacy削除」「リファクタ」「新規改善」を混ぜない。

順番を変更しない。

```text
1. PR #109 merge-readiness確定        完了
2. PR #109をmainへsquash merge       完了
3. legacy / 過去経路削除             完了（PR #112）
4. Stable V5挙動不変リファクタ       進行中
5. 7視点でゼロベース再棚卸し        未着手
6. 新規会話品質改善・機能追加        未着手
```

## 非交渉ルール

- Phase 3とPhase 4を同じPRへ混ぜない。
- Phase 4ではpublic behavior、semantic meaning、scheduler policy、approval/save flowを意図的に変えない。
- AI意味理解責務をdeterministic parserへ戻さない。
- AIの自然さ・意味理解に固定期待文面を置く自動testを復活させない。
- refactor中に見つけた新しい仕様問題はPhase 5 backlogへ記録する。データ破壊・security・save不整合等のBLOCKERだけは例外。
- testを通すための仕様変更をrefactorとして偽装しない。

## Phase 1: merge-readiness — 完了

PR #109の機能追加を凍結し、実API主要経路、preview訂正、re-preview、no-op、checkpoint、approval境界、typecheck、full Vitest、build、dependencyを監査した。

## Phase 2: merge — 完了

PR #109は監査済みheadをsquash mergeし、merge後main CI greenを確認した。

## Phase 3: legacy / 過去経路削除 — 完了

PR #112で独立実施した。

削除済み:

- weeklyPlanningTurnExecutorの到達不能legacy branch
- old interpreter / parser fallback / old intake/dialogue pipeline
- semantic V1 / V2 experiment cluster
- runtime mode selector / runtime mode change event
- production-unreachable semantic/cutover prototypes
- 旧経路だけを支えるtest-support / fixed scenario tests
- obsolete Stable V5 migration/status docs

残したもの:

- 既存保存data migration decoder
- approval ledger / owner migration
- trace/export read compatibility
- human-guided observation checkpoint helper
- current repository/trace test-support

production reachability、legacy marker、canonical docs、dependency、typecheck、foundation、full regression、build、diff checkをgreen確認してmergeし、merge後main CIもgreen確認済み。

## Phase 4: 挙動不変リファクタ — 進行中

独立branch / PRで実施する。

重点対象:

- current validatorの歴史的`Legacy`命名とwrapper/core分離
- semantic orchestration / focused vs generic semantic
- prompt assembly / budget responsibility
- validator chain / evidence validation
- existing entity binding / canonicalization / no-op detection
- Fact Graph mutation / revision / idempotency
- readiness / scheduler / preview lifecycle
- application executor / reducer / persistence
- dialogue decision / renderer contract
- fixture builder / 重複test setup

### Phase 4で許可する変更

- rename
- pure helper extraction
- module split / module merge
- duplicate code removal
- dependency directionの明確化
- fixture builder導入
- type/interface整理
-同じ入力に同じmachine結果を返す範囲の内部実装整理

### Phase 4で禁止する変更

- semantic promptへ新しい意味規則を追加
- focused semanticの適用範囲拡大
- validatorのaccept/reject policy変更
- readiness優先度変更
- scheduler配置policy変更
- renderer意味契約変更
- preview / approval / save workflow変更
- migration compatibility削除

### batch gate

各batchで最低限:

1. 変更対象のdeterministic回帰
2. AI ownership境界確認
3. typecheck
4. conversation foundationへの影響確認
5. 変更範囲に応じfull regression / build
6. 7視点監査

大規模batchはgreenになるまでbranchへ固定しない。

## Phase 5: 7視点再棚卸し

Phase 4 PR mergeとmain CI成功後に開始する。

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
