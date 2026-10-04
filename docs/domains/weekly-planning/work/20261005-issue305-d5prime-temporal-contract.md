# Issue #305 r2-F — D5′ 時刻・日付の typed pending 契約設計

Status: active / 設計と診断評価の準備。本番 route・採用は未実装
Updated: 2026-10-05
Tracking: Issue #305、第2ラウンド F（GustyMaxwell、統合者 BronzeMaxwell）
Base / HEAD: `8e62377e0c59d8b5ac820358781a8c3584433a9a`
Branch: `feat/issue305-d5prime-temporal-contract`（親が改名。未 commit の提出）
Parent contract: [候補集合による入力意味解釈](20261004-issue305-jev-hierarchical-input-interpretation.md)
Authority: owner の DECISION 5。Phase 0 / Unit 0 の結果の後に統合者が実装へ進むか判断する。

質問が表す一つの時間条件について、明確な同日 interval または一日の日付を一つだけ受ける契約を設計する。現行の質問には完全な temporal binding がないため、question code の存在だけでは D5′ eligible としない。片側不足と両端回答を分け、本番の自然言語経路は変更しない。

## 作業 checkpoint

- Issue #305 の最新 checkpoint を読み、F の担当範囲と基準 HEAD を確認済み。他担当の port / reducer / codec / guard は編集しない。
- availability / commitment の質問発生、provider と保存値の検証、質問提示の revision、既存 correction transaction を読んだ。
- 現行 availability の片端欠落は補完される。`missing_time_bounds` は両端不足。24:00 は解決値と保存値で許容範囲が異なる。
- 140件・70 minimal pair の synthetic 診断 corpus、10 / 50 / 100 / 250 の完全 interval 葉集合、評価設計を runtime artifact に凍結した。provider は呼んでいない。
- 整合検証、既存 temporal focused106件、app / Worker typecheck、最終verifyが成功した。tracked runtime tree は基準HEADと同一。
- 次: 親のreviewと外部監査。採用の次段階は Phase 0 / Unit 0 後の統合者判断。
- 完了条件: code ごとの入口根拠、片端と両端の区別、tuple / canonical encoding / supersession / migration 設計、凍結 corpus と hash、対称な cardinality 設計、検証記録、親への報告。

## 1. 現行の入口と、設計上の eligibility

以下の `file:line` は基準 HEAD に固定。`semantic/`、`application/`、`dialogue/` は `src/features/weeklyPlanning/` 配下を指す。発生条件は実コードの条件であり、実ユーザー頻度ではない。

| question code | 発生箇所と実際の条件 | D5′ 初期契約案 |
| --- | --- | --- |
| `missing_time_bounds` | `semantic/weeklyPlanningAvailabilityResolver.ts:279`。named period 解決後も start / end が両方ない | **両端 interval**。単一の適用日と一つの availability fact を質問時に固定できる場合だけ。単独時刻は受理しない |
| `invalid_time_interval` | 同 `:289`。補完後の不正 clock、start=24:00、同値など | **両端 interval repair**。質問自体は両端を要求する。valid な片端が存在しても勝手に固定しない |
| `named_time_period_unresolved` | 同 `:264`。両端なし、named period あり、context に対応 bounds がない | built-in period の**今回の単一条件だけ**を具体化する両端型を設計。custom period は除外。既存 enum の選択や習慣の更新ではない |
| `missing_availability_date_scope` | 同 `:230`。recurrence / date expression がなく、planningDates が複数 | **一日 date repair**。同日で正常な interval が既に固定されている場合だけ。複数日、繰り返し、別の clock 変更は全文 fallback |
| `missing_commitment_date_scope` | `semantic/weeklyPlanningTaskCommitmentResolver.ts:178`。適用する recurrence / date expression がなく、planningDates が複数 | **一日 date repair**。fixed interval の task と component/task target、hard level、clock を同じ tuple に固定 |
| `invalid_commitment_interval` | 同 `:261`。fixed interval の端欠落、format 不正、同値 | availability と区別した**両端 repair**。単一適用日、hard、exact、task と対象を固定できる場合だけ |
| `missing_daily_capacity_date_scope` | `semantic/weeklyPlanningDailyCapacityResolverV5.ts:141` | 初期範囲外。capacity の保存/provider validator 自体が date scope を要求する（`semantic/weeklyPlanningAvailabilityValueValidatorV5.ts:80`）。resolver の code だけから有効 ingress の母集団を作らない |
| その他の date / interval code | `unsupported_date_expression` は availability resolver `:206`、`unsupported_commitment_date_expression` は commitment resolver `:153`。`unresolved_hard_date_expression` / `contradictory_hard_date_bound` は `semantic/weeklyPlanningGenericSchedulerInput.ts:464` / `:479` | custom / unsupported、複数条件の矛盾、date rule の分割は範囲外。`conflicting_task_date_rule` も引き継がない |

