# weeklyPlanning current contract v5

Status: canonical / active for semantic v5 migration
Updated: 2026-07-22

- Schema overview: [weekly-planning-semantic-schema-v5.md](../architecture/weekly-planning-semantic-schema-v5.md)
- Architecture: [weekly-planning-dialogue-architecture-v5.md](../architecture/weekly-planning-dialogue-architecture-v5.md)
- Availability architecture: [weekly-planning-availability-architecture-v5.md](../architecture/weekly-planning-availability-architecture-v5.md)
- Migration roadmap: [weekly-planning-semantic-v5-roadmap.md](strategy/weekly-planning-semantic-v5-roadmap.md)
- Active task and decision log: [20260722-weekly-planning-generic-semantic-v5-migration.md](tasks/20260722-weekly-planning-generic-semantic-v5-migration.md)
- External source retry record: [20260722-weekly-planning-external-source-atomic-retry.md](tasks/20260722-weekly-planning-external-source-atomic-retry.md)
- Specific date / personalization record: [20260722-weekly-planning-specific-date-and-personalization-profile.md](tasks/20260722-weekly-planning-specific-date-and-personalization-profile.md)
- Legacy status overlay: [weekly-planning-current-contract-status.md](weekly-planning-current-contract-status.md)

この文書はsemantic v5移行に関する最優先contractである。request ownership、preview、approval、storage、personalization、trace等の非競合領域は従来のcurrent contractを継承する。

## 1. 意味解釈境界

- raw user textからtask、quantity、time、relation、availability、task date rule、correction、decision、明示的な外部予定source requestを生成する主体はsingle AI semantic normalizerだけとする。
- AIは内部mutation commandを選ばない。
- AI出力は`SemanticTurnDocument`であり、database state、reducer command、scheduler requestではない。
- validator、canonicalizer、readiness、dialogue、scheduler、safety層はraw textを再解釈しない。
- provider failure、空応答、不正JSON、schema不一致、全拒否、repair失敗でもparserへfallbackしない。
- repairはJSON/schema修復に限り、一turn最大一回とする。
- failed/rejected turnはaccepted facts、question context、preview、proposal、draftを変更しない。
- 個人最適化係数を単発のAI出力から直接保存しない。

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
├─ task date rules
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
- task date ruleは特定taskを特定日にだけ実行する、または特定日だけ除外する条件を表す。
- recurrenceはtaskまたはavailabilityの繰り返し頻度を表す。
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

## 4. 日付、時間帯、特定日

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
```

- `今日`、`明日`、`来週`、`午前中`等の日本語をvalidator以降で再解析しない。
- ISO形式だけでなく実在する日付かを検証する。
- 週境界は月曜日始まりとする。
- `custom:`は後段で意味解釈せず、未解決としてreadinessへ返す。
- named time periodは注入済みpolicyがある場合だけ具体時刻へ解決する。
- named time periodと明示clockを同じfactへ同時指定しない。

特定日の要求は次へ分ける。

```text
一日だけの計画
→ absolute planning window start=end

特定taskをその日だけ行う
→ allowed_date

特定taskをその日だけ行わない
→ excluded_date

