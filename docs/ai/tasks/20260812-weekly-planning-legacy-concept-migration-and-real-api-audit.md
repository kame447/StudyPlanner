# 週間計画 旧思想移植・ヒューリスティック監査・実API検証

Status: active
Date: 2026-08-12
PR: #120
Branch: `agent/weekly-planning-human-grounding-repair`

## 目的

過去の週間計画pipeline・実装・historical roadmapを棚卸しし、現在のStable V5責務境界を壊さずに有効な概念を移植する。

完了報告は推測で行わない。deterministic regression、full CI、実OpenAI APIの逐次会話、実OpenAI APIの通し会話を実行し、最後にproductionで実際に使われるヒューリスティックを全列挙する。

## 非交渉の責務境界

- raw user textと会話文脈の意味理解はAIが担当する。
- deterministic codeはschema/reference/evidence validation、formal binding、Fact Graph lifecycle、revision/idempotency、readiness、質問優先度、scheduler、preview、approval、saveを担当する。
- 旧日本語regex/parserをsemantic source of truthとして復活させない。
- 科目名だけから固定時刻・認知負荷・優先度を決めない。
- hard constraintをpersonalizationやheuristic scoreより先に適用する。
- 実績データをAIへそのまま渡さず、必要なdeterministic集約値だけをschedulerへ渡す。

## 棚卸し分類

過去資料の項目は必ず次に分類する。

1. 旧productionで実装済みだった能力
2. 現Stable V5に既に同等以上の能力がある
3. historical roadmap / designだけで、旧productionには未実装
4. 現Stable V5へ移植する価値がある
5. raw text依存・過学習・責務逆転のため不採用

「古いMDに書いてある」だけでは旧実装済みと扱わない。

## 現在までに移植・強化した概念

- human-scale effort質問とformal answer binding
- page/problemのper-unit effort
- vocabularyのtotal/session effort切替
- vocabulary 100語上限のdeterministic session分割
- vocabulary sessionをpreview work itemまで保持
- execution profile / session policy
- session chunking
- distinct taskの開始日分散
- daily load ranking / overload回避
- tiny-tail回避
- 重い作業の長いfree segment優先
- preferred date / preferred window
- existing plan / timetable buffer
- scheduler break
- task relation ordering
- before / after / dependency / sequenceの実時刻順制約
- relation cycleのblocking
- request-time not-before
- reserve / review既存policyの保持
- Actual由来のowner-scoped estimate calibration
- intrinsic durationを校正対象外にする境界
- canonical weekday availability compatibility

## 意図的に復活させない旧方式

- 日本語keyword/regexをsemantic truthとして使うparser
- `英語なら13時`、`数学なら14:30`のような科目名→固定時刻rule
- 根拠のない生活profile永続化
- product policyが未定義な固定spaced-repetition間隔
- historical roadmapだけに存在した機能を「旧実装」とみなすこと

## Semantic prompt / orchestration監査

### 実測

2026-08-12の実OpenAI API traceで、初回のopen-ended semantic requestは23,014 bytesだった。system prompt単体は10,404 UTF-8 bytes、53行で、出力は1,957文字、repairなしだった。

focused contextual route導入前には、machine pending targetが既に確定している`8分くらいです。`という短答にも25,239 bytesのgeneric semantic requestを送っていた。これはsemantic能力不足ではなくorchestration責務の過大化であり、現在はfocused contextual routeへ分離済みである。

PR #120でalways-on generic system promptに追加した規則はpartner-specific title/contextLabel保持の1行だけで、今回のPRだけがcore promptを急激に肥大化させたわけではない。ただしgeneric core自体は既に大きく、今後さらに常時規則を積む余地は小さい。

一方、real APIで観測した表現揺らぎへの対処としてsemantic repair directiveは増加している。absolute planning window、canonical weekday、exact clockなどをfull-document repair promptへ足し続ける方式は、障害ごとにrepair promptが肥大化する回帰ループになり得る。

### 現在の判定

generic semantic一回が担当している意味領域は多い。

- task/study分類
- decompositionStatus
- component hierarchy
- workload / effort
- quantity role
- planning window
- date / weekday / clock表現
- recurrence
- hard / soft constraint
- event occurrence / task deadline
- durable context / concern
- existing entity continuation
- modifier scope / ambiguity
- relations
- source requests
- corrections / decisions
- current-turn delta / sourceText grounding

これはcontext-window上限の問題ではなく、instruction density、相互制約、repair時の意味保持の難しさが主なリスクである。

