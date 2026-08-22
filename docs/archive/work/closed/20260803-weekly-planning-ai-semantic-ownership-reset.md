# 週間計画 AI意味理解責務の再固定

Status: completed baseline
Original date: 2026-08-03
Closed: 2026-08-11
Issue: #108
PR: #109

## 達成した契約

- raw user textの意味理解はAI semanticに置く。
- short answer、correction、creation authorization、task boundary、relative dateをdeterministic parserで再解釈してAI出力を置換しない。
- provider/validation failureから自然言語parserへfallbackしない。
- effort estimateはworkloadをformal targetとして参照できる。
- machine pending questionとformal ID bindingを使い、renderer文面から状態を逆推定しない。
- current-turnに根拠のない過去Factコピーをvalidatorで拒否する。
- no-op normalizationは意味を変えず、revisionとidempotencyを別々に扱う。
- architecture regression testで、旧semantic override helperが意味文書を生成しないことを固定した。

代表guard:

- `src/features/weeklyPlanning/semantic/weeklyPlanningSemanticOwnershipArchitecture.test.ts`
- `src/features/weeklyPlanning/semantic/weeklyPlanningSemanticEvidenceV5.test.ts`
- `src/features/weeklyPlanning/semantic/weeklyPlanningStableV5ProductionIsolation.test.ts`

## 後続

このtask完了は「semantic新機能がすべて完了した」という意味ではない。

partial semantic acceptance、ambiguity lifecycle、generic semantic turn delta等は、PR #109 merge後のlegacy削除と挙動不変リファクタ、その後の7視点再棚卸しで必要性を再評価する。

現在の順序は `docs/ai/tasks/20260811-weekly-planning-merge-cleanup-refactor-sequence.md` を正とする。