resolver の issue は `semantic/weeklyPlanningGenericSchedulerInput.ts:543` / `:606` でそれぞれ temporal constraint / availability の fact ID に結合される。`semantic/weeklyPlanningStableDialoguePolicyV5.ts:89` が blocking issue を順位付けし、`application/weeklyPlanningStableV5ResponseRouting.ts:131` が質問へ送る。質問の機械 state は `application/weeklyPlanningStableV5CompatibilityState.ts:78` で code / topic ID 等を保持する。表示要求の裏付けは `dialogue/weeklyPlanningStableV5DialogueContext.ts:331` と `application/weeklyPlanningStableV5RuntimeQuestions.ts:382`。ここでは質問の生成条件を確認しているだけで、renderer の品質は評価しない。

**片端固定の現在の入口は確認できない。** availability は start だけがなければ 00:00、end だけがなければ 24:00 を補完する（availability resolver `:287`）。一方、commitment は fixed interval の両端を要求する。現在の質問は `start_and_end_time` / `commitment_start_and_end_time` であり、片端 slot ではない。新しい片端 policy を後から追加する場合は別の tagged contract / question identity が必要で、現在の `missing_time_bounds` を流用しない。

**到達可能性にも層がある。** provider と persisted graph の clock 値検証（`semantic/weeklyPlanningTemporalValueValidatorV5.ts:17`、同 `:49`）は不正 clock と fixed interval の端欠落を拒否する。同値 interval は値検証の後でも resolver で検出される。したがって `invalid_commitment_interval` が生成できることを、端欠落の正常な新規 ingress が存在する証拠にはしない。旧データ・mock・direct resolver と、現在の validated graph を区別して census に対応させる。date と interval の両方が未確定なら、片方の値だけで新 route を開かない。

現行 pending transport は `semantic/weeklyPlanningPendingQuestionV5.ts:8`、projection は `application/weeklyPlanningStableV5SemanticContext.ts:50`。temporal field、固定端、anchor、完全候補は含まれない。dialogue intent の `allowedChoices` も空（`dialogue/weeklyPlanningStableV5DialogueContext.ts:291`）。focused contextual の allowlist は numeric / quantity-role だけ（`semantic/weeklyPlanningPendingQuestionV5.ts:54`）。**現行 pending のまま直接 Jev に入れる案は閉じていない。**

## 2. 比較した案と選択

| 案 | 支持証拠 | 反証条件 | 影響範囲と検証方法 |
| --- | --- | --- | --- |
| A. 新しい片端質問を作り、もう一端を固定 | 完全 tuple を保ったまま候補数を減らせる | 現行 policy に片端 slot はない。質問が両端修正を許すなら one-slot 化は意味を落とす | 質問進行と UX、pending / codec / ledger。端を訂正する minimal pair と reload が必要。将来設計として隔離 |
| B. 現行の両端 / 日付質問に、単一条件の完全 tuple binding を足す | 現行の requestedInformation、fact ID、replacement transaction が存在する | broad fact の分割、別 target の変更、日付・clock の複合修正、候補外吸着が必要なら不成立 | 狭い pending と formal adapter が将来必要。まず設計・診断比較のみ。**本提出で選んだ設計案** |
| C. 全 interval / relative / recurring を hierarchy で扱う | 完全 interval は有限集合として列挙可能 | hierarchy は joint current intent、例外、24:00 の保存整合を保証しない。百万葉の payload / storage 問題が残る | provider / state / migration に広い影響。大集合は offline resource 研究に限定し、初期実装へ含めない |
| D. 現在の Luna を維持し、設計も行わない | 現行 runtime の変更がない | DECISION 5 は schema を確認して temporal を先に設計することを承認した | 本番維持は採用判断まで必要だが、設計を止める根拠にはしない |

