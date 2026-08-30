# Learning Consultation and Advice Contract

Status: canonical product requirement / seven-view hardening in progress
Updated: 2026-08-31
Owning Issue: [#246](https://github.com/kame447/StudyPlanner/issues/246)

Parent product intent: [product-intent.md](product-intent.md)
Current production runtime: [../architecture/current-contract-v5.md](../architecture/current-contract-v5.md)
Semantic ownership: [../architecture/weekly-planning-semantic-ownership-boundary-v5.md](../architecture/weekly-planning-semantic-ownership-boundary-v5.md)
Human grounding: [../policies/human-grounding.md](../policies/human-grounding.md)
Adaptive memory: [../policies/adaptive-memory.md](../policies/adaptive-memory.md)
Material metadata: [../../external-integrations/spec/material-metadata.md](../../external-integrations/spec/material-metadata.md)
Prompt / evidence design: [learning-consultation-prompt-and-evidence.md](learning-consultation-prompt-and-evidence.md)
Regression patterns: [../../../work/regression-patterns.md](../../../work/regression-patterns.md)
Test philosophy: [../quality/test-philosophy.md](../quality/test-philosophy.md)
Current roadmap: [../roadmap/current.md](../roadmap/current.md)

## 1. この文書の役割

この文書は、AI計画に「予定を作る前段階の学習相談」を追加するための正仕様である。

対象は、既存条件から予定を生成するだけのturnではない。ユーザーが学習方針そのものを相談し、AIがStudyPlanner内の現在情報にgroundされた助言を返し、ユーザーがレビューした意思だけを既存Stable V5 planningへ安全に接続するturnを扱う。

代表例:

- 「数学の点数を上げたいけど、どの参考書をいつまでに仕上げればいい？」
- 「英語が苦手なんだけど、何から始めればいい？」
- 「この参考書が難しすぎるけど、変えた方がいい？」
- 「金フレが終わったら次に何をやればいい？」
- 「共通テスト数学を伸ばしたい。今の教材のままでいい？」
- 「この勉強法で間に合う？」
- 「なぜその教材がおすすめなの？」

production runtimeへこの機能が完全実装されるまでは [current-contract-v5.md](../architecture/current-contract-v5.md) がproduction baselineである。

本書では次の語を規範的に使う。

- 必須: 実装が満たさなければならない。
- 禁止: 実装してはならない。
- 推奨: 特別な理由がない限り従う。
- projection: 表示・集計・prompt入力等の派生状態。authorizationやsource of truthではない。

## 2. Product goal

同じAI計画の会話面で次を成立させる。

```text
相談する
→ 関連するStudyPlanner contextをowner domainからboundedに取得
→ 学習方針・教材・順序・目安期限について助言を得る
→ 理由や代替案を聞く
→ proposalをレビューする
   ├─ approve
   ├─ request_revision
   ├─ request_alternative
   └─ dismiss
→ approve対象をcurrent contextで再検証
→ approved + current + fully-accounted-for scopeだけをStable V5へpromotion
→ readiness / scheduler
→ preview
→ Planの最終承認
→ save
```

最終的なproduct outcomeは「AIがそれらしい勉強法を話すこと」ではない。

ユーザーが、自分の目標・現在地・教材・予定・進捗にgroundされた提案を理解し、修正・別案・終了を含めて自分で判断し、その意思だけが安全にplanningへ反映されることを目的とする。

## 3. Non-negotiable invariants

最重要不変条件:

```text
AI-generated advice
≠ user-stated fact
≠ user-approved planning strategy
≠ promoted planning condition
≠ preview
≠ saved Plan
≠ durable memory
```

また、2種類の承認を混同しない。

```text
Advice approval
= この助言の特定scopeをplanning材料として使ってよい

Plan approval
= 実際に生成されたpreviewを保存してよい
```

AIが「基礎問題精講を10月末までに終えるのがおすすめ」と回答しただけでは、次のどれも成立しない。

- ユーザーがその教材を使うと決めた
- 10月末を正式期限として承認した
- schedulerへ渡してよい
- Planとして保存してよい
- 長期記憶として保持してよい

追加の必須不変条件:

1. renderer proseからmachine stateを再構成しない。
2. activeなproposal revision以外へreview commandを適用しない。
3. 1 proposal revisionにつき成功するadoption decisionは最大1回とする。
4. conversation内でimplicit short-answerを受け取れるauthorization-bearing targetは常に1つだけとする。
5. reviewとpromotionはimmutable operation identityとexpected revisionへbindする。
6. AI回答生成中に根拠が変わった結果をcurrent proposalとしてcommitしない。
7. reload後もreview対象・根拠・lineageをtyped stateから復元できる。
8. `empty / unavailable / omitted / stale / non_revalidatable`を同じ状態へ潰さない。
9. 相対期限は一度canonical valueへ解決し、promotion時にproseを再解釈しない。
10. unresolvedな教材名をcanonical material identityとして扱わない。
11. consultation clarificationとplanning clarificationを同じpending question stateへ混在させない。
12. 新しいproposalを生成したturnだけで、そのnew revisionを暗黙承認しない。
13. approved scopeのplanning-relevantな内容をsilent partial promotionしない。
14. stale explanationはhistorical adviceをcurrent recommendationへ復活させない。
15. prompt用projectionをfreshness / identity / availabilityのsource of truthとして使わない。
16. consultation AdviceProposalを既存のgeneric proposal / assumption proposalと同じidentity namespaceへ曖昧に載せない。
17. same-browser multi-tabでlocal read-check-writeだけをformal compare-and-set authorityにしない。
18. promotion後のstrategy変更で過去ReviewDecision / PromotionReceiptを上書きしない。

## 4. Product scope

### 4.1 Phase 1で対象とする相談

- 学習戦略: 何から始めるか、どの順序がよいか
- 教材選択: 何を使うか、現在教材を継続するか
- 教材遷移: 現教材の次に何を行うか
- 目標分解: 目標点までにどの段階をいつまでに終えるか
- 期限提案
- feasibility explanation
- 学習方法
- 複数案の比較
- 理由説明

### 4.2 Phase 1で行わないもの

- StudyPlannerと無関係な汎用雑談assistant化
- AI回答から直接Planを書き込むshortcut
- 教材・試験ごとの巨大な決定論的heuristic表
- 無制限なautonomous web research
- AI回答の自動長期記憶化
- owner domainのsource of truth複製
- item単位の部分承認
- cross-device consultation state同期
- offline multi-device conflict resolution

Phase 1でreview可能なscopeは「proposal全体」または「複数optionのうち1つのoption全体」に限定する。

same-browser multi-tabのmutation safetyはPhase 1から必要であり、cross-device非対応を理由に省略しない。

## 5. SSOT / ownership map

同じ事実・identity・authorizationに複数ownerを作らない。

```text
Bookshelf / StudyMaterial
  registered material identity
  aliases / catalog link
  user-specific progress / pace

userPlanningContext
  durable explicit user facts / preferences

Stable V5 Fact Graph
  accepted planning facts / lifecycle

Timetable / Plan / Actual / Reporting owners
  their canonical domain state and deterministic aggregates

client-runtime / Issue #164
  local durable persistence
  local replica
  migration infrastructure
  multi-tab mutation coordination
  future local/cloud reconciliation

approval/server authority / Issue #51
  final Plan-save uniqueness across devices

security / Issue #152
  prompt-injection / trust / provenance policy
  untrusted stored/supplemental content boundary

external-integrations / Issue #187
  material catalog / retrieval providers
  registered-material identity integration boundary

product-observability
  service-wide metrics

weekly-planning
  consultation routing/state/review binding
  freshness orchestration
  promotion into normal Stable V5 planning
```

weekly-planningは各ownerのstable port / facadeを利用し、第二のidentity resolver、storage policy、security policy、final-save authorityを作らない。

## 6. SOLID architecture requirements

### 6.1 SRP — Single Responsibility Principle

consultation orchestratorはflow調整だけを所有する。

所有してはならないもの:

- 教材identity照合アルゴリズム
- Bookshelf / Timetable等のstorage実装
- context source固有のfetch/fallback policy
- localStorage / IndexedDB等の具体的永続化
- AI provider SDK
- scheduler placement
- final Plan save

### 6.2 OCP — Open/Closed Principle

新しいcontext sourceやexternal providerはadapter / port追加で拡張する。

source追加のたびにconsultation core state machineへ巨大switchやprovider固有分岐を追加しない。

### 6.3 LSP — Liskov Substitution Principle

context source adapterは共通contractを守る。

最低限:

- source identity
- requirement
- availability status
- authority
- canonical digest / basis
- provenance
- bounded items

adapter差し替えで`empty`の意味やfreshness semanticsが変わってはならない。

### 6.4 ISP — Interface Segregation Principle

Answer AIへrepository全体・manager全体を渡さない。相談に必要なbounded read modelだけを渡す。

promotion mapperへAI clientを渡さない。validated proposalとowner-domain portsだけを渡す。

### 6.5 DIP — Dependency Inversion Principle

weekly-planningはconcrete provider / localStorage / raw catalog responseへ直接依存しない。

owner domainが公開するstable interfaceへ依存する。

## 7. Existing Stable V5との責任分離

### 7.1 `study_advice`を新機能のauthorityとして流用しない

current codeに存在する互換語彙 `PlanningIntent = 'study_advice'` をconsultation lifecycleのformal authorityとして流用しない。

conceptとして少なくとも次を区別する。

```text
planning_operation
learning_consultation
consultation_review
consultation_followup
other / unresolved
```

exact TypeScript名は実装時に既存schemaへ合わせてよいが、意味責任を統合しない。

### 7.2 既存LearningStrategyProposalとの分離

current Stable V5のweekly learning strategy proposalは、週内capacity / memorization session等のplanning-side proposalである。

Issue #246のAdviceProposalは学習相談のadvisory stateであり、同じ型・ledger・statusを共有しない。

### 7.3 Generic proposal referenceとのnamespace分離

Stable V5には既存proposalを指すgeneric semantic referenceがある。

AdviceProposalを曖昧に同じnamespaceへ載せない。

許される設計は次のどちらか。

1. consultation advice専用のtyped reference namespaceを持つ。
2. 共有reference schemaへ明示的なproposal-family discriminatorを追加し、deterministic applicationがfamilyまで検証する。

既存generic proposal decisionがAdviceProposalをmutationできてはならない。

## 8. Turn routing and active interaction

### 8.1 3種類の「質問」を分ける

```text
planning clarification
  application → userへplanning不足情報を質問

consultation clarification
  learning consultation → userへ助言に必要な1問を質問

user consultation
  user → StudyPlannerへ学習相談
```

別machine stateとして扱う。

### 8.2 ActiveInteraction invariant

conversation内で、`それでいい`、`はい`、`1つ目`等のimplicit short replyを受け取れるtargetは常に最大1つ。

概念上:

```text
ActiveInteraction
  none
  planning_clarification
  consultation_clarification
  consultation_review
  preview_approval
```

これは表示履歴を消すという意味ではない。historical stateは保持できるが、implicit authorizationを持てるのはactive targetだけである。

新しい無関係な相談やplanning flowが始まった場合、以前のtargetはimplicit authorityを失う。

ambiguousなshort replyはmutationせずclarificationする。

古いadviceを後から利用する場合は明示的に再activateし、current contextでrevalidateしてからreviewableにする。

### 8.3 Raw-text heuristic禁止

教材名、科目名、「おすすめ」「それで」等のkeyword/regexをformal semantic authorityにしない。

semantic repairで失敗してもlegacy raw-text parserへfallbackしない。

### 8.4 Mixed turn

例:

```text
「教材はそれで、期限だけ11月末にして、そのまま予定組んで」
```

Phase 1 rule:

- active proposal内容の変更を含む場合はnew revisionを生成する。
- 同じturnのschedule要求でnew revisionをauto-approveしない。
- new revisionへ別の明示的review decisionを必要とする。
- 内容変更なしの「それで予定組んで」はactive current proposalへのapproveになり得る。

### 8.5 Cross-option composition

```text
「Aの教材でBの期限」
「AとB両方やる」
```

これは既存optionのapproveではない。

`request_revision`として新しいproposalを生成し、新revisionへfresh approvalを要求する。

## 9. Answer output contract

Answer AIのvalidated outputはPhase 1で必ず1種類だけ。

```text
AdviceAnswerDocument
  proposal
  clarification
  explanation
```

### 9.1 Proposal

新しいreviewable AdviceProposal候補。

複数optionを返してよい。

AIはformal adviceId / optionId / review status / promotion statusを生成しない。

### 9.2 Clarification

recommendationを大きく変えるblocking inputが1つある場合だけ返す。

一度に大量のプロフィール質問をしない。

clarification outputからAdviceProposalをcommitしない。

### 9.3 Explanation

activeまたはhistorical proposalのrationale / assumptions / evidence / trade-offを説明する。

strategy contentを変更しない限りnew revisionを作らない。

## 10. Consultation state model

consultation stateはFact Graphとは別のconversation-scoped advisory stateとして保持する。

概念モデル:

```text
ConsultationSessionState
  consultationId
  ownerId
  conversationId
  revision
  lifecycle: active | closed
  activeAdviceId?
  activeAdviceRevision?
  proposals[]
  reviewDecisions[]
  validityChecks[]
  promotionOperations[]
  promotionReceipts[]
  pendingClarification?
  activeInteraction
```

consultation revisionはformal state commitごとに単調増加する。

### 10.1 AdviceProposal

proposal revisionはimmutableに近い扱いをする。

最低限:

- adviceId
- consultationId
- revision
- sourceQuestionTurnId
- supersedes / supersededBy
- structured options
- assumptions
- evidence refs
- dependency refs
- context fingerprint
- temporal resolutions
- material bindings
- answer snapshot
- createdAt

修正でv1をin-place editせずv2を作る。

### 10.2 Active leaf invariant

review可能なのはactive leaf revisionだけ。

new revision commit後、旧revisionはhistoryになり、approve / revision / alternative / promotionの対象に再利用しない。

古いUI、別tab、reload前commandでもside effectを起こさない。

### 10.3 Status projectionをauthorityにしない

formal truth:

```text
user decision
  immutable ReviewDecision ledger

freshness
  deterministic ValidityCheck

promotion
  immutable PromotionOperation / PromotionReceipt ledger
```

`approved/current/promoted`等のUI表示statusはprojectionとして計算してよいがauthorizationの正本にしない。

## 11. Review contract

### 11.1 Phase 1 review scope

review scope:

- proposal全体
- 1つのoption全体

item-level partial approvalは不可。

### 11.2 ReviewDecision

最低限:

- decisionId
- consultationId
- targetAdviceId
- expectedAdviceRevision
- expectedConsultationRevision
- target scope
- action
- feedback
- source turn
- decidedAt

formal ID / expected revision / target bindingはdeterministic applicationが付与する。

### 11.3 Adoption terminality

1 proposal revisionにつき成功する`approve`は最大1回。

成功したapproveはそのrevisionのadoption authorityを消費する。

例:

```text
Proposal v1
  Option A
  Option B

User approves A
  → v1のadoptionは確定・消費済み

User later says Bも採用
  → v1へ2つ目のapproveを追加しない
  → strategy changeとしてnew revisionを作る
```

これによりsibling optionが時間差で複数promotionされることを防ぐ。

### 11.4 Concurrency

review command適用はexpected consultation/advice revisionを必須にする。

minimum guard:

- owner / conversation一致
- consultation active
- target advice = active leaf
- expected revisions一致
- target scope存在
- adoption authority未消費
-同一operation未適用

同一runtime writer内ではapprove vs alternative、double approve等のうち1つだけをcommitする。

same-browser multi-tabのserializationは §20 に従う。

## 12. Context source contract

Answer AIへplain arrayだけを渡さない。

各sourceは概念上:

```text
ContextSourceEnvelope
  sourceDomain
  sourceIdentity
  requirement: required | optional
  status: available | empty | unavailable | omitted | stale
  sourceBasis / revision
  semanticDigest
  observedAt
  authority
  bounded items
```

### 12.1 `empty`の意味

loadに成功しauthoritativeに0件である場合だけ`empty`。

load failure、permission、timeout、token/privacy budget omissionをemptyへ変換しない。

### 12.2 Required / optional

validated consultation meaningからdeterministic applicationが決める。raw text keywordで決めない。

required sourceがunavailable / omitted / staleなら、そのsourceが必要な確定proposalを作らない。

### 12.3 Owner snapshot first

freshness / identity / source availabilityの判定はowner domain snapshot / portから行う。

Stable V5 public semantic summary等のprompt用projectionをsource of truthにしない。

projectionで落ちたrevision / statusを後から推測しない。

## 13. Context fingerprint and freshness

fingerprintは、そのproposal生成に実際に消費したdependencyだけから作る。

含めるもの:

- source identity
- consumed canonical semantic digest
- source basis/revision where meaningful
- deterministic signal + calculation version
- temporal request context
- evidence snapshot digest
- material binding basis

無関係なsource更新でstaleにしない。

単なるupdatedAt変更ではなく、consumed canonical contentの変化を基準にできる設計を優先する。

### 13.1 Commit-time freshness

```text
F0 = answer call前のdependency fingerprint
AI call
structured validation
F1 = commit直前の同dependency fingerprint

F0 == F1
  commit candidate

F0 != F1
  stale AI resultをdiscard
```

source drift時の自動regenerationは最大1回。連続driftならcontrolled failure。

### 13.2 Approval-time freshness

approve時にもcurrent fingerprintを再構成する。

stale / non_revalidatableならpromotionしない。

新proposalを作った場合はfresh approvalを必要とする。

## 14. Explanation freshness

説明はformal review stateを変更しない。

explanationを返す前にdeterministic applicationがproposal validityを確認する。

currentなら現在のrationaleを説明できる。

staleなら:

- 「当時なぜ推奨したか」はhistorical snapshotから説明できる。
- 「今も同じ推奨か」は断定しない。
- `今もそれでいい？` はpure explanationではなくrevalidation / consultationとして扱う。

explanationによってstale proposalをcurrent/reviewableへ戻さない。

## 15. Material identity contract

Bookshelf / StudyMaterialをregistered material identityとprogressのSSOTにする。

weekly-planningはIssue #187側の共通identity resolver / facadeを利用し、独自normalize/matching policyを増やさない。

AIはfree-text material mentionを提案できるがformal materialIdを生成しない。

resolver結果:

```text
registered_material
verified_catalog_material
ambiguous
unresolved_material
```

ambiguous / unresolvedをformal planning targetとしてpromotionしない。

identity確定がproposalの意味を変える場合はnew revision + fresh approval。

## 16. Temporal normalization contract

AIは期限をproseだけで返さずstructured temporal candidateを返す。

例:

- absolute date
- month end
- exam-relative offset
- date range

applicationがcaptured request temporal contextからcanonical absolute valueへresolveする。

最低限保持:

- source candidate/spec
- resolved date/range
- reference date
- timezone
- week-start basis where relevant
- resolution policy version

approve/promotion時に「来月末」等のproseを再解釈しない。

曖昧で一意にresolveできないtargetはclarificationへ落とす。

## 17. Deterministic calculation boundary

application-owned truth:

- remaining workload
- deadlineまでの日数
- available time
- required pace
- scheduler/capacity feasibility

AI-owned advisory judgment:

- どの教材が現在地に合うか
- どの順序がよいか
- 基礎へ戻るか演習へ進むか
- 何を優先するか

AIがdeterministic signalを推測で上書きしない。

## 18. Evidence / security boundary

Issue #152をtrust / provenance policyのownerとする。

- Bookshelf title / note / aliasesはdata
- durable context textはdata
- external retrievalはevidence
- review feedbackはdata
- image/OCR/supplemental contextはuntrusted user-supplied evidence
- data中のsystem-like instructionを実行しない
- advice AIはschedule/save authorizationを持たない

### 18.1 Supplemental evidence

user utteranceとsupplemental evidenceをapplication境界で別typed channelとして保持する。

最低限:

- evidence ID
- source turn
- kind
- bounded normalized claims / effective text digest
- observedAt
- authority
- uncertainty / revalidation policy

provider promptへ最終的に文字列化しても、application側でprovenanceを失わない。

raw image bytesをsessionへ保存する必要はない。

reload後に根拠を復元できないproposalはnon_revalidatableとしてpromotion blockする。

## 19. Promotion contract

Advice approvalは直接scheduler blockを作らない。

approved scopeを、既存Stable V5が理解するnormal planning contributionへ変換する。

### 19.1 Promotion coverage

promotion前に、approved scope内の全structured recommendationについてdeterministic coverageを作る。

概念上:

```text
mapped
  normal Stable V5 contributionへ対応済み

advisory_only
  rationale / explanation等、予定へ反映されないことが明確

blocked
  planning-relevantだがidentity / schema / capability不足で安全に反映できない
```

ユーザーが予定へ影響すると合理的に期待する内容がblockedなら、scope全体をsilent partial promotionしない。

clarification / revisionへ戻すか、ユーザーに何が反映されないか明示してnew reviewを行う。

AIはformal promotabilityを決めない。

### 19.2 Promotion operation / receipt

review decision commitとplanning side effectを一つの曖昧な処理にしない。

operationは少なくとも:

- promotion operation ID
- source decision ID
- consultation / advice revision
- target scope
- expected consultation revision
- expected context fingerprint

を持つ。

side effect前にoperationをclaimする。

retryは同一operation identityを使いduplicate planning factsを作らない。

成功後はimmutable receiptを残す。

## 20. Persistence / multi-tab contract

### 20.1 Conversation-scoped state

AdviceProposal / ReviewDecision / ValidityCheck / PromotionOperation / PromotionReceipt / PendingConsultationClarification / ActiveInteractionはFact Graphとは別のconversation-scoped persisted stateとして保存する。

renderer messagesだけへ保存しない。

### 20.2 Versioned codec

persisted consultation stateはexact versioned schemaでdeep validateする。

unknown field、malformed revision、dangling reference、lineage cycle、duplicate operation identityをfail closedする。

`is object`だけの浅いvalidationでrestoreしない。

PlanningState / nested intakeのvalidation authorityはIssue #164側でSSOT化し、#246専用の別validator policyを作らない。

### 20.3 Migration

v1 sessionにconsultation stateが存在しない場合、empty consultation stateへmigrationする。

過去assistant proseを解析してfake AdviceProposalを作らない。

migrationはidempotentにする。

### 20.4 Clear / reset / export / import

- clear conversationでconsultation stateもclear
- resetでnew conversationへcarryしない
- export/importはconsultation stateも同じvalidatorを通す
- pending async resultはcheckpoint authorityにしない

### 20.5 Same-browser multi-tab

expected revisionだけでは十分ではない。

client-runtime / Issue #164が提供するsingle-writer / mutation coordinatorを利用する。

exact technologyはclient-runtime ADRがownerとし、weekly-planningが独自Web Locks / localStorage protocol等を決めない。

formal mutationはcoordinatorを通してserializableにする。

writer権限を取得できないtabはmutationをfail closedし、必要ならread-only/stale UIを表示する。

### 20.6 Cross-device

consultation stateのcross-device syncはPhase 1非対象。

ただしfinal Plan saveは既存Issue #51のserver-authoritative uniquenessを通る。

## 21. Post-promotion change contract

ReviewDecisionとPromotionReceiptはhistoryであり、後から編集して帳尻を合わせない。

### 21.1 Plan保存前

promoted strategyを変更する場合、Stable V5のnormal correction / lifecycleを通し、影響するplanning facts / previewをinvalidate/recomputeする。

old promotion provenanceは残す。

### 21.2 Plan保存後

saved Planの変更は通常Plan edit / correction domainがowner。

Advice ledgerがsaved Planをsilent rewriteしない。

new consultationでreplacement strategyを提案できるが、適用にはnew approvalと通常correction boundaryを必要とする。

## 22. Memory boundary

Adviceはdurable memoryではない。

review feedbackも自動的にdurable preferenceへ昇格しない。

`今回は`と`今後も`をsemanticに区別する。

ユーザーが「今後もこのやり方にしたい」と明示した場合だけ、別のdurable-context contribution candidateとしてadaptive-memory / userPlanningContext ownerへ渡し得る。

## 23. Failure behavior

### Semantic routing failure

planning mutationを行わない。必要なら1回のsemantic repairまたは最小clarification。legacy parserへfallbackしない。

### Required context failure

unavailableをemptyにしない。必要sourceなしで確定proposalを捏造しない。

### Source drift

commit前fingerprint mismatchならAI resultをdiscardする。

### Provider / validation failure

accepted planning stateを変更しない。unvalidated proseからproposal/factを抽出しない。

### Ambiguous review reference

勝手に一つへbindしない。

### Old revision / consumed adoption

controlled stale/no-op。side effectなし。

### ActiveInteraction conflict

implicit short replyをmutationへ使わずclarificationする。

### Writer conflict

second tab mutationをfail closedする。

### Streaming interruption

partial textをreviewable proposalとしてcommitしない。

### Dismiss

自動再提案を停止する。

## 24. UX contract

- 手動「相談モード」切替を必須にしない。
- Advice review actionはPlan保存と誤解させない。
- advice / preview / saved Planを視覚的に区別する。
- stale revisionのbuttonはside effectを起こさない。
- review buttonは表示labelではなくformal target ID / expected revisionへbindする。
- ActiveInteractionが切り替わった場合、古い暗黙承認UIをdisabled/staleとして扱う。
- blocked promotionがある場合、何が予定へ反映できないかをユーザーへ隠さない。

候補:

```text
[この方針で進める]
[修正する]
[別の案を見る]
```

Planの最終保存は既存approval UIを使う。

## 25. Streaming contract

```text
streaming text
  presentation only

validated final structured output
+ commit-time context revalidation
  proposal commit candidate
```

formal identityはvalidation後にapplicationが付与する。

retry/resumeで同一turnからduplicate proposalを作らない。

## 26. Observability contract

product-observabilityはmetrics ownerでありruntime authorityではない。

default metricsはtyped event / reason code / IDs / statusを中心とし、raw advice textやraw supplemental evidenceを無制限保存しない。

観測候補:

- consultation route rate
- advice generation success/failure
- clarification rate
- material identity resolution rate
- review action distribution
- stale-before-present discard
- stale-at-approval block
- non-revalidatable block
- interaction-target conflict
- cross-proposal-namespace rejection
- partial-promotion block
- writer/multi-tab conflict
- promotion retry/idempotency
- provider latency / token / cost
- consultation → preview turn count

trace/metricsからruntime stateを復元しない。

## 27. Deterministic regression contract

### 27.1 Authority / review

- consultationだけでFact Graph mutationなし
- adviceだけでpreview/saveなし
- Option A approveがBへ漏れない
- approve A後に同revision B approveをreject
- item-level approvalをPhase 1でreject
- Aの教材 + Bの期限 → new revision + fresh approval
- mixed revision + schedule requestでnew revision auto-approveなし

### 27.2 Active interaction / binding

- consultation review中にplanning clarification開始 → short reply誤bindなし
- planning clarificationへの短答をconsultationへbindしない
- consultation clarificationへの短答をplanningへbindしない
- preview approvalがactiveなときold adviceへのimplicit short replyでmutationしない
- generic proposal referenceがAdviceProposalへcross-bindしない

### 27.3 Revision / concurrency

- v2生成後v1 approve reject
- stale UI command no-op
- double approveで一effect
- approve vs alternativeで一方だけcommit
- two-tab same-revision approveで一formal mutation
- writer unavailable tabはfail closed
- crash/reload後もsame operation IDでresume

### 27.4 Freshness / explanation

- answer生成中Bookshelf progress変更を検出
- answer生成中goal変更を検出
- consumedしていないsource更新で不要なstale化なし
- approval直前source変更block
- stale advice rationaleはhistorical explanationのみ
- `今もそれでいい？`をpure explanationとして処理しない

### 27.5 Context status / SSOT

- empty vs unavailable vs omittedを区別
- prompt projectionをfreshness authorityとして使わない
- owner snapshot digest変更でstale検出
- source revisionだけ変わりconsumed canonical digest同一なら不要なstale化を避けられる

### 27.6 Promotion coverage

- approved optionの全recommendationにdispositionがある
- planning-relevant blocked itemがあればsilent partial promotionなし
- advisory-only rationaleはplanning factへ変換しない
- promotion後revisionでold factsをsilent rewriteしない

### 27.7 Persistence / migration

- answer → reload → approve
- revision → reload → latestのみreviewable
- dismiss → reload → no regeneration
- malformed consultation stateをpartial restoreしない
- v1→new version migrationでproseからproposalを作らない
- clear/reset/export/import contract
- unknown nested field / malformed revisionをreject

### 27.8 Supplemental / security

- OCR instruction + legitimate scoreでscoreはdata、instructionはauthorityへ昇格しない
- supplemental provenanceをreload可能に保持
- missing evidence snapshotはnon_revalidatable
- user utteranceとsupplemental evidence矛盾時に文字列の後勝ちにしない
- delimiter / role-like textをinstruction扱いしない

### 27.9 Material / temporal

- registered material一意bind
- alias ambiguity fail safe
- same-name different edition混同なし
- unresolved material promotionなし
- display-name変更でもcatalog identity維持
- 月跨ぎ / year boundary / timezone / exam-relative target
- normalized targetをapproval時に再解釈しない

## 28. Real-model Japanese evaluation

最低限:

```text
「数学の点数を上げたいけど、どの参考書をいつまでに仕上げればいい？」
「英語が苦手なんだけど何から始めればいい？」
「この参考書難しいけど変えた方がいい？」
「金フレ終わったら次何やる？」
「なんでそれがおすすめ？」
「今もそれでいい？」
「それでいい」
「1つ目で」
「教材はそれで、期限だけ11月末にして」
「Aの教材でBの期限にして」
「AとB両方やる」
「教材はそれで、期限だけ11月末にして、そのまま予定組んで」
「その教材は嫌。別の案にして」
「いや、それも違う」
「もういい、今回はやめる」
「今後もそのやり方にしたい」
「このままで間に合う？ 無理なら少し増やして」
```

評価対象:

- route
- active interaction
- context status
- grounding
- material identity
- temporal normalization
- review scope / terminality
- proposal-family binding
- freshness
- promotion coverage
- preview boundary
- memory scope

## 29. Browser / E2E contract

最低限:

- consultation → answer: previewなし
- consultation → approve → preview
- multi-option → one option approve only
- approve A → old B action rejected
- revision → v2 → old v1 UI action rejected
- request_alternative → v2
- dismiss → no regeneration
- rationale → same proposal → approve
- stale rationale UI
- consultation review → planning clarification → short reply binding
- answer生成中context変更 → stale result not presented
- approval直前context変更 → block/regenerate
- blocked promotion → no silent preview
- reload continuity
- image-derived context → reload
- double tap approve
- two-tab mutation conflict
- desktop/mobile
- provider failure UX

## 30. Issue #246 implementation acceptance criteria

Issue #246は次をすべて満たすまでruntime完了としない。

1. consultationをplanning operationとtyped semantic上区別する。
2. raw-text regex/keyword routerをsemantic authorityにしない。
3. existing `study_advice` / LearningStrategyProposal / generic proposalと二重authorityを作らない。
4. `proposal / clarification / explanation`のstrict discriminantを持つ。
5. advice生成だけでaccepted planning state / preview / Plan / memoryを変えない。
6. AdviceProposalはimmutable lineageを持つ。
7. active leaf以外review不可。
8. one revision / one adoption terminalityを守る。
9. ActiveInteractionを単一SSOTとしてshort replyをbindする。
10. cross-option compositionはnew revisionを要求する。
11. expected revision / operation IDでreview/promotionをbindする。
12. same-browser multi-tab mutationを#164 authorityでserializeする。
13. answer commit前とapproval時にfreshnessを検証する。
14. stale explanationがcurrent recommendationを復活させない。
15. context statusを区別しowner snapshotをSSOTにする。
16. relative targetをcanonical absolute valueへnormalizeする。
17. material identityは#187 owner resolverを利用しunresolvedをpromoteしない。
18. supplemental provenanceは#152 trust boundaryを利用する。
19. promotion coverageでplanning-relevant silent partial applyを禁止する。
20. promotion/review historyをimmutableに保ちpost-promotion changeはnormal correction ownerへ渡す。
21. versioned persisted consultation stateをdeep validateする。
22. migrationでassistant proseからstateを復元しない。
23. repeated request / retry / reloadでduplicate effectなし。
24. promotion後もStable V5 readiness / scheduler / preview / Plan approval / saveを通る。
25. review feedbackをdurable memoryへ自動昇格しない。
26. deterministic calculationsをAIが上書きしない。
27. SOLID requirementsをarchitecture tests/reviewで固定する。
28. deterministic / Real API / Browser Regressionで代表flowを検証する。
29. desktop/mobile双方で主要操作成立。
30. trace/persistence変更時は該当trace gateを満たす。
31. exact current HEADでcanonical docsとimplementationが同期する。
32. current main取り込み後にauthority conflictがない。

## 31. Phased evolution

### Phase 0: contract / research / adversarial design

完了済みの範囲:

- initial requirement
- prompt/evidence design
- OSS/research pattern review
- historical regression-pattern audit
- first concurrency/persistence/freshness hardening
- seven-view SOLID / SSOT / integration audit

seven-view findingsの正仕様反映後、documentation gateを再評価する。

### Phase 1: core consultation loop

- typed consultation / review / interaction routing
- context source ports/envelopes
- context fingerprint
- answer purpose
- proposal / clarification / explanation
- AdviceProposal lineage
- proposal/option-level review
- adoption terminality
- active interaction guard
- proposal-family namespace guard
- commit/approval freshness
- versioned persistence
- same-browser multi-tab coordination via #164
- promotion coverage / operation / receipt
- material resolver via #187
- supplemental provenance via #152
- temporal normalization
- regression / Real API / Browser tests

item-level partial approval、cross-device consultation syncはPhase 1で行わない。

### Phase 2

- item-level partial approval
- richer option comparison
- richer catalog integration
- evidence detail UI
- stronger material disambiguation UX

### Phase 3

- deterministic capacity/feasibility integration
- goal/exam milestone modeling
- richer Actual/Reporting evidence
- strategy comparison / simulation

### Phase 4

- trusted external retrieval/RAG
- fresh exam/material info
- longitudinal consultation history
- performance-aware recommendation
- proactive suggestion candidate

proactive suggestionもsilent applyせず同じreview boundaryを通す。

## 32. Open implementation choices

実装時に決めてよいもの:

- exact TypeScript type/file names
- exact ID string format
- exact persisted field names
- digest/hash algorithm
- streaming有無
- context token budget値
- historical proposal compact方式
- client-runtimeが選ぶsingle-writer technology
- external retrieval導入時期

openではないもの:

- active leaf guard
- one revision / one adoption
- single active interaction target
- proposal-family namespace separation
- expected revision / idempotency
- same-browser multi-tab serialization ownership
- commit/approval freshness
- owner snapshot SSOT
- persistence deep validation
- no prose recovery
- context status distinction
- temporal canonicalization
- material resolver owner
- supplemental provenance owner
- promotion coverage
- mixed revision + approvalの再承認
- post-promotion correction ownership

## 33. Dependency / owner Issues

- #164 client-runtime: storage codec SSOT / local durable state / multi-tab coordination
- #152 security: stored/supplemental prompt injection / provenance
- #187 external/material integration: material identity / catalog / Bookshelf planning context
- #51 final Plan approval multi-device uniqueness

#246はこれらの既存ownerを利用し、duplicate Issue / authorityを作らない。

## 34. Adopted external patterns

外部事例はStudyPlannerのsource of truthではなく設計evidenceとしてのみ利用する。

OpenAI Agents SDK等から:

- approval targetをstable identityへscopeする
- managerがformal state authorityを維持する
- streaming presentationとformal approval stateを分離する

LangGraph系から:

- thread/session checkpointとlong-term memoryを分離する
- human decisionをstate transitionとして扱う
- retry side effectをidempotentにする

教育系OSS/研究から:

- learner context
- evidence
- strategy generation
- planning execution

の責任分離を参考にする。

他repoのagent数、memory model、UIをそのままコピーしない。

## 35. Seven-view audit / pre-implementation gate

2026-08-31に次の7視点で、仕様とcurrent Stable V5の双方を敵対的に監査した。

1. user-visible state transitions
2. SOLID / responsibility ownership
3. SSOT / identity / authority
4. persistence / migration / recovery
5. concurrency / idempotency / authorization
6. AI / evidence / security
7. integration / compatibility / regression / observability

監査で確認した既存owner側の問題は、新Issueを作らず以下へ統合した。

- #164: Stable V5 persisted-state validation drift、storage responsibility集中、multi-tab coordinator dependency
- #152: user utteranceとsupplemental/OCR evidenceのtyped provenance不足
- #187: registered material identity resolution policyのweekly-planning側への責任分散

誤検知として除外したもの:

- cross-week conversation continuityは既存の意図的contractでありバグ扱いしない。
- Stable V5 preview approvalのcurrent revisionはbound runtimeからFact Graph revisionへ解決されるため、表面的な別revision値だけではSSOT違反と判定しない。

この更新でseven-view auditの設計findingはcanonical specへ反映した。

ただしdocumentation gateはまだclosedにしない。

runtime implementation開始前の必須pre-flight:

1. supporting prompt/evidence designを本specへ同期する。
2. current mainをexisting branchへ取り込む。
3. exact HEADでproposal-family namespace、context owner adapters、session codec、controller cancellation、#164/#152/#187 dependencyを再確認する。
4. 新しいauthority conflictがないことを確認する。
5. その時点でdocumentation gateをcloseする。

TypeScript runtime implementationはこのgate close後に開始する。
