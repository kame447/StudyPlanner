# weeklyPlanning current contract v5

Status: canonical / active for semantic v5 migration
Updated: 2026-07-22

- Schema registry: [weekly-planning-semantic-schema-registry.md](../architecture/weekly-planning-semantic-schema-registry.md)
- Stable V5 migration plan: [weekly-planning-semantic-stable-v5-migration-plan.md](strategy/weekly-planning-semantic-stable-v5-migration-plan.md)
- Schema overview: [weekly-planning-semantic-schema-v5.md](../architecture/weekly-planning-semantic-schema-v5.md)
- Architecture: [weekly-planning-dialogue-architecture-v5.md](../architecture/weekly-planning-dialogue-architecture-v5.md)
- Availability architecture: [weekly-planning-availability-architecture-v5.md](../architecture/weekly-planning-availability-architecture-v5.md)
- Migration roadmap: [weekly-planning-semantic-v5-roadmap.md](strategy/weekly-planning-semantic-v5-roadmap.md)
- Active task and decision log: [20260722-weekly-planning-generic-semantic-v5-migration.md](tasks/20260722-weekly-planning-generic-semantic-v5-migration.md)
- External source retry record: [20260722-weekly-planning-external-source-atomic-retry.md](tasks/20260722-weekly-planning-external-source-atomic-retry.md)
- Specific date / personalization record: [20260722-weekly-planning-specific-date-and-personalization-profile.md](tasks/20260722-weekly-planning-specific-date-and-personalization-profile.md)
- Legacy status overlay: [weekly-planning-current-contract-status.md](weekly-planning-current-contract-status.md)

この文書はsemantic v5移行に関する最優先contractである。request ownership、preview、approval、storage、personalization、trace等の非競合領域は従来のcurrent contractを継承する。schemaの実在世代、依存、廃止条件はschema registryを正とし、Alpha 1 / Alpha 2からStable V5への物理統合手順はStable V5 migration planを正とする。

## 1. 意味解釈境界

- raw user textからtask、quantity、time、relation、availability、correction、decision、明示的な外部予定source requestを生成する主体はsingle AI semantic normalizerだけとする。
- AIは内部mutation commandを選ばない。
- AI出力は`SemanticTurnDocument`であり、database state、reducer command、scheduler requestではない。
- validator、canonicalizer、readiness、dialogue、scheduler、safety層はraw textを再解釈しない。
- provider failure、空応答、不正JSON、schema不一致、全拒否、repair失敗でもparserへfallbackしない。
- repairはJSON/schema修復に限り、一turn最大一回とする。
- failed/rejected turnはaccepted facts、question context、preview、proposal、draftを変更しない。

## 2. 汎用task model

唯一の大枠は`PlanningTask`である。

```text
PlanningTask
├─ category: study | non_study | unknown
├─ title
├─ study details
├─ workloads
├─ effort estimates
├─ temporal constraints
└─ recurrence
```

- 院試、資格試験、大学受験等をtop-level専用型にしない。
- 院試は`category=study`、`purpose=exam`、`contextLabel=大学院入試`として表す。
- 科目、分野、教材、章、単元、技能は`StudyComponent`で表す。
- componentとworkloadの対応を同一object内またはID参照で保持し、配列位置へ依存しない。
- 研究等の分類が不明ならAI境界で`unknown`を許可し、必要性が低ければ即時質問しない。

## 3. 数量、時間、availability

- workloadは作業量を表す。
- effort estimateは所要時間見積りを表す。
- temporal constraintは特定taskの開始、終了、固定区間、締切、希望、回避時間を表す。
- task date ruleは特定taskの明示的な許可日・除外日を表す。
- recurrenceはtaskまたはavailabilityの繰り返し頻度と曜日集合を表す。
- planning windowは計画全体の期間だけを表す。
- plan-wide availability declarationは特定taskを持たない空き、利用不可、希望、回避時間を表す。
- external source requestは時間割、既存予定、calendarを使う・使わないというユーザー要求だけを表す。
- task局所の「今週」「明日」等をplanning windowへ昇格させない。
- external予定の本文、event ID、owner、日時をAIに生成させない。

workloadのquantity roleは次とする。

```text
declared | target | remaining | completed | unknown
```

量が明示されたが総量・残量・今回目標を確定できない場合は`declared`とする。AIに早期確定を強制しない。

## 4. 日付、時間帯、曜日集合

AI境界で日付と時間帯を分離する。

```text
dateExpression:
  today | tomorrow | day_after_tomorrow | this_week | next_week
  | YYYY-MM-DD
  | custom:<原文>

namedTimePeriod:
  morning | afternoon | evening | night
  | before_sleep | before_meal | after_meal
  | custom:<原文>

weekday:
  sun | mon | tue | wed | thu | fri | sat
```