「What would make my current interpretation wrong?」への答えは、片端 slot を持つ既存の正式な pending が見つかること、または一つの exact fact の replacement が unrelated facts / 派生条件を変えること。前者なら入口表を修正し、後者ならその subtype を HOLD に戻す。候補数の少なさや高い Choice 確率は反証への回答にならない。

## 3. 質問時に固定する完全 tuple

これは**設計上の型**であり、source の型や本番 route は追加していない。

```text
TemporalQuestionBinding v1
  question: code + action/question ID + presenting turn/message/revision + selectionEpoch
  authority: owner + conversation + request + input/graph revision
  source: exact active condition fact ID + created revision + canonical payload hash
  target:
    availability  -> availability_declaration ID（task ID に置き換えない）
    commitment    -> temporal_constraint ID + taskId + targetFactId
  context: referenceDate + timeZone + weekStartsOn + planning start/end
  mode（排他的 union）:
    full_interval: allowedFieldSet={startTime,endTime}
    named_interval: allowedFieldSet={startTime,endTime,namedTimePeriod},
                    built-in period を今回だけ置換、namedTimePeriod は null に固定
    single_date:   allowedFieldSet={dateExpression}, fixed complete clock interval
    missing_start: fixed explicitly stored end, one absolute date（将来の新質問のみ）
    missing_end:   fixed explicitly stored start, one absolute date（将来の新質問のみ）
  before: family の正式な typed payload 全体 + raw-null/default provenance
  manifest: version + ordered complete leaves + domain definition + candidateSetHash

CompleteTemporalLeaf v1
  binding identity（上の全 scope / revisions と照合）
  sourceConditionFactId + immutable source payload basis
  mode + exact temporal field/scope
  after:
    availability -> kind, constraintLevel, dateExpression, namedTimePeriod,
                    startTime, endTime, recurrenceKind, days, capacityMinutes
    commitment   -> kind=fixed_interval, hard, taskId, targetFactId,
                    dateExpression, namedTimePeriod, startTime, endTime, precision
  resolvedInterval: start(date,time), end(date,time), timeZone
  applicationEffect: replace exactly the pending condition（application が事前に決める）
```

family の正式な payload の根拠は `semantic/weeklyPlanningFactGraphV5.ts:92` / `:197` と `semantic/weeklyPlanningSemanticTypesV5.ts:224` / `:310`。availability と commitment を同一 wire object にしない。capacity / no-additional-constraint は time-window subtype ではないので除外する。availability の `capacityMinutes` は absent と null の既存互換を基準 snapshot に保持し、commitment に availability recurrence を付け足さない。

provider は opaque leaf ID と none を選ぶだけ。operation、source target、date offset、revision、commit を返させない。葉集合・順序・tree・binding の意味を application が作る。group はその完全葉の部分集合であって「start head の結果」と「end head の結果」ではない。root / 中間選択には mutation を許さない。hash は integrity / correlation であり、権限や user の current intent の証明ではない。

**初期 domain は保守的に限定する。** 単一の current planning date、非 recurring、単一条件、既知の level / polarity、同日で start < end、両端 00:00〜23:59。interval 型は元条件の明示的な absolute ISO 一日を保持する（暗黙の一日 default を新しい date field に昇格しない）。commitment は既存 precision=exact / hard に限る。date 回答では fixed clocks と field を変えず、planning horizon 内の明確な absolute date 一日だけを選ぶ。新しい相対表現の意味は初期 domain に含めない。既存 Luna の相対日付機能は維持する。

質問が広い日付集合や繰り返しを表す場合、単一 fact でも scope は一日とは限らない。range の一日だけを修正するには分割が必要なので除外する。候補は「この menu の中だけなら答えられる」domain であり、horizon 内や有限集合というだけで言語上の答え全体を覆うとは主張しない。正しい値が候補外なら none / 全文 fallback にする。raw 日本語で domain を狭める parser、丸め、5分 bucket は使わない。

### 同じ interval / date / target への束縛

