# 週間計画 Stable V5 Semantic / Orchestration ロードマップ

Status: canonical / PR #130 conversation grounding and Luna simplification audit
Updated: 2026-08-15

Canonical references:

- [Main roadmap](weekly-planning-roadmap.md)
- [Current status](../weekly-planning-current-contract-status.md)
- [Current contract](../weekly-planning-current-contract-v5.md)
- [Current Luna audit](../tasks/20260814-weekly-planning-conversation-quality-luna-audit.md)
- [Human grounding policy](../tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md)
- [Adaptive memory learning policy](weekly-planning-adaptive-memory-learning-policy.md)
- [Test philosophy](../testing/weekly-planning-test-philosophy.md)

## 1. Semantic ownership

```text
raw user utterance + relevant conversation + typed machine state
→ machine-state route selection
→ focused or generic AI semantic interpretation
→ structural / evidence / reference validation
→ deterministic binding / canonicalization
→ Fact Graph V5
```

禁止:

```text
raw user utterance
→ regex / keyword / dictionary / deterministic parser
→ AI semantic meaningの補完・上書き
```

AIは複数解釈があり得る自然言語の意味理解を担当する。意味がtyped representationとして一意になった後のID、calendar arithmetic、unit conversion、lifecycle、readiness、scheduler、proposal state、preview、saveはapplicationが担当する。

## 2. Current semantic routes

```text
machine-state routing
├─ focused authorization AI
├─ focused contextual-answer AI
└─ generic open-ended semantic AI
   → normalization
   → validation
   → optional AI repair max 1
→ accepted current-turn delta
→ formal binding / correction / no-op
→ canonical Fact Graph V5
```

machine stateでexact pending targetが分かっているturnはfocused routeを優先する。focused routeでもraw textの意味解釈はAIに残す。

## 3. Dialogue / proposal semantics

PR #130では次をsemantic contractへ含める。

- proposalへのaccept / reject / modification
- `今回は` / `今週は` / `いつも` / `今後も`等のscope
- current-week policyとdurable preferenceを区別するための意味情報

applicationはproposal候補の生成とlifecycleを所有する。AI semantic layerはユーザー返答の意味を構造化するだけで、了承を勝手に確定しない。

## 4. Shared-ground boundary

application内部で知るheuristicはsemantic public stateとしてユーザーとの共通基盤に自動昇格しない。

rendererへ渡すcontextは最低限次を区別できるようにする。

- internal candidate / recommendation
- already presented proposal
- accepted current-week policy
- durable accepted preference
- observed learning evidence

これによりrendererが未共有のheuristicを「当然知っている前提」で話すことを防ぐ。

## 5. Adaptive memory learning semantic direction

詳細は [Adaptive Memory Learning Policy](weekly-planning-adaptive-memory-learning-policy.md) を正とする。

暗記・想起系は`word`だけに限定しない。教科名やtask labelのkeywordで暗記判定せず、semantic AIが学習目的・活動の意味として構造化する。

意味レイヤで必要なのは「暗記・想起中心か」「新規学習か復習か」「ユーザーがどのproposalをどう受けたか」等であり、次はAIへ返させない方向を優先する。

- scheduler用session ID
- review date arithmetic
- fixed review count
- fixed daypart placement
- total-session expansion
- durable storage ID
- personalization multiplier

これらはtyped meaningからapplicationが導出する。

## 6. Prompt complexity contract

新しいfailureを見つけてもgeneric system promptへ規則を足すことを第一選択にしない。

判断順序:

1. schemaで有限表現にできるか。
2. 意味を選び直さないdeterministic conversionか。
3. machine pending stateがexact targetを持つか。
4. AI repairが本当にsemantic再解釈を必要とするか。
5. generic AIが必要な自由入力か。

AIへ返させなくてもapplicationが一意に作れるfieldはschema / AI outputから削る方向で監査する。

## 7. Repair policy

repairは最大1回。

意味がすでに一意でrepresentationだけ直せる場合はdeterministic converterを優先する。raw user textを後段で再解析してrepairすることは禁止する。

PR #130の次のablation候補はfocused planning-window AI repairである。

- typed start/end等の十分なsemantic evidenceがある場合はapplication canonicalizationへ寄せる。
- raw `8月17日から23日`を後段AIへ再送して二度目のsemantic interpretationを行う経路は削除候補。
- typed evidence自体が欠ける場合はfail closed / uncertaintyへ戻し、raw-text parserで補わない。

## 8. Memory architecture direction

既存:

- weekly Fact Graph / episodic memory
- owner-scoped `userPlanningContext`

追加方向:

- learning preferenceをowner-scoped durable contextでtypedに扱う。
- observed learning evidenceをpreferenceと別contractで保持する。
- raw observationsからpace / retention / confidence等をdeterministicに導出する。
- one-week acceptanceをdurable preferenceへ自動昇格しない。

既存`userPlanningContext`の現行`goal_event` / `concern`へ無理に文字列詰め込みせず、責務に合うtyped extensionを設計する。

## 9. PR #130 execution order

```text
MD / contract sync
→ stale vocabulary behavior inventory
→ remove total-duration / word-count / automatic daypart assumptions
→ typed memorization proposal state
→ accept / reject / modify lifecycle
→ current-week scheduler integration
→ durable preference promotion boundary
→ observed learning evidence
→ adaptive review proposal
→ focused planning-window repair ablation
→ remaining prompt simplification
→ final Luna conversation + preview
→ Browser Regression + normal CI
```

各loopはone-element changeを基本とし、targeted regression → full CI → relevant real-API rerunをgreenにしてから次へ進む。

## 10. Acceptance gate

- raw-text semantic fallbackなし
- proposalが了承前にschedulerへ適用されない
- internal heuristicをshared premiseとしてrendererが話さない
- current-only acceptanceがdurable preferenceへ漏れない
- vocabulary-specific historical threshold / automatic daypart ruleがproductionから除去される
- prompt budget green
- focused/generic semantic regression green
- full Vitest / typecheck / build green
- Browser Regression green
- final Luna dynamic conversationがpreviewへ到達
