# 週間計画 汎用意味モデル v5 移行

Status: active / semantic, availability, specific-date, scheduler-input, personalization-profile foundations implemented / production not connected
開始日: 2026-07-22
Branch: `test/weekly-planning-semantic-schema-eval`
PR: #77

## 1. 目的

週間計画を院試・過去問中心のcommand/state/scheduler構造から切り離し、すべての学習者と一般タスクを扱える汎用task modelへ移行する。

```text
SemanticTurnDocument
├─ planning window
├─ tasks
│  ├─ study | non_study | unknown
│  ├─ study details / components
│  ├─ workloads
│  ├─ effort estimates
│  ├─ temporal constraints
│  ├─ task date rules
│  └─ recurrence
├─ relations
├─ availability declarations
├─ explicit external source requests
├─ uncertainties
├─ corrections
└─ decisions

PlanningFactGraph
├─ task / component / workload / effort
├─ temporal constraint / task date rule / recurrence / relation
├─ availability declaration / source request
└─ correction / decision intent

Resolved planning materials
├─ generic work demand
├─ fixed task reservation
├─ task allowed / excluded dates
├─ whole-day and clock-based availability windows
└─ external source selection
```

個人最適化は一回の計画factへ混ぜず、アカウント単位のversion付きprofileとして保持する。

## 2. 固定済み方針

- raw user textの意味解釈主体は単一AI semantic normalizerだけとする。
- AIはcommand、state mutation、missing slot、readiness、preview、scheduler、approval、saveを決定しない。
- AI出力後にraw textを再解析しない。
- provider failure、空応答、不正JSON、schema不一致、repair失敗でもparserへfallbackしない。
- AI出力をそのまま永続化せず、deterministic canonicalizerで正式factへ変換する。
- task、component、workload、effort、temporal constraint、task date rule、recurrence、relationを独立factとして扱う。
- workloadと所要時間見積りを分離する。
- task局所期間と計画全体のplanning windowを分離する。
- workloadとavailabilityを分離する。
- timetable、existing plans、calendarの本文をAIに再生成させない。
- external sourceはowner-bound authoritative dataからcoreが解決する。
- 日付と時間帯を分離し、後段で日本語日時を再解析しない。
- 一日計画、taskの特定日、計画全体の終日休みを別の意味として扱う。
- 個人最適化係数は単発AI出力から直接保存しない。
- 新旧意味経路を同一turnでmergeしない。
- request ownership、stale rejection、preview authorization、approval、storage、security境界を維持する。

## 3. 作業手順

各作業単位の開始前に次を確認する。

- `weekly-planning-current-contract-v5.md`
- `weekly-planning-semantic-schema-v5.md`
- `weekly-planning-dialogue-architecture-v5.md`
- `weekly-planning-availability-architecture-v5.md`
- `weekly-planning-semantic-v5-roadmap.md`
- 本MD

完了後は変更、判断、注意点、検証結果、production接続状態を対応MDへ記録する。

## 4. Gate進捗

### A. 正本文書

- [x] architecture v5、schema overview、current contract、roadmap、active taskを正本化する。
- [x] v4とtyped command/exam専用設計をhistoricalへ降格する。
- [x] availability / external source / specific date / personalizationの正本文書を同期する。

### B. SemanticTurnDocument

- [x] generic task、component、workload、effort、temporal、recurrence、relationを追加する。
- [x] `quantityRole = declared | target | remaining | completed | unknown`を採用する。
- [x] constraint level、plan-wide availability、external source request、named time periodを追加する。
- [x] 日付と時間帯を別fieldへ分離する。
- [x] canonical date tokenと`custom:`境界を追加する。
- [x] `allowed_date | excluded_date`をtask-specific date ruleとして追加する。
- [x] date ruleへclock/named period/soft strengthを許可しない。
- [x] runtime validator、response-local ID、参照整合、repair境界を実装する。
- [x] raw response本文をdiagnosticsへ残さない。
- [ ] alpha1/alpha2を一つのstable schemaへ統合する。
- [ ] stable schemaでreal API evalを再実行する。

### C. PlanningFactGraph / canonicalizer

