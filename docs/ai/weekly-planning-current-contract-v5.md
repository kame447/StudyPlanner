# weeklyPlanning current contract v5

Status: canonical / active for Stable V5 trial and remaining migration
Updated: 2026-07-24
Reviewed main baseline: `14e2184856fdbdb1f6513735e9eae3efb45c9822`

- Runtime state: [weekly-planning-stable-v5-runtime-trial-contract.md](weekly-planning-stable-v5-runtime-trial-contract.md)
- Schema registry: [weekly-planning-semantic-schema-registry.md](../architecture/weekly-planning-semantic-schema-registry.md)
- Stable V5 migration plan: [strategy/weekly-planning-semantic-stable-v5-migration-plan.md](strategy/weekly-planning-semantic-stable-v5-migration-plan.md)
- Implementation status: [strategy/weekly-planning-semantic-stable-v5-implementation-status.md](strategy/weekly-planning-semantic-stable-v5-implementation-status.md)
- Architecture: [weekly-planning-dialogue-architecture-v5.md](../architecture/weekly-planning-dialogue-architecture-v5.md)
- Availability architecture: [weekly-planning-availability-architecture-v5.md](../architecture/weekly-planning-availability-architecture-v5.md)
- Roadmap: [strategy/weekly-planning-semantic-v5-roadmap.md](strategy/weekly-planning-semantic-v5-roadmap.md)

この文書はsemantic v5とStable V5 runtime trialの最優先contractである。runtime接続、browser persistence、conversation identity、trace continuity、rollbackについてはruntime trial contractを優先する。schemaの実在世代と廃止条件はschema registryを正とする。

## 1. 意味解釈境界

raw user textからtask、quantity、time、relation、availability、correction、decision、明示的な外部予定source requestを生成する主体はsingle AI semantic normalizerだけとする。

AI出力は`WeeklyPlanningSemanticDocumentV5`であり、database state、reducer command、scheduler requestではない。AIは内部mutation command、missing slot、質問、readiness、preview可否、配置、approval、saveを決定しない。

validator、canonicalizer、resolver、readiness、dialogue、scheduler、safety層はraw textを再解釈しない。provider failure、空応答、不正JSON、schema不一致、全拒否、repair失敗でもparserへfallbackしない。repairはJSON/schema修復に限り、一turn最大一回とする。

failed/rejected turnはaccepted facts、question context、preview、proposal、draft、committed Graphを変更しない。

## 2. 汎用task model

唯一の大枠は`PlanningTask`である。

```text
PlanningTask
├─ category: study | non_study | unknown
├─ title
├─ study context / components
├─ workloads
├─ effort estimates
├─ temporal constraints
└─ recurrence
```

院試、資格試験、大学受験等をtop-level専用型にしない。院試は`category=study`、`purpose=exam`、`contextLabel=大学院入試`として表す。科目、分野、教材、章、単元、技能はcomponentで表す。

componentとworkloadの対応をID参照で保持し、配列位置へ依存しない。分類が不明なら`unknown`を許可し、計画を妨げない低影響不明を即時質問しない。

## 3. 数量、時間、availability

- workloadは作業量を表す。
- effort estimateは所要時間見積りを表す。
- temporal constraintは特定taskの開始、終了、固定区間、締切、希望、回避時間を表す。
- task date ruleは特定taskの許可日・除外日を表す。
- recurrenceはtaskまたはavailabilityの繰り返しを表す。
- planning windowは計画全体の期間だけを表す。
- plan-wide availability declarationはtaskを持たない空き、利用不可、希望、回避時間を表す。
- external source requestはtimetable、existing plans、calendarを使うという要求だけを表す。

workloadのquantity roleは次とする。

```text
declared | target | remaining | completed | unknown
```

量が明示されたが総量・残量・今回目標を確定できない場合は`declared`とする。task局所の「今週」「明日」をplanning windowへ無条件に昇格させない。

## 4. 日付、時間帯、曜日集合

AI境界で日付と時間帯を分離する。

```text
dateExpression:
  today | tomorrow | day_after_tomorrow | this_week | next_week
  | YYYY-MM-DD | custom:<原文>

namedTimePeriod:
  morning | afternoon | evening | night
  | before_sleep | before_meal | after_meal | custom:<原文>

weekday:
  sun | mon | tue | wed | thu | fri | sat
```

validator以降で日本語日時を再解析しない。ISO形だけでなく実在日付を検証する。`custom:`は捏造して解決せず、未解決としてreadinessへ返す。