1. **Typed eligibility:** fresh な pending、exact active source、単一 scope、mode と必要 context を machine state から照合する。既存質問 presentation の検証（`intake/weeklyPlanningQuestionPresentation.ts:176`）に manifest を足す必要がある。
2. **Semantic sufficiency:** 未変更の全文と必要最小限の質問 context から、明確な答え一つだけか、否定・引用・history・mixed・別 target がないかを model が評価する。これは empirical なリスクであり、deterministic code で証明しない。
3. **Formal application:** selected leaf → family-specific semantic contribution → accepted graph が target / fields / scope / exact endpoint の意味を保つことを検証する。既存 validator と実 transaction を通す。typed shape の成功だけでは binder 不変の証拠にならない。

none、低確率、余分な意味、unknown option、候補外、stale、provider / validation error、budget / depth 超過は部分適用せず、未変更の全文を現行 Luna へ戻す。commit 後例外など outcome unknown は ledger / checkpoint を先に回復し、二重 mutation につながる新規 fallback を開始しない。この recovery hold は semantic な fail-open ではない。

## 4. 日付・24:00・翌日の既存表現との整合

| 表現の層 | 現行 | 初期 D5′ 設計 |
| --- | --- | --- |
| provider / persisted temporal fact clock | `semantic/weeklyPlanningTemporalValueValidatorV5.ts:10`、availability も同 validator を使う。00:00〜23:59 | 同じ領域。24:00 を正規化して保存したことにしない |
| availability の default / named 解決値 | resolver `:287` で欠落 end は24:00。`:311` で翌日00:00へ変換 | default の値と raw null を別に記録。default24:00 を明示的 fixed endpoint として再利用しない |
| overnight | availability `:315` / commitment `:210` は end < start を翌日 endpoint にする | 既存機能は存在するが、初期 route は翌日を含む interval を除外。曖昧か明示的かにかかわらず初期 corpus では fallback |
| draft / preview clock | session codec `application/weeklyPlanningStableV5SessionCodec.ts:56` は24:00も許す | draft が保存できることを Fact Graph / provider value の証拠にはしない |
| absolute date | `semantic/weeklyPlanningCalendarResolver.ts:214` は valid ISO 一日を resolve | 葉に ISO 一日を保存し、resolved start/end の日付一致を照合する |
| relative date anchor | `semantic/weeklyPlanningResolvedDateExpressionsV5.ts:52` は request currentDate / weekStartsOn を使う | 初期回答は absolute だけ。元条件が symbolic/relative date の場合も初期 eligibility 外とし、既存 request-time policy を変更しない |

質問時の reference date / timezone / weekStartsOn / planning range を immutable basis に含める。日付またぎで context が変われば epoch を失効させ、必要なら質問を再提示する。古い「明日」を回答日の今日へ無言でずらさない。将来 relative/date-set 対応を追加するには anchor policy と semantic representation を別の unit として定める。

named period を具体化する場合、旧 `namedTimePeriod` と新 clock を共存させない（value validator `:38`、availability validator `:22`）。単一 built-in period の local repair の after は `namedTimePeriod=null`。旧 condition は lifecycle 履歴へ残し、別の named definition や durable user habit は変えない。custom period、event 相対、recurrence 例外はこの clearing で「解決した」と扱わない。

## 5. 旧条件の置換、保存、migration

**新しい condition の追加だけでは未完成。** 既存 correction transaction は availability の exact active target / new replacement を検証する（`semantic/weeklyPlanningCanonicalCorrectionApplicationExtendedV5.ts:67`）。temporal constraint の target rebase は `semantic/weeklyPlanningCanonicalCorrectionApplicationV5.ts:289`、correction apply は同 `:472`、lifecycle supersession は `semantic/weeklyPlanningFactLifecycleEngineV5.ts:160`。これらが存在するので「旧条件を置き換える機能がない」とはしない。ただし D5′ の manifest / durable consumption を実 consumer と統合した証拠はまだない。

将来の consumer は次の一つの formal transaction を必要とする。

1. live source / permission、question / target / graph / input revision、完全葉、候補追加・削除・改名・順序、epoch、ledger を再読する。
2. family-specific validator を再実行し、application-owned local replacement を current answer の evidence と結合する。新 fact の source を古い発話と偽らない。旧 source lineage は before / lifecycle に残す。
3. 一つの old condition を supersede し、一つの complete replacement を active にする。unrelated facts を保存し、dependent / derived availability・commitment・preview の freshness を既存 policy で更新する。別 scope の migration が必要なら拒否する。
4. reducer の `commit_turn` 成功、graph / planning state、pending の失効、ledger consumption を atomic に確定する。拒否・失敗なら全部 rollback。既存 `weeklyPlanningReducer.ts:76` は pending / week / state revision しか照合しないので、候補 ledger や source CAS の保証として宣伝しない。

