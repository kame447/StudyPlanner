# weeklyPlanning current contract status

Status: canonical / Stable V5 sole runtime + PR #130 conversation-quality audit
Updated: 2026-08-16

Canonical contract: [weekly-planning-current-contract-v5.md](weekly-planning-current-contract-v5.md)
Current roadmap: [strategy/weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md)
Current PR task: [tasks/20260814-weekly-planning-conversation-quality-luna-audit.md](tasks/20260814-weekly-planning-conversation-quality-luna-audit.md)
Human grounding policy: [tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md](tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md)
Adaptive memory policy: [strategy/weekly-planning-adaptive-memory-learning-policy.md](strategy/weekly-planning-adaptive-memory-learning-policy.md)
Decision-ownership audit: [audits/20260816-pr130-decision-duplication-adversarial-audit.md](audits/20260816-pr130-decision-duplication-adversarial-audit.md)

## 1. 現在位置

Stable V5 が唯一の production 週間計画 runtime である。PR #109、#112、#113、#120、#127、#129 までで、Stable V5 主要経路、legacy runtime 削除、semantic ownership、human grounding、scheduler hardening、Browser Regression、file-by-file SOLID hardeningを main へ統合済みである。

現在は PR #130 `agent/weekly-conversation-quality-luna-audit` で、Luna による turn-by-turn real-API 会話監査、旧 model 時代の heuristic / prompt scaffolding の削減、adaptive memory policy の整理、最終 preview 会話の検証を行っている。

2026-08-16 の敵対的監査では、アプリ全体は「複雑だが構造化されている」と判定した。ただし weekly-planning conversation orchestration には decision ownership の局所的な重複があり、次の refactor ではコード行数より「同じ意味の判断が何箇所に存在するか」を主要指標とする。

## 2. 現在の architecture 判定

AI と deterministic application の責務境界そのものは崩れていない。raw user text / conversation context の意味理解は AI、schema / evidence / binding / Fact Graph lifecycle / question necessity / proposal lifecycle / readiness / scheduler / preview / approval / save / persistence / recovery / derived calculation は application が所有する。

問題は大きな層の混線ではなく、application 内部の会話 orchestration である。特に effort question、next conversational action、scheduler readiness、preview authorization compatibility で、上流の decision を下流が別 state から再導出する箇所がある。

詳細な根拠と file-level inventory は decision-ownership audit を正とし、この status 文書には重複転記しない。

## 3. 最優先の構造課題

最優先は effort-question contract の一本化である。`missing_effort_estimate` の必要性、measurement、target、memory proposal による `session_duration` override が複数層へ分散しているため、一つの typed question decision を source of truth にする必要がある。

次に、repair、proposal、memory-specific question、missing-work fallback、authorization、preview readiness の優先順位を一つの typed next-action decision へ寄せる。router は decision を再判断せず実行するだけにするのが目標である。

さらに semantic pipeline 内の scheduler compilation と planning evaluation 側の enriched authoritative compilation の二重性を整理する。前者が diagnostics 目的なら、その役割を明示して production decision の source of truth と混同しない。

preview authorization は semantic intent classification と application authorization の責務分離自体は妥当だが、`planningIntent`、`authorized`、compatibility state の `draftGenerationIntent` が近接しているため、compatibility projection を source of truth と誤認しないよう整理する。

## 4. Prompt / heuristic の現在評価

semantic prompt と dialogue prompt は、現時点では特定の日本語完成文を大量に積み上げた状態ではない。PR #130 では explanation-request regex による renderer routing も削除されており、Luna の自然な realization に寄せる方向は正しい。

したがって現在の主問題は prompt の総文字数そのものではない。prompt ablation は継続するが、より優先度が高いのは application decision ownership の重複削減である。

renderer output validation に残る date / clock / execution-claim regex は raw-user semantic parser と同一視しない。これは output guardrail なので即時削除せず、Luna one-element ablation と real-API failure / fallback 観測を根拠に判断する。

## 5. Human grounding / memory

application 内部の heuristic、推奨、推定結果を shared premise として話さない。proposal は会話上へ提示し、user accept / reject / modify を経た accepted scope だけを shared ground とする。

current week / conversation acceptance、durable user preference、observed learning profile は別 state として扱う。一回の「今回はそうして」を durable preference へ昇格させない。

暗記・想起系の詳細 policy は Adaptive Memory Learning Policy を正とする。この status 文書には固定 session 長、word threshold、review interval 等の詳細を再掲しない。

## 6. 現在までに維持する主要能力

selectedDate と実発話日時の分離、request-time not-before boundary、relative planning range grounding、active-only corrected Fact projection、proposal acceptance / rejection grounding、repair agenda、human-scale effort question、per-unit effort、session chunking、task relation ordering、existing-plan buffer、owner-scoped observed effort calibration、canonical date / weekday / clock validation、focused machine-pending semantic route、preview / approval runtime isolation は current baseline として維持する。

これらの挙動を decision-ownership cleanup のために壊さない。

## 7. PR #130 execution order

```text
MD / contract / docs index sync
→ decision-ownership adversarial inventory
→ effort-question ownership consolidation
→ next-action ownership consolidation
→ duplicate scheduler-readiness path review
→ preview-authorization compatibility review
→ remaining stale heuristic / focused-route Luna ablation
→ turn-by-turn real-API revalidation
→ final dynamic preview conversation
→ full CI / Browser Regression / closeout
```

2026-08-16 の今回作業は Markdown audit / organization のみであり、production code、test code、workflow、configuration は変更していない。

## 8. 別 scope

Issue #52 の大規模 weekly UI 責務分離と Issue #115 の raw-text regex weekly entry routing は独立 scope のまま維持する。

PR #130 本文には現在 `Closes #115` が残っているが、この status / roadmap と矛盾する。PR metadata の変更は今回の Markdown-only scope では行わないため、merge 前に PR 本文側を修正する。

privacy / personalization broader rollout、cross-device approval uniqueness、saved-preview migration 等も既存の独立 scope を維持する。