- `今日`、`明日`、`来週`、`午前中`等の日本語をvalidator以降で再解析しない。
- ISO形式だけでなく実在する日付かを検証する。
- 週境界は月曜日始まりとする。
- `custom:`は後段で意味解釈せず、未解決としてreadinessへ返す。
- named time periodは注入済みpolicyがある場合だけ具体時刻へ解決する。
- named time periodと明示clockを同じfactへ同時指定しない。
- `7月8日、10日、11日`等の非連続日を最小日から最大日までの連続rangeへ変換しない。一日ごとの`allowed_date`として保持し、解決時に和集合する。
- `水曜と金曜から日曜`等は一つのtask recurrenceへ`days=[wed,fri,sat,sun]`として保持する。
- 曜日rangeはAI境界でcanonical weekdayへ展開する。
- task-level recurrenceの曜日集合はplanning window内の具体日付へ決定論的に解決し、scheduler inputのtask date eligibilityへ渡す。
- exact excluded dateは曜日集合から差し引く。
- recurrence由来の候補日とexcluded dateの重なりは正常な例外指定である。
- 明示的`allowed_date`と明示的`excluded_date`が同じtask・同じ日に直接衝突した場合だけblocking conflictとする。

## 5. Canonical state

AI出力をそのまま永続化しない。deterministic coreが`PlanningFactGraph`へ変換する。

- 正式ID、revision、owner、trusted metadataはcoreが発行する。
- local IDは一response内参照に限定する。
- accepted factをtask、study context、component、workload、effort、temporal constraint、task date rule、recurrence、relation、window、availability declaration、source request、uncertaintyへ分離する。
- correctionはstable public fact refを対象にし、対象factだけをsupersedeする。
- deleteは明示的public refを対象にする。
- 不完全なfactを保持する。例としてend timeだけが明示された制約を捨てない。
- 一turnのcanonical commitはatomicとし、検証失敗時はrevisionを進めない。

現在のFact Graph V2はFact Graph V1を型継承し、V2 canonicalizerはdocumentとgraphをV1へprojectionしてV1 canonicalizerを再利用している。この構造はAlpha段階の実装依存であり、Stable V5の正しい境界ではない。

Stable V5では次を必須とする。

- Alpha 1基礎fieldとAlpha 2追加fieldを一つのStable schemaで直接定義する。
- Stable validatorはAlpha 1へのprojectionを行わない。
- Stable canonicalizerは旧documentまたは旧graphへのprojectionを行わない。
- Stable Fact Graphは現在必要なcollectionを直接定義する。
- semantic schema versionとfact graph versionを独立して記録する。

## 6. Availabilityと外部予定取得

coreはsemantic factを次へ決定論的に解決する。

- user availability declaration → available/unavailable/preferred/avoided window
- hard fixed task → task ID付きcommitment reservation
- task date rule / task-level recurrence → taskごとの許可日・除外日
- explicit source request → owner-bound active source selection
- successful external event set → occupied windows

外部予定取得結果は次の二つだけとする。

```text
success(events)
failure(reason)
```

- `success(events=[])`は登録予定なしの正常成功である。
- `partial`状態を設けない。
- pagination等の途中結果を上位層へ渡さない。
- 途中失敗時は途中結果を破棄し、temporary failureなら取得層が自動再試行する。
- timeout、network error、rate limit、一時的server errorを既定最大3回まで再試行する。
- authentication、permission、source未設定、invalid responseは自動再試行せず具体的な対応へ進む。
- retry後のfailureを予定0件とみなさない。
- owner mismatchまたは不正eventが一件でもあればsource import全体を拒否する。
- fixed taskを可動work itemとして二重配置しない。
- hard occupied/unavailable windowへwork itemを配置しない。
- named time periodのpolicyが無ければ時刻を捏造しない。

外部予定取得failure時の挙動:

- conversationを終了しない。
- accepted factsと入力済み内容を破棄しない。
- 他の条件確認を継続できる。
- ユーザーが利用を求めたsourceを反映した最終previewだけを保留する。
- ユーザーが明示的にsourceを使わず進めると決めた場合だけ、そのsource依存を解除する。

## 7. Readinessと対話

- accepted fact diffからgrounded acknowledgementをdeterministicに生成する。
- 次の質問はreadiness policyが選ぶ。
- previewを妨げる高影響不足を一度に原則一件だけ確認する。
- AI normalizerはmissing slot、question target、readiness、preview可否を決定しない。
- exam専用rendererと一般rendererを最終的に統合する。
- availability/source/commitment/task dateのblocking issueも同じreadinessへ統合する。
- 外部予定failure時は、自動再試行済みであること、予定へ未反映であること、入力内容を保持していることを案内する。
- security rejectionでも計画の最初からのやり直しを要求しない。

