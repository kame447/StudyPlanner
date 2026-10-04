# Issue #305 第四段階 — application が持つ候補集合による入力意味解釈の再設計

Status: active / 設計判断と Phase B の受入条件（runtime 変更なし）
Updated: 2026-10-04
Tracking: Issue #305（品質証拠 #333、安全性回帰 #335。user-context 側の既存境界は [`../../user-context/work/20260927-issue305-jev-first-user-context-routing.md`](../../user-context/work/20260927-issue305-jev-first-user-context-routing.md)）
Base: main `228e58330e5275aa3a33173e46dc136cb1cd2b7c`（調査時の固定 snapshot は `842cd4e9`。その後の main の差分は Jev の入力契約に触れていないことを確認した）
Reference implementation: Jevbox `7e4562124c49d0e6a527609e872b7627e00ef604`（`server/jev.ts`、`server/organization.ts`、`server/retrieval.ts`、`docs/organization.md`、`docs/retrieval.md`、`docs/section-sampling-2026-10-02.md`）

## 範囲と KPI

- **範囲**：ユーザー入力の意味解釈（semantic 層）だけを扱う。renderer、最終的な自然文の生成、テンプレート文、UI の文章は、KPI・評価・提案のいずれにも含めない。
- **KPI**（この順で、すべて semantic 層に限る）
  1. semantic-Luna-free rate（同じ turn に semantic Luna の呼出しが1回も残らない turn の率）
  2. semantic Luna dispatch の実数 / turn
  3. semantic latency（実測 p50 / p95）
  4. semantic cost（実 usage）
  5. semantic correctness（全命題・対象・scope の保存）
- Jev で扱う field の数は KPI にしない。
- 五つの KPI は別々に測る。同じ turn に Luna が残れば、その turn は semantic-Luna-free rate には寄与しない。それでも、実行された Luna 呼出しが減れば（例：2回 → 1回）dispatch / turn は改善する。Luna が残ることは「全 KPI の効果が 0」と同じではない。
- 逆に、field 単位・head 単位で Jev を足しても、実行される Luna 呼出しが同じなら dispatch の削減は 0 である。Luna を直列に同じだけ呼ぶ構成なら、Jev の分だけ latency と cost が増えやすい。ただし token 量や並行性によって変わるので、latency と cost は常に実測で判断する。

## 採用規則

**semantic Luna を安全に減らすことが実測で証明された unit だけを採用する。**

unit とは、次の五つを一つにまとめた turn 型の transaction である。

- typed な入口（pending questionCode 等の machine state）
- 質問時点で固定した、application が持つ候補集合（manifest）
- Jev の gate
- formal commit（既存 validator、revision の再照合、atomic な適用）
- 全文を既存 Luna へ送る fallback

採用ゲート（すべて AND。閾値は結果を見る前に owner が事前登録する）：

1. **頻度**：Phase 0 census で、eligible な turn が実際にある。
2. **削減の実測**：事前登録した全 turn の分母（weekly-planning と user-context は別）で、semantic Luna dispatch の実数 / turn が、同じ turn の Luna baseline より減る。
   - initial / focused / audit / repair / retry / fallback / shadow / race の、**実行されたすべての呼出しを数え**、同じ turn どうしで合計の差を取る（paired）。repair の呼出しが実測で減ったなら、それも削減として数える。
   - Luna を1回でも実行した turn（shadow・race を含む）は、free な turn とは数えない。
   - 下の三つの率と dispatch / turn を分けて報告する。
3. **安全**：accepted 群の joint correctness と joint false acceptance（veto の偽陰性を含む）が、事前登録の上限以内で、同じ turn の Luna baseline に対して非劣性である。候補漏れを注入しても重大な scope の欠落が起きない。none・低信頼・stale・revision の不一致は、必ず全文 Luna か reject になる。
4. **校正**：閾値は別の calibration set で決め、未消費の封印 holdout で一度だけ判定する。confidence を accuracy の代わりにしない。
5. **label**：出所（synthetic / `opus-5.5-limited-judge` / human）・独立性・不確実性の区間を示す。synthetic や model judge を gold と呼ばない。区間が判定に足りなければ未証明として hold にする。
6. **KPI の非退行**：実測 latency と実 usage cost が、事前登録した許容幅を超えて悪化しない。推定 latency や、欠測 usage を 0 とした値は証拠にしない。