非連続日を最小日から最大日までのrangeへ変換しない。曜日rangeはAI境界でcanonical weekday集合へ展開し、task-level recurrenceはplanning window内の具体日へ決定論的に解決する。exact excluded dateはrecurrence由来候補から差し引く。明示的allowed/excludedが同一日に直接衝突した場合だけblocking conflictとする。

## 5. canonical stateとtransaction

AI出力をそのまま永続化しない。deterministic coreが`WeeklyPlanningFactGraphV5`へ変換する。

- 正式ID、revision、owner、trusted metadataはcoreが発行する。
- local IDは一response内参照に限定する。
- accepted factをtask、study context、component、workload、effort、temporal constraint、task date rule、recurrence、relation、window、availability declaration、source request、uncertaintyへ分離する。
- correction、delete、decisionはstable public refとlifecycleへ適用する。
- 不完全なfactを保持し、根拠なしに補完しない。
- 一turnのcanonical commitはatomicとし、検証失敗時はrevisionを進めない。

Stable V5 document、validator、canonicalizer、Fact GraphはAlpha 1 / Alpha 2またはFact Graph V1/V2へprojectionしない。Alpha世代はlegacy evaluationと互換性記録のため残す。

runtime executorはGraph更新をrequest単位にstageする。PlanningState reducerが同じpending turnのcommitを受理した後だけGraphをfinalizeし、stale、cancel、week change、commit rejection、failure時はstageを破棄する。

## 6. external source acquisition

外部予定取得結果は次の二つだけとする。

```text
success(events)
failure(reason)
```

`success(events=[])`は正常な予定なしである。pagination等の途中結果を上位へ渡さず、途中失敗時は全体を破棄する。timeout、network、rate limit、一時的server errorは既定最大3回まで再試行する。authentication、permission、source未設定、invalid responseは自動再試行しない。

failureを予定0件とみなさない。conversationとaccepted factsを保持し、ユーザーがsourceを使わず進めると明示した場合だけ依存を解除する。owner mismatchまたは不正eventが一件でもあればimport全体を拒否する。

## 7. readinessとdialogue

accepted fact diffからgrounded acknowledgementをdeterministicに生成し、readiness policyが次の質問を選ぶ。previewを妨げる高影響不足を一度に原則一件だけ確認する。

AI normalizerはquestion target、missing優先順位、preview gateを決めない。短答結合はexpected revision、短答形、単一target、単一candidateを満たす場合だけ行う。長い別件入力、create-plan turn、availabilityやrelationを同時に含む入力を短答として誤結合しない。

provider/schema failure、security rejection、external source failureでも入力済み内容を破棄せず、最初からやり直しを要求しない。

## 8. scheduler境界

schedulerへ渡す正本はgeneric scheduler inputである。

```text
planning window
generic work items
task commitment reservations
task date eligibilities
availability windows
task relations
source fact refs
```

`exam_year`は単位の一つであり、全work itemの必須fieldではない。estimated minutes不足は推測せずreadinessへ返す。fixed taskを可動work itemとして二重配置しない。hard occupied/unavailableへ配置しない。named time period policyがなければ時刻を捏造しない。

全作業を配置できない場合はpartial previewを返さない。previewはowner、conversation、Graph revision、source fact refs、task ID、PlanTypeへ拘束する。

## 9. conversation identityとbrowser persistence

conversation、turn、request、message、local trace session、server trace handleを区別する。

```text
conversation ID: 一つの対話系列
turn ID: conversation内のuser/assistant対
request ID: 一回の非同期実行
local trace session ID: browser側の連続trace entry列
server trace handle: server repository上のcanonical session identity
```

同じconversationを復元した場合、turn/request/message IDを再利用しない。controllerは保存済みmessage IDとPlanningState revisionから単調なsequence下限を復元して次番号を発行する。

`clear_conversation`は画面に表示されるmessage履歴と最後のassistant表示だけを消す。同じconversation ID、request sequence、compatibility intake state、Fact Graph、preview、draft、approval作業状態、planning mode、persisted Stable V5 session、trace continuityを維持する。`clear_conversation`から`reset_session`を呼ばず、runtime、Graph、persisted session、trace sessionを削除しない。messagesが空になっても過去のrequest IDへ戻らない。

`reset_session`は「最初からやり直す」操作である。messages、intake、preview、draft、approval、request sequence、conversation identity、Fact Graph、persisted Stable V5 sessionを初期化し、新しいconversationを発行する。