### 今後の追加ルール判断順序

新しいsemantic不具合を見つけても、generic promptへ規則を追加することを第一選択にしない。必ず次の順で分類する。

1. JSON Schemaだけで表現できるrepresentation contractか。
   - yesならschemaへ寄せる。
2. deterministic canonicalizationで意味を選び直さず安全に直せるrepresentationか。
   - yesならcanonicalizerへ寄せる。
3. machine pending stateがexact semantic targetを既に持っているか。
   - yesならfocused AI semantic routeを優先する。
4. AIによる再解釈が必要だが変更対象fieldが限定されているか。
   - yesならfield-scoped semantic repair / focused repairを優先し、full documentを書き直させない。
5. 上記のどれにも当たらず、自由入力の複数意味を統合する必要がある場合だけgeneric semanticへ残す。

validator errorが増えたという理由だけで、同じ規則をsystem prompt、validator、repair promptの3層へ重複実装しない。

### オーケストレーション方針

初回の自由入力は、task、量、期間、availability、関係が同一発話内で相互参照するため、現時点ではgeneric semanticを維持する。根拠なく複数AI callへfan-outすると、entity identity、modifier scope、relationの統合が逆に不安定になるためである。

一方、会話継続後はmachine stateを利用して責務を狭める。

既にfocused化済み:

- create-plan authorization
- `missing_effort_estimate`
- `quantity_role_unresolved`

次の有力候補:

- pending `work_breakdown`
  - exact targetPublicIdがmachine stateで確定しているため、generic全体schemaを再度解かせる必要性が低い。
- field-scoped temporal representation repair
  - planningWindow / clock / weekday等で意味対象が限定済みの場合、full semantic documentをAIに再生成させない構造を検討する。

`semantic_uncertainty`全体を一括focused化することはしない。target種類ごとにmachine contractが十分狭い場合だけ分離する。

### Prompt budget gate

prompt wordingそのものをquality oracleにはしないが、operational sizeは回帰contractとして扱う。

- always-on generic system prompt: 11,000 bytes以下
- representative generic request（JSON Schema込み）: 24,000 bytes以下
- focused authorization request: 2,500 bytes以下
- focused contextual answer request: 4,000 bytes以下
- focused requestはrepresentative generic requestの1/4未満を維持する

これらは`weeklyPlanningSemanticPromptBudget.test.ts`で検証する。

閾値を超えた場合、単純に上限を引き上げない。まずschema化、規則削減、machine-state focused route、field-scoped repairのいずれかで責務を分離する。閾値変更が必要な場合はreal API request bytes、repair率、失敗shapeを根拠としてこのMDを更新する。

## 実API監査

### 逐次会話

GitHub Actionsのresumable observationを使い、1 turnごとにcheckpointを復元する。

各turnで確認する。

- AI raw semantic document
- validation / repair
- canonical graph diff / revision
- scheduler issues
- selected pending question target
- renderer response
- authorization persistence
- preview candidate count
- failure diagnostics

返答はrenderer文面の文字列ではなくmachine pending targetを見て決める。

2026-08-12の第1回観測では、AIは`weekday:tuesday`を正しく出したがavailability resolverが旧`tue`形式だけを期待し`invalid_weekday`を出す実バグを検出した。canonical weekday compatibilityを修正し、full CI green後に新規conversationでTurn 1から再実行した。

修正後Turn 1では`invalid_weekday`は消え、数学40問の`missing_effort_estimate`が正しく選択された。

### 通し会話

逐次会話完了後、同じproduction boundaryを使って一つの実API job内で開始からpreviewまで通す。

固定renderer文面をoracleにしない。machine stateから必要な回答を選び、preview到達・constraint保持・authorization保持・failureなしを検証する。

## final gate

完了条件:

1. legacy思想棚卸しが分類済み
2. 採用概念がproduction経路へ接続済み
3. 移植ごとの対象回帰green
4. TypeScript green
5. full Vitest green
6. production build green
7. diff check green
8. semantic prompt / orchestration auditが完了し、prompt budget gateがgreen
9. 逐次real API conversationがpreviewまで完走
10. 通しreal API conversationがpreviewまで完走
11. 7視点敵対的監査でBLOCKER/MAJORなし
12. current contract / roadmap / semantic roadmap / current statusが現コードと一致
13. productionのdeterministic heuristic inventoryをコード根拠付きで全列挙

このgateを満たすまで「完全に完了」とは報告しない。