次のものは unit ではなく、単独では採用しない。

- field 単位・head 単位の Jev 化、hierarchy や menu 幅という表現の選択
- 下記の基盤（questionCode の修正、計測、候補 manifest の primitive）。これらを merge しても、採用ゲートの通過にはならない。基盤の merge は「既存の挙動を壊さない」ことの確認であり、「semantic Luna を減らした」ことの証明ではない。
- 実行される Luna 呼出しを1回も減らさない Jev 化（Jev を同じ Luna 呼出しの前に足すだけのもの）

**現時点の採用は 0 件**である。既存の D1 / D2 / #339 は実装済み・off・未証明で、有効化にも同じゲートを課す。過去に「採用（off）」とした単位（focused authorization、focused contextual、temporal scope repair、user-context routing）の扱いは下の「前回の判定」を参照。

## 結論

1. Jevbox 型の階層で消えるのは、「一つの menu に入る候補数の上限」という機械的な blocker だけである。既存の no-go / hold を解除する証拠はなく、hierarchy が flat より優れるという実測も、semantic Luna 削減の新しい実績もない。
2. 移す価値があるのは階層そのものより、application が所有する候補集合、none、menu 内の確率 gate、provider の前後と commit 時の再照合というパターンである。Jevbox の filing には source と folder の snapshot を commit の transaction 内で再照合する仕組みがある（下記）。一方、候補集合全体の hash・候補の追加検出・StudyPlanner の selection epoch は Jevbox になく、StudyPlanner 側の**新規設計**である。
3. 最優先は新しい tree ではない。順に、(i) turn 単位の semantic dispatch の計測と census、(ii) focused contextual の questionCode 欠落の修正と新しい独立評価、(iii) 頻度と契約が成立した候補だけの対称比較、である。

## Jevbox から学ぶこと / 移さないこと

Jevbox `7e456212` は参照実装であり、StudyPlanner の正本ではない。

**学ぶこと**

- **application が持つ tree**：Jev は tree を生成しない。葉は application が所有する実在の entity（document・section・folder）である。ただし中間の routing group は、application が機械的に作る仮想の group で、実在の entity ではない。filing の root では、生成 model が新しい folder を提案する（これは移さない。下記）。
- **none**：候補外への逃げ道を menu ごとに持つ。StudyPlanner では none は「全文を既存 Luna へ」を意味する。
- **確率 gate**：filing は、同じ menu 内で top の確率 ≥ 0.65 かつ top − 次点 ≥ 0.2 のときだけ選ぶ（`server/organization.ts:133–152`）。confidence という field ではなく、Choice の確率分布から計算する。root 以外で曖昧なら、実在の parent に留まる。root で曖昧なら、留まる先がないので新しい branch の提案へ進む。StudyPlanner では「留まる」を「部分 commit せず全文を Luna へ」と読み替え、root の例外は移さない。
- **bounded menu**：retrieval は子 64＋none（`server/jev.ts:5–22` の `menuSize`）。filing は子 16（`filingMenuSize`）に、該当する場合の here / none / 提案した folder の選択肢が加わる。子が menu 幅を超えると、連続した slice の仮想 group を再帰的に作る（`size=max(m, ceil(n/m))`、`server/retrieval.ts:158–208`）。
- **freshness**：retrieval と filing で範囲が違う。
  - retrieval は、routing の前と provider の応答の後に読み取り権限を再確認する（`server/retrieval.ts` の `canRead`）。内容の revision は照合しない。
  - filing は、document の状態・parent・名前・解析結果と attempt の同一性（`server/organization.ts:318–346`）、folder の parent・名前・説明と書き込み権限（`:402–430`）を照合する。照合は各 decision の前（`:435–437`）、planning の後と commit の transaction 内（`:549–552`）で行い、移動先の権限も確認する（`:559` 以降）。
  - どちらにも、候補集合全体の hash、候補の追加の検出、応答ごとの content hash の保証はない。

