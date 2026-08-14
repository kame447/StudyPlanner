# weeklyPlanning documentation index

Status: canonical / active
Updated: 2026-08-14
Current phase: Stable V5 sole-runtime structural hardening / seven-perspective audit
Current refactor branch: `agent/browser-regression-audited-integration`
Current refactor PR: #129

## 1. 現行判断に使用する正本

1. [weekly-planning-current-contract-v5.md](weekly-planning-current-contract-v5.md)
   - AI/core責務、Fact Graph、scheduler、preview、approval、persistenceの最優先contract
2. [weekly-planning-current-contract-status.md](weekly-planning-current-contract-status.md)
   - 現在フェーズと実装到達点
3. [weekly-planning-stable-v5-runtime-trial-contract.md](weekly-planning-stable-v5-runtime-trial-contract.md)
   - ファイル名はhistoricalだが、内容は現在のStable V5 sole-runtime contract
4. [strategy/weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md)
   - 週間計画全体ロードマップ
5. [strategy/weekly-planning-semantic-v5-roadmap.md](strategy/weekly-planning-semantic-v5-roadmap.md)
   - semantic固有ロードマップ
6. [testing/weekly-planning-test-philosophy.md](testing/weekly-planning-test-philosophy.md)
   - AI会話と自動テストの境界
7. [strategy/20260814-solid-refactor-roadmap.md](strategy/20260814-solid-refactor-roadmap.md)
   - 現在のfile-by-file SOLID hardening / seven-perspective audit実行ロードマップ
8. [tasks/20260814-solid-file-by-file-loop-log.md](tasks/20260814-solid-file-by-file-loop-log.md)
   - 現在のrefactor loop実行記録
9. [../architecture/weekly-planning-semantic-schema-v5.md](../architecture/weekly-planning-semantic-schema-v5.md)
   - Stable V5 semantic schema
10. [../architecture/weekly-planning-dialogue-architecture-v5.md](../architecture/weekly-planning-dialogue-architecture-v5.md)
   - dialogue / state architecture
11. [../architecture/weekly-planning-availability-architecture-v5.md](../architecture/weekly-planning-availability-architecture-v5.md)
   - availability / external constraint architecture

## 2. 読む順序

```text
current contract v5
→ current contract status
→ runtime contract
→ test philosophy
→ current SOLID refactor roadmap / loop log（構造作業時）
→ 必要なarchitecture
→ weekly-planning roadmap
→ 対象task / Issue
```

過去PR、Alpha、feature-flag trial、旧runtime、固定scenario evalの文書はhistorical sourceであり、現行判断へ使用しない。`tasks/superseded/`配下のexecution planもcurrent execution sourceとして扱わない。

## 3. Current execution order

```text
完了: PR #109 Stable V5主要経路固定
完了: PR #112 production到達不能legacy runtime/parser/interpreter削除
完了: PR #113 semantic module責務整理
完了: PR #120 human grounding / repair / scheduler / real-API hardening
完了: PR #127 audited Browser Regression suite統合
現在: PR #129 挙動不変SOLID file-by-file hardening / seven-perspective audit
次:   #52 / #115等、既存Issueとして明示された機能・architecture課題を各scopeで処理
```

PR #129では新規featureやsemantic policy変更を混ぜず、責務分離、dead surface除去、回帰修正、検証・文書同期だけを行う。

## 4. Task placement rule

```text
現在独立して実行する問題
→ docs/ai/tasks/

実装・必要検証が完了
→ docs/ai/tasks/closed/

別の現行taskへ統合済み、または過去設計としてのみ残す
→ docs/ai/tasks/superseded/
```

rootにある古いtaskの`Status: active`を無条件に信用しない。2026-08-11以前のtaskはcurrent contract / roadmap / current execution recordと照合してから実行する。

## 5. Legacy cleanup classification

コード・テスト・文書を次で分類する。

```text
A. productionから到達不能かつ現行test-supportにも不要
   → 削除

B. productionから到達不能だが現行observation/test-supportに必要
   → 残す。責務・配置・命名は挙動不変refactorで整理可能

C. productionが参照している
   → legacyという名前だけでは削除しない
```

保存migration、trace decoder、approval ledger migrationなどは既存data互換のためのC分類になり得る。旧runtimeを復活させる互換性とは区別する。

## 6. Testing rule

AI意味理解・自然さを固定期待値でPASSにしない。

自動テスト対象はschema、validation、binding、Fact Graph lifecycle、readiness、scheduler、preview、approval、save、persistence、trace、budget等の決定論的契約である。

実API会話はhuman-reviewed observationとして扱う。

refactorでは、テスト失敗を次の3分類に分ける。

1. implementation defect → production codeを修正
2. stale / incorrect test contract → current canonical contract確認後にtestを修正
3. harness boundary issue → harnessを修正

## 7. Documentation rule

- canonical文書には現在実装だけを書く。
- 完了済みmigration planをcanonicalのまま残さない。
- `default runtime=legacy`、runtime selector、fixed scenario quality eval等の廃止済み前提をcurrent docsへ残さない。
- historical filenameを互換上残す場合は、本文冒頭で現在の役割を明示する。
- roadmapとcurrent statusが競合した場合は、より新しいcurrent statusとcurrent execution recordを確認して修正する。
- `tasks/superseded/20260811-weekly-planning-merge-cleanup-refactor-sequence.md`はhistorical execution planであり、現在の実行順序を決めない。
