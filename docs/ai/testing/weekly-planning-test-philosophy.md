# 週間計画 AI テスト方針

Status: canonical
Updated: 2026-08-15

Canonical references:

- [Human Grounding Policy](../tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md)
- [Adaptive Memory Learning Policy](../strategy/weekly-planning-adaptive-memory-learning-policy.md)
- [Current Luna Audit](../tasks/20260814-weekly-planning-conversation-quality-luna-audit.md)

## 1. 自動テストの対象

AIの自然言語理解や自然な日本語に唯一の正解があるとは仮定しない。

自動化するのは決定論的に正誤を定義できる内部contractである。

- schema / type
- evidence / reference validity
- formal binding
- Fact Graph revision / lifecycle / idempotency
- pending question target
- proposal candidate / state / acceptance lifecycle
- acceptance scope
- current-week policy / durable preference promotion boundary
- observed learning evidence / derived calculations
- readiness / scheduler
- preview / approval / save
- persistence / recovery / trace
- safety / request budget / prompt budget

raw Japanese fixtureからdeterministic codeが意味を再解釈するtestをproduction behaviorとして追加しない。

## 2. Renderer test

AI rendererの完成済み日本語全文を正解としてassertしない。

検査するのは、

- typed application decisionとの整合
- 未根拠factを発明しない
- 未了承proposalをacceptedとして話さない
- internal heuristicをshared premiseとして扱うための誤ったmachine contextを渡さない
- action identity / safety boundary

である。

自然な表現差は許容する。

## 3. Proposal / shared-ground test

proposalを提示したことと、ユーザーが了承したことを別stateとして検査する。

必須回帰:

```text
proposal generated
≠ accepted policy
```

- 提示前にschedulerへ反映されない。
- 提示しただけでacceptedにならない。
- rejectで反映されない。
- modifyで変更内容だけが採用される。
- current-week acceptanceがdurable memoryへ自動昇格しない。
- durable scopeを明示的にacceptした場合だけowner-scoped preferenceへpromotionできる。

## 4. Adaptive memory learning test

暗記系policyでは固定文面ではなくpolicy invariantを検査する。

禁止behaviorの回帰:

- 100語等の固定word threshold
- word countだけからsession数決定
- vocabulary total durationの必須自己予測
- 暗記だから自動で朝昼夜へ配置
- 必ず3周 / 固定1-3-7日

検査対象:

- short-session proposalはcold-start候補であり未了承では適用されない。
- explicit user session lengthがgeneral heuristicより優先される。
- large workload / short deadlineではmixed acquisition-review proposalを生成できる。
- infeasible caseでは無理なscheduleを作らず方針選択へ戻せる。
- preferenceとobserved learning profileを別stateとして扱う。

## 5. Real API conversation

実APIは固定scenarioの自動quality scoreとして扱わない。

一turnずつ会話を進め、各assistant turnの後に次のuser utteranceを決める。

各turnで読むもの:

- semantic raw response
- accepted semantic delta
- validator / repair
- formal binding
- Fact Graph
- proposal / dialogue decision
- renderer output
- scheduler / preview
- trace

明確な意味誤認、文脈欠落、重複質問、誤binding、根拠のない具体化、internal heuristicをshared premiseとして話す、未了承proposalを適用する、memory scopeを越える等があればそのturnで停止する。

## 6. 原因層を直す

- semantic raw output誤り → semantic context / schema / prompt
- representation-only問題 → schema / deterministic converterを検討
- validator誤拒否 → validator
- target / identity誤り → binding / lifecycle
- proposal / question判断誤り → deterministic dialogue policy
- placement誤り → scheduler
- decisionは正しく文面だけ不自然 → renderer / renderer context
- memory scope誤り → promotion / persistence boundary

症状を隠すためraw user text regexや特定日本語専用prompt ruleを追加しない。

## 7. AI repair

通常AI semantic repairは最大1回。

意味保存を機械的に保証できるrepresentation normalizationはdeterministicに寄せてよいが、raw textを後段で再解釈しない。

## 8. Gate

重要なsemantic / proposal / scheduler / memory境界変更後は、

```text
targeted regression
→ full TypeScript / Vitest / build
→ Browser Regression when relevant
→ real API rerun when model behavior is relevant
```

をgreenにしてから次loopへ進む。

会話品質の最終意思決定は人間が行う。開発エージェントは明確な問題を先に除去し、最終real-API transcriptを人間へ提示する。
