# 週間計画 会話品質・Luna簡素化監査

Status: active / PR #130
Updated: 2026-08-15
Branch: `agent/weekly-conversation-quality-luna-audit`

Mandatory references:

- [Human Grounding / Dynamic Dialogue Policy](20260815-weekly-planning-human-grounding-dialogue-policy.md)
- [Adaptive Memory Learning Policy](../strategy/weekly-planning-adaptive-memory-learning-policy.md)
- [Semantic V5 Roadmap](../strategy/weekly-planning-semantic-v5-roadmap.md)
- [Current Contract](../weekly-planning-current-contract-v5.md)

## 1. 目的

Stable V5の実API会話をLunaで一turnずつ観測し、会話品質、semantic ownership、deterministic application boundary、scheduler、previewを確認する。

明確な失敗を見つけた場合は次turnへ進まず、原因層を特定して一般化した修正を行う。

同時に、旧model時代に追加されたprompt scaffolding、固定heuristic、AIへ返させなくてよいrepresentationをone-element ablationで削減する。

## 2. 固定する責務境界

AI:

- natural language / conversation meaning
- contextual reference / correction
- quantity role / date-time intent
- proposal response meaning
- scope meaning (`今回は` / `今後も` 等)

Application:

- schema / evidence / reference validation
- formal binding / IDs
- Fact Graph lifecycle / revision / idempotency
- question / confirmation necessity
- proposal candidate / acceptance lifecycle
- accepted scope
- readiness / scheduler
- preview / approval / save
- persistence / recovery
- arithmetic / calibration / learning evidence derived calculation

raw Japaneseを後段regex / keyword / parserで再解釈してAI semantic meaningを上書きしない。

## 3. Human grounding acceptance

application内部のheuristicをユーザーとの共有済み前提として話さない。

```text
internal heuristic
→ proposal becomes observable
→ accept / reject / modify
→ accepted scope only becomes shared ground
```

会話品質の確認では、ユーザーを「必要情報を最初から全部まとめてくれる人」と仮定しない。短答、省略、後出し、訂正を通常ケースとする。

## 4. 暗記・想起系policyの更新

2026-08-15の会話レビューにより、旧vocabulary policyを撤回した。

撤回対象:

- word countからtotal durationをユーザーへ予測させることを標準にする。
- 100語等の固定境界でsession数を切り替える。
- word countだけからsession数 / 語数配分を決める。
- vocabularyだから朝・昼・夜へ自動分散する。
- 3周や固定復習間隔を必須規則にする。

現在の正本:

- vocabularyだけでなく暗記・想起中心の学習全般へ一般化する。
- spacing / retrievalの一般原則をcold-start proposalとして利用する。
- 15〜30分はproposal候補であり自動採用しない。
- 1日複数回への分散もproposalとし、了承後のみ適用する。
- 新規学習と復習を分離する。
- 量・期限・空き時間から短時間だけでは不足すると判断できる場合、新規学習を長め、復習を短く分散するmixed planを提案できる。
- それでも不足する場合、全範囲一巡 / 重要範囲へ絞る / 目標変更等を提示する。
- 一般priorより本人実績を徐々に優先する。

詳細はAdaptive Memory Learning Policyを正とする。

## 5. Memory policy

三層を区別する。

1. current week / conversation accepted policy
2. durable owner-scoped user preference
3. observed learning profile

一回の`今回はそうして`をdurable preferenceへ自動昇格させない。

`今後もその方針を基本にする`ことまで共有された場合にdurableへpromotionできる。

本人が明示したpreferenceと、actual session / progress / recall等から観測したprofileを別contractにする。

## 6. これまでのLuna evidence

### 6.1 Prompt scaffolding削除

Run `31859623464`

- `fresh localIds`という内部管理向けprompt文言を削除後に実行。
- semantic call 1回。
- repair 0回。
- existing mock-exam math componentを正しく継続。
- daily 2hを正しく構造化しpreviewへ到達。

結論: AIへ内部local-ID運用を説明する冗長promptは不要。

### 6.2 Vocabulary total-duration experiments — historical only

Run `31860330719`

- 220語targetは正しく保存。
- renderer質問が「学習時間の目安」でmeasurement scopeが曖昧だった。

Run `31860578812`