Stable V5 browser envelopeはowner、week、conversationに拘束し、完了済みPlanningState、Fact Graph、preview、draftを一体保存する。pending turn / approval中の半端なstateは保存しない。不正envelopeを部分復元しない。

versioned payloadのdecodeは純粋処理として行い、検証のためにlive localStorage keyへpayloadを一時書込みしない。明示的saveまたはlegacy migration commit以外で保存領域を変更しない。

これは同一browser内の保存であり、server/cross-device Graph persistenceではない。旧stateからGraph V5へのmigration decoderは未実装である。

## 10. trace、privacy、observability

Stable V5 traceはuser/assistant turn、structured internal event、snapshot、preview、failureを既存repositoryへ保存する。raw provider response、stack trace、external event本文を保存しない。

physical trace continuityのscopeは`owner ID + logical conversation ID`とする。同じscopeでは、module memory消失、ページ再読込、remote repository再生成、30分を超えるidle、表示message履歴の消去があっても同じlocal trace session、連続sequence、連続turn index、同じserver-issued handleへ追記する。idle時間または空のmessage配列をconversation終了条件にしない。

metadata-only cursorからsession ID、entry sequence、turn index、recent request IDを復元する。cursorへconversation本文、Graph、semantic documentを保存しない。trace counterとrequest dedupeはrepository append成功後だけcommitし、write failureはsequenceを消費しない。

server-issued handleはowner・local sessionに拘束したlocal mappingへ保存し、repository instance再生成後も再利用する。serverがsession不存在、ownership conflict、legacy read-only、conversation conflictを明示した場合だけ再発行する。一時的network failureは同じcanonical payloadを再送する。

stored handleをowner認証の正本として扱わない。Firebase認証、server-side owner token、immutable entry、retention、admin access audit契約を維持する。過去に分割済みのlogsは自動mergeしない。

## 11. personalization

個人最適化係数をSemanticDocumentまたはFact Graphへ混ぜない。profileはaccount単位、schema version付きで保持し、coefficient、scope、context、provenance、confidence、updatedAt、feature version、weight versionを持つ。

単発のAI出力から長期係数を直接永続化せず、明示設定または計画と実績の集計を根拠に更新する。raw conversation本文をprofileへ保存しない。

## 12. migrationとcutover

新旧semantic resultを同一turnでmergeしない。production切替はexecutor単位かつsession generation単位で行う。Stable Graphを旧形式へdowngrade保存しない。

現在の順序は次とする。

```text
Stable V5 runtime trial
→ automated test / typecheck / build
→ Stable V5 real-eval
→ read-only production shadow
→ old state migration decoder / dry-run
→ cutover rehearsal / rollback verification
→ default cutover判断
→ rollback observation
→ legacy runtime deletion
```

pre-V5 fixtureとrunnerはGit履歴だけへ退避せずlegacy-eval領域で保持する。実AIを実行していない場合はreal-eval成功と書かない。runnerがstep開始前に失敗した場合は実行基盤失敗とtest failureを区別する。

## 13. current status

```text
Stable direct schema / prompt / validator       implemented
Stable normalizer / Fact Graph / lifecycle      implemented
resolver / scheduler / deterministic dialogue   runtime connected
preview / approval / Plan save                  runtime connected
browser conversation / Graph persistence        implemented
staged Graph atomic commit                       implemented
Stable V5 trace recording                        implemented
trace continuity across reload / idle            merged to main in PR #83
controller ID continuity after clear / reload    merged to main in PR #83
remote server handle continuity                  merged to main in PR #83
message-only clear conversation boundary         implemented in Draft PR #86
pure owner-bound storage decoder                 implemented in Draft PR #86
default runtime                                  legacy
server / cross-device Graph persistence          not implemented
old state migration decoder                      not implemented
production shadow invocation                     not connected
Stable V5 actual AI real-eval                     not confirmed
full browser roleplay                             not confirmed
default cutover                                   not started
```

PR #86のfocused test、full Vitest、typecheck、buildは未確認である。GitHub Actionsはstep 0件・logsなしでrunner起動前に失敗しており、code test failureとは判定しない。PR #86はDraftのまま維持する。

七視点監査は[audits/20260724-stable-v5-trace-continuity/final-overseer.md](audits/20260724-stable-v5-trace-continuity/final-overseer.md)を参照する。
