# weeklyPlanning current contract v5

Status: canonical / Stable V5 production baseline
Updated: 2026-08-15

Canonical references:

- [current contract status](weekly-planning-current-contract-status.md)
- [runtime contract](weekly-planning-stable-v5-runtime-trial-contract.md)
- [main roadmap](strategy/weekly-planning-roadmap.md)
- [semantic roadmap](strategy/weekly-planning-semantic-v5-roadmap.md)
- [human grounding policy](tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md)
- [adaptive memory learning policy](strategy/weekly-planning-adaptive-memory-learning-policy.md)
- [test philosophy](testing/weekly-planning-test-philosophy.md)

## 1. Runtime baseline

Stable V5が唯一のproduction週間計画runtimeである。

```text
NaturalLanguageAssistant
→ machine-state semantic routing
→ focused / generic AI semantic interpretation
→ validation / optional one-shot AI repair
→ formal binding / canonical Fact Graph commit
→ readiness / proposal policy / scheduler / dialogue decision
→ AI renderer
→ preview
→ approval / save
```

legacy parser / interpreter / semantic runtimeへ戻すproduction pathを持たない。

## 2. Semantic ownership

raw user textと会話文脈の意味理解はAIが担当する。

AI:

- task / component / workload / quantity role
- effort information
- date / weekday / time intent
- recurrence / availability / relation
- correction / contextual reference
- authorization intent
- proposal accept / reject / modify
- current-only / durable等のscope意味

Deterministic application:

- schema / evidence / reference validation
- canonical IDs / formal binding
- Fact Graph lifecycle / revision / idempotency
- question / confirmation necessity
- proposal generation / lifecycle / accepted scope
- readiness
- scheduler / placement
- preview / approval / save
- persistence / recovery
- observed pace / retention / feasibility計算

AI semantic boundary以後でraw Japaneseをregex、keyword、dictionary、legacy parserにより再解釈しない。

## 3. Semantic document contract

AI出力はcurrent-turn semantic deltaであり、accepted state snapshotではない。

過去Factをcurrent deltaへ根拠なく再コピーしない。`sourceText`はcurrent user turnのevidenceを持つ。

formal IDs、revision、lifecycle mutation、scheduler decisionはAI出力に所有させない。

## 4. Date / time contract

自然言語上の時間意味をAIが構造化し、具体的なcalendar arithmeticはapplicationが行う。

- `next_week`等の意味選択: AI
- actual date range resolution: deterministic calendar resolver
- timezone / weekStartsOn / current turn time: application

selectedDateをcurrent timeの代用にしない。

利用者が明示したtime preferenceはapplication default heuristicより強い。

## 5. Fact Graph / transaction

AI documentはそのまま保存せずcanonical Fact Graphへcommitする。

- formal IDs / revisionはcoreが発行
- local IDsは一response内参照
- correction / replacementはlifecycleへ適用
- canonical commitはatomic
- validation failure時はaccepted Graph不変
- no-opではfact revisionを増やさない
- staged stateはcommit成功時のみfinalize

## 6. Readiness / proposal / scheduler

readiness、proposal necessity、scheduler placementはaccepted typed stateだけから決める。

AIはmissing slot、proposal acceptance、preview gate、placementを決めない。

proposalはscheduler commandではない。

```text
application candidate
→ renderer presents proposal
→ AI interprets user response
→ application accepts / rejects / modifies
→ accepted policy may affect scheduler
```

未了承proposalをschedulerへ適用しない。

## 7. Human grounding contract

application内部で知っていることと、ユーザーとの共通基盤にあることを区別する。

内部heuristic、一般原則、推定結果を、ユーザーも既に知っている前提で話さない。必要なら会話上へ導入し、accept / reject / modifyを受けたscopeだけshared groundとして再利用する。

`今回は`と`今後も`を別scopeとして扱う。

正常系の完成済み日本語をquestion code / proposal codeごとに固定しない。rendererはtyped decisionとgrounded contextから自然に実現する。

## 8. Effort / workload contract

教材構造、進捗量、作業速度、calendar session時間を分離する。

- page / problem: per-unit paceを利用可能
- completed workload + actual duration: observed paceへ利用可能
- unit conversion / multiplication / rounding: deterministic
- session splitting: deterministic scheduling policy
- explicit current user estimate > applicable observed evidence > cold-start heuristic

同じ情報を別表現で聞き直さない。

## 9. Adaptive memory learning contract

詳細SSoTは [Adaptive Memory Learning Policy](strategy/weekly-planning-adaptive-memory-learning-policy.md) とする。

暗記・想起中心の学習は英単語だけに限定しない。

禁止する固定behavior:

- 100語等のword-count thresholdからsession数を決める。
- word countだけから必要総時間を推測する。
- ユーザーへ総単語量のtotal duration予測を必須要求する。
- 暗記だから自動で朝・昼・夜へ配置する。
- 1日後 / 3日後 / 7日後や必ず3周をhard ruleにする。

cold startでは短いsessionや分散復習をproposalできるが、了承前に採用しない。

量・期限・availabilityから短時間だけでは必要範囲へ到達しにくい場合、新規学習を長め、復習を短く分散するmixed proposalを提示できる。

さらに現実的に不足する場合、全範囲一巡 / 範囲を絞った定着 / 目標変更等の選択肢をapplicationが提示する。

## 10. Memory contract

三種類を区別する。

### Current planning memory

そのweek / conversationで成立したFact、accepted proposal、current-only policy。

### Durable user preference

今後も利用することまで明示的に共有されたowner-scoped preference。

一回のweek-local acceptanceを自動的にdurableへ昇格させない。

### Observed learning profile

本人が明示した好みではなく、実行結果から得られた観測・derived estimate。

例:

- actual session duration
- progressed quantity
- recall success
- elapsed interval
- acquisition / reviewの処理速度差

Preferenceとobserved profileを混同しない。実績が好みと衝突する場合、好みを勝手に変更せず影響を説明して別案をproposalする。

既存owner-scoped `userPlanningContext`はdurable storage責務を持つが、learning preference / observed profile向けtyped extensionはPR #130以降の実装単位として追加する。

## 11. Preview / approval / save

previewはowner、conversation、Graph revision、source factsへ拘束する。

- stale previewを承認しない
- preview後の実変更は再preview
- no-opでは既存previewを保持
- approval / saveはdeterministic application responsibility
- duplicate / owner mismatch / stale操作を拒否

## 12. Persistence / trace

Stable V5 sessionはowner・week・conversationへ拘束する。

traceはlogical conversation identity、request / turn / revision / sourceを観測可能にする。privacy / retention contractを破らない。

## 13. Testing contract

自動テストは決定論的契約を保証する。

- schema / evidence / binding / lifecycle
- proposal lifecycle / acceptance scope
- durable promotion boundary
- readiness / scheduler / preview
- approval / save / persistence
- heuristic adversarial cases
- prompt / request budget

自然なAI返答全文を固定oracleにしない。

実AI会話はturn-by-turnで人間が読み、明確な意味誤認、共有前提違反、重複質問、誤binding、不自然な提案適用があればそのturnで停止する。

## 14. Current execution order

```text
MD / contract同期
→ stale vocabulary heuristic削除・一般化
→ proposal / acceptance typed boundary
→ current-week memory boundary
→ durable preference extension
→ observed learning evidence extension
→ adaptive review proposal
→ Luna turn-by-turn revalidation
→ prompt / repair ablation
→ final preview / Browser Regression / normal CI
```

各実装単位は targeted regression → full CI → 必要なreal API再観測をgreenにしてから次へ進む。
