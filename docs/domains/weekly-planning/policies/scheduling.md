# Weekly Planning Scheduling Policy

Status: canonical / current Stable V5 scheduling behavior
Updated: 2026-10-10

References:
- [Current contract](../architecture/current-contract-v5.md)
- [Availability architecture](../architecture/weekly-planning-availability-architecture-v5.md)
- [Product intent](../spec/product-intent.md)

## Purpose

週間計画schedulerは、accepted typed stateから**実行可能で、過密になりにくく、崩れたときの回復余地を持つ**候補を決定論的に生成する。

この文書はcurrent Stable V5の配置方針を所有する。AIは配置時刻、日別負荷、reserve利用、feasibilityを決めない。

## Safety before optimization

配置候補の好みや負荷分散より先に、hard boundaryを満たす。

- planning horizon外へ置かない
- request-time `notBefore` より前へ新しい予定を置かない
- existing StudyPlanner plans、timetable、accepted unavailable intervalと衝突させない
- accepted daily capacityを超えて新しい学習予定を配置しない
- hard deadline / allowed date / excluded date / relation orderingを破らない
- required authoritative sourceを取得できない状態を「空いている」と解釈しない
- explicit user constraintを一般heuristicやpersonalization scoreで上書きしない

過去の学習実績を記録することと、これからの予定を過去時刻へ配置することは別責務である。

## Planning horizon and hard date bounds

schedulerは、accepted temporal meaningそのものを再解釈せず、scheduler-input compilationで解決済みのhard date boundsとpreferred placementsを利用する。

明示的なplanning windowがない場合も、default horizonを常に7日で打ち切るとは限らない。current production behaviorでは、適用可能なhard date constraintがある単純なper-occurrence recurrenceについて、deadline / latest-end等のhard endまでfallback horizonを延長できる。future `earliest_start` がある場合も、その開始日だけを見て利用可能な配置期間を消失させない。

hard date boundsはrecurrence expansionだけでなくordinary movable workにも適用する。配置候補日は少なくとも次の境界でclipされる。

- hard `earliest_start`
- hard `deadline`
- hard `latest_end`

同じtaskに属するcomponent workはtask-level hard date boundを継承できる。一方、component固有boundはsibling componentへ漏らさない。soft constraintや無関係なtargetのconstraintをhard clippingへ昇格させない。

複数hard boundsが矛盾する、またはhard bounds適用後にeligible dateが存在しない場合は、制約を弱めて予定を作るのではなくfail closedする。

このhorizon導出・date clippingを変更するときは、scheduler input compilation、recurrence/ordinary placement、task/component scopeのregressionを同じ変更で確認する。

## Current seven-day distribution baseline

current Stable V5では、planning horizonがちょうど7日間の場合、**最初の6日をnormal placement days、7日目をreserve dayとして扱う**。

```text
7-day horizon
├─ day 1..6: normal placement
└─ day 7: reserve / overflow / recovery capacity
```

通常はnormal daysを先に使い、reserve dayは以下のような場合に利用できる。

- normal daysだけではaccepted workを安全に収められない
- hard date constraintや明示的な利用可能日がreserve dayを要求する
- 他のhard constraintを守るためreserve利用が必要になる

この方針の目的は「7日すべてを最初から埋める」ことではなく、遅延、急な予定変更、見積もり誤差を吸収できるslackを残すことである。

6+1 partitionはcurrent production behaviorであり、変更する場合はscheduler code、regression tests、本policyを同じ変更で同期する。

## Load distribution

normal daysでは、総movable workを一日に偏らせるより、可能な範囲で負荷を分散する。

current Stable V5はnormal daysの平均負荷をtargetとして用い、通常日の過密を避けるsoft capを持つ。現実装のsoft capはtarget daily loadの1.5倍である。

これはhard capacityではなく**tunable scheduling policy**である。deadline、availability、explicit date/preference等のharder evidenceより優先しない。

「必ず完全な6等分」することはproduct invariantではない。現在の原則は、normal daysへ現実的に分散し、reserve capacityを可能な限り保持することである。

## Bounded recovery from placement-order failure

The ordinary placement attempt retains the compiled work-item order. If it places all work, its result is kept without deadline-based reoptimization. Only after a failed attempt may placement try one different order: stable priority by the already compiled hard end for the item's component or task, followed by the existing relation-ordering owner. Accepted before/after/sequence/dependency and priority relations remain authoritative. Missing or start-only bounds are not deadlines.

Each attempt starts with fresh busy intervals, daily loads and candidates, using the same accepted input, horizon, availability, quantity and request-time boundary. A retry replaces the first result only when all work is placed. If it also fails, the first attempt's partial candidates and unscheduled identities are retained under the existing partial-output contract. This bounded search is not a complete feasibility solver, and failure does not prove that every possible ordering is impossible.

Separately, work-item compilation follows the supplied active task order while preserving the relative order of workloads within each task. Replacing a workload may append a new fact to graph history; that historical append must not move its task behind another task. The compiler sorts only its newly created item array and retains workload IDs, amounts and provenance. It does not reorder or rewrite the accepted graph.

## Explicit daily study capacity

「土日は1日8時間勉強できる」のように、時刻帯ではなく1日あたりの総学習時間が明示された場合は、clock availabilityへ変換せず、typed daily capacityとして扱う。