Unit 2 の pure staging / in-memory reference port は実 storage の保証ではない。check → await → commit を採用しない。provider の直前（hash/auth の await 後も含む）、各 hierarchy level、応答後、commit transaction 内で authoritative freshness / permission を照合する。local-tab と cross-tab/device の保証範囲を明記する。

**実装する段階では保存・migration が必要。今は不要。** manifest / binding / complete before / epoch / current consumed request を pending と同じ checkpoint に保存し、graph と ledger を別々に失わない契約が要る。現行 session は version v1、2 MiB 上限（session codec `:6` / `:9`）。intake が object であることだけの検証（同 `:188`）や未知 field が残ることは decoder 同期の証明ではない。厳密な temporal union / domain / hash / owner-conversation scope / ledger validation を追加する。

旧 session には binding がないので D5′ を無効にし、既存 Luna と既存 saved data を維持する。再提示時だけ fresh epoch / manifest を作る。旧 response を新 request として再適用しない。unknown version / 不正 binding / quota 超過は fail closed。新巨大 manifest を古い session へ推測補完しない。保存 bytes、quota 縮小、rollback、reload/retry、owner A→B→A、concurrent tabs、commit後例外は実 integration test が必要。

今回は prompt / request / graph / intake / trace schema に変更がない。synthetic artifact は production trace へ送らない。将来これらを wire する PR は feature AGENTS の trace persistence gate（outbox retry、Worker preparation、bytes、未知 sentinel、truncation）か、根拠を示した exclusion 契約とその test を満たす。

## 6. 凍結した adversarial 診断 corpus

Artifact root: AgentStack runtime `jev-impl-artifacts/r2/d5prime-temporal/`。本文は本 work record / 報告書へ転記しない。実ユーザー資料は使っていない。

- `diagnostic-corpus.v1.jsonl`: **140件 / 70 minimal pair / 253,487 bytes**。
- SHA-256: `9951d2bfcdce7a4f6edabfae26a22b55f7ef5c8c555ed46b20ceaf91b0ed147d`。
- `diagnostic-corpus.v1.manifest.json`: author、base、label provenance、population / phase / expected outcome の件数、generator hash を保持。
- 作者: GustyMaxwell、実装と閉包調査を閲覧済み。**synthetic・実装を見た診断用 label、非独立、非 gold、sealed holdout ではない。** API 実行0。これは言語精度の結果ではなく、将来の評価 case 設計。

境界は23:59 / 00:00 / 24:00、両端の順序・同値・不正 clock、AM/PMの曖昧さ、明示／曖昧 overnight。対照には両端と片端、固定端の訂正、custom / event 相対、繰り返しと例外、複数対象、追加 workload / save / polarity、引用・否定、current と history、absolute date の複数日・範囲外・calendar 不正・clock 同時変更を含む。freshness 対照は同じ本文に owner / conversation / input / graph / source revision / epoch / active status / permission / 候補変化を与える。

expected outcome は proposed tuple の候補71、全文 fallback 68、unknown outcome recovery 1。**actual accepted 件数ではない。** 片端型8件は `future_question_policy_only_not_actual`、従来の両端質問に片端短答を与える対照2件、consumer fault injection20件、その他110件を別 population として保持する。semantic・eligibility・freshness・commit・recovery の phase は分けて採点する。

fixture の `oldFact` / `after` は family を比較するための実験用 normal form（nullable task/target/precision と空 recurrence metadata を併記）であり、実際の保存 graph / wire object ではない。formal adapter は family-specific な正式型へ projection し、selected leaf → normalized document → accepted graph の不変を検証する必要がある。generator の assertion は fixture の typed consistency だけで、日本語の意味解釈や production consumer の成功を検証していない。

モデルが quoted interval と現在の採用を混同したり、否定・history・追加の意味を落とした場合は、単に interval が合っていても critical false acceptance とする。fallback は受理 containment の期待結果であり、Luna で final correctness が確認されるまで semantic 正解とは数えない。hierarchy の head accuracy の積、model 同士の一致を正解 label にしない。