- [x] 正式ID、revision、source factをcoreが発行する。
- [x] local ID参照、親子関係、task relationを検証する。
- [x] 不完全なfactを破棄しない。
- [x] 同一turnのatomic commitと失敗時無変更を保証する。
- [x] constraint level、named time period、availability、source requestを正式factへ保持する。
- [x] task date ruleを通常temporal constraintから分離して正式factへ保持する。
- [x] task date ruleのID、diff、local mappingを追加する。
- [ ] active / superseded / removed lifecycleを追加する。
- [ ] correction、delete、proposal decisionをstable public refへ実適用する。
- [ ] persisted graph migrationを実装する。

### D. AI semantic normalizer / shadow

- [x] 現行interpreterとは別moduleで実装する。
- [x] initial call＋最大一回repairだけを許可する。
- [x] provider/schema failure時にfail closedする。
- [x] parser fallbackを持たない。
- [x] request byte、response length、latency、attempt、validation errorを記録する。
- [x] production stateを書き換えないshadow evaluatorを追加する。
- [x] 専用purpose routingとclient output token要求を追加する。
- [ ] Workerのpurpose別output token上限を固定する。
- [ ] production turnからfeature flag付きshadow callを起動する。

### E. Work demand / availability / scheduler input

- [x] task/component/workloadからgeneric work demandを生成する。
- [x] `exam_year`を一般単位の一つとして扱う。
- [x] ordinal rangeとactual rangeを分離する。
- [x] estimated minutes、quantity role、range不足をblocking issueとして返す。
- [x] user-declared availabilityを具体windowへ解決する。
- [x] external source selectionとauthoritative event importを追加する。
- [x] 外部取得を`success(events) | failure(reason)`へ限定し、自動再試行する。
- [x] fixed taskをtask ID付きreservationへ変換する。
- [x] calendar/date/named-time処理を共通化する。
- [x] task allowed/excluded date resolverを追加する。
- [x] fixed reservationへtask date ruleを適用する。
- [x] date-only hard unavailableを終日windowへ変換する。
- [x] work、reservation、task-date、availability、relation、planning windowをscheduler input v2へ統合する。
- [x] fixed taskを可動work itemから除外する。
- [x] 特定日除外で固定予約が消えても可動workへ戻さない。
- [x] hard occupied/unavailable windowを保持する。
- [x] unresolved issueがあればinput全体を生成しない。
- [ ] 旧schedulerへのtemporary one-way adapterを実装する。

### F. Dialogue / readiness

- [x] accepted fact diffからgrounded acknowledgement素材を生成する。
- [x] 一度に一件の高影響質問を選ぶpure policyを追加する。
- [x] work/source/availability/commitment/relationのblocking issueを統合する。
- [x] task date ruleのcustom date、orphan、invalid strength、allow/exclude conflictを統合する。
- [x] explicit authorization、conversation、revisionを確認するpreview gateを追加する。
- [x] 外部取得失敗時もconversationと入力内容を保持する案内へ変更する。
- [ ] unified rendererへ接続する。
- [ ] exam専用rendererを削除する。

### P. Personalization profile

- [x] profile schemaをv2へ更新する。
- [x] feature versionとweight versionを追加する。
- [x] context、scope、coefficient、provenance、confidence、updatedAtを持つparameterを追加する。
- [x] time band、weekday、session length、completion、delay、interruption、reschedule、transition、sleep proximity、density、subject affinityを初期featureにする。
- [x] coefficientを`-4〜4`へ制限する。
- [x] unknown feature、不正key、不正係数をsanitizeする。
- [x] parameter数を最大300件へ制限する。
- [x] v1 profileを空placement model付きv2へ移行する。
- [ ] production schedulerへread-onlyで接続する。
- [ ] plan/actual集計からparameter候補を生成する。
- [ ] 更新率、最小標本数、減衰、明示設定優先を固定する。

### G. Production切替

- [ ] executorを新経路へ一括切替する。
- [ ] old persisted state migrationを実装する。
- [ ] 旧prompt、command schema、exam専用state、adapter、rendererを削除する。
- [ ] full roleplay、stable real-eval、七視点監査を完了する。

## 5. 必須評価ケース