- `8時間`はそのscopeの日に新しく配置するweekly-planning学習ブロックの合計上限480分を意味する
- start/end timeを捏造して`00:00-24:00`等のavailabilityを作らない
- weekday/date/recurrence scopeはsemantic layerで表現し、calendar展開はdeterministicに行う
- 同じ日に複数のhard capacityが適用される場合は、より厳しい上限を採用する
- sessionを追加すると上限を超える候補日は配置対象から除外する。全候補日で収まらなければcapacityを弱めず`insufficient_capacity`とする

既存StudyPlanner plans、timetable、塾、固定予定等は、daily capacityへ勝手に算入・再解釈するのではなく、従来どおりoccupied/busy intervalとして配置可能時刻を減らす。したがってdaily capacityは「新規計画として何分割り当てるか」を所有し、availabilityは「その時間帯に置けるか」を所有する。この2責務を混同しない。

## Work-unit integrity

schedulerは作業の意味構造を勝手に作らない。

- `atomic` work itemは機械的に分割しない
- `splittable`とtypedに確定したworkだけをsessionへ分割できる
- `unknown` / `needs_breakdown`をraw textや科目名heuristicで勝手にsplittableへ変えない
- breakdownが計画結果へ影響する場合はsemantic/dialogue layerで解決する

current schedulerのsession chunking定数は実装policyであり、作業のatomicityより強くない。

## Progress and target basis

schedulerへ渡す「今回配置する量」は、全範囲や過去進捗と区別する。

- `scope_total`: 全体範囲
- `completed`: すでに完了した量
- `remaining`: accepted factsから得られる残量
- `target`: 今回の計画で達成・配置したい量

`completed`を再配置しない。`target`が同じscopeに明示されている場合は、単なる全remainingを無条件に今回のworkへしない。

open-ended workに架空のscope totalを作って分配しない。

## Life and behavioral availability

起床・睡眠終了は、そのまま学習開始可能時刻を意味しない。朝食、準備、移動等により、`study available start`相当の境界が別に必要な場合がある。

acceptedな生活制約・buffer・availabilityはtyped constraintとしてschedulerへ渡し、raw Japaneseや科目名から後段で推測しない。

日付を跨ぐaccepted hard `available` intervalは、配置対象日ごとの区間へ展開し、通常配置とpreferred配置の両方で同じ境界を消費する。各日のrequest-time `notBefore` と既存occupied/unavailableの制約は保持する。これは宣言されたavailabilityの配置責務であり、終日MonthEventのbusy/free方針を変更しない。

## Preference and personalization

preferred time、observed profile、learning-specific scoreは、hard availabilityを通過したsafe candidate集合の中でのみ順位付けに使う。

Task/component の accepted `preferred_window` は、片側だけの明示 clock なら不足側を同日の `00:00` / `24:00` として解決する。clock を伴わない有効な date-only preference は保持する。日付表現・named time period・時刻区間・constraint level が未解決なら、work量がまだない場合も黙って捨てず、既存のblocking issue/question経路へ渡す。

Plan-wide の `preferred` と soft `available` は同じ既存順位付けへ投影し、hard availabilityを広げない。単一のaccepted planning windowに対して、非反復のcanonical曜日が期間外となったこれらの宣言は、毎週へ読み替えず適用日を質問する。質問の意味は既存のtyped availability-date-scopeとしてrendererへ渡す。

- explicit preference > inferred/observed tendency
- current-week acceptanceをdurable preferenceへ自動昇格しない
- personalization unavailable/failed時はsafe deterministic baselineへ戻る
- preferenceはfree timeを新設しない

## Change rule

scheduler policyを変更するときは、少なくとも次を確認する。

1. hard constraintsを弱めていないか
2. reserve/slack behaviorを意図せず失っていないか
3. atomic workを勝手に分割していないか
4. current timeより前へ配置していないか
5. progressとtargetを混同していないか
6. deterministic regressionがcurrent behaviorを固定しているか

古いtask文書をcurrent ruleとして復活させず、現在も必要な原則だけをこのpolicyへ統合する。

## Explicit content session length precedes margin

Accepted session duration is resolved by workload, then component, then task scope. Conflicting selected facts remain unresolved. An explicit cap precedes ordinary whole-content distribution and estimation margin: allocate each integer unit's real effort first, preserve all quantities and ranges, then share only the margin that fits the cap. This applies to integer page/problem/word/lesson/chapter/section/exam_year/custom quantities. Minute/hour/session use their existing time/count paths; mock exams remain atomic and fractional custom quantities are not rounded into whole units.

For20 problems×3 minutes with session30, the actual result is30+30 minutes with10+10 problems. An indivisible unit above the cap, atomic work, or bounded fallback retains its real effort and selected cap source. The actual new candidates determine satisfied/not_satisfied/not_evaluated. Missing identity/provenance cannot establish satisfaction; incomplete coverage, duration mismatch or a computable cap violation is not_satisfied. The current renderer receives this typed result and explains it naturally without deriving scheduling truth from prose.

Original minute precision is retained: explicit time slices round to at least one minute; content caps floor to at least one minute. The diagnostic compares actual duration to the unrounded accepted cap. No new fractional-minute policy is implied. Renderer failure with an unmet/unevaluated condition uses the existing technical-stop message while preserving candidate state and explicit approval authority.

The generated-session guard512 and Stable checkpoint array limit500 remain distinct existing contracts. Before ordinary publication, the application checks the reducer-projected state and returned graph against the existing Stable shape authority. Failure retains the prior graph/preview/draft/context through the existing rollback path. Compatibility-only persistence, byte compaction and physical storage/quota behavior retain their existing owners.