- typed measurementをrendererへ渡し「合計でどれくらい時間」が明確になった。
- semantic 1 call / repair 0。

Run `31860642579`

- `180分くらいです`をfocused routeで受理。
- 74 / 73 / 73語 × 60分 + reviewで9 preview candidates。

これらは当時のtotal-duration設計が技術的に動いたevidenceではあるが、2026-08-15にproduct policy自体を変更したため、**現在のvocabulary / memorization UXのacceptance evidenceとしては使用しない**。

## 7. 現在の実装負債

文書正本とproduction codeを再同期する必要がある。

最優先inventory:

- vocabulary effort questionがtotal durationを要求する残存経路
- word workloadをtotal durationでdistributeする処理
- vocabulary専用planned session compilation
- automatic vocabulary daypart preference
- unused review-daypart heuristic
- 100-word threshold由来のhelper / test / wording
- vocabulary-specific behaviorを一般暗記policyへ移すための境界

テストを新仕様に書き換えて古いproduction regressionを隠さない。まずproduction ownerを直し、それからcontractに合わなくなったfixtureを更新する。

## 8. 次の実装loop

### Loop A — stale vocabulary behavior removal

1. current HEADを再取得。
2. vocabulary-specific total-duration / automatic placementのproduction reachabilityを棚卸し。
3. one-elementずつ撤回。
4. targeted regression。
5. full CI / Browser Regression。

このloopではまだ新しい大きなadaptive memory機能を一気に追加しない。旧仕様を安全に除去してclean baselineへ戻すことを優先する。

### Loop B — typed memorization proposal

- `memorization / recall centered`というsemantic traitをkeywordではなくAI semantic意味として扱う。
- applicationがcold-start proposal候補を生成する。
- rendererがshared-groundを壊さず自然に提示する。
- proposalは了承前にschedulerへ反映しない。

### Loop C — accept / reject / modify lifecycle

- current week / current task等のaccepted scopeをtyped stateへ保持。
- short session / spaced review / mixed acquisition-review等のpolicyを了承後だけschedulerへ渡す。

### Loop D — durable preference promotion

- existing owner-scoped user contextを一般化。
- current-only acceptanceとdurable preferenceを区別。
- 明示的durable scopeの了承後だけpromotion。

### Loop E — observed learning profile

raw observationsを保存しderived estimateを計算する。

- actual duration
- progressed quantity
- acquisition / review
- recall outcome
- elapsed interval

単一倍率だけをsource of truthにしない。

### Loop F — adaptive review

一般的なforgetting / spacing heuristicをcold-start priorにし、本人実績に応じてinterval proposalを伸縮する。

固定3周 / 固定1-3-7日にはしない。

## 9. Prompt simplification continuation

adaptive memory baselineがgreenになった後、以前のprompt simplification loopへ戻る。

次の強い候補:

- focused planning-window AI repair

現在の問題:

```text
AIが日付意味を理解
→ representation validation failure
→ raw date phraseをもう一度AIへ送る
→ canonical absolute windowを再生成
```

意味がtyped evidenceから一意に導出できるならapplication converterへ移す。typed evidence自体が不足する場合はfail closed / uncertaintyへ戻し、raw-text deterministic parserを追加しない。

## 10. Real-API protocol

```text
assistant turnを観測
→ semantic raw output
→ validation / repair
→ binding / Fact Graph
→ proposal / dialogue decision
→ renderer
→ scheduler / preview
→ 人間視点で共有前提を確認
```

明確な失敗があれば、そのturnで停止する。

特に確認すること:

- internal heuristicが共有済み前提として話されていないか。
- proposalが了承前に適用されていないか。
- acceptance scopeが正しいか。
- durable memoryへ過剰昇格していないか。
- 同じ質問を別表現で聞き直していないか。
- rendererが自然でもapplication stateと矛盾していないか。

## 11. Completion gate

- stale vocabulary total-duration / word-threshold / automatic-daypart behaviorがproductionから除去または新policyへ置換
- proposal lifecycle regression green
- durable promotion boundary regression green
- observed learning evidence boundary green
- prompt budget green
- full TypeScript / Vitest / build green
- Browser Regression green
- final Luna dynamic conversationがhuman-reviewedでpreviewへ到達
- roadmap / contract / taskが最終HEADと一致

PR #130をこのgate前にmerge readyとしない。