1. 院試過去問2分野＋研究15時まで＋前後関係。
2. 資格試験の分野、問題数、1問あたり時間。
3. 学校課題の締切、時間帯、複数task。
4. 仕事・家事・移動と学習の混在。
5. task局所期間がplanning windowへ漏れない。
6. 一日だけのplanning horizonを保持する。
7. taskを特定日だけ実行する。
8. taskを特定日だけ除外する。
9. recurring fixed taskから例外日を除外する。
10. 計画全体の特定日を終日休みにする。
11. allowed/excluded conflictを一件だけ確認する。
12. custom dateを後段parserへ渡さない。
13. correctionで対象factだけを変更する。
14. provider failure時にstateを変更せずfallbackしない。
15. 外部予定本文をAIが捏造しない。
16. external source failureを「予定なし」と扱わない。
17. fixed taskを可動work itemとして二重配置しない。
18. personalization v1→v2 migrationが成立する。
19. 不正係数・未知featureをprofileから除外する。
20. personalization profileへraw conversation本文を保存しない。

## 6. 主要な作業記録

### API schema / generic semantic

- GitHub Models APIで院試、学校課題、仕事＋TOEICを評価した。
- task分離、数量対応、研究15時まで、前後関係を保持した。
- 量の役割を早期確定しすぎないため`declared`を追加した。
- generic task、deterministic fact ID、expected revision、duplicate turn guard、atomic proposalを実装した。

### Availability / calendar / external source

- user commitment、plan-wide availability、external sourceを分離した。
- dateとnamed time periodを分離した。
- 実在日付、閏年、月跨ぎ、月曜始まりを共通resolverへ集約した。
- 外部取得は途中結果を公開せず、temporary failureを最大3回再試行する契約へ変更した。
- success空配列を正常な予定なしとして扱う。

### Generic scheduler input

- work、fixed reservation、availability、source selection、relation、horizonを一つのimmutable inputへ統合した。
- fixed task由来の可動workと見積りissueを抑制した。
- orphan/self relationをblocking issueにした。
- graph revision、owner、timezone、source fact refsを保持する。

### Specific date

- 一日計画をstart=endのplanning windowとして確認した。
- task-specific `allowed_date | excluded_date`を追加した。
- task date ruleを通常temporal constraintから分離した。
- allow集合、exclude差引き、同日conflictを実装した。
- date-only hard unavailableを終日windowへ変換した。
- recurring fixed reservationへ例外日を適用した。
- scheduler inputをv2へ更新し、task date eligibilityを追加した。

### Personalization profile

- profile schemaをv2へ更新した。
- 全ユーザー共通weightとユーザー固有parameterを分離した。
- parameterへversion、context、scope、provenance、confidence、updatedAtを持たせた。
- bounded coefficient、safe key、unknown feature rejection、最大件数を追加した。
- v1 profileを安全にv2へ読み替える。

## 7. 検証

Cloudflare Pagesを代替実行環境として使用した。

- semantic全test＋Worker routing: success。
- full project TypeScript: success。
- Vite production build: success。
- 外部予定atomic retry一括検証: commit `47b66f8` success。
- task date resolver: commit `8913477` success。
- specific-date scheduler integration: commit `6514a81` success。
- personalization profile v2: commit `86d1972` success。
- date-rule validation: commit `e8c8c5c` success。
- canonicalizer date-rule separation: commit `89e8942` success。
- semantic全回帰＋personalization＋routing: commit `69bebad` success。
- task-date dialogueを含むsemantic全回帰: commit `3d6d674` success。
- full TypeScript＋Vite production build: commit `a4c29be` success。
- temporary type-check configはcommit `bb4d951`で削除した。

GitHub Actionsはrunner step開始前にfailureとなり、job log/artifactが生成されない状態が継続しているため、コード由来の判定には使用できていない。

## 8. 現在の注意点

- production executor、UI、repository、現行schedulerへ新経路はまだ接続していない。
- 現行schedulerはtask date eligibilityをまだ消費しない。
- personalization profile v2は保存・validation基盤のみで、配置scoreへ未接続である。
- plan/actualから係数を更新するlearning pipelineは未実装である。
- correction/decision intentは既存factへ実適用されない。
- persisted state migrationは未実装である。
- 旧prompt、typed command、exam state、exam rendererは残っている。
- alpha1/alpha2はproduction採用前にstable schemaへ統合する必要がある。
- Workerのsemantic normalizer出力上限は現状1200 tokenである。
- GitHub Actions runner問題は未解決である。
