# weeklyPlanning current contract v5

Status: canonical / Stable V5 production baseline
Updated: 2026-08-14

Canonical references:

- [current contract status](weekly-planning-current-contract-status.md)
- [runtime contract](weekly-planning-stable-v5-runtime-trial-contract.md)
- [test philosophy](testing/weekly-planning-test-philosophy.md)
- [main roadmap](strategy/weekly-planning-roadmap.md)
- [semantic roadmap](strategy/weekly-planning-semantic-v5-roadmap.md)
- [current conversation-quality / Luna audit](tasks/20260814-weekly-planning-conversation-quality-luna-audit.md)
- [semantic schema](../architecture/weekly-planning-semantic-schema-v5.md)
- [dialogue architecture](../architecture/weekly-planning-dialogue-architecture-v5.md)

この文書は週間計画Stable V5のAI/core責務と主要machine contractの正本である。過去のAlpha、feature-flag trial、legacy runtime、固定scenario eval文書と競合する場合は本書を優先する。

## 1. Runtime baseline

Stable V5が唯一のproduction週間計画runtimeである。legacy interpreter、parser fallback、semantic V1/V2、runtime mode selectorへ戻すproduction経路を持たない。

```text
NaturalLanguageAssistant
→ weeklyPlanningTurnExecutor
→ Stable V5 semantic AI
→ validator / optional one-shot AI repair
→ deterministic Fact Graph V5
→ readiness / scheduler / dialogue decision
→ AI renderer
→ preview UI
→ draft / approval / Plan save
```

旧保存形式を現在形式へ読むmigration compatibilityと、現行trace/storage decoderに必要な過去形式互換はruntime切替ではない。production dataを安全に読むために必要な間は残してよい。

## 2. AI意味理解責務

raw user textから次を理解する主体はAIである。

- task / component
- workloadとquantity role
- effort estimate
- planning window
- 曜日、日付、時間帯、task-local temporal constraint
- recurrence / availability / relation
- correction / decision / authorization intent
- 会話文脈に基づく短答の意味

AIはformal fact ID、revision、lifecycle mutation、readiness、質問優先度、scheduler placement、preview freshness、approval、saveを決めない。

deterministic codeはraw user textを再解析してAIの意味を上書きしない。日本語regex、特定フレーズ、固定scenario分岐で意味を復元しない。

provider failure、空応答、不正JSON、schema rejection、repair failureからparserへfallbackしない。semantic repairは最大1回とする。

focused semanticを使う場合も意味解釈はfocused AIが担当する。deterministic routerはmachine stateから「どの限定責務へ渡すか」を選ぶだけとする。

## 3. Semantic document contract

AI出力はcurrent-turn semantic deltaであり、現在の計画全体のsnapshotではない。

現在発話で新規に述べた、変更した、訂正した、または判断した内容だけを返す。public state summaryに存在する過去factを根拠なく再出力しない。

`sourceText`はcurrent user textに根拠を持つ。過去発話をcurrent deltaのevidenceとして扱わない。

主要構造は次である。

```text
WeeklyPlanningSemanticDocumentV5
├─ planningIntent
├─ planningWindow
├─ tasks
│  ├─ components
│  ├─ workloads
│  ├─ effortEstimates
│  ├─ temporalConstraints
│  └─ recurrence
├─ relations
├─ availabilityDeclarations
├─ constraintSourceRequests
├─ uncertainties
├─ corrections
└─ decisions
```

workloadのquantity roleは次を使用する。

```text
declared | target | remaining | completed | unknown
```

総量と完了量が同時に与えられた場合、総量そのものをremainingとして扱わない。構造的一貫性違反はvalidatorで検出し、AI repairへ返す。deterministic codeが自然言語から差分量を再計算して意味を作らない。

## 4. Date / time contract

AI境界で日付、曜日、時間帯をcanonical表現へ構造化する。

```text
dateExpression:
  today | tomorrow | day_after_tomorrow | this_week | next_week
  | weekday:sunday | weekday:monday | weekday:tuesday
  | weekday:wednesday | weekday:thursday | weekday:friday | weekday:saturday
  | YYYY-MM-DD | custom:<原文>

weekday recurrence days:
  weekday:sunday | weekday:monday | weekday:tuesday
  | weekday:wednesday | weekday:thursday | weekday:friday | weekday:saturday

namedTimePeriod:
  morning | afternoon | evening | night
  | before_sleep | before_meal | after_meal | custom:<原文>
```

標準曜日を`custom:`へ逃がさない。validator以降で日本語曜日を再解釈しない。解決不能な`custom:`は捏造せずreadinessへ返す。

過去のavailability resolverが内部で使用した`sun/mon/tue/...`はmigration compatibilityの内部表現であり、Stable V5 semantic contractではない。production boundaryではcanonical `weekday:<english-day>`を正とする。

scheduler既定時間帯はユーザーの明示preferred windowより弱い。明示された曜日・時間帯を既定09:00–22:00等のヒューリスティックで切り落とさない。

## 5. Fact Graph / transaction