**移さないこと**

- root での新 branch の生成（生成 model による提案）
- retrieval の「後段の evidence 検証で routing の誤りを回収する」構造。StudyPlanner の commit には後段の回収がないので、none は「後で回収」ではなく全文 fallback である。
- 0.65 / 0.2 の閾値。StudyPlanner の日本語 corpus で、node の種類・候補数・深さごとに校正するまで使わない。
- single child で Choice を呼ばずに p=1 とする扱い、route score（幾何平均）を正解確率として扱うこと、group label（子の説明の切り詰め連結）を evidence として扱うこと。qualifier が label から落ちる menu は不適格とする。

**Jevbox の比較実験とその限界**（`docs/section-sampling-2026-10-02.md`）

- 固定した 240 問（answerable 212）の pilot で、section の outline だけを渡す腕と、選んだ原文の抜粋を加える腕を比べた。
  - review 後の根拠の到達：186/212（87.7%）→ 193/212（91.0%）。
  - provider への request：1,801 → 1,589（−11.8%。主に evidence scoring の呼出しが減った）。
  - request body の文字数：+38.7%。文字数は payload の目安で、token や金額の測定ではない。
- 両腕は同じ hierarchy・beam・予算を使っている。比較したのは routing に渡す内容（抜粋か outline か）で、**flat と hierarchy の比較でも、意味抽出の比較でもない**。
- 各腕1回の実行、model 補助の label、変化した label だけの review、共有された document という限界がある。StudyPlanner の速度・費用・正確さについては、ここから何も言えない。

**menu 幅**：provider の Choice の上限 255 と、menu 幅の方針は別物である。commit 対象 16・discovery 64＋none は校正前の試験パラメータで、architecture の上限でも精度の保証でもない。flat 101 を制約違反として比較から外さない。幅 × 深さ × latency × payload × joint risk で決める。

## field ごとの分類

V5 semantic schema（18 object、124 field、145 path：closed 39 / bounded 9 / open 76 / cross-field 21）を棚卸しした。

語：**既存0-Luna** = 実装済みの境界（off・未証明）。**研究** = 契約と census が成立した場合に対称比較で検証する候補。**field-only** = field 単体は closed でも、同じ turn に open な意味が残り、Luna 呼出しを減らさないので、それだけでは dispatch の削減にならない。**Luna 維持** = semantic owner は Luna。

| field | 性質 | 判定 | 主な blocker |
| --- | --- | --- | --- |
| category / purpose / activityKind | closed | field-only | 新 task の title・量・構造。これらを問う typed question は現行にない |
| component role / decomposition | closed | field-only | 新 label、親子関係、個数、workload との結びつき |
| quantityRole | closed | 既存0-Luna（D1） | questionCode 欠落、target・scope 込みの joint 評価がない |
| unitCode | closed＋custom | field-only | custom の label、新しい量 |
| amount / minutes / count / capacity | bounded（正の有限値、小数可、capacity ≤1440） | 自由文は Luna 維持。typed pending への回答に限り研究（D5） | 近似・範囲・相対量・換算、unit × role × target × scope の結合、候補漏れ |
| namedTimePeriod | 7 enum＋custom | field-only。`named_time_period_unresolved` は境界（start / end）を補う質問で、enum 選択ではない | custom、食事・睡眠、履歴の昇格 |
| start / end（時・分） | bounded（1440＋null） | 自由文は Luna 維持。`missing_time_bounds` / `invalid_time_interval` / `named_time_period_unresolved` への回答は研究（D5′） | 同じ interval への束縛（両端が自由なら単純積 2,073,600）、overnight、24:00、例外 |
| weekday | closed の集合 | field-only | 集合の契約、例外、特定の週 |
| absolute / relative date | relative は closed、absolute は bounded、custom は open | 自由文は Luna 維持。date scope 系の typed pending への回答は研究（D5′） | 週 × 曜日、event 相対、元 turn の anchor |
| recurrence kind / count | closed / bounded | Luna 維持 | interval・総回数・例外の field がない |
| availability / unavailability | variant 付きの joint tuple | Luna 維持 | 極性、plan と task の範囲、hard / soft、例外 |
| constraint source の use / stop | closed（3×2） | hold 維持（C5） | 旧 use の supersession がない、期間、置換か併用か |
| registered materials / user context | entity | discovery は context 品質の改善（Luna-free とは別に計上）。単一教材の完全操作は研究（D6） | material → planning graph の adapter、current intent、12件上限、updatedAt がない、章の正本がない |
| entity target / reference | entity | reference discovery として再評価 | 同名、複数参照、新 entity、stale |
| accept / reject / modify | closed | C9 no-go 維持 | 直接受理 1/16、p50 の悪化、collective・条件付き |