## 7. cardinality と対称な表現比較

| domain | 数 | 比較上の意味 |
| --- | ---: | --- |
| 00:00〜23:59 の clock | 1,440 | clock domain の算術。現在の片端 pending 母集団ではない |
| start × end の単純積 | 2,073,600 | 同値・翌日等を含む。eligible interval 数ではない |
| 同日 start < end | 1,036,080 | 日付・target・level 等を既に固定した場合の組数 |
| fixed start18:00、同日 end | 359 | 新片端契約で有効 end は18:01〜23:59。1,440葉と呼ばない |
| fixed end20:00、同日 start | 1,200 | 同 start は00:00〜19:59 |
| 一週間内の単一 absolute date | 7 | interval / scope を固定した date 型のみ |
| 七日 × 同日 interval | 7,252,560 | date と interval が両方自由な拡張 domain。初期範囲外 |

凍結した `interval-leaves-{10,50,100,250}.v1.json` は同じ binder と一分精度の exact complete tuple を保持する。seed `305000+N` の numeric domain 抽選で集合を作り、typed `(18:00,20:00)` 葉を必ず含め、start/end 順で並べた。字面の抽出や丸めではない。別 N 間の差を hierarchy 優位の証拠にしない。

| substantive leaves | none込み | manifest bytes（実測） | leaf manifest SHA-256 |
| ---: | ---: | ---: | --- |
| 10 | 11 | 8,046 | `efa373d062de3b3c0fde848f084448e5f812fdd98ab0efbf0efe7722f6098499` |
| 50 | 51 | 35,726 | `bc3143a4d9ea490181e381da459fe1e646ae2785e6e8647c05632ff8839d570d` |
| 100 | 101 | 70,326 | `403cea18263c79ded8c458080e2b731558e2d5b021c2e3e2e766bf37fcf8d612` |
| 250 | 251 | 174,126 | `d10fa5aa9fc5193f0868b44e20651db20ccf830c51f631d8101c9f2cd9d3b724` |

bytes はこの実験用 serialization のサイズであり、provider tokens、production session サイズ、latency の測定ではない。百万葉の materialization や2 MiB codecへの保存は行っていない。

**対称比較**は同じ raw turn / history / question / binder / leaf order / semantic context / whole-turn gate / formal commit / 全文 fallback を使う。主対照は flat complete tuple+none（255 option以下）、比較腕は同じ葉の hierarchy、必須 baseline は exact HEAD の実際の Luna full-turn pipeline。10 / 50 / 100 / 250 をそれぞれ paired として比較する。group routing に start / end を独立選択させない。

候補漏れは正解 interval / date、別対象の同値、固定端修正、日付だけ異なる同時刻、候補追加・削除・改名・reorder を両腕へ同じように注入する。raw phrase が同じでも binder が違えば tuple が違う。候補外の値を近傍葉へ吸着させない。typed eligibility 拒否、semantic veto、formal rejection、fallback の final correctness を別集計する。

1,440 clock や百万 interval は **offline resource / coverage 診断**とする。単一 flat の255 option上限を越える cell は `NA: unavailable`。それを latency0、error0、Luna削減0として扱わない。254葉の flat と1,440葉の hierarchy を同葉比較と呼ばない。大集合を比べるなら multistage flat を別の arm として事前登録し、同じ complete leaves、binder、budget、全dispatchを維持する。未解釈 span は候補 authority / recall が別問題になるため初期比較から外す。

階層の child幅16 / 64 / 254（各nodeにnone）、最大深さ5 / decision6は**試験案**。menu kind・option count・depthごとに別 calibration set で閾値を決め、owner / auditor が結果前に承認する。既存0.65 / 0.2をdefaultにしない。大集合・短い label・qualifier の欠落・budget 打切りは resource と semantic risk の両方で評価する。

## 8. 実行前に満たす評価条件

`evaluation-design.v1.json` SHA-256: `e2ca40f6ef0f52ede9aa9153861faf62b4b36ff96d83789779861f699f0d0a8c`。これは**事前登録案であり、承認済みの有料実行契約ではない**。