## 8. Scheduler境界

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

- `exam_year`は単位の一つであり、全work itemの必須fieldではない。
- 「2年分」は具体年度がなくてもordinal unitへ変換できる。
- 具体年度が必要なpolicyだけactual valueを要求する。
- estimated minutesが不足する場合は推測せずreadinessへ返す。
- fixed reservation対象taskは可動work itemから除外する。
- unresolved availability/source/commitment/task dateがある場合、schedulerへ不完全な入力を渡さない。
- scheduler入力が未完成でも計画sessionを停止せず、readinessへ戻す。
- task date eligibilityは複数の非連続日と曜日集合を具体的な許可日へ解決した結果を保持する。
- eligibilityのsource fact refsには明示日付ruleとrecurrence factの両方を含める。

## 9. 個人最適化profile

- 個人最適化係数をSemanticTurnDocumentまたはPlanningFactGraphへ混ぜない。
- profileはaccount単位、schema version付きで保持する。
- 全ユーザー共通の基本weightはprofileへ複製しない。
- coefficient、scope、context、provenance、confidence、updatedAt、feature version、weight versionを保持する。
- 単発のAI出力から長期係数を直接永続化しない。
- 明示設定または計画と実績の集計を根拠に更新する。
- raw conversation本文をprofileへ保存しない。

## 10. 維持する安全境界

- conversation、turn、request、revision、selected week ownership
- stale async result rejection
- explicit preview authorization
- hard constraintとavailability validation
- unsaved preview
- explicit UI approval
- approval idempotency
- user-boundary storage
- browser reload後のpreview再計算
- trace privacyとaccount data separation

## 11. 移行規則

- 新旧semantic resultを同一turnでmergeしない。
- Alpha 1 / Alpha 2をproduction採用前に一つのdirect Stable V5 schemaへ統合する。
- Stable V5はAlpha 1 response schema clone、Alpha 1 validator projection、V1 canonicalizer projectionへ依存しない。
- Stable V5 automated compatibility testの後にStable V5専用real-evalを行う。
- 実AI real-evalの成功後に、production stateへ書き込まないStable V5 shadowを接続する。
- 現行のAlpha 1型shadow evaluatorをproductionへ接続しない。
- shadow reportへsemantic schema version、JSON Schema name、fact graph version、normalizer/validator/canonicalizer versionを記録する。
- shadow後にold persisted state migration decoderとdry-runを完了する。migration設計とfixture作成はshadow前から進めてよい。
- migrationなしで保存済みschema/state versionを書き換えない。
- SemanticDocumentをraw conversationからAIで再生成してmigrationしない。
- production切替はexecutor単位かつsession generation単位で一括して行う。
- Stable V5へ移行済みsessionを旧executorへ無条件に戻さず、Stable graphを旧形式へdowngrade保存しない。
- temporary adapterは旧schedulerへ渡す境界だけに置き、新しいcanonical stateへexam構造を戻さない。
- production切替後、rollback観察期間を経てから旧prompt、command schema、command reducer、exam state、exam adapter、exam renderer、Alpha runtime依存を削除する。
- pre-V5 eval fixtureとrunnerはGit履歴だけへ退避せず、legacy-eval領域で保持する。
- mainへ採用する前にfull tests、build、roleplay、Stable V5 real-eval、七視点監査を行う。

順序は次で固定する。

```text
Stable V5 direct implementation
→ automated compatibility and full build
→ Stable V5 real-eval
→ read-only production shadow
→ migration decoder and dry-run
→ cutover rehearsal and rollback verification
→ production cutover
→ rollback observation
→ legacy runtime deletion
```

実AIを実行していない場合はreal-eval成功と書かない。GitHub Actionsがrunner開始前に失敗し、step、log、artifactがない場合は実行基盤失敗であり、AI評価失敗ではない。資格情報がない場合は資格情報不足として分離する。

## 12. 現在status

```text
API schema experiment                 complete
schema generation registry            documented
Stable V5 migration design            documented / implementation not started
architecture / contract               documented
Alpha 2 semantic / validator           foundation complete
Stable direct schema / validator       not implemented
PlanningFactGraph V2 additive facts    foundation complete
Stable Fact Graph V5                   not implemented
availability / source resolution       foundation complete
external source atomic retry           module complete / production disconnected
fixed commitment reservation           foundation complete
specific dates / weekday sets          foundation complete / automated verified
personalization profile v2             foundation complete / scoring disconnected
Alpha 1 shadow evaluator               module complete / production disconnected
Stable V5 shadow                       not implemented / disconnected
generic work demand                    foundation complete
unified scheduler input                foundation complete
generic scheduler dialogue policy      foundation complete / renderer disconnected
fact lifecycle / correction            not implemented
persisted migration                    not implemented
production cutover                     not started
```