「値域が有限だから Jev でよい」とは判断しない。独立した head と joint な tuple を混同しない。user の履歴を current intent に昇格しない。

## 表現の比較原則（flat / 未解釈 span / hierarchy / Luna）

すべての腕に**同じ target・measurement・precision・scope の binder と whole-turn gate** を与え、**完全な tuple を葉にする**。「数字だけの head」と「完全 tuple」を比べる非対称な比較はしない。

| 腕 | 位置づけ |
| --- | --- |
| flat 完全 tuple（≤255、none 込み） | D5 / D5′ の主対照 |
| 未解釈 span 完全 tuple | 原文の数字・時刻の字面 span を解釈せずに候補化する研究の腕。authority と candidate recall を事前に監査し、同じ paired 比較に明示した腕として入れる。修飾・否定・対象の保持は前提にせず試験する |
| 同じ葉集合の hierarchy | 比較の腕。優位を主張するには、同じゲート上で flat を上回る実測が必要 |
| cardinality sweep（10 / 50 / 100 / 250） | binding を固定した診断として別に集計 |
| coarse bucket・代表値、桁分解 | no-go（意味を変える／混成・小数） |
| parser が解釈して候補を狭める案 | production では no-go（raw 日本語 parser を semantic authority にしない） |
| Luna | 必須の baseline。ただし Luna への fallback も semantic accuracy の保証ではない |

## 受理の三段構造

1. **typed eligibility**：入口は machine state（pending questionCode、fresh な単一 target、manifest）だけで決める。raw 発話の分類で新しい受理経路を開かない。
2. **semantic sufficiency**：Jev が「発話がその範囲だけを含む」ことを判定する。これは**経験的リスクであり、code では証明できない**。
3. **formal commit**：既存 validator、revision / hash の再照合、atomic な適用。部分 commit はしない。

veto head（condition_change / independent_meaning 等）は「誤っても Luna に戻るだけで安全」とは扱わない。veto の偽陰性と主 Choice の高確信な誤答が重なると、命題の欠落を通してしまう。同じ model に由来するので独立した安全層でもない。安全性は accepted 群の joint false acceptance で採点する。

## 候補

