# 週間計画 汎用意味モデル v5 移行

Status: active / foundation implemented / production not connected
開始日: 2026-07-22
Branch: `test/weekly-planning-semantic-schema-eval`
PR: #77

## 1. 目的

週間計画を院試・過去問中心のcommand/state/scheduler構造から切り離し、すべての学習者と一般タスクを扱える汎用task modelへ移行する。

```text
PlanningDocument
├─ planningWindow
├─ tasks
│  ├─ category: study | non_study | unknown
│  ├─ studyDetails
│  ├─ workloads
│  ├─ effortEstimates
│  ├─ temporalConstraints
│  └─ recurrence
├─ relations
├─ uncertainties
└─ explicit external source requests (next schema revision)

PlanningFactGraph
├─ task / component / workload / effort / temporal / recurrence / relation
├─ generic work demand
└─ availability / commitment (design complete, implementation pending)
```

院試、資格試験、大学受験、高校受験、学校課題、語学、日常学習等をtop-level専用型にしない。院試は`study` taskの`purpose=exam`と`contextLabel=大学院入試`として表す。

## 2. 固定済み方針

- raw user textの意味解釈主体は単一AI semantic normalizerだけとする。
- AIはcommand、state mutation、missing slot、readiness、preview、scheduler、approval、saveを決定しない。
- AI出力は`SemanticTurnDocument`とし、後段でraw textを再解釈しない。
- provider failure、空応答、不正JSON、schema不一致、全拒否でもparserへfallbackしない。
- AI出力をそのまま永続化せず、deterministic canonicalizerで`PlanningFactGraph`へ変換する。
- task、component、workload、effort estimate、temporal constraint、recurrence、relationを独立したfactとして扱う。
- 作業量と所要時間見積りを分離する。
- task局所の期間と計画全体のplanning windowを分離する。
- workloadとavailabilityを分離する。
- timetable、existing plans、calendarの本文をAIに再生成させない。
- `examPrepScope`、分野配列と進捗配列の位置対応、`field + year`固定work itemを新しい正本に残さない。
- 新旧意味経路を同一turnでmergeしない。
- request ownership、stale rejection、preview authorization、approval、storage、security境界は維持する。

## 3. 作業手順

各作業単位の開始前に、このMD、architecture v5、availability architecture v5、current contract v5、semantic v5 roadmapを確認する。完了後は本MDへ変更、判断、注意点、検証結果を追記する。

### A. 正本文書更新

- [x] architecture v5を追加する。
- [x] v4をhistorical sourceへ降格する。
- [x] current contract v5を追加する。
- [x] semantic v5 roadmapを追加する。
- [x] documentation indexの優先参照をv5へ変更する。
- [x] availability / commitment architecture v5を追加する。

### B. SemanticTurnDocument基盤

- [x] 実験v1からproduction候補schemaを分離する。
- [x] `quantityRole = declared | target | remaining | completed | unknown`を採用する。
- [x] runtime validatorを独立moduleにする。
- [x] raw response、parse error、schema versionの観測境界をnormalizerへ接続する。
- [x] 代表fixtureとproperty testを追加する。
- [ ] temporal constraintへ`constraintLevel = hard | soft | unknown`を追加する。
- [ ] explicit constraint source requestをschemaへ追加する。

raw response本文はdiagnostics/shadow reportへ含めず、response lengthだけを記録する。

### C. PlanningFactGraphとcanonicalizer

- [x] 正式ID、revision、source factをcoreが発行する。
- [x] local ID参照、親子関係、task relationを検証する。
- [x] partial factを破棄しない。
- [x] 同一turnのatomic commitと失敗時無変更のテストを追加する。
- [x] normalizerから未保存proposalまでのtransaction準備engineを追加する。
- [ ] active/superseded/removed lifecycleを追加する。
- [ ] correction、delete、proposal decisionをstable public refへ実適用する。
- [ ] constraint source selectionとauthoritative availability importを追加する。

現在はcorrection/decisionをcanonical intentとして保持するだけであり、既存factへの破壊的適用はまだ行わない。

### D. AI semantic normalizer shadow経路