AI documentはそのまま永続化せず、deterministic coreが`WeeklyPlanningFactGraphV5`へcanonicalizeする。

- formal ID / revision / trusted metadataはcoreが発行する。
- local IDは一response内参照に限定する。
- correction / delete / decisionはformal referenceとlifecycleへ適用する。
- canonical commitはatomicとする。
- validation failure時はaccepted graphを変更しない。
- no-op turnではfact revisionを進めない。
- no-opでもapplied turn/idempotency履歴は保持する。
- staged graphはPlanningState commit成功後だけfinalizeする。
- stale / cancel / week change / commit rejection / failureではstageを破棄する。

既存entityのidentity、同一workload、pending targetはformal bindingで扱う。raw textの類似だけで別factを同一視しない。

## 6. Readiness / scheduler

readinessはaccepted machine stateだけから決める。

- 認識済み各taskに予定化可能なworkloadが必要。
- quantity role未確定はeffort不足より先に解消する。
- missing情報は原則一件ずつ質問する。
- partial placementを成功previewとして返さない。
- existing plan / timetable / fixed commitmentはAIへ本文を送らずschedulerで扱う。
- task-local weekday / allowed / excluded / preferred timeをplacementへ保持する。
- session分割・日付分散・負荷ranking・relation orderingはsemantic AIではなくdeterministic policyで行う。
- cyclic relationなど実行順が矛盾するmachine stateは黙って無視せずresolutionへ戻す。
- personalization/estimate calibrationはhard constraintを変更しない。

AIはmissing slot、question target、preview gate、placementを決めない。

## 7. Dialogue / renderer

applicationがtyped dialogue decisionを作り、AI rendererが自然な日本語へ表現する。

rendererはsemantic meaningを再決定しない。question target、Graph state、preview stateをrenderer textから逆推定しない。

AI返答の自然さを固定文言で自動合否にしない。deterministic fallback/UI固定文言だけは必要に応じてexact contractを持てる。

## 8. Preview / approval / save

previewはowner、conversation、Graph revision、source factsへ拘束する。

- Graph revisionが変わったstale previewは承認しない。
- preview後の実変更は再previewする。
- no-op turnではschedulerを再実行せず既存previewを保持する。
- preview candidateは既存UIからdraft blockへ昇格する。
- approval/saveはapplicationの決定論的責務である。
- 二重承認・二重保存・owner mismatch・stale操作を拒否する。

チャット文面だけからdeterministic codeが直接保存を実行しない。AIがauthorization intentを理解しても、保存は既存application/UI contractを通す。

## 9. Persistence / recovery / trace

Stable V5 sessionはowner・week・conversationに拘束する。

保存・復元対象はconversation identity、完了済みPlanningState、Fact Graph、preview、draft等を一貫したenvelopeとして扱い、部分復元を避ける。pending turn / pending approvalの半端なstateを永続化しない。

legacy storage payloadのmigration decoderは、既存利用者データを安全に読むための互換層であり、旧runtimeを再導入する理由にはしない。

traceは同一logical conversationのidentityを維持し、request/turn/revision/sourceを観測可能にする。raw conversationやsemantic payloadのprivacy/retention契約を破らない。

## 10. Testing contract

自動テストで保証するのは決定論的契約である。

対象:

- schema / evidence validation
- binding / lifecycle / revision / idempotency
- readiness / scheduler / preview
- correction / approval / save
- storage / checkpoint / recovery
- trace / request budget / prompt budget
- production dependency boundary
- heuristic policy invariants / adversarial placement cases

禁止:

- 特定AI返答文を正解に固定する。
- 固定scenarioのsemantic結果をquality PASSとする。
- model比較実験を通常CIへ残す。
- prompt wording自体を回帰契約にする。

実AIの意味理解・自然さはhuman-reviewed real-API observationで確認し、明確な欠陥は最終ユーザー判断前に開発ループ内で修正する。

重要なscheduler/semantic境界変更後は、対象回帰だけでなくfull CIをgreenに戻してから次の実装単位へ進む。

## 11. Current execution order

旧「legacy削除 → 挙動不変リファクタ → 7視点監査 → 新規改善」はStable V5移行期のhistorical sequenceであり、現在のactive phaseではない。

2026-08-14時点の実行順序は次とする。

```text
stale会話task・Issue・PRと現コード回帰の対応付け
→ deterministic baselineとprompt byte実測
→ historical scenarioを実APIで1 turnずつLuna監査
→ 失敗地点で停止し、原因層修正・回帰・full CI・同地点再実行
→ Issue #118の残るcompleted-duration会話policyを完了
→ heuristic敵対的回帰とprompt Luna ablation
→ 最終HEADの通し会話をpreviewまで実行
→ Browser Regression / normal CI / trace persistence
→ roadmap / contract / status / task queue / Issueを最終同期
```

実API観測で新しい実不具合を見つけた場合はそのturnで停止し、修正→回帰→full CI→新規conversationまたは必要なcheckpointから再検証する。

現在のactive作業正本は`tasks/20260814-weekly-planning-conversation-quality-luna-audit.md`である。Issue #52と#115は別scopeである。
