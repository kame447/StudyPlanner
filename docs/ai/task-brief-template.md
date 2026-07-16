# タスクmdテンプレート（Codex向け実装ブリーフ）

`docs/ai/tasks/`に未完了taskを作るときのテンプレートである。1 taskは、単一の主原因、責務境界、完了条件を持つ中規模作業にする。分割とlifecycleは`docs/ai/weekly-planning-pipeline-guide.md`のtask設計・運用規則に従う。

- ファイル名: `docs/ai/tasks/YYYYMMDD-<slug>.md`
- rootには未完了taskだけを置く。
- 完了後は必要な結果だけを`docs/ai/tasks/closed/`のcompletion recordへ統合する。
- 以下のsectionは必須である。書くことがない場合も「なし」と明記する。

---

```markdown
# <タスクタイトル>

Status: planned
Priority: P0 | P1 | P2
Requirement IDs: <該当ID。無ければ none>

## 1. 背景

<!-- なぜ必要か。観測事実と推測を分ける。 -->

## 2. 目的

<!-- 完了時に成立する状態。 -->

## 3. 計画書との対応

- product spec:
- architecture:
- roadmap:
- test contract / Requirement ID:

## 4. Entry conditions

<!-- 着手前に必要な実装、branch、設計決定、検証済み条件。 -->

## 5. 対象ファイル

- 変更:
- 新規:
- テスト:

<!-- ここに無いfileへ変更が必要なら、実装を広げず報告する。 -->

## 6. 現在の処理経路

<!-- input → parser/interpreter → validator → adapter → reducer → scheduler/dialogue/UI の実経路を関数名つきで記載する。 -->

## 7. 確認済みの事実

<!-- code、test、trace、再現結果から確認できた事項。 -->

## 8. 未確認事項

<!-- 推測、実AI未再現、browser未確認、外部環境依存。 -->

## 9. 問題点

<!-- 仕様または責務境界へ反する点。 -->

## 10. 修正方針

<!-- どの層で直すか。自然言語解釈、normalization、validation、state transition、scheduling、renderingを混ぜない。 -->

## 11. 触らない範囲

<!-- UI、CSS、save、approval、scheduler、fallback等、明示的に対象外とするもの。 -->

## 12. 受け入れ条件

<!-- 入力、事前state、期待state/decision/outputを検証可能な形で書く。 -->

## 13. テスト観点

- unit:
- integration:
- browser/manual:
- regression:
- property/fuzz（必要な場合）:

## 14. リスク

<!-- 既存経路、fallback、migration、cost、latency、privacyへの影響。 -->

## 15. Dependencies

<!-- 先行taskと、並行変更してはいけない対象。 -->

## 16. Exit conditions

<!-- test、build、diff、browser、document sync、completion recordの条件。 -->

## 17. 実装担当への指示

1. `docs/ai/weekly-planning-docs-index.md`から現行文書を確認する。
2. `docs/ai/codex-task-guide.md`と`docs/ai/weekly-planning-pipeline-guide.md`に従う。
3. scope外へ広げず、必要なら停止条件として報告する。
4. test結果、変更file、未確認事項を最終報告へ残す。
5. git操作はユーザーから明示された場合だけ行う。
```

## completion recordへの移行

完了時は元taskをrootへ残さない。closed側には次だけを残す。

```text
Status / Completed date / commit or PR
目的
実装結果
維持した安全境界
検証結果
未完了の後続事項
参照すべきcanonical文書
```

長い実装指示や古いbranch前提を、completion recordでcurrent instructionとして再掲しない。
