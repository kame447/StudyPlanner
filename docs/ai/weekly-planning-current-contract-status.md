# weeklyPlanning current contract status

Status: canonical / Stable V5 sole runtime + PR #130 conversation quality audit
Updated: 2026-08-15

Canonical references:

- [current contract v5](weekly-planning-current-contract-v5.md)
- [runtime contract](weekly-planning-stable-v5-runtime-trial-contract.md)
- [main roadmap](strategy/weekly-planning-roadmap.md)
- [semantic roadmap](strategy/weekly-planning-semantic-v5-roadmap.md)
- [human grounding policy](tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md)
- [adaptive memory learning policy](strategy/weekly-planning-adaptive-memory-learning-policy.md)
- [test philosophy](testing/weekly-planning-test-philosophy.md)
- [current Luna audit](tasks/20260814-weekly-planning-conversation-quality-luna-audit.md)

## 1. 現在位置

Stable V5が唯一のproduction週間計画runtimeである。

PR #109 / #112 / #113 / #120 / #127 / #129で、Stable V5主要経路、legacy削除、semantic責務整理、human grounding、scheduler hardening、Browser Regression、file-by-file SOLID refactorをmainへ統合済みである。

現在はPR #130 `agent/weekly-conversation-quality-luna-audit`で、Lunaによる逐次実API会話監査、prompt簡素化、残heuristicの削除・一般化、最終preview確認を行っている。

## 2. AI / deterministic責務

AI:

- raw user text / conversation contextの意味理解
- task / component / quantity role
- date / weekday / time intent
- correction / contextual reference
- proposalへのaccept / reject / modification
- current-only / durable preference等のscope理解
- structured semantic candidates

Deterministic application:

- schema / evidence / reference validation
- formal binding / canonical IDs
- Fact Graph lifecycle / revision / idempotency
- confirmation necessity / question priority
- proposal candidate / lifecycle / acceptance scope
- readiness
- scheduler / placement
- preview / approval / save
- persistence / recovery / safety
- observed pace / retention等のderived calculation

raw Japaneseをregex / keyword / dictionary / legacy parserで再解釈してsemantic truthにしない。renderer textからmachine stateを逆推定しない。

## 3. Human grounding

application内部で知っているheuristicや推奨方針を、ユーザーとの共通基盤に既に入っている前提で話さない。

```text
internal heuristic
→ proposalを会話上へ提示
→ user accept / reject / modify
→ accepted scopeだけshared groundへ
```

「今回はそうして」と「今後もそうして」は別scopeとして扱う。

## 4. 暗記・想起系のcurrent contract

詳細は [Adaptive Memory Learning Policy](strategy/weekly-planning-adaptive-memory-learning-policy.md) を正本とする。

- 英単語専用の固定heuristicへ閉じない。
- 100語等の語数境界からsession数を決めない。
- 単語総量の総所要時間を必須で自己予測させない。
- 15〜30分はcold-start proposal候補であり固定規則ではない。
- 1日複数回・朝昼夜分散もproposalであり自動採用しない。
- 新規学習と復習を分離する。
- 量・期限・空き時間から短時間だけでは厳しい場合、長めの新規学習＋短い分散復習を提案できる。
- それでも期限内に難しい場合、全体一巡 / 範囲を絞る / 目標変更等を提案してユーザーに選択させる。
- 復習は固定3周や固定日程ではなく、spacing / retrievalの一般原則と本人実績から適応する。

## 5. Memory contract

三層を区別する。

1. current week / conversation state
   - 今回だけ採用したsession長、復習方針、配置方針。
2. durable user preference
   - 今後も利用することまで明示的に共有された好み。
3. observed learning profile
   - 実行時間、進捗量、想起率、経過時間等の観測から導出した本人特性。

既存`userPlanningContext`はowner-scoped durable storageを持つが、現行型は`goal_event` / `concern`中心である。learning preference / observed learning profileは今後のtyped extension対象とする。

一回のweek-local acceptanceを根拠なくdurable preferenceへ自動昇格させない。

## 6. 現在までに確立した主要能力

- selectedDateと実発話日時の分離
- request-time not-before / today past-time hard boundary
- weekStartsOn / relative planning range grounding
- active-only corrected Fact projection
- proposal acceptance / rejection grounding
- repair agenda / local self-repair
- human-scale effort questions
- page/problem per-unit effort
- session chunking / daily load distribution
- task relation ordering / cycle blocking
- timetable / existing-plan buffer
- reserve / review safety
- owner-scoped actual-derived effort calibration
- canonical date / weekday / clock validation
- focused machine-pending semantic routes
- preview / approval runtime ownershipのconversation isolation

旧vocabulary total-duration / 100-word split / automatic vocabulary daypart behaviorはcurrent designとして扱わない。残存実装はPR #130の削除・置換対象である。

## 7. PR #130 current execution

```text
MD / contract同期
→ stale vocabulary heuristic inventory
→ one-element deterministic refactor
→ targeted regression
→ full CI / Browser Regression
→ Luna turn-by-turn revalidation
→ prompt / repair ablation
→ final dynamic preview conversation
→ closeout
```

各loopでgreenになるまで次へ進まない。

## 8. 別scope

- Issue #43: request ownership browser evidence
- Issue #45: trace privacy / operational rollout
- Issue #47: personalization / cloud session authorityの broader scope
- Issue #51: cross-tab / cross-device approval uniqueness
- Issue #52: weekly planning UI責務分離
- Issue #89: trace operational verification
- Issue #115: raw-text regex weekly entry routing
- Issue #128: saved-preview compatibility migration

PR #130では新branch / 新PR / 新Issueを作らず、現在branch内で会話品質と今回確定した暗記系policyの既存heuristic整理を進める。
