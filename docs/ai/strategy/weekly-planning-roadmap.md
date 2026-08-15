# 週間計画 AI ロードマップ

Status: canonical / conversation quality, Luna simplification, adaptive learning policy
Updated: 2026-08-15

Canonical references:

- [Current status](../weekly-planning-current-contract-status.md)
- [Current contract](../weekly-planning-current-contract-v5.md)
- [Semantic V5 roadmap](weekly-planning-semantic-v5-roadmap.md)
- [Current Luna audit](../tasks/20260814-weekly-planning-conversation-quality-luna-audit.md)
- [Human grounding policy](../tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md)
- [Adaptive memory learning policy](weekly-planning-adaptive-memory-learning-policy.md)
- [Test philosophy](../testing/weekly-planning-test-philosophy.md)
- [Completed SOLID refactor roadmap](20260814-solid-refactor-roadmap.md)

## 1. 最上位設計原則

複数の意味に解釈できる自然言語の理解まではAI、意味がtyped stateとして一意になった後はapplicationが所有する。

AI:

- natural language meaning / conversation context
- contextual reference / correction
- quantity role / date-time intent
- proposal accept / reject / modify
- current-only / durable scope meaning

Application:

- schema / evidence / reference validation
- formal binding / IDs
- Fact Graph lifecycle / revision / idempotency
- confirmation necessity / question priority
- proposal lifecycle / accepted scope
- readiness / scheduler
- preview / approval / save
- persistence / recovery
- calculations / personalization evidence

raw Japaneseを後段regex / keyword / parserで再解釈しない。

## 2. Human grounding

共通基盤は内部stateだけでは成立しない。

application内部のheuristic、推奨、推定結果をユーザーも既に知っている前提で話さない。

```text
internal candidate
→ proposal / explanation becomes observable
→ user accept / reject / modify
→ accepted scope becomes shared ground
```

正常系の会話を固定質問文へ戻さない。rendererはtyped decisionとshared-ground contextから自然な発話を生成する。

## 3. Production baseline

```text
user utterance
→ machine-state semantic route
→ Luna semantic interpretation
→ validation / optional max-one repair
→ deterministic canonical commit
→ Fact Graph V5
→ readiness / proposal / scheduler / dialogue decision
→ Luna renderer
→ preview
→ approval / save
```

Stable V5が唯一のproduction runtimeであり、legacy parser / interpreterへ戻さない。

## 4. Adaptive memory learning

詳細SSoTは [Adaptive Memory Learning Policy](weekly-planning-adaptive-memory-learning-policy.md)。

暗記・想起中心の学習を英単語だけの特殊caseとして実装しない。

### Cold start

一般的なspacing / retrievalの知見から、短めsessionや分散復習をproposalできる。

15〜30分はproposal候補であり固定値ではない。1日複数回もproposalであり、自動採用しない。

### Large workload / short deadline

短いsessionだけでは必要量へ到達しにくいとapplicationが判断できる場合、

- 新規学習は比較的まとまった時間
- 復習は短く分散

というmixed planをproposalできる。

それでも現実的でない場合、

- 全範囲を一巡
- 重要範囲へ絞って定着
- 目標量 / 期限変更

等を提示してユーザーに選択させる。無理な長時間予定を自動で詰め込まない。

### Review

固定3周、固定1/3/7日、固定朝昼夜をhard ruleにしない。

本人のactual learning / recall evidenceが増えるほど一般priorを弱め、本人のpace / retentionへ適応する。

## 5. Memory roadmap

三層を維持する。

1. week / conversation memory
   - current planでacceptedされた方針。
2. durable preference
   - 今後も利用することまで明示的に共有されたowner-scoped好み。
3. observed learning profile
   - actual session / progress / recall / interval等から得た観測・derived estimate。

現在owner-scoped `userPlanningContext`は存在するが、learning preference / observed profileはtyped extensionが必要。

Preferenceとobserved profileを分ける。実績が本人の好みを勝手に書き換えない。

## 6. 現在までに完了した基盤

PR #109 / #112 / #113 / #120 / #127 / #129で以下を確立済み。

- Stable V5 production一本化
- legacy semantic/runtime path削除
- semantic責務分離
- human grounding / correction / Fact lifecycle hardening
- session / scheduler / preview / approval境界
- Browser Regression
- file-by-file SOLID refactor
- owner / conversation-scoped runtime isolation
- observed effort calibration基盤

詳細な過去refactor履歴はcompleted SOLID refactor roadmapとGit historyを参照し、このcurrent roadmapへ重複転記しない。

## 7. PR #130 active sequence

```text
1. canonical MD / contract sync
2. stale vocabulary total-duration / word-threshold / automatic-daypart inventory
3. one-element removal and regression repair
4. generic memorization proposal state
5. accept / reject / modify lifecycle
6. current-week scheduling integration
7. durable preference promotion boundary
8. observed learning evidence / derived profile
9. adaptive review proposal
10. Luna prompt / repair ablation
11. final dynamic conversation → preview
12. Browser Regression / normal CI / closeout
```

各段階で targeted regression → full CI → 必要なreal API rerunを実施し、greenになるまで次へ進まない。

## 8. Prompt simplification

Lunaの性能向上を理由にapplication safetyをAIへ移さない。

削減対象:

- schemaと重複するformat指示
- model-eraのhistorical repair scaffolding
- applicationが一意に導出できるfieldをAIへ生成させる処理
-同じ意味規則のprompt間重複

次の主要候補はfocused planning-window AI repairである。意味が既にtypedに確定しているrepresentation変換はapplicationへ寄せる。

## 9. 別scope

Issue #52の大規模weekly UI分離、Issue #115のentry routing等は独立scopeを維持する。

PR #130では新branch / 新PR / 新Issueを作らず、現在branchで会話品質・heuristic整理・prompt simplificationを完遂する。

## 10. Completion gate

- internal heuristicをshared premiseとして話さない
- proposalが了承前に適用されない
- current-only acceptanceがdurable memoryへ漏れない
- stale vocabulary-specific fixed behaviorが除去される
- adaptive memory policy向けtyped boundariesが一般化される
- prompt / request budget green
- full typecheck / Vitest / build green
- Browser Regression green
- final Luna conversationがhuman-reviewedでpreviewへ到達
