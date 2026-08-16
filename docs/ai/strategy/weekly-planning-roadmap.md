# 週間計画 AI ロードマップ

Status: canonical / execution order
Updated: 2026-08-16

Current contract: [../weekly-planning-current-contract-v5.md](../weekly-planning-current-contract-v5.md)
Current status: [../weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
Current PR task: [../tasks/20260814-weekly-planning-conversation-quality-luna-audit.md](../tasks/20260814-weekly-planning-conversation-quality-luna-audit.md)
Human grounding policy: [../tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md](../tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md)
Adaptive memory policy: [weekly-planning-adaptive-memory-learning-policy.md](weekly-planning-adaptive-memory-learning-policy.md)
Decision-ownership audit: [../audits/20260816-pr130-decision-duplication-adversarial-audit.md](../audits/20260816-pr130-decision-duplication-adversarial-audit.md)
Test philosophy: [../testing/weekly-planning-test-philosophy.md](../testing/weekly-planning-test-philosophy.md)

## 1. この roadmap の役割

この文書は architecture の詳細仕様を全文再掲する場所ではなく、現在どの順序で何を片付けるかを決める source of truth である。

AI / deterministic application の責務、Fact Graph、scheduler、preview、approval、save、persistence の契約は current contract を正とする。human grounding の詳細は Human Grounding Policy、暗記・想起系の詳細は Adaptive Memory Learning Policy を正とする。

## 2. 完了済み基盤

PR #109、#112、#113、#120、#127、#129 までで Stable V5 production 一本化、production 到達不能 legacy runtime / parser / interpreter の削除、semantic ownership 整理、human grounding / correction / Fact lifecycle hardening、scheduler / preview / approval 境界、Browser Regression、file-by-file SOLID hardening、owner / conversation isolation の主要基盤を確立した。

これらの詳細履歴は Git history と completed refactor documents を参照し、この roadmap へ重複転記しない。

## 3. 現在の architecture 評価

2026-08-16 の敵対的監査では、StudyPlanner 全体は「複雑だが構造化されている」と判定した。大きな責務境界は維持されており、全面的なスパゲッティではない。

一方、weekly-planning conversation orchestration では「同じ意味の判断が何箇所に存在するか」という観点で局所的な重複が確認された。特に effort question、next conversational action、scheduler readiness、preview authorization compatibility が次の構造 refactor の中心である。

このため PR #130 の残作業では、ファイル分割やコード行数削減だけを成功条件にしない。一つの意味判断に一つの application owner を割り当て、renderer、compatibility、trace は typed decision を再推論せず投影する構造を目標にする。

```text
semantic meaning
→ canonical typed state
→ one application decision owner
→ immutable typed decision
→ renderer / compatibility / trace projection
```

## 4. PR #130 current sequence

最初に Markdown / contract / docs index を current HEAD へ同期し、decision-ownership audit を正本として残す。これは 2026-08-16 の Markdown-only 監査で実施した。

次に effort-question contract を一本化する。`missing_effort_estimate` の必要性、measurement、target、memory proposal による `session_duration` override を一つの typed decision にまとめ、response routing、compatibility projection、renderer context、contextual answer が別 state から同じ意味を再導出しない状態を目標にする。

その次に next conversational action の ownership を整理する。repair、proposal、memory-specific question、missing-work fallback、authorization、preview readiness の優先順位を一つの policy に閉じ、router は action を選び直さず実行するだけにする。

続いて semantic pipeline 内の scheduler compilation と planning evaluation 側の enriched authoritative compilation の二重性を確認する。semantic pipeline 側が diagnostics のためだけならその役割を明示し、不要なら削除候補とする。

その後 preview authorization compatibility を整理する。semantic intent、application authorization、compatibility `draftGenerationIntent` の authority を混同しない。compatibility state は projection であり source of truth ではない状態を維持する。

これらの構造 cleanup 後に、残っている focused semantic route、repair scaffolding、renderer output guardrail を Luna one-element ablation で評価する。Luna の能力向上だけを理由に application safety を AI へ移さないが、旧 model 時代に必要だった補助経路が不要になっているなら削る。

最後に Stable V5 の過去会話を一 turn ずつ human review し、固定 transcript を quality oracle にせず dynamic real-API conversation を preview まで通す。各 assistant turn を確認してから次の user utterance を決め、明確な意味誤認、shared-premise 違反、重複質問、誤 binding、未了承 proposal 適用があればその turn で停止する。

## 5. Adaptive memory の順序

暗記・想起系は英単語専用 heuristic に戻さない。current-week acceptance、durable preference、observed learning profile を分離し、proposal は了承前に scheduler へ適用しない。

ただし decision-ownership cleanup より先に大きな adaptive memory feature を追加しない。現在の orchestration にさらに例外 branch を積み上げると、今回確認した構造負債を悪化させるためである。

既に実装済みの learning proposal / observed pace 基盤を壊さず、owner を整理した後に durable preference promotion、observed learning evidence、adaptive review proposal を進める。

## 6. Prompt simplification

semantic prompt と dialogue prompt は現時点では一般原則へかなり整理されているため、prompt の総文字数だけを複雑性指標にしない。

削減候補は、schema と重複する format 指示、model-era repair scaffolding、application が一意に導出できる representation、同じ意味規則の prompt 間重複である。

focused planning-window AI repair など、意味が既に typed evidence から一意に導出できる処理は converter 化を検討する。typed evidence 自体が不足している場合は fail closed / uncertainty に戻し、raw Japanese deterministic parser を追加しない。

renderer validation に残る Japanese regex は raw-user semantic parser と同列に削らず、typed output safety と real-API evidence を見て one-element ごとに判断する。

## 7. 検証順序

各構造変更は targeted regression を先に通し、その後 full TypeScript / Vitest / build を通す。browser behavior に関係する変更では Browser Regression を通し、model behavior に関係する変更では real API を同地点から再実行する。

exact renderer wording を自動 quality oracle にしない。自動テストは deterministic invariant、実会話は human-reviewed observation として扱う。

## 8. 別 scope

Issue #52 の大規模 weekly UI 責務分離と Issue #115 の raw-text regex weekly entry routing は PR #130 と独立 scope のまま維持する。

PR #130 本文に残る `Closes #115` は current roadmap と矛盾するため merge 前に PR metadata 側で修正する。今回の 2026-08-16 作業は Markdown-only scope のため PR 本文は変更していない。

privacy / personalization broader rollout、cross-device approval uniqueness、saved-preview migration も既存の独立 scope を維持する。

## 9. Completion gate

PR #130 を merge ready とする前に、decision-ownership audit で high-risk とした effort question と next-action orchestration の扱いが明確になっていること、Luna prompt / focused-route ablation の結論が記録されていること、final dynamic conversation が human review で preview まで到達すること、full CI と Browser Regression が green であること、current contract / status / roadmap / task / docs index が最終 HEAD と一致していることを確認する。
