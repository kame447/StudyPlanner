# AI commandの任意項目に含まれるnullを未指定へ正規化する

Status: closed
Closed: 2026-07-16
Created: 2026-07-16
Parent: `20260716-weekly-planning-conversation-hardening.md`

## 対象問題

実利用traceでは「全体を先におさらいしたいからその時間も含めたい」に対し、AI interpreterが`set_study_goal`を返したが、任意項目`amount`を`null`で出力したため`invalid-command-shape`として候補全体が拒否された。

`SetStudyGoalCommand.goal.amount`は未指定を許容しており、未指定の場合は後続で時間見積もりを確認する設計である。したがって、任意項目の`null`は意味的には未指定として扱うべきである。

## 方針

AI interpreter境界で、objectの値が`null`であるプロパティだけを再帰的に除去する。型の変換や既定値補完は行わない。

必須項目が`null`の場合もプロパティが除去されるため、既存validatorで不足として拒否される。配列内の`null`は構造を変えず、そのまま後続validatorへ渡す。

この処理は`set_study_goal`専用の例外ではなく、AI structured output全体に対するcanonicalizationとして実装する。

## 完了条件

- [x] 任意のobject propertyが`null`なら未指定として除去する
- [x] 必須項目の`null`は有効な値へ変換せず、既存validatorで拒否する
- [x] 配列要素を勝手に削除しない
- [x] `set_study_goal.goal.amount: null`を受理し、時間見積もりが必要なtaskとして保持する
- [x] 既存interpreter、validator、週間計画テストを壊さない
- [x] buildとdiff checkを通す
