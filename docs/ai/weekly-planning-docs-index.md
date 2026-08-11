# weeklyPlanning documentation index

Status: canonical / active
Updated: 2026-08-11
Current phase: Phase 3 legacy cleanup
Current cleanup branch: `cleanup/weekly-planning-legacy-removal`

## 1. 現行判断に使用する正本

1. [weekly-planning-current-contract-v5.md](weekly-planning-current-contract-v5.md)
   - AI/core責務、Fact Graph、scheduler、preview、approval、persistenceの最優先contract
2. [weekly-planning-current-contract-status.md](weekly-planning-current-contract-status.md)
   - 現在フェーズと実装到達点
3. [weekly-planning-stable-v5-runtime-trial-contract.md](weekly-planning-stable-v5-runtime-trial-contract.md)
   - ファイル名はhistoricalだが、内容は現在のStable V5 sole-runtime contract
4. [strategy/weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md)
   - 全体ロードマップ
5. [strategy/weekly-planning-semantic-v5-roadmap.md](strategy/weekly-planning-semantic-v5-roadmap.md)
   - semantic固有ロードマップ
6. [testing/weekly-planning-test-philosophy.md](testing/weekly-planning-test-philosophy.md)
   - AI会話と自動テストの境界
7. [tasks/20260811-weekly-planning-merge-cleanup-refactor-sequence.md](tasks/20260811-weekly-planning-merge-cleanup-refactor-sequence.md)
   - cleanup → refactor → 7視点棚卸しの実行順序
8. [../architecture/weekly-planning-semantic-schema-v5.md](../architecture/weekly-planning-semantic-schema-v5.md)
   - Stable V5 semantic schema
9. [../architecture/weekly-planning-dialogue-architecture-v5.md](../architecture/weekly-planning-dialogue-architecture-v5.md)
   - dialogue / state architecture
10. [../architecture/weekly-planning-availability-architecture-v5.md](../architecture/weekly-planning-availability-architecture-v5.md)
   - availability / external constraint architecture

## 2. 読む順序

```text
current contract v5
→ current contract status
→ runtime contract
→ test philosophy
→ execution sequence
→ 必要なarchitecture
→ roadmap
→ 対象task
```

過去PR、Alpha、feature-flag trial、旧runtime、固定scenario evalの文書はhistorical sourceであり、現行判断へ使用しない。

## 3. Current execution order

順番を変更しない。

```text
完了: PR #109 merge-readiness
完了: PR #109 squash merge
現在: legacy / 過去経路削除
次:   Stable V5挙動不変リファクタ
次:   7視点再棚卸し
最後: 新規改善
```

legacy削除とリファクタは別PRにする。

## 4. Task placement rule

```text
現在独立して実行する問題
→ docs/ai/tasks/

実装・必要検証が完了
→ docs/ai/tasks/closed/

別の現行taskへ統合済み、または過去設計としてのみ残す
→ docs/ai/tasks/superseded/
```

rootにある古いtaskの`Status: active`を無条件に信用しない。2026-08-11以前のtaskはcurrent contract / roadmap / execution sequenceと照合してから実行する。

## 5. Legacy cleanup classification

Phase 3ではコード・テスト・文書を次で分類する。

```text
A. productionから到達不能かつ現行test-supportにも不要
   → 削除

B. productionから到達不能だが現行observation/test-supportに必要
   → 残す。Phase 4で配置・命名を整理可能

C. productionが参照している
   → legacyという名前だけでは削除しない
```

保存migration、trace decoder、approval ledger migrationなどは既存data互換のためのC分類になり得る。旧runtimeを復活させる互換性とは区別する。

## 6. Testing rule

AI意味理解・自然さを固定期待値でPASSにしない。

自動テスト対象はschema、validation、binding、Fact Graph lifecycle、readiness、scheduler、preview、approval、save、persistence、trace、budget等の決定論的契約である。

実API会話はhuman-reviewed observationとして扱う。

## 7. Documentation rule

- canonical文書には現在実装だけを書く。
- 完了済みmigration planをcanonicalのまま残さない。
- `default runtime=legacy`、runtime selector、fixed scenario quality eval等の廃止済み前提をcurrent docsへ残さない。
- historical filenameを互換上残す場合は、本文冒頭で現在の役割を明示する。
- roadmapとcurrent statusが競合した場合は、より新しいcurrent statusとexecution sequenceを確認して修正する。
- Phase 3完了時、cleanup結果をcurrent statusとexecution sequenceへ反映する。