- [x] 現行interpreterとは別moduleで実装する。
- [x] production stateへ書き込まないshadow evaluatorを追加する。
- [x] request body byte、latency、parse/schema rejectionを記録する。
- [x] provider failure時にparser fallbackしないことを固定する。
- [x] 専用purpose routingを追加する。
- [x] clientからoutput token要求を送れるようにする。
- [ ] 実production turnからfeature flag付きshadow callを起動する。
- [ ] stable schemaでreal API evalを再実行する。

注: Workerは現状semantic normalizerから2400 tokenを要求されても1200 tokenへclampする。実測後にpurpose別上限を決めるまで未解決とする。

### E. Generic work item compiler

- [x] task/component/workloadから一般work demandを生成する。
- [x] `exam_year`を単位の一つとして扱う。
- [x] ordinal rangeとactual rangeを分離する。
- [x] estimated minutes不足をblocking issueとして返す。
- [x] `declared`/`unknown` quantityを保持しつつpreviewをblockする。
- [x] completed workloadを候補から除外する。
- [ ] availability window、relation、planning windowをscheduler inputへ統合する。
- [ ] 旧schedulerへのtemporary one-way adapterを実装する。

300語や20問を即座に300件/20件へ展開しない。workload fact一件を一つのwork demandとして保持し、分割は後続scheduler policyへ委譲する。

### F. Dialogue/readiness統合

- [x] accepted fact diffからgrounded acknowledgement素材を生成する。
- [x] 一度に一件の高影響質問を選ぶpure policyを追加する。
- [x] explicit authorization、conversation、revision、見積り解決を確認するpreview gateを追加する。
- [x] acknowledgementから内部unit codeを除外する。
- [ ] unified rendererへ接続する。
- [ ] exam専用rendererを削除する。

### G. Production切替と旧構造削除

- [ ] executorを新経路へ一括切替する。
- [ ] 同一turnで旧commandと新factをmergeしない。
- [ ] old persisted state migrationを実装する。
- [ ] 旧prompt、command schema、exam専用state、adapter、rendererを削除する。
- [ ] full tests、build、roleplay、real-eval、七視点監査を完了する。

## 4. 必須評価ケース

1. 院試過去問2分野＋研究15時まで＋前後関係。
2. 資格試験の分野、問題数、1問あたり時間。
3. 大学受験の科目、教材、年度、ページ、問題。
4. 学校課題の締切、時間帯、複数task。
5. 日常学習の反復、1回あたり量、希望時間帯。
6. 仕事・家事・移動と学習の混在。
7. task局所期間がplanning windowへ漏れない。
8. partial time factを保持する。
9. correctionで対象factだけを変更し、無関係factを維持する。
10. provider failure時にstateを変更せずparserへfallbackしない。
11. timetable / existing plans / calendar本文をAIが捏造しない。
12. hard occupied windowへwork itemを配置しない。
13. external source取得失敗を「予定なし」と扱わない。

## 5. 作業記録

### 2026-07-22 / API schema experiment

- GitHub Models API `openai/gpt-4.1`で院試、学校課題、仕事＋TOEIC等を評価した。
- targeted 3ケースすべてJSON Schema parse成功。
- 学校課題、仕事＋TOEICはstrict pass。
- 院試例はtask分離、2分野、数量対応、研究15時まで、前後関係を保持した。
- `total | target | remaining | completed`は早期確定を要求しすぎるため`declared`を追加する判断とした。
- GitHub Modelsは連続呼び出しで429になるため、real-evalは低頻度・再試行付きとする。

### 2026-07-22 / A: 正本文書

確認:

- 旧current contract、旧roadmap、architecture v4、docs index。

発見:

- typed command、exam compatibility、rules fallbackが新方針と競合していた。

変更:

- architecture v5、current contract v5、semantic v5 roadmap、active task MDを追加した。
- docs indexをv5優先へ変更した。
- v4は内容を削除せずhistorical sourceへ降格した。

### 2026-07-22 / B: semantic document / validator

変更:

- `weeklyPlanningSemanticDocument.ts`
- `weeklyPlanningSemanticValidator.ts`
- `weeklyPlanningSemanticValidator.test.ts`

判断:

- taskだけでなくcomponent、workload、effort、constraint、recurrence、relation、uncertainty、correction、decisionにもresponse-local IDを付ける。
- relative planning windowはsymbolicのまま保持する。
- effort/constraint/recurrenceのtargetは同一taskまたはそのcomponentに限定する。
- source excerptが空のfactを拒否する。

### 2026-07-22 / C: fact graph / canonicalizer

変更:

- `weeklyPlanningFactGraph.ts`
- `weeklyPlanningSemanticCanonicalizer.ts`
- `weeklyPlanningSemanticCanonicalizer.test.ts`
- `weeklyPlanningSemanticProposalEngine.ts`
- `weeklyPlanningSemanticProposalEngine.test.ts`

実装:

- deterministic fact ID、expected revision、duplicate turn guard、atomic proposalを追加した。
- task/component/workload所有関係とrelationを正式IDへ変換する。
- `latest_end`の`startTime=null`を維持する。
- provider failureまたはsemantic/canonical rejection時は元graphの同一参照を返す。

未解決:

- fact lifecycle、correction実適用、persisted migration。

### 2026-07-22 / D: shadow normalizer

変更:

- `weeklyPlanningSemanticNormalizer.ts`とtest。
- `weeklyPlanningSemanticShadowEvaluation.ts`とtest。
- frontend/Worker model policy。
- OpenAI-compatible clientへ`maxCompletionTokens`を追加。

実装:

- initial call＋最大一回repairだけを許可した。
- provider/schema failureでfail closedする。
- parser fallbackを持たない。
- request bytes、response length、latency、attempt、validation errorsを記録する。
- shadow reportは意味本文を返さず集計件数だけを返す。

### 2026-07-22 / E: generic work demand

変更:

- `weeklyPlanningGenericWorkItems.ts`とtest。

実装:

- `exam_year`、page、problem、word、minute等を同一contractで扱う。
- duration-per-unit、total duration、session duration、time workloadからestimated minutesを求める。
- 見積りがない場合は推測しない。
- fractional discrete unitを丸めない。
- split policyに根拠がない場合は`unknown`のまま保持する。

### 2026-07-22 / F: dialogue policy foundation

変更:

- `weeklyPlanningGenericDialoguePolicy.ts`とtest。

実装:

- accepted diff以外をacknowledgeしない。
- quantity role、range、estimate不足のうち優先度が最も高い一件だけ質問する。
- explicit user authorizationとcurrent graph revisionが一致しなければpreviewを拒否する。
- `exam_year`等の内部codeを表示せず「年分」等へ変換する。

### 2026-07-22 / availability再監査

旧`PlanningIntakeState`を再確認した結果、sleep、meal、bath、commute、fixed event、unavailable、timetable、existing plans、calendarの受け皿がv5 task/workloadだけでは不足していると判明した。

変更:

- `weekly-planning-availability-architecture-v5.md`を追加した。
- docs indexへ追加した。

判断:

- user-declared commitmentは通常のtask＋temporal constraintで保持する。
- authoritative external予定はAI出力へ入れず、coreがowner-bound sourceからAvailabilityWindowFactを生成する。
- AIは明示的なsource selection requestだけを返す。
- workload、temporal constraint、availability window、source selectionを別factにする。
- temporal constraintへ`hard | soft | unknown`が必要である。

### 2026-07-22 / 検証

- GitHub Actionsはrunner step開始前にfailureとなり、log/artifactが生成されなかった。
- 一時的にCloudflare Pagesのbuild commandへsemantic関連testを追加した。
- commit `d8e59f4`でsemantic tests、Worker routing test、TypeScript、production buildがすべて成功した。
- 検証後、`package.json`は通常のbuild commandへ復元した。
- 一時診断workflowは削除した。

## 6. 現在の注意点

- production executor、UI、repository、現行schedulerへ新経路は接続していない。
- 旧prompt、typed command、exam state、exam rendererは残っている。
- Workerのsemantic normalizer出力上限は現状1200 tokenである。
- stable alpha1 schemaにはconstraint levelとexternal source requestがまだ入っていない。
- correction intentは実適用されない。
- old persisted state migrationは未実装である。
- GitHub Actions runner問題は未解決である。