| # | turn 型 | 入口 | 分類 | 前提・注意 |
| --- | --- | --- | --- | --- |
| D1 | 数量 role の回答 | `quantity_role_unresolved` | 既存0-Luna（off・未証明） | questionCode 欠落の修正と、新しい独立評価 |
| D2 | 未保存 draft の作成意図 | draft eligibility | 既存0-Luna（off・未証明） | save / approval ではない |
| #339 | user-context 新規入力の external owner 差し戻し | 新規入力（既存 record なし） | 既存0-Luna（off・未証明。user-context の分母） | 新しい hierarchy の成果に加算しない |
| C5-tuple | 既存の effort / window 候補の選択（ordinal / deictic / content-addressed） | `ambiguous_effort_estimate` / `ambiguous_planning_window` | 研究（検証の暫定第一） | typed intent に候補がない（`weeklyPlanningStableV5DialogueContext.ts` で `allowedChoices` が空）。質問時点で manifest を state に固定する入力契約、supersession、頻度 |
| D5 | 数値の typed pending 回答（「1問7分」） | `missing_effort_estimate` | 研究 | 上の対称比較。現行の応答 shape は minutes を返せない。字面にない値は Luna |
| D5′ | 時刻・日付の typed pending 回答 | `missing_time_bounds` / `invalid_time_interval` / `named_time_period_unresolved` / date scope 系 | 研究（条件付き） | typed question があることだけで値 tuple が閉じたとは認めない。片側が既存値で固定される場合と両端を作る場合を分ける。overnight / 24:00 / 複合相対 / 例外は Luna |
| D6 | 明示選択した単一教材の saved remaining を今回の target に採用 | 明示選択＋新しい typed 入口 | 研究（契約依存） | domain → graph の adapter、current intent、revision / permission |
| — | constraint source / date rule / proposal reject | — | hold / no-go 維持 | 下の表 |

指標は三つに分ける：(1) raw dispatch-free rate、(2) 正しい semantic resolution かつ free の率（正しい無変更・外部差し戻しを成功に含める）、(3) mutating commit rate。

## 前回の判定：維持 / 再評価 / 条件付き仮説

過去の結論は書き換えない。この表は、Jevbox 方式で消える blocker と残る blocker を並べたものである。

| 項目 | 前回 | 今回 | Jevbox 方式で消える blocker | 残る blocker |
| --- | --- | --- | --- | --- |
| 全 field の独立 fan-out | no-go | 維持 | 単一 menu の上限 | open の生成、結びつき、mixed、joint |
| C1 / C1′ effort の categorical head | no-go | 維持 | なし | minutes が open、tuple と不可分 |
| C1 系の完全 tuple 化（D5） | — | 条件付き仮説 | 値の再生成が不要（候補が完全な場合） | 候補の完全性、binding、頻度 |
| C2 provisional_timebox | hold | 維持 | なし | scheduler / preview の権限 |
| C3 no-op completeness | no-go | 維持 | なし | 命題の不存在の証明 |
| C4 dense complete | hold | 維持 | なし | 全命題充足の証明 |
| C5 既存 effort / window tuple の選択 | hold | hold のまま再評価（検証の暫定第一） | 候補が多い場合の幅 | manifest、supersession、頻度 |
| C5 source use / stop | hold | 維持 | 候補数（元から小さい） | supersession、期間、busy authority |
| C5 date rule の衝突 | hold | 維持 | rule ID を経路に入れられる | 分割・残存の atomic な差分 |
| C6 user-context 編集 | no-go | 本番は維持。既存 record の候補化は再評価 | 文脈の欠落を候補で補える | 頻度・便益が未計測 |
| C8 user-context kind | no-go | 維持 | なし | label / value の生成 |
| C9 proposal reject / accept | no-go | 維持（旧 holdout での再 tuning は禁止） | なし | 直接受理 1/16、p50 3,227 対 2,596ms |
| 1440 の単一 Choice | 不可 | 単一方式は維持。bounded tree は単一時刻の候補数の blocker だけが消える（採用ではない） | 単一 menu の上限 | interval 全体の結合、候補の完全性、効率 |
| flat 1〜100 / sweep | 実用精度は未証明 | D5 / D5′ の主対照・診断として再評価 | （元から API の範囲内） | 識別 × binding |
| 桁分解 | no-go | 維持 | menu の小ささだけ | 混成・小数 |
| 字面 parser の候補 | offline 限定 | 「未解釈 span 候補」として研究で再評価。authority の禁止は維持 | 値の再生成・全列挙が不要 | 候補漏れを検出できない |
| registered material の「残り全部」 | 原理的に可能 | 研究（D6、契約依存） | 12件の切り落とし、名前抽出の回避 | adapter、current intent、stale |
| material → chapter → section | Luna | 維持 | なし | domain の正本がない |
| temporal side contribution | no-go | 維持 | なし | 実測で不採用（holdout で generic の Luna 呼出しが 57 対 53 に増え、回収が 15/16 対 16/16 に下がり、p50 / p95 も悪化した。#333 記録「置換の結果」の単位7） |
| temporal scope repair | 採用（off） | 採用規則のもとでは未採用扱い（初回 Luna の後に動くので free な turn は作らない。repair 段の呼出しの削減は、全 turn の paired 実測でまだ証明されていない。便益が 0 だという判定ではない） | なし | initial の後に動く |

