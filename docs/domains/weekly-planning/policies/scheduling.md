# Weekly Planning Scheduling Policy

Status: canonical / current Stable V5 scheduling behavior
Updated: 2026-10-08

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

同じtyped task/component/workloadを共有する分割sessionは、まず明示された希望scope内の未使用eligible日を優先し、その後に安全な空き時間の未使用日を探す。安全な未使用日が無ければ同じ日を再利用する。hard date bound・occupied interval・daily capacityを弱めず、無制約の7日horizonでは6 normal daysをreserveより先に使う。明示scopeが土日に限定される場合は、その土日内で別日を優先できる。別々のworkloadを同じ作業とみなして日付を強制分散させない。

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

hard availabilityが日付境界をまたぐ場合も、対象日との交差区間を残す。片側だけ指定された時刻は、解決済みの開始日/終了日境界までを表す。`24:00`は内部の解決済み終端であり、providerのwire clockに追加した許容値ではない。

## Preference and personalization

preferred time、observed profile、learning-specific scoreは、hard availabilityを通過したsafe candidate集合の中でのみ順位付けに使う。

- explicit preference > inferred/observed tendency
- current-week acceptanceをdurable preferenceへ自動昇格しない
- personalization unavailable/failed時はsafe deterministic baselineへ戻る
- preferenceはfree timeを新設しない

plan-wideの希望時間帯（例: 平日は20時以降）もtask/componentの希望時間帯も、解決済みの日付・時刻から配置用のpreferenceへ渡す。plan-wideの希望は各work targetへ適用し、task/component固有の希望を先に評価する。希望時間に安全な空きがない場合、soft preferenceをhard constraintへ昇格させず、既存の安全な候補へ戻る。

task/componentの希望時刻が片側だけ指定されている場合、開始のみはその時刻から日末、終了のみは日初からその時刻までとしてcompileする。日付だけの希望へ落とさない。日付・named period・時刻区間・constraint levelが解決できない希望はblocking questionにし、黙って省かない。`soft available`は希望として順位付けに使い、hard available集合を拡張しない。既知のtyped clock/named periodはwork targetの有無と独立に解決し、配置用projectionがまだ無いことを理由に未解決の時間帯と判定しない。

plan-wideのnon-recurringなcanonical weekdayのsoft preferenceがrequest clockから解決され、accepted planning windowの外になる場合は、既存の`availability_outside_planning_window`をblockingとして日付scopeを質問する。勝手に毎週の反復や計画週の曜日へ読み替えず、一度のscope回答を通常のsemantic/訂正境界で受理して解決する。既にwindow内のweekdayは追加質問を必要としない。

## Estimated effort and allocated time

作業量とペースから求めた見積もり時間と、実際に確保する予定枠は区別する。明示session capがない場合のcurrent allocation policyは、適用されるペース補正のあとに10%の余裕を加え、基準見積もりが60分以下なら5分単位、60分を超えるなら15分単位で切り上げる。

- 20ページ×3分、12ページ×5分はいずれも基準60分 → 余裕込み66分 → 確保70分
- 基準120分の見積もりは132分 → 確保135分（固定で10分を加える仕様ではない）
- 「2時間進める」のような時間そのものを作業量とする`intrinsic_duration`には10%の見積もり余裕を加えない

プレビューの時刻・合計は確保した時間を表示する。会話で予定枠の長さを説明するときも、作業量×ペースをそのまま予定枠と断言せず、実際の候補時間を根拠にする。余裕と切り上げは`semantic/weeklyPlanningEffortAllocation.ts`が所有し、既存予定の前後に置く衝突回避bufferとは別である。

候補とdraftには、基準見積もり・ペース補正後・余裕込み・確保時間、および補正/見積もり余裕/切り上げの理由をtyped `allocationBreakdown`として引き継ぐ。配置済みのsliceから内訳を投影し、previewの集計で再度余裕を加えない。既存データで内訳が無い場合は、理由を推測して表示しない。

preview card/sheetは余裕があるとき「見積もり1時間＋余裕10分」のように基準と差分を表示する。時間そのものを作業量とするintrinsic durationには見積もり余裕の表示を付けない。内訳がrendererへ渡る場合は、見積もり・余裕（0分も含む）の説明を会話で重ねず、applicationの表示へ委ねる。rendererへの内訳と実際の条件達成の説明境界は[current contract](../architecture/current-contract-v5.md#conversation-interaction-three-responsibilities-issue-488)が所有する。

### Explicit content session length precedes margin

個数で数える内容単位（countable content units）の明示session lengthは、通常の日別分配と見積もり余裕より先に扱う。対象は正の整数amountを持つ内容単位で、word/lesson/chapter/section/exam_yearや整数customも含む。minute/hour/sessionは専用の分割経路、mock_examはatomicのままとし、分数customの量を整数へ変えない。補正後の1単位コストと上限から各sessionに収まる整数単位数を求め、全量を保てるだけのsessionへ分ける。各sliceへその内容の実コストを先に確保し、既存の余裕込みallocationと全session上限の小さい方までの残余を、上限内で均等に配る。基準見積もり・page range・session factの出典を保ち、余裕だけのtailや端数page/problemを作らない。

- 40ページ×3分、上限60分 → 20ページずつの60分×2
- 20ページ×3分、上限60分 → 60分×1。通常の70分allocationより明示上限が先で、実余裕は0分
- 1単位の補正後コスト自体が上限より長い場合は、その単位を端数化せず実コストを保ち、達成状況を`not_satisfied`として表示する。atomic work・分数custom・生成chunk数上限によって分割できない経路でもsession factの出典を保ち、実際のblock長から達成/未達を判定する。計算可能な超過を`not_evaluated`にしない

内訳の`bufferedMinutes`は明示上限適用前のpolicy計算値であり、`allocatedMinutes`は実際の確保時間、`marginMinutes`は確保時間と基準見積もりとの差分としての実余裕を表す。例えば20ページ×3分・上限60分なら、基準60分・policy-buffered66分・allocated60分・実余裕0分となる。上限が無い場合は従来どおり60→66→70となる。この中間計算値を表示枠の長さとして扱わない。

各sliceの所要時間はその内容のコストを下回らず、条件が許す別日分散を保つ。固定日のworkはその日を保つ。これらはshared scheduler policyであり、同じaccepted factsなら両conversation architectureへ適用する。


## Change rule

scheduler policyを変更するときは、少なくとも次を確認する。

1. hard constraintsを弱めていないか
2. reserve/slack behaviorを意図せず失っていないか
3. atomic workを勝手に分割していないか
4. current timeより前へ配置していないか
5. progressとtargetを混同していないか
6. deterministic regressionがcurrent behaviorを固定しているか

古いtask文書をcurrent ruleとして復活させず、現在も必要な原則だけをこのpolicyへ統合する。
