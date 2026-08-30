# Learning Consultation and Advice Contract

Status: canonical product requirement / runtime implementation pending
Updated: 2026-08-30
Owning Issue: [#246](https://github.com/kame447/StudyPlanner/issues/246)

Parent product intent: [product-intent.md](product-intent.md)
Current production runtime: [../architecture/current-contract-v5.md](../architecture/current-contract-v5.md)
Semantic ownership: [../architecture/weekly-planning-semantic-ownership-boundary-v5.md](../architecture/weekly-planning-semantic-ownership-boundary-v5.md)
Human grounding: [../policies/human-grounding.md](../policies/human-grounding.md)
Adaptive memory: [../policies/adaptive-memory.md](../policies/adaptive-memory.md)
Material metadata: [../../external-integrations/spec/material-metadata.md](../../external-integrations/spec/material-metadata.md)
Test philosophy: [../quality/test-philosophy.md](../quality/test-philosophy.md)
Current roadmap: [../roadmap/current.md](../roadmap/current.md)

## 1. 文書の役割

この文書は、AI計画に「予定を作る前段階の学習相談」を追加するための正仕様である。

対象は、単に既存条件から予定を生成する依頼ではなく、学習方針そのものをユーザーが相談するturnである。

代表例:

- 「数学の点数を上げたいけど、どの参考書をいつまでに仕上げればいい？」
- 「英語が苦手なんだけど、何から始めればいい？」
- 「この参考書が難しすぎるけど、変えた方がいい？」
- 「金フレが終わったら次に何をやればいい？」
- 「共通テスト数学を伸ばしたい。今の教材のままでいい？」
- 「この勉強法で間に合う？」
- 「なぜその教材がおすすめなの？」

現行Stable V5は、予定作成に必要な不足情報をassistant側から確認することはできる。一方、本Issueが扱うのは逆方向、すなわちuserがStudyPlannerへ学習戦略を質問し、回答を受け、その回答を必要なら後続turnで予定へ接続する能力である。

この文書が定義するのは要求・責任境界・状態モデル・安全条件・将来発展であり、現時点でproduction runtimeにこの機能が実装済みであることを意味しない。実装完了までは [current-contract-v5.md](../architecture/current-contract-v5.md) のproduction baselineが優先される。

## 2. Product goal

AI計画を「自然言語から予定を登録する機能」だけで終わらせず、次の一連の流れを同じ対話面で成立させる。

```text
相談する
→ 方針・教材・順序・目安期限について助言を得る
→ 理由や代替案を聞く
→ 必要なら修正する
→ ユーザーが採用する
→ 既存Stable V5の計画条件へ変換する
→ preview
→ 明示承認
→ save
```

最終的なproduct outcomeは「AIがそれらしい勉強法を話すこと」ではない。

ユーザーが、自分の目標・現在地・教材・予定・進捗にgroundされた提案を理解し、採用するかを自分で決め、その意思だけが安全に既存planning runtimeへ接続されることを目的とする。

## 3. Core invariants

最重要不変条件は次である。

```text
AI-generated advice
≠ user-stated fact
≠ user-accepted planning condition
≠ preview
≠ saved Plan
≠ durable memory
```

AIが「基礎問題精講を10月末までに終えるのがおすすめ」と回答しただけでは、次のどれも成立しない。

- ユーザーがその教材を使うと決めた
- 10月末を期限として承認した
- 週間計画へ追加してよい
- 長期記憶として保持してよい
- schedulerへ渡してよい
- Planとして保存してよい

assistantの文章をmachine stateやauthorizationの代替にしない。

ユーザーの明示的なaccept / modify / rejectをsemantic layerが意味として解釈し、deterministic applicationが対象proposal、scope、revisionを検証した後にだけ、採用された範囲をplanning inputへpromoteできる。

## 4. Product scope

### 4.1 対象とする相談

初期実装は、予定作成と意味的に接続できる学習相談を対象とする。

例:

- 学習戦略: 何から始めるべきか、どの順序がよいか
- 教材選択: どの教材を使うべきか、今の教材を継続すべきか
- 教材遷移: この教材の次に何をやるべきか
- 目標分解: 目標点までにどの段階をいつまでに終えるべきか
- 期限提案: 参考書や範囲をいつまでに終えるのが妥当か
- feasibility explanation: 今のペース・残り時間・既存予定で現実的か
- 学習方法: 復習頻度、演習中心か講義系を挟むか等
- 比較: AとBのどちらを選ぶか、複数案のtrade-off
- 理由説明: なぜその順序・教材・期限を推すのか

### 4.2 初期非対象

次はIssue #246の初期実装へ混ぜない。

- StudyPlannerと無関係な汎用雑談assistant化
- AI回答から直接Planを書き込むshortcut
- 「数学ならこの参考書」のような巨大な決定論的教材heuristic表
- 教材推薦だけを目的とするランキングサービス
- Web全体を無制限に検索するautonomous research agent
- 学習科学の高度な個人モデルを最初から全面導入すること
- AI回答を自動的に長期記憶へ保存すること
- Goal / Bookshelf / Timetable / Actual / Reportingのsource of truthを相談機能へ複製すること
- consultation専用の独立UI modeを必須にすること

## 5. Existing StudyPlanner boundariesとの関係

この機能はStable V5の原則を変更するのではなく、予定作成より手前にadvisory branchを追加する。

### AIが所有する意味

- current turnが相談・助言要求を含むか
- 何について相談しているか
- 学習目標、教材、科目、期限、比較対象等の自然言語上の意味
- 「それで」「2つ目で」「教材はそれ、期限は11月末で」等のproposal response / contextual reference
- `今回は` / `今後も` 等のscope meaning
- recommendationに必要な曖昧さが自然言語上存在すること

### Deterministic applicationが所有するもの

- consultation routeを実行可能状態として受理するか
- source-of-truthごとのcontext取得
- context budget / provenance / revision
- advice ID / option ID / item ID
- advice lifecycle
- stale判定
- accept / modify / reject対象の正式binding
- promotion transaction
- idempotency
- planning Fact Graphへ入れる正式な構造
- readiness / scheduler / preview / approval / save
- persistence / sync / recovery

### Answer AIが所有するもの

- grounded contextに基づく学習戦略・教材選択・順序・説明の生成
- 複数案の比較やtrade-offの言語化
- 不確実性や前提の説明
- deterministic calculationやcatalog evidenceを人間が理解しやすい形で説明すること

Answer AIはformal lifecycle、scheduler placement、approval、saveを所有しない。

## 6. Intent / turn routing contract

### 6.1 `question`という語を既存意味と衝突させない

現行weekly planningでは、applicationがユーザーへ不足情報を聞くclarification actionとして`question`概念を使っている。

Issue #246が扱う「userがassistantへ質問すること」を同じmachine labelへ雑に重ねない。

少なくとも概念上、次を区別する。

```text
assistant clarification
  application → userへ質問

user consultation
  user → StudyPlannerへ学習相談
```

exact TypeScript名は実装時にcurrent schemaへ合わせて決めるが、責任の混同は禁止する。

### 6.2 初期routingは粗く保つ

production semantic routingを、教材名や科目ごとの大量keyword/regexにしない。

初期責任は概念上、少なくとも次の大分類を安全に分けられればよい。

```text
planning_operation
consultation
other / unsupported / unresolved
```

必要ならevaluation・analytics上のsubtypeとして次を持てる。

```text
learning_strategy
material_selection
material_transition
sequence_recommendation
target_or_deadline_recommendation
feasibility_explanation
learning_method
comparison
rationale
```

subtypeは「この語が入っていたらこの処理」のheuristic authorityにしない。

### 6.3 mixed turn

次のようなturnは単純なsingle-label分類では足りない。

```text
「このままで間に合う？ 無理なら少し増やして」
```

これはconsultationとconditional mutationを同時に含み得る。

現行Stable V5のcandidate-level partial acceptanceがどこまで保証されるかを実装前に監査し、未保証の状態でraw textを分割するad-hoc parserを追加しない。

安全に一括処理できない場合は、意味を失わない最小のclarificationまたは段階処理へ落とす。

## 7. Orchestration model

### 7.1 Manager patternを採用する

StudyPlanner applicationが会話・状態・正式なlifecycleのownerであり続ける。

consultationを検出した後、専用のanswer purposeへ質問とgrounded contextを渡す。

```text
user turn
→ Stable V5 semantic interpretation
→ validated consultation contribution
→ deterministic consultation orchestration
→ bounded ConsultationContext
→ learning-advice answer purpose
→ validated AdviceAnswerDocument
→ deterministic AdviceProposal lifecycle
→ user-facing response
```

「別のAIへ渡す」とは、必ずしも別provider・別modelを意味しない。

必要なのは少なくとも次の分離である。

- separate purpose
- separate prompt / instruction contract
- separate input envelope
- separate output validation
- separate metrics
- authorityの分離

同一modelを利用してもこの境界を守れる。

### 7.2 Full handoffを初期設計にしない

consultation agentへconversation authorityを丸ごと移すhandoffより、applicationが中心に残りspecialistをtool-likeに呼ぶmanager patternを優先する。

理由:

- Stable V5の正式state ownerを維持できる
- adviceからschedule mutationへの越権を防ぎやすい
- proposal lifecycleを一箇所で管理できる
- trace / cost / security policyを統一できる
- 後からanswer providerを差し替えやすい

## 8. ConsultationContext grounding

### 8.1 原則

回答AIへ質問本文だけを渡さない。

recommendationに関係するStudyPlanner内の利用可能情報を、source ownerを壊さないread-only contextとして組み立てる。

```text
source domain
→ bounded read model / context projection
→ ConsultationContext
→ answer AI
```

contextへ含めたからといって、元データをweekly planning Fact GraphやMemoryへ複製しない。

### 8.2 Context source候補

質問との関連性に応じて次を利用できる。

- current conversation / accepted planning state
- user-stated goal / durable planning context
- Bookshelfの登録教材、alias、progress、pace metadata
- material catalog identity / bibliographic metadata
- Timetable
- existing Schedule / Plan
- Actual / observed study evidence
- Reportingが所有するdeterministic aggregate
- planning availability / capacity signal
- exam / goal dateのauthoritative sourceが存在する場合その情報
- accepted current-session constraints

すべてを毎回渡すことは要件ではない。relevanceとtoken/privacy budgetでboundedにする。

### 8.3 Provenance

context itemは概念上、少なくとも次を追跡できる必要がある。

- source domain
- source identity
- source revision / updated basis when available
- authority
- scope
- observation / retrieval time when relevant

recommendation textだけを保存し、何を根拠にしたかを失う設計にしない。

### 8.4 Bookshelf boundary

Bookshelfは登録教材とユーザー固有進捗のsource of truthである。

consultationが登録教材を参照しても、`scope_total`、`completed`、`currentUnit`等を「AIが言った事実」として複製しない。

material aliasが一意に解決しない場合は1冊へ勝手にbindしない。

### 8.5 External material metadata boundary

共有catalog / NDL等の外部書誌は教材identity・ページ数・目次等のevidenceであり、「その教材をやるべき」という学習判断のauthorityではない。

provider固有responseをanswer promptやdomain stateへ直接漏らさない。

## 9. Knowledge and evidence tiers

教材・学習戦略回答では、根拠の強さを区別する。

### Tier 1: user-owned authoritative context

- 明示目標
- 登録教材
- 現在進捗
- 実際の学習実績
- 試験日
- 既存予定
- 明示的な制約・希望

### Tier 2: StudyPlanner-owned normalized knowledge

- curated material identity
- alias / series identity
- shared bibliographic catalog
- StudyPlannerが正式に保持する教材metadata

### Tier 3: trusted external retrieval

将来導入するRAG / Web / provider検索。

導入時は [../../external-integrations/](../../external-integrations/README.md) の責任としてprovider、利用条件、normalization、fallbackを定義する。

### Tier 4: model general knowledge

一般的な学習法、典型的な教材の位置付け、教育的な説明等。

model-only knowledgeを、最新の版・ISBN・ページ数・公式難易度等の確定事実として話さない。

named commercial materialを推奨する場合、可能ならStudyPlanner catalog identityへ解決する。解決不能でも助言を完全禁止する必要はないが、存在・版・metadataを捏造しない。

## 10. AdviceAnswerDocument

assistant proseだけをmachine stateの唯一の表現にしない。

answer purposeは、概念上次を含むvalidated structured resultを返す。

```text
AdviceAnswerDocument
├─ user-facing explanation
├─ recommendation / option candidates
├─ rationale
├─ assumptions
├─ uncertainty
├─ evidence/provenance references
├─ possible planning implications
└─ whether one missing input materially blocks a useful answer
```

exact field名・schema versionは実装時にcurrent TypeScript contractがownerとなる。

この文書が固定するのは責務であり、将来のfield名ではない。

### 10.1 Recommendation item

予定へ昇格する可能性がある内容は、文章中の位置ではなくstable item identityを持てるようにする。

例:

```text
Option A
- material: 基礎問題精講
- milestone: 基礎例題を完了
- suggested target date: 10月31日

Option B
- material: 青チャート
- milestone: 重要例題を中心に進める
- suggested target date: 11月15日
```

後続の「2つ目で」をoption identityへbindできることが重要である。

### 10.2 Uncertainty

根拠が薄いrecommendationを確定口調にする必要はない。

ただし、未校正の架空確率を毎回表示することも禁止する。

初期段階は定性的なuncertaintyとassumptionでよい。

例:

- 現在得点が不明なので、基礎不足を仮定した案
- 教材の版が一意に特定できていない
- 実績データが少ないので必要時間は概算

## 11. Question economy for consultation

consultationを検出した後、通常planningのslot-fillingへそのまま流してはいけない。

「良い回答を作るためにあると便利な情報」と「無いと回答が実質的に変わるblocking information」を分離する。

原則:

- known contextを聞き直さない
- recommendationが大きく変わる不足だけを質問する
- 仮定を明示すれば有用な回答を出せるなら、先にprovisional adviceを出してよい
- 1turnで大量のプロフィール入力を要求しない
- 「わからない」を許容する
- planning開始時に必要なslotをconsultation開始時から全部聞かない

例えば「数学の点数を上げたい、どの参考書をやればいい？」では、target examや現在レベルがrecommendationを大きく変える可能性がある。一方、無関係な教材の進捗率まで機械的に質問する必要はない。

## 12. Deterministic calculation boundary

consultationには2種類の判断が混在する。

### 12.1 決定論的に計算できるもの

例:

- 残り500語を25学習日で終えるなら1日20語
- 既存予定を考慮した利用可能学習時間
- accepted progressからremainingを算出
- explicit deadlineまでの日数
- scheduler / capacity engineが正式に返したfeasibility

これらはdeterministic applicationが数値のsource of truthとなり、answer AIは説明だけを担当する。

### 12.2 戦略判断

例:

- どの参考書が現在地に合いそうか
- どの順番で教材を進めるか
- 基礎へ戻るべきか演習へ進むべきか
- 何を優先すべきか

これらはevidence-grounded advisory judgmentとしてAIが生成できる。

AIがscheduler計算を想像して「余裕で間に合います」と断定しない。feasibilityが重要なら正式なdeterministic signalをcontextとして受け取る。

## 13. AdviceProposal lifecycle

consultation回答はconversation-scoped advisory stateとして保持する。

概念モデル:

```text
AdviceProposal
├─ adviceId
├─ owner / conversation
├─ source question turn
├─ structured options/items
├─ assumptions
├─ evidence refs
├─ context revision fingerprint
├─ createdAt
└─ lifecycle
```

lifecycleは少なくとも次を表現できる設計にする。

```text
presented
→ accepted
→ modified
→ rejected
→ superseded
→ stale
```

すべてを単純なboolean `accepted`に潰さない。

### 13.1 `accepted`の意味

ここでのacceptedは「ユーザーがこの助言の全部または一部をplanning intentとして採用した」という意味である。

saved Planになったことを意味しない。

```text
advice accepted
→ planning contributionへpromotion
→ Stable V5 readiness
→ scheduler
→ preview
→ user approval
→ save
```

### 13.2 Item-level scope

将来的な複数案・部分採用に備え、proposal全体だけでなくoption/item単位のidentityを持てる構造を優先する。

例:

- 「教材はAで、期限はB案より遅くして」
- 「2つ目だけ予定にして」
- 「教材はそのまま、復習方法だけ変えたい」

## 14. Adoption / promotion contract

### 14.1 User response

userが次のように返せる。

- 「それで予定組んで」
- 「1つ目で」
- 「教材はそれで、期限だけ11月末にして」
- 「やっぱその案なし」
- 「今後もそのやり方にしたい」

semantic layerはnatural-language meaningとcontextual referenceを構造化する。

### 14.2 Deterministic binding

applicationは次を確認する。

- referenced advice / itemが現在conversationに存在する
- lifecycleが適用可能
- ownerが一致する
- revision / source contextが許容範囲
- ambiguous referenceでない
- 同一adoption operationがすでに適用済みでない

### 14.3 Stale advice

recommendation生成後に重要sourceが変わった場合、古いadviceを黙って適用しない。

例:

- target exam dateが変更
- material progressが大幅更新
- referenced materialが削除・変更
- current goalがsuperseded
- planning availabilityが大きく変更し、期限recommendationの前提が崩れた

stale adviceは履歴として表示できるが、promotion前にrevalidation / regeneration / targeted clarificationのいずれかを行う。

staleness判定のexact fingerprintは実装時に定義するが、少なくとも「生成時の根拠を失ったadviceをそのまま正式条件にする」ことは禁止する。

### 14.4 Promotion result

promotionはscheduler blockを直接生成しない。

accepted advice scopeを、既存Stable V5が理解する通常のplanning contribution / typed factsへ変換し、以後は既存runtimeへ渡す。

これによりconsultation-specific logicがschedulerの第二ownerになることを防ぐ。

## 15. Memory and persistence boundary

### 15.1 Adviceは長期記憶ではない

AIが生成したrecommendationを「ユーザーについて知っている事実」としてuser planning contextへ自動保存しない。

```text
assistant: 「英単語は朝15分がおすすめです」

→ advice
→ user preferenceではない
```

一方、userが

```text
「今後も英単語は15分ずつにしたい」
```

と表明した場合、これはadvice acceptanceとは別にdurable user-context candidateになり得る。

そのpromotionは [adaptive-memory.md](../policies/adaptive-memory.md) と `userPlanningContext` のauthority/lifecycle規則がownerとなる。

### 15.2 Conversation/session state

AdviceProposalは初期状態ではconversation/session-scoped stateとする。

cross-device persistence、cloud authority、reconciliation、offline behaviorは [../../client-runtime/](../../client-runtime/README.md) と関連Issueの責任であり、このspecが特定storage providerを固定しない。

logical identity / lifecycle / stalenessはstorage方式に依存せず維持する。

## 16. UX contract

### 16.1 Same conversation surface

ユーザーへ「相談モード」「予定作成モード」の手動切替を要求しない。

AiPlanningの同じ会話面でsemantic routingする。

### 16.2 MVP

初期UIで最低限必要なのは次である。

- userが自然文で相談できる
- assistantが自然な回答を返す
- 回答だけでpreviewが勝手に出ない
- userが自然文で採用・修正・拒否できる
- 採用後は既存planning previewへ移行する
- adviceとpreview / saved planが視覚・状態上区別される

### 16.3 Future UI

将来は次を追加できる。

- 「この方針で予定を作る」action
- 複数案カード
- option比較
- recommendation itemの部分選択
- rationale / evidence detailsのprogressive disclosure
- 「前提が変わったので再提案」表示
- advice history

buttonはsemantic authorizationを補助できるが、button表示自体をformal acceptanceにしない。実際のapplication commandとして対象IDを明示的に送る。

## 17. Streaming contract

answer generationをstreaming表示してもよいが、partial tokenをmachine stateの正本にしない。

```text
streaming text
→ presentation only

validated final answer envelope
→ AdviceProposal commit candidate
```

途中切断、provider error、validation failure時に半分の文章をvalid AdviceProposalとして残さない。

resume/retryで同一turnから重複proposalを作らないidentity設計を持つ。

## 18. Failure behavior

### Semantic routing failure

validated consultation meaningが得られない場合、planning mutationを行わない。

必要なら1回のsemantic repairまたは最小clarificationへ落とす。legacy raw-text parserへfallbackしない。

### Context source failure

sourceを`required`と`optional`に分けられる設計にする。

required sourceのload failureを「データが0件だった」とみなさない。

optional sourceが取れなくても有用な回答が可能なら、前提・制約を明示してdegradeできる。

### Answer provider failure

accepted planning stateを変更しない。

架空のfallback adviceを作らない。

### Output validation failure

current AI contractが許す範囲でsemantic/structured repairを最大1回行える。

修復できなければcontrolled failureとし、未検証proseからplanning factsを抽出しない。

### Ambiguous advice reference

「それ」が複数advice/optionへ対応する場合、勝手に一つへbindしない。

### Stale advice

古い根拠のadviceを直接promoteしない。

### External retrieval failure

model knowledgeで回答を継続できる場合も、最新書誌等を捏造しない。必要ならidentity解決不能を表示する。

### Streaming interruption

partial responseをaccepted/presented proposalとしてcommitしない。

## 19. Security boundary

相談機能はprompt injection surfaceを増やすため、Issue #152のsecurity contractと整合させる。

- Bookshelf title / note / imported metadataはuntrusted data
- Memory textもinstructionではなくdata
- external retrieval contentもinstructionではなくevidence
- retrieved text中の「system instruction」等を実行しない
- advice AIはschedule/save authorizationを持たない
- advice resultからtool execution permissionを導出しない
- provenanceを失ったstored proseをsource of truthにしない
- user-facing answerとdiagnostic traceのprivacy boundaryを分離する

## 20. Observability

service-wide metricsは [../../product-observability/](../../product-observability/README.md) がownerであり、weekly planningはtyped eventを供給する側に留まる。

将来計測候補:

- consultation route rate
- semantic route accuracy evaluation
- answer前clarification数
- advice generation success/failure
- named material identity resolution rate
- advice → adoption rate
- partial adoption / modify / reject rate
- regeneration rate
- stale adoption block rate
- provider latency
- token / cost
- consultationからpreviewまでのturn数

`adoption rateを最大化する`ことをquality goalにしない。

ユーザーがadviceを拒否・修正できること自体が正常なproduct behaviorである。

raw conversationや個人情報をanalyticsのために無制限保存しない。

## 21. Test and evaluation contract

実装PRは次を最低限保護する。

### 21.1 Deterministic tests

- consultation turnだけでaccepted planning Fact Graphをmutationしない
- advice生成だけでpreview/saveへ進まない
- AdviceProposal lifecycleがexplicitである
- explicit semantic acceptanceなしにpromotionしない
- rejectされたadviceを適用しない
- modifyは正しいadvice/itemだけへ作用する
- ambiguous referenceはfail safeする
- stale adviceは直接applyできない
- repeated adoption/retryがduplicate planning effectを作らない
- advice textがdurable memoryへ自動昇格しない
- durable scopeをuserが明示した場合だけ別memory candidateになり得る
- Bookshelf source factsをFact Graphへ複製しない
- deterministic calculation resultをanswer AIが書き換えない
- required context load failureをempty contextとして扱わない
- provider/validation failureでaccepted stateを壊さない
- partial streaming outputをvalid adviceとしてcommitしない
- untrusted stored contentをinstruction扱いしない

### 21.2 Real-model Japanese evaluation

少なくとも次を自然な会話として評価する。

```text
「数学の点数を上げたいけど、どの参考書をいつまでに仕上げればいい？」
「英語が苦手なんだけど何から始めればいい？」
「この参考書難しいけど変えた方がいい？」
「金フレ終わったら次何やる？」
「なんでそれがおすすめ？」
「じゃあそれで予定組んで」
「教材はそれで、期限は11月末にして」
「2つ目の案で」
「やっぱさっきの案なし」
「今後もそのやり方にしたい」
「このままで間に合う？ 無理なら少し増やして」
```

見るべきもの:

- semantic route
- context selection
- recommendation grounding
- assumptions
- lifecycle
- reference binding
- promotion delta
- preview boundary
- memory scope

完成日本語の一字一句をuniversal oracleにしない。

### 21.3 Browser / E2E

- consultation → answer: previewは出ない
- consultation → accept: existing planning previewへ遷移
- consultation → modify → accept
- consultation → reject
- multi-option → one option adoption
- reload後のsession continuity
- stale advice handling
- desktop/mobile
- provider failure UX

## 22. Issue #246 implementation acceptance criteria

Issue #246のruntime実装は、少なくとも次がすべて成立して完了とする。

1. 学習戦略・教材選択等のuser consultationを通常の予定作成要求と安全に区別できる。
2. raw-text regex/keyword routerを新たなsemantic authorityとして導入していない。
3. consultation時に関連するStudyPlanner contextをsource ownershipを壊さず利用できる。
4. answer AIがvalidated structured adviceを返し、proseだけをmachine truthにしない。
5. advice生成だけではaccepted planning state、preview、Plan、durable memoryが変化しない。
6. userがadviceをaccept / modify / rejectできる。
7. 「それで予定組んで」等を正しいadvice identityへbindできる。
8. adoption後も既存Stable V5 readiness / scheduler / preview / approval / saveを通る。
9. stale / ambiguous / failed adviceをsilent applyしない。
10. repeated request / retry / reloadでduplicate planning effectを作らない。
11. Bookshelf等のauthoritative dataを不必要に複製しない。
12. current-week acceptanceとdurable preferenceを分離する。
13. deterministic calculationはapplication-owned truthのまま維持する。
14. security / prompt-injection boundaryをIssue #152と整合させる。
15. deterministic regression、Real API evaluation、Browser Regressionで代表flowを検証する。
16. desktop/mobile双方で相談→採用→previewの主要操作が成立する。
17. trace/persistence変更がある場合はfeature-local `AGENTS.md` のtrace persistence gateを満たす。
18. current canonical docsを実装と同じPRで同期する。

## 23. Phased evolution

### Phase 0: contract / research / eval design

この文書と関連canonical docsを整備する段階。

runtime behaviorは変更しない。

実装前に、semantic representation、state owner、promotion boundary、context source、failure behaviorをレビュー可能にする。

### Phase 1: core consultation loop

- coarse semantic consultation route
- bounded internal context
- separate answer purpose
- validated structured advice
- conversation-scoped AdviceProposal
- natural-language accept / modify / reject
- accepted scopeをexisting Stable V5へpromotion
- regression / Real API / Browser tests

最初から外部Web検索を必須にしない。

### Phase 2: material grounding and richer review

- named material catalog resolution
- evidence/provenance details
- multiple options
- option/item identity
- partial adoption
- 「この方針で予定を作る」UI action
- better stale detection

### Phase 3: planning intelligence

- deterministic capacity / feasibility integration
- goal / exam milestone modeling
- stronger Actual / Reporting evidence
- strategy comparison
- alternative simulation
- plan consequence explanation

### Phase 4: retrieval and longitudinal coach

- trusted external retrieval / RAG
- fresh material/exam information
- consultation history
- performance-aware recommendation
- evidence-backed personalized strategy
- proactive suggestion candidate

proactive suggestionもsilent applyせずproposal lifecycleを通す。

### Phase 5: research-grade adaptation

十分な実データ・評価基盤ができた後に検討する。

- knowledge tracing
- forgetting / recall modeling
- skill graph
- learner state estimation
- counterfactual strategy evaluation
- long-horizon adaptive curriculum

高度なモデルを導入しても、user approval / source ownership / deterministic scheduling境界を外さない。

## 24. Design decisions and rejected alternatives

### Decision A: 巨大heuristic表を作らない

却下:

```text
数学 + 偏差値50 → 教材A
英語 + TOEIC600 → 教材B
...
```

理由:

- 教材・試験・版・学習目的の組合せが増え続ける
- maintenance負債が大きい
- raw language semanticsとrecommendation knowledgeが混ざる
- StudyPlanner applicationが教育知識の巨大rule engineになる

代わりに、AI advisory judgmentをsource-groundedに利用する。

### Decision B: raw LLM chatbotにschedule mutationさせない

却下:

```text
user question
→ LLM
→ LLMが直接Plan作成
```

理由:

- adviceとauthorizationが混ざる
- Stable V5のpreview/approval境界を破る
- retry / stale / multi-device / identityを安全に扱えない

### Decision C: AI回答を長期記憶のtruthにしない

assistantが提案した内容はuser factではない。

長期記憶へ入れるには別のuser-stated durable meaningが必要。

### Decision D: specialistへのfull conversation handoffを初期採用しない

application managerがauthorityを維持し、answer purposeをspecialistとして呼ぶ。

### Decision E: advice textから後でregex抽出しない

promotion可能な情報は生成時にstructured itemとして保持する。

renderer proseはpresentationであり、後段parserのsource of truthにしない。

## 25. Open implementation decisions

次は実装開始時にcurrent code/schemaと照合して決める。これらが未決だからといって上記invariantを弱めてよいわけではない。

- semantic document内でconsultation contributionをどう表現するか
- mixed consultation + mutation turnをどこまでatomicに扱うか
- answer purposeのexact identifier
- AdviceAnswerDocumentのexact schema
- AdviceProposalの永続化場所
- context sourceごとのrequired / optional分類
- context budgetとselection policy
- stale fingerprintのexact構成
- material identity resolutionを必須にする条件
- initial UIでstreamingを使うか
- MVPでoption-level acceptanceまで入れるか
- action buttonをPhase 1へ含めるかPhase 2にするか
- external retrievalをいつ導入するか
- goal domainが正式導入された後のcontext ownership
- cross-device advice stateのauthority / reconciliation

## 26. Dependency / ownership map

```text
weekly-planning
  owns: consultation routing contract, advice lifecycle, promotion into planning

Bookshelf / StudyMaterial
  owns: registered material identity, user progress, user-specific material state

userPlanningContext
  owns: durable explicit user context / preference

external-integrations
  owns: provider adoption, retrieval, normalization, quota/terms/fallback

reporting
  owns: deterministic user-facing Actual aggregation when consultation consumes it

client-runtime
  owns: local/cloud/sync authority and reconciliation

product-observability
  owns: service-wide consultation/adoption/cost metrics and bounded admin read models

weekly-planning trace
  owns: detailed diagnostic evidence for this runtime only
```

一つのdecisionに複数ownerを作らない。

## 27. Research evidence and adopted patterns

調査結果はStudyPlannerのsource of truthではなく、設計判断のevidenceとして保持する。

### 27.1 Tier A: agent runtime / HITL implementation patterns

#### OpenAI Agents SDK

Repository:
- https://github.com/openai/openai-agents-python

Relevant docs:
- https://github.com/openai/openai-agents-python/blob/main/docs/human_in_the_loop.md
- https://github.com/openai/openai-agents-python/blob/main/docs/agents.md
- https://github.com/openai/openai-agents-python/blob/main/docs/handoffs.md

Observed pattern:

- approval-required operationをinterruptとして停止できる
- serializable run stateを保持してresumeできる
- approve / rejectは具体的なpending callへscopeされる
- streamingでもapproval boundary自体は変えない
- managerがspecialistをtool-likeに呼ぶpatternとconversation handoffを分ける

StudyPlannerへの採用:

- advice adoptionをprose推測ではなくfirst-class lifecycleにする
- stable advice/item identityを持つ
- application managerが正式state ownerに残る
- partial streamingをformal stateにしない

採用しないもの:

- generic tool approval modelをそのままStudyPlanner domain modelにコピーすること
- consultation specialistへplanner authorityを委譲すること

#### LangGraph / LangGraphJS

Repositories:
- https://github.com/langchain-ai/langgraph
- https://github.com/langchain-ai/langgraphjs

Observed pattern:

- thread-scoped checkpoint stateとcross-thread long-term storeを分ける
- interrupt / resumeにはdurable thread identityが必要
- resume/retry時のside effectはidempotencyを考慮する必要がある
- human edit / approve / rejectをstate transitionとして扱う

StudyPlannerへの採用:

- AdviceProposalはconversation/thread state、durable preferenceは別memory responsibility
- adoptionはidempotent operationにする
- resume/reloadを前提にidentity / revisionを持つ

採用しないもの:

- LangGraph自体を依存ライブラリとして導入する判断
- graph frameworkの型をStudyPlanner domain contractに流用すること

### 27.2 Tier B: education / research architecture evidence

#### GenMentor

Repository:
- https://github.com/GeminiLight/gen-mentor

Observed pattern:

学習支援を、learner model、skill gap identification、learning path scheduling、content generation、chat tutor等の責務へ分ける。

StudyPlannerへの採用:

- learner/context理解、strategy recommendation、schedulingを一つのmonolithic LLMへ集約しない
- recommendationとscheduler authorityを分離する

#### OATutor

Repository:
- https://github.com/CAHLR/OATutor

StudyPlannerへの示唆:

- adaptive tutoringではlearner evidenceとinstructional policyを分けて評価する必要がある
- 将来personalizationを入れても、単一会話から強いlearner truthを作らない

#### TASA

Repository:
- https://github.com/YANGWU001/TASA

StudyPlannerへの示唆:

- persona / event memory / forgetting-aware learner stateのような長期適応は将来方向として有用
- 初期Issue #246へ重いlearner modelを持ち込まず、まず観測・authority・memory scopeを正しく分ける

### 27.3 Tier C: exploratory OSS product patterns

#### Tutor MCP

Repository:
- https://github.com/ArnaudGuiovanna/tutor-mcp

StudyPlannerへの示唆:

algorithmic state、episodic memory、narrative contextを分け、LLMに十分なcontextを渡しつつschedule authorityを持たせない設計はStudyPlannerの境界と近い。

#### edu-agent

Repository:
- https://github.com/StudentTraineeCenter/edu-agent

StudyPlannerへの示唆:

RAG-grounded tutor、weak-point awareness、personalized study planは将来retrieval/context方向の参考になる。

#### Adaptive Educational AI Agent

Repository:
- https://github.com/Felipeegert/Adaptive-Educational-AI-Agent

StudyPlannerへの示唆:

deterministic business ruleとLLM explanationを分けるpatternは、数値計算/feasibilityとadvice explanationの境界に適用できる。

#### AiTutor

Repository:
- https://github.com/yaswanth-jogireddy/AiTutor

StudyPlannerへの示唆:

学習目的・syllabusを会話で調整し、userが修正できるflowは「planを作る前に方針を相談する」UXの参考になる。

#### OpenTutor

Repository:
- https://github.com/zijinz456/OpenTutor

StudyPlannerへの示唆:

教材grounding、citation、adaptive workspace、study planを組み合わせる方向はPhase 4以降の参考になる。

#### StudyPal

Repository:
- https://github.com/adnanahmaddev/StudyPal

StudyPlannerへの示唆:

複数の学習支援modeでもconversation continuity / shared contextを維持するUXは、「相談モード」を手動切替させない方針と整合する。

### 27.4 Evidenceの使い方

上記OSSを「実装例があるから正しい」と扱わない。

判断優先順位は次とする。

```text
StudyPlanner current code / tests
→ StudyPlanner canonical contract
→ Issue #246 product requirement
→ established framework / research evidence
→ exploratory OSS pattern
```

他repoの型・agent数・memory構造・UIをそのままコピーせず、StudyPlannerの責任境界へ変換して採用する。

## 28. Pre-implementation gate

Issue #246のproduction code実装へ入る前に、最低限次を満たす。

1. このcanonical specがreview可能な状態でmainへ入っている。
2. `DOCUMENT_DICTIONARY.md`、weekly-planning domain index、product intent、runtime boundary、grounding/memory/test/roadmapの参照関係が矛盾していない。
3. Issue #246本文はこのspecを正本として参照し、詳細仕様を二重管理していない。
4. current production runtimeとplanned requirementを文書上で混同していない。
5. mixed turn、advice lifecycle、staleness、promotion、memory scopeの未決事項が実装前レビュー対象として可視化されている。
6. future code PRはこのspecを参照し、PR本文やpromptだけを新しい正仕様にしない。

このgateを満たすまでは、Issue #246のruntime implementationを開始しない。