その日は計画全体で何も入れない
→ date-only hard unavailable
```

- task date ruleはhardのみとし、clockやnamed time periodを持たせない。
- 複数allowed dateは和集合とする。
- excluded dateは実行可能日から差し引く。
- 同じtask・同じ日へのallow/exclude競合は自動解決せず一件だけ確認する。
- 繰り返し固定予定にも例外日を適用する。
- date-only hard unavailableは00:00〜翌日00:00の終日windowへ解決する。

## 5. Canonical state

AI出力をそのまま永続化しない。deterministic coreが`PlanningFactGraph`へ変換する。

- 正式ID、revision、owner、trusted metadataはcoreが発行する。
- local IDは一response内参照に限定する。
- accepted factをtask、study context、component、workload、effort、temporal constraint、task date rule、recurrence、relation、window、availability declaration、source request、uncertaintyへ分離する。
- correctionはstable public fact refを対象にし、対象factだけをsupersedeする。
- deleteは明示的public refを対象にする。
- 不完全なfactを保持する。例としてend timeだけが明示された制約を捨てない。
- 一turnのcanonical commitはatomicとし、検証失敗時はrevisionを進めない。

## 6. Availabilityと外部予定取得

coreはsemantic factを次へ決定論的に解決する。

- user availability declaration → available/unavailable/preferred/avoided window
- date-only hard unavailable → whole-day unavailable window
- hard fixed task → task ID付きcommitment reservation
- task date rule → taskごとのallowed/excluded date
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
- 特定日除外で固定予約が0件になっても可動work itemへ戻さない。
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
- availability/source/commitment/task date ruleのblocking issueも同じreadinessへ統合する。
- 同じ日にtaskを行う指定と行わない指定が競合した場合、どちらを採用するか質問する。
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
- task date eligibilitiesはallowed dateまたはexcluded dateとして渡す。
- unresolved availability/source/commitment/task date ruleがある場合、schedulerへ不完全な入力を渡さない。
- scheduler入力が未完成でも計画sessionを停止せず、readinessへ戻す。

## 9. 個人最適化profile

個人最適化係数はSemanticTurnDocumentやPlanningFactGraphへ混ぜず、アカウント単位のversion付きprofileへ保存する。

```text
personalization profile
├─ schema version
├─ week start
├─ subject estimate multipliers
├─ preferred session minutes
└─ placement model
   ├─ feature version
   ├─ weight version
   └─ contextual parameters
```

- 既存v1 profileは空のplacement modelを持つv2へ移行する。
- parameterはfeature、context、coefficient、scope、provenance、confidence、updatedAtを持つ。
- coefficientは`-4〜4`へ制限する。
- unknown feature、不正key、不正係数をsanitize時に除外する。
- parameter数は最大300件とする。
- 全ユーザー共通の基本weightはprofileへ複製せず、weight versionで管理する。
- 単発のAI発話から係数を直接保存しない。
- 明示的好みはconfirmed setting、行動学習値はplan/actual集計を根拠とする。
- production schedulerによるscore適用とlearning pipelineは未接続である。

配置featureの初期集合は、完了しやすさ、開始遅延、中断、再配置、時間帯、曜日、session長、切替負担、就寝近接、詰め込み、科目相性とする。

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
- personalization raw conversationをprofileへ保存しない

## 11. 移行規則

- 新旧semantic resultを同一turnでmergeしない。
- 新schemaはshadow評価から開始する。
- production切替はexecutor単位で一括して行う。
- temporary adapterは旧schedulerへ渡す境界だけに置き、新しいcanonical stateへexam構造を戻さない。
- production切替後に旧prompt、command schema、command reducer、exam state、exam adapter、exam rendererを削除する。
- alpha1/alpha2はproduction採用前に一つのstable schemaへ統合する。
- mainへ採用する前にfull tests、build、roleplay、real-eval、七視点監査を行う。

## 12. 現在status

```text
API schema experiment                 complete
architecture / contract               documented
alpha2 semantic / validator           foundation complete
PlanningFactGraph additive facts      foundation complete
task date rule                        foundation complete / production disconnected
whole-day unavailable                 foundation complete / production disconnected
availability / source resolution      foundation complete
external source atomic retry          module complete / production disconnected
fixed commitment reservation          foundation complete
shadow normalizer                      module complete / disconnected
generic work demand                    foundation complete
unified scheduler input v2             foundation complete
generic scheduler dialogue policy     foundation complete / renderer disconnected
personalization profile v2            storage/validation foundation complete
personalized placement scoring        not connected
fact lifecycle / correction            not implemented
persisted migration                    not implemented
production cutover                     not started
```
