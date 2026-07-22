# 週間計画 汎用意味モデル v5 移行

Status: active / semantic, availability, scheduler-input foundation implemented / production not connected
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
│  └─ recurrence
├─ relations
├─ availability declarations
├─ explicit external source requests
├─ uncertainties
├─ corrections
└─ decisions

PlanningFactGraph
├─ task / component / workload / effort / temporal / recurrence / relation
├─ generic work demand
├─ task commitment reservation
├─ availability window
└─ external source selection
```

院試、資格試験、大学受験、高校受験、学校課題、語学、日常学習等をtop-level専用型にしない。院試は`study` taskの`purpose=exam`と`contextLabel=大学院入試`として表す。

## 2. 固定済み方針

- raw user textの意味解釈主体は単一AI semantic normalizerだけとする。
- AIはcommand、state mutation、missing slot、readiness、preview、scheduler、approval、saveを決定しない。
- AI出力後にraw textを再解析しない。
- provider failure、空応答、不正JSON、schema不一致、repair失敗でもparserへfallbackしない。
- AI出力をそのまま永続化せず、deterministic canonicalizerで正式factへ変換する。
- task、component、workload、effort、temporal constraint、recurrence、relationを独立factとして扱う。
- workloadと所要時間見積りを分離する。
- task局所期間と計画全体のplanning windowを分離する。
- workloadとavailabilityを分離する。
- timetable、existing plans、calendarの本文をAIに再生成させない。
- external sourceはowner-bound authoritative dataからcoreが解決する。
- 日付と時間帯を分離し、後段で日本語日時を再解析しない。
- `examPrepScope`、位置対応配列、`field + year`固定work itemを新しい正本に残さない。
- 新旧意味経路を同一turnでmergeしない。
- request ownership、stale rejection、preview authorization、approval、storage、security境界を維持する。

## 3. 作業手順

各作業単位の開始前に、次を確認する。

- `weekly-planning-current-contract-v5.md`
- `weekly-planning-dialogue-architecture-v5.md`
- `weekly-planning-availability-architecture-v5.md`
- `weekly-planning-semantic-v5-roadmap.md`
- 本MD

完了後は変更、判断、注意点、検証結果を本MDへ記録する。

## 4. Gate進捗

### A. 正本文書

- [x] architecture v5を追加する。
- [x] v4をhistorical sourceへ降格する。
- [x] current contract v5を追加する。
- [x] semantic v5 roadmapを追加する。
- [x] documentation indexをv5優先へ変更する。
- [x] availability / commitment architecture v5を追加する。
- [x] availability architectureを実装結果へ同期する。

### B. SemanticTurnDocument

- [x] 実験schemaからproduction候補schemaを分離する。
- [x] `quantityRole = declared | target | remaining | completed | unknown`を採用する。
- [x] runtime validatorを独立moduleにする。
- [x] response-local IDと参照整合を検証する。
- [x] `constraintLevel = hard | soft | unknown`を追加する。
- [x] plan-wide availability declarationを追加する。
- [x] explicit external source requestを追加する。
- [x] named time periodを追加する。
- [x] 日付と時間帯を別fieldへ分離する。
- [x] canonical date tokenと`custom:`境界を追加する。
- [x] raw response本文をdiagnosticsへ残さない。
- [x] 代表fixtureとproperty testを追加する。

### C. PlanningFactGraph / canonicalizer

- [x] 正式ID、revision、source factをcoreが発行する。
- [x] local ID参照、親子関係、task relationを検証する。
- [x] partial factを破棄しない。
- [x] 同一turnのatomic commitと失敗時無変更を保証する。
- [x] normalizerから未保存proposalまでのtransaction準備engineを追加する。
- [x] constraint level、named time period、availability declaration、source requestを正式factへ保持する。
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
- [x] 専用purpose routingを追加する。
- [x] clientからoutput token要求を送れるようにする。
- [ ] stable alpha2 schemaでreal API evalを再実行する。
- [ ] production turnからfeature flag付きshadow callを起動する。

注: Workerは現状semantic normalizerの出力要求を1200 tokenへclampする。実測後にpurpose別上限を確定する。

### E. Work demand / availability / scheduler input

- [x] task/component/workloadからgeneric work demandを生成する。
- [x] `exam_year`を一般単位の一つとして扱う。
- [x] ordinal rangeとactual rangeを分離する。
- [x] estimated minutes不足をblocking issueとして返す。
- [x] `declared`/`unknown` quantityを保持しつつpreviewをblockする。
- [x] completed workloadを候補から除外する。
- [x] user-declared availabilityを具体windowへ解決するpure resolverを追加する。
- [x] external source selectionとauthoritative event importを追加する。
- [x] fixed taskをtask ID付きreservationへ変換する。
- [x] weekday/weekend/relative date処理を共通calendar resolverへ集約する。
- [x] named time periodは注入済みpolicyがある場合だけ解決する。
- [x] work demand、reservation、availability、relation、planning windowを単一scheduler inputへ統合する。
- [x] fixed taskを可動work itemから除外する。
- [x] hard occupied/unavailable windowをscheduler inputへ保持する。
- [x] unresolved work/source/availability/commitmentがあればinput全体を生成しない。
- [ ] 旧schedulerへのtemporary one-way adapterを実装する。

300語や20問を即座に300件/20件へ展開しない。workload fact一件を一つのwork demandとして保持し、分割は後続scheduler policyへ委譲する。

### F. Dialogue / readiness

- [x] accepted fact diffからgrounded acknowledgement素材を生成する。
- [x] 一度に一件の高影響質問を選ぶpure policyを追加する。
- [x] explicit authorization、conversation、revision、見積り解決を確認するpreview gateを追加する。
- [x] acknowledgementから内部unit codeを除外する。
- [ ] scheduler inputのblocking issueをdialogue policyへ統合する。
- [ ] unified rendererへ接続する。
- [ ] exam専用rendererを削除する。

### G. Production切替

- [ ] executorを新経路へ一括切替する。
- [ ] 同一turnで旧commandと新factをmergeしない。
- [ ] old persisted state migrationを実装する。
- [ ] 旧prompt、command schema、exam専用state、adapter、rendererを削除する。
- [ ] full tests、build、roleplay、real-eval、七視点監査を完了する。

## 5. 必須評価ケース

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
12. hard occupied/unavailable windowへwork itemを配置しない。
13. external source取得失敗を「予定なし」と扱わない。
14. 「寝る前」と「午前中」を日付表現へ混ぜない。
15. `custom:`日時を後段parserへ渡さずpreviewをblockする。
16. fixed taskを可動work itemとして二重配置しない。
17. fixed taskの可動作業用見積り不足でpreviewを止めない。
18. orphan/self relationをschedulerへ渡さない。

## 6. 作業記録

### 2026-07-22 / API schema experiment

- GitHub Models API `openai/gpt-4.1`で院試、学校課題、仕事＋TOEIC等を評価した。
- targeted 3ケースすべてJSON Schema parse成功。
- 学校課題、仕事＋TOEICはstrict pass。
- 院試例はtask分離、2分野、数量対応、研究15時まで、前後関係を保持した。
- `total | target | remaining | completed`は早期確定を要求しすぎるため`declared`を追加した。
- GitHub Modelsは連続呼び出しで429になるため、real-evalは低頻度・再試行付きとする。

### 2026-07-22 / 正本文書と基礎意味モデル

- architecture v5、current contract v5、semantic v5 roadmap、active task MDを追加した。
- docs indexをv5優先へ変更した。
- typed command、exam compatibility、rules fallbackをhistorical contractへ降格した。
- generic task、component、workload、effort、temporal、recurrence、relationを追加した。
- deterministic fact ID、expected revision、duplicate turn guard、atomic proposalを追加した。
- provider/schema failure時は元graphの同一参照を返す。

### 2026-07-22 / generic work demandとdialogue foundation

- `exam_year`、page、problem、word、minute等を同一contractで扱う。
- duration-per-unit、total duration、session duration、time workloadからestimated minutesを求める。
- 見積り、quantity role、rangeが不足する場合は推測せずblockする。
- accepted diff以外をacknowledgeしない。
- 高影響不足を原則一件だけ質問する。
- explicit user authorizationとcurrent graph revisionが一致しなければpreviewを拒否する。

### 2026-07-22 / availability再監査

旧stateを再確認し、sleep、meal、bath、commute、fixed event、unavailable、timetable、existing plans、calendarの受け皿がtask/workloadだけでは不足していると判明した。

判断:

- user commitmentは通常task＋temporal constraintで保持する。
- plan-wide availabilityはtaskとは別factにする。
- external予定本文はAIへ渡さず、coreがowner-bound sourceから取得する。
- AIは明示的なsource use/stop requestだけを返す。
- workload、task constraint、availability window、source selectionを分離する。

### 2026-07-22 / alpha2 availability foundation

- temporal constraintへconstraint levelを追加した。
- plan-wide availability declarationを追加した。
- timetable、existing plans、calendarのsource requestを追加した。
- availability declarationとsource requestを正式factへcanonicalizeする。
- external sourceのcomplete/partial/unavailable、owner、event妥当性を検証する。
- 一件でも不正eventがあればsource全体を採用しない。
- source取得失敗を空予定として扱わない。
- stop requestはeventを取得せずdeselectionだけを生成する。

### 2026-07-22 / calendar・named time・commitment整理

発見:

- 「午前中」をdate expressionへ入れると後段parserが必要になる。
- task側の「寝る前」とplan-wideの「午前中」を同じ時間帯概念で扱う必要がある。
- availability resolverに時間帯fieldがある一方、semantic documentとfact graphに未反映の不整合があった。
- resolverの未使用型importがfull TypeScriptを失敗させていた。

変更:

- 共通calendar resolverを追加した。
- 実在日付、閏年、月跨ぎ、月曜始まりの週境界を検証する。
- `today | tomorrow | day_after_tomorrow | this_week | next_week | YYYY-MM-DD | custom:`へ日付表現を閉じた。
- `morning | afternoon | evening | night | before_sleep | before_meal | after_meal | custom:`を時間帯として分離した。
- 日本語日時をvalidator以降で再解析しない。
- named time periodはpolicyが無ければ具体時刻を捏造しない。
- fixed interval taskをtask ID付きreservationへ変換する。
- 23:00〜00:30等を翌日終了として保持する。
- 一時型bridgeを削除した。

### 2026-07-22 / generic scheduler input

変更:

- generic work demand、fixed task reservation、availability window、external source selection、task relation、planning horizonを一つのimmutable inputへ統合した。
- blocking issueが一件でもあれば部分的なscheduler inputを返さず`input=null`とする。
- fixed reservation対象taskの可動work itemを除外する。
- fixed task由来の可動作業用見積り不足・quantity issueを抑制する。
- orphan relationとself relationをblocking issueにする。
- complete external sourceだけをoccupied windowとして含める。
- inputへgraph revision、owner、timezone、source fact refsを保持する。

判断:

- fixed taskの時間はfixed intervalから確定するため、可動作業用の1問あたり時間を要求しない。
- availabilityだけ存在しtaskもreservationも無い場合はscheduler inputを`empty`とする。
- unresolved source、work、commitment、relationを含むinputをschedulerへ渡さない。

### 2026-07-22 / 検証

GitHub Actions:

- runner step開始前にfailureとなり、job log/artifactが生成されない状態が継続している。
- コード由来の失敗判定には使用できていない。

Cloudflare Pagesによる代替検証:

- semantic全test＋Worker model routing test: success。
- V2 production source strict TypeScript: success。
- V2 test fixture TypeScript: success。
- full project TypeScript: success。
- semantic全test＋routing＋full TypeScript＋Vite production buildをcommit `c6336f0`で同時実行し、success。
- scheduler inputと固定task回帰を含む一括検証をcommit `7041d75`で実行し、success。
- 診断用script、probe、temporary tsconfigは検証後にすべて削除した。
- `package.json`はcommit `b74fc8a`で通常の`tsc --noEmit && vite build`へ復元した。

## 7. 現在の注意点

- production executor、UI、repository、現行schedulerへ新経路はまだ接続していない。
- 旧prompt、typed command、exam state、exam rendererは残っている。
- alpha1は比較基準として残っており、production採用前にalpha2へ統合して二重schemaを削除する必要がある。
- Workerのsemantic normalizer出力上限は現状1200 tokenである。
- correction/decision intentは既存factへ実適用されない。
- persisted state migrationは未実装である。
- scheduler inputはgeneric contractまでで、旧scheduler adapterは未実装である。
- scheduler inputのblocking issueを対話質問へ変換するpolicyは未実装である。
- GitHub Actions runner問題は未解決である。