C7 は今回の証拠範囲に現れなかったため判定していない。

## 先に直す既存の問題

1. **focused contextual の questionCode が Jev の state の外にある。**
   - `shared/focusedContextualDecision.ts:32–45` で questionCode は state の外にあり、state は currentUserText と pendingQuestion だけを持つ（`:100–107`）。Worker は `provider.evaluate(params.context.state, …)` だけを渡し、questionCode は gate にだけ使う（`workers/ai-proxy/src/decision/focusedContextualDispatch.ts:282`）。
   - ところが catalog は「Only for questionCode=quantity_role_unresolved」と条件づけている（`workers/ai-proxy/src/decision/contextualDecisionPolicy.ts:26–30`）。
   - 同じ state（targetQuantityRole=unknown、questionBasis=null、hasEstimateTarget=false）が `quantity_role_unresolved` と `missing_effort_estimate` の両方で validator を満たす。
   - 欠落は focused contextual の2つの code に限られる。過去の低い受理率の原因とは断定しない。
2. **既存評価の削減数は semantic-Luna-free rate ではない。** authorization の 34/50 のうち 27 件は generic へ進みうる。contextual の 11/30 は focused 呼出しの削減である。temporal repair の 31/48 は初回 Luna の後に動く。境界ごとの削減を足して全 turn の率にしない。
3. **評価基盤の限界。** contextual の Jev latency は「Jev 実測＋別実行の Luna」による推定である。contextual runner は欠測 token を `?? 0` で合算している。holdout に消費記録の強制がない。
4. **C5 の pending は候補 set・順序・ID を持たない。** time / date 系も requestedInformation だけである。
5. **source の stop_using が旧 use を supersede しない**（静的確認。テストでの再現はしていない）。
6. **登録教材の projection は最大12件で、updatedAt を model に渡していない。** 章・section の正本が型にない。

## 評価と label

- **消費済みの holdout を、新方式の独立証拠に再利用しない。** 対象は、#305 の置換単位1〜5（focused authorization、focused contextual、temporal scope repair、user-context routing、temporal side contribution）と C9 の holdout である。回帰の診断には使ってよい。
- synthetic label、Gemini の判定、`opus-5.5-limited-judge`、Jev と Luna の一致は gold ではない。二人の human blind review は必須ではない（owner 判断 2026-09-27）が、label の出所・独立性・不確実性を必ず記録する。
- 実測と推定の latency、未知の usage と 0、全 turn と eligible、既存と新規、semantic correctness と route の一致を分けて報告する。
- 禁止：head 別の正解率の積、別 corpus の率の掛け算、shadow を分子に含めること、既存 D1 / D2 / #339 の成功を新方式に二重計上すること、「fallback した」ことを正解と数えること。

## Phase 0 census

**行**：入力 turn（retry / repair も同じ turn に join する）。weekly-planning と user-context を別の母集団にする。

**列**

