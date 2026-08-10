# 週間計画 Stable V5 マージ・整理・リファクタ順序

Status: active / canonical execution sequence
Date: 2026-08-11
Issue: #108
PR: #109

## 目的

Stable V5 の主要経路が実API会話と決定論的回帰で成立した時点を基準線として固定し、以後の整理作業で「legacy削除」「挙動変更」「リファクタ」が混ざって原因追跡不能になることを防ぐ。

このtaskは、週間計画に関する次の作業順を固定する。順番を入れ替えない。

```text
1. PR #109 を機能凍結して merge-readiness を確定
2. PR #109 を main へ merge
3. legacy / 過去経路を削除
4. Stable V5 を挙動不変でリファクタ
5. 整理後のコードを7視点で再棚卸し
6. そこで初めて新しい会話品質改善・機能追加へ戻る
```

## 非交渉ルール

- Phase 1 完了前に #109 へ新機能を追加しない。
- Phase 2 完了前に legacy 削除を始めない。
- legacy 削除とリファクタを同一PRで行わない。
- リファクタでは原則として利用者向け挙動を変えない。
- リファクタ中に見つけた新しい仕様問題は、その場で仕様変更せず Phase 5 の棚卸しへ記録する。ただしデータ破壊・セキュリティ・保存不整合などのBLOCKERは例外とする。
- 旧経路は「名前がlegacyだから」ではなく、productionから到達不能であり、Stable V5のテスト支援にも不要であることを確認して削除する。
- AI意味理解責務は全Phaseで維持する。raw user textをdeterministic codeで再解釈する経路を復活させない。
- AIの自然さや意味理解に固定期待文面を置く自動テストを復活させない。

## Phase 1: PR #109 merge-readiness

Scopeは検証・文書同期・明白なmerge blocker修正だけとする。

必須確認:

- Stable V5のみがapplicationから到達すること。
- 実APIで複数turnの意味理解、数量、所要時間、preview生成、preview訂正、再previewが成立すること。
- AIが出した曜日・時間帯がschedulerで保持されること。
- no-op turnでFact revisionを不要に増やさず、idempotency履歴は保持すること。
- previewがno-op turnで消えないこと。
- preview → draft block昇格 → approval/save application境界が決定論的に検証されていること。
- stale preview、二重承認、二重保存、reload破損を既存回帰が防ぐこと。
- semantic request、repair、rendererの責務境界が現行テスト思想と一致すること。
- typecheck、全Vitest、production build、diff checkがgreenであること。
- `npm audit` の既知脆弱性が残っていないこと、または明示的に受容判断されていること。
- PR本文、canonical roadmap、current contract statusが現在実装と一致すること。

Phase 1では、partial semantic acceptance、cloud session、personalization、外部sourceなどの未着手機能を追加しない。

## Phase 2: merge

Phase 1がgreenになったheadだけをmerge対象とする。

PR #109は履歴が大きいため、mainの履歴を汚さないためにsquash mergeを優先する。merge直前にhead SHAが監査済みSHAから動いていないことを確認する。

merge後、main上のCIを確認してからPhase 3へ進む。

## Phase 3: legacy / 過去経路削除

独立PRで実施する。目的は削除だけで、構造改善を混ぜない。

削除候補を依存グラフで分類する。

```text
A. productionから到達不能かつtest-supportにも不要 → 削除
B. productionから到達不能だがStable V5のfixture/test-supportに必要 → test-supportへ隔離
C. Stable V5がまだ参照 → legacyではないので残す、依存理由を記録
```

対象候補:

- old interpreter / old semantic experiment
- parser fallback / legacy runtime switch
- obsolete adapter / compatibility shim
- obsolete real-api fixed scenario harness
- obsolete workflow / package script
- old prompt contract / fixed wording test
- superseded task/eval documentation

削除後に全テスト・buildを通し、挙動差分がないことを確認する。

## Phase 4: 挙動不変リファクタ

独立PRで実施する。

重点対象:

- semantic orchestration / focused semantic / generic semantic の境界
- validator chain と evidence validation
- existing entity binding / canonicalization / no-op detection
- Fact Graph mutation / revision / idempotency
- readiness / scheduler / preview lifecycle
- application executor / reducer / persistence
- dialogue decision / renderer contract
- test fixture builder と重複fixture

リファクタの受け入れ条件:

- public contractとmachine stateの意味が変わらない。
- 実API用promptへscenario固有規則を増やさない。
- prompt budgetが悪化しない。
- deterministic regressionが減らない。
- production runtimeへlegacy依存を再導入しない。

## Phase 5: 7視点再棚卸し

整理後のmainを新しい基準線として、次の7視点でゼロベース監査する。

1. AI意味理解責務とorchestration
2. state / Fact Graph / revision / idempotency
3. dialogue / pending question / renderer自然性
4. scheduler / preview / correction / approval / save
5. test妥当性・古い期待・過学習
6. trace / checkpoint / persistence / recovery
7. CI / dependency / deployment / operational safety

ここで見つけた問題を、新しい優先度付きbacklogとして再構成する。古いroadmapの未完了項目を無条件に引き継がない。

## Phase 6: 新規改善再開

Phase 5で確定したbacklogから着手する。候補にはpartial semantic acceptance、clarification lifecycle、current-time boundary、cloud session、external source、personalizationなどがあるが、優先度はPhase 5の監査結果で決める。

## 完了条件

このtask自体はPhase 5の再棚卸し結果がcanonical roadmapへ反映された時点で完了とする。Phase 6の各機能は別taskで扱う。