1. Phase 0 / Unit 0 の証拠を親が確認し、temporal subtype、実 consumer、実装着手を決める。frequency unknown をsynthetic分布で埋めない。
2. 本 corpus とは別の新しい calibration set と、実装を見ていない作者による temporal holdout / 独立 label を用意し、provenance・不確実性を記録する。過去の消費済み holdout は診断だけ。
3. 親と外部監査が、scope/menu/depth/budget、zero observed critical acceptance、joint error の非劣性marginと区間方法、all-turn denominator、dispatch reduction、実p50/p95とusage costの許容幅・停止条件を結果前に数値で事前登録する。margin未確定のまま有料評価を実行しない。
4. permission をprovider直前・階層途中・応答後・commit前に撤回する case、re-present、reload/replay、reducer拒否、quota failure、commit後throwを実 consumer で検証する。unknown outcome は回復まで保留。
5. 同じ turn の initial/focused/audit/repair/retry/fallback/shadow/race をすべて join する。weekly と user-context、actual/fixture/synthetic、全turn/eligibleを分離する。raw semantic-Luna-free、correct joint resolutionかつfree、mutating commit率、dispatch/turnを分ける。欠測 usage・incomplete raceはunknown/NA。

この task では paid/real API、real-user collection、shadow/canary、Worker deploy を実行しない。採用0、現在のdispatch削減・semantic精度・実latency/cost・actual頻度はすべて**unknown**。契約設計の完了と採用評価の完了を混同しない。

## 9. 残る判断と引き継ぎ

- DECISION 5 は設計を進める承認として充足した。target / scope の意味や24:00除外を緩める新owner判断は求めていない。
- 既存 temporal pending をbinding付きに拡張する実 consumer と local replacement の integration が次の作業。初期案Bのどの subtype を実装するかは、Phase 0 / Unit 0 後の親判断。
- 片端の質問進行は現行にない。新 UX / policy が必要になる場合だけ別途ownerの判断事項とし、両端質問の頻度に混ぜない。
- 多数の完全葉の保存上限、cross-tab/device atomicity、durable ledgerとgraph/checkpointのrecoveryは実装責務として未検証。pure foundation のmergeやこのdocで保証されたことにしない。
- 本番 path、E のgeneric Choice port、D のcodec/reducer、Unit2 guard、flagsは触っていない。shared hookも追加していない。新Issue/PR/GitHub write、commit/push/branch削除はない。

## 10. 検証 checkpoint

- Repository差分はこの新work recordだけ。tracked app/Worker/config/testsはHEAD `8e62377e0c59d8b5ac820358781a8c3584433a9a`、tree `a3ee5f8f7edcfb5765d454ad61590f77be6fe6f5` と同じ。
- frozen design structural validator: exit0。140件・70pair、complete tupleの固定field、hash、4 sweep、Markdownのparent参照を確認。日本語精度・実consumerの保証を検証したものではない。
- focused: exit0、10files / 106tests pass。availability、commitment、calendar、clock値、local correction、question presentation、dormant import guard。
- `npm run typecheck`: exit0。app / Worker、Worker runtime types再生成を含む。
- `npm run verify`: exit0。fresh non-incremental app/Worker typechecks、full unit/integration suite **655files pass / 4409tests pass**、production build。10files / 45tests skip / 1todoはdefault suiteに既存のobservation/live等のopt-in gateであり、実行済みの独立モデル評価の証拠にはしない。
- 環境: Node22.23.0、npm10.9.8、TypeScript5.9.3、Vitest3.2.7、Vite6.4.3、Wrangler4.143.1、workerd1.20260926.1。`npm ci --ignore-scripts`でlock通りの依存を導入。既存npm cacheへのEPERMは環境の書込み制約として分類し、writableなruntime cacheを指定して解消。source/assertionを変更していない。
- Wranglerはrunbook通り `WRANGLER_HIDE_BANNER=true`。typecheck/verifyではmetricsを送らず、log先をruntimeへ指定。型生成・test・buildを省略していない。
- lint scriptは未設定。buildの500kB chunk warningは既存baselineの警告で、exit0。browser、Firestore、CI、live language evalは本設計提出のscope外。将来consumerのmerge/adoptionでは該当gateが別途必要。
- source引用26箇所の存在・行番号、Markdown link、新fileのwhitespace、runtime差分なしを検査。最終diffとruntime artifactのSHA-256、実行logのpathは親向け報告書に記録する。