- 出所（actual / fixture / synthetic）、baseline の model と mode、相関 ID。actual・fixture・synthetic は別の母集団として集計し、synthetic に例があることを本番の頻度とみなさない。実測の証拠がなければ hold か owner の判断とし、新しい収集の承認はこの記録からは生じない
- questionCode、input / graph / source revision、binding の状態
- 対象数・独立命題数、open な値の種類（新 title・label、自由な数値、日付の関係、custom）
- C5 の参照形式（ordinal / deictic / content-addressed / new-value）
- D5 / D5′ の値 tuple の形（片側固定か両端か、overnight / 24:00 / 例外の有無）
- 候補集合の大きさ・分岐数・深さ、manifest の完全性（現状と、契約ができた場合の見込み）
- 既存 adapter の有無、scope の閉包
- semantic 用途ごとの dispatch（initial / focused / audit / repair / retry / fallback / shadow / race）。attemptCount を Luna の回数の代わりにしない
- 実測と推定の latency の区別、usage / cost（欠測は NA で、0 にしない）
- label の出所と独立性、NA の理由

**導出**：構造上の上限 U（区間）、上の三つの率（全 turn と eligible の両方の分母）、dispatch / turn、semantic p50 / p95・cost、joint correctness と joint false acceptance。打ち切り条件は結果を見る前に owner が決める。

user text を保存しない typed telemetry を優先する。real-user の telemetry や外部送信の有効化に owner の承認が要る場合は、code と tooling を用意したところで止める（#187 / #213 の責務）。

## Phase B の unit（実装の受入条件）

一つの unit を一つの worktree / branch で扱い、file の担当を重ねない。各 unit は #335 の影響範囲の回帰を通す。merge の条件は CI green、Opus の統合承認、外部監査（Astra）の pass である。docs（この記録）の merge より前に production code を merge しない。

| unit | 内容 | 性質 |
| --- | --- | --- |
| 0 | focused contextual の questionCode を Jev に見える typed 契約へ入れる（または question 別の catalog を application が選ぶ）。envelope と state の不一致は fail closed。wire レベルの request body テスト、questionCode だけが違う minimal pair、新しい封印 corpus での paired 評価。D1 の直接受理・誤り・latency・cost を測り直す | 基盤の修正＋既存 D1 の再評価。修正の merge は採用ではない |
| 1 | Phase 0 census と turn 単位の semantic dispatch 計測 | 基盤。採用ではない |
| 2 | 候補 manifest と階層 transaction の共通 primitive（安定した候補 ID と順序、none、candidateSetHash、source / input revision、selection epoch、部分 commit の禁止、校正方針の明示。0.65 / 0.2 を production の値として固定しない）。source の状態・権限・候補集合の一致を、provider に候補を見せる前、選択の後、commit の直前の3点で確認する | 基盤。採用ではない |
| 3 | C5-tuple の PoC（manifest に完全 tuple を固定できる scope に限る） | 採用ゲートの対象。lifecycle・supersession・scope が一意に閉じなければ hold として報告し、実装を押し込まない |
| 4 | D5 の PoC（target・measurement・scope が machine state で確定している場合に限る） | 採用ゲートの対象。flat / 未解釈 span / hierarchy / Luna の対称比較 |
| 5 | Phase 0 の頻度と契約の閉包で D5′ か D6 を選ぶ | 採用ゲートの対象。どちらも安全に閉じなければ、枠を埋めるためだけに実装しない |

## rollout

`JEV_MODE=off` / `JEV_CANARY_PERCENT=0` のまま進める。段階は **off → shadow / 評価 → owner の明示的な承認の後に限り canary** である。real-user の shadow、production telemetry、provider への送信範囲の拡大、scheduler・save・approval・lifecycle の権限は、owner の承認なしに広げない。

## 証拠の系譜

この判断は、gpt-6.1-sol 6体の調査報告（schema-closure、numeric-hierarchy、temporal-hierarchy、context-availability、transaction-architecture、current-jev-audit）、Opus の統合、gpt-6-astra の独立監査と2往復の反論を経て合意した。runtime の合意記録は repository の外（AgentStack runtime）にあり、この記録が repository 内の正本である。

## Checkpoint

- 2026-10-04：Phase A（この記録と関連 docs の更新）を `docs/issue305-jev-hierarchical-input` で作業中。base は main `228e5833`。次の作業は外部監査 → docs PR → CI → merge → Phase B の unit 0〜2 着手。
