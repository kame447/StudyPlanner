# Issue #305 Unit 0 — contextual paired 評価の事前登録（r2）

Status: active / HOLD — 2本の独立 holdout は凍結済み・未消費。評価は未実行。harness r2 は mock の dry-run まで。実行には harness の監査と承認書が必要
Updated: 2026-10-05
Authority: owner の DECISION 2（新しい独立評価。gate は BronzeMaxwell と CopperHopper が実行前に合意する）。[Phase B の採用規則](20261004-issue305-jev-hierarchical-input-interpretation.md#採用規則)
Technical record: [既存 focused contextual 記録の Unit 0 追記](20260927-issue305-jev-first-focused-contextual.md#phase-b-unit-0--2026-10-04-作業-checkpoint)

この文書は、runtime の事前登録の正本（`preregistration-draft.md`、§0〜§19d）を、§19d の時点の内容で一本化したものである。追補の途中の規則（旧い分母、「失効した turn を 8 dispatch で補完する」規則、Clopper–Pearson の一般の iid の主張、旧い 100 cases / 50 groups の名簿、撤回された §19 の「予約の上限 USD 10」、cost の判定の2つの方法の切替え）は、ここでは置き換え済みである。holdout の結果を見る前に固定し、結果を見て変えない。

## 1. 名簿と母集団

- **B**（RockyGalileo、gpt-6.1-sol xhigh）：60 cases / 30 groups。作者仕様の4層。主の set。
- **C**（DewyGuericke、gpt-6.1-sol xhigh）：70 cases / 35 groups。adversarial に特化した挑戦の set。凍結の前に 20 groups から拡大した（§3 の判定に 59 groups 以上が必要なため。結果を見る前の変更）。
- 合計 130 cases / 65 groups。全 case を名簿に載せ、各 arm を1回ずつ実行して消費する。group の除外はしない。各 group は 2 cases である。
- B と C は別の artifact として受け取り、別々にも記述する。合算の重みは case 数に比例する 60:70 で、結果の前に固定する。
- synthetic な割合を本番の頻度と呼ばない。消費済みの holdout と development corpus は、独立証拠に数えない。development corpus（`scripts/jev-contextual-development-corpus.json`、SHA-256 `75e2cbbf…a22ba`）は実装者の synthetic label で、gold ではない。
- 凍結の hash・時刻・閲覧者・消費の状態は、親が所有する canonical な ledger（runtime の `jev-unit0-eval/ledger.json`）に記録する。本文は、親と監査が凍結まで読まない。

## 2. 固定するもの

- catalog `focused-contextual-answer-2026-10-04-v3`、gate `contextual-conservative-v2-calibrated`（値は変えずに凍結する。questionCode の契約変更があったため、旧い校正は新しい校正の証明にならない）、Jev と Luna の model と routing。
- runtime、policy、両 holdout とその rubric の hash。arm の呼出しグラフ全体。評価用の Worker は run の開始時に1回だけ bundle し、全 segment で同じ bytes を deploy する。segment を開始するたびに runtime・policy・holdout の hash を照合し、違えば中止する。
- 実行順：全 130 cases を ID の code point 昇順に並べ、seed `unit0-r2-2026-10-05` の PRNG で Fisher–Yates を行う。並べ替えた位置が偶数なら AB（Jev-first が先）、奇数なら BA。並行度は 1（直列）。
- 乱数の規約：seed を UTF-8 にして SHA-256 を取り、先頭 16 byte を big-endian の 32 bit word 4つとして xoshiro128** 1.1 の state にする（全部0なら拒否）。算術はすべて unsigned 32 bit。区間 [0, n) の index は `floor(next() × n / 2^32)`（n ≤ 2,080 なので偏りは無視できる。それも記録する）。既知の答え（外部監査と親の2つの独立実装で一致）を test に持つ。
- percentile は nearest-rank：n 件を昇順に並べた ⌈q × n⌉ 番目の値。

## 3. 判定（すべて AND。1つでも満たさなければ HOLD）

| # | 判定 | 規則 |
| --- | --- | --- |
| 1 | 重大な誤り | Jev-first の**最終的な semantic の結果全体**（直接受理だけでなく、fallback や repair を通った結果も含む）で、意味の誤受理・target / scope の誤り・独立した命題の欠落・stale な受理・権限の侵害が **0件**。別の条件として、Jev が直接受理した turn の joint false acceptance も **0件**。B と C のそれぞれで要求する |
| 2 | 意味の正しさの非劣性 | group ごとに、R=1 を「Luna-only では正しく、Jev-first では誤りになった case が1つでもある」とする。悪化した group が **0件** のときに限り、平均の悪化率の上限 U_R = 1 − 0.05^(1/65) ≈ 0.0450 を使い、**U_R < 0.05** で満たす。1件以上なら HOLD |
| 3 | dispatch の削減 | Δ = Luna-only − Jev-first の **semantic な Luna の dispatch の数**（正が削減）。D1 の層（質問の前の machine の適格性 `quantity_role_unresolved` で固定。受理や成功で絞らない）で点推定 **≥ 0.3** かつ片側95%下限 **> 0**。全 turn で点推定 **≥ 0** かつ下限 **≥ 0** |
| 4 | latency と cost | arm ごとの分位点の差の超過（下の式）の点推定と片側95%上限が **0 以下**。cost は §3.4 の上界・下界による判定（1つだけ）。usage が欠ければ、または料金の条件が契約と違えば **HOLD**（0 にしない） |
| 5 | 完全性 | 全 130 cases の両 arm の観測と label が完全。欠ければ unknown として HOLD |
| 5a | run の終端の妥当性 | run が停止なしで完了し、全 260 turn が精算され、支出の ledger（完了の記録、停止の理由、合計）が結果と一致し、holdout の消費が記録されていること。停止・不完全な run は、測定値を診断用に残すが、label や cost が有利でも PASS にならない |
| 6 | census | 評価とは別の採用の条件（§7） |

研究上の判定を満たしても、production の shadow・canary・本番の有効化の承認にはならない。

### 3.1 判定の補足

- 重大な誤り：Luna-only も同じ誤りをした場合は報告するが、それで Jev-first の誤りは許されない。abstain や fallback そのものを正解とは数えない。言語の holdout で表せない条件（不正な envelope、stale な revision、候補の状態の消失、権限）は、既存の決定的な契約 probe（Unit 0 の Worker の wire test）を別の証拠として添え、言語の case で test したとは主張しない。
- 非劣性の前提：group が独立なら、group ごとの悪化率 p_g が同一でなくても、P(全部0) = Π(1 − p_g) ≤ (1 − p̄)^65（相加相乗平均の不等式）なので、0件のときの上限は平均の悪化率 p̄ に対して保守的に成り立つ。group の独立性と生成の分布は作成の条件であり、仮定として残る。同一の p を仮定した一般形の Clopper–Pearson の区間は、記述にだけ使う。B 単独で 5% を証明したとは言わない。real user の精度は保証しない。bootstrap は非劣性の判定に使わない（全部の差が0のとき [0, 0] になり、誤った確実性を作るため）。
- 補足として、case 単位の paired な平均の差、raw な Luna-free の率、「正しく解決し、かつ Luna-free」の率、Jev の provider 呼出しの数を別に報告する。gate には使わない。

### 3.2 区間の推定法（判定 3・4）

- 層別の cluster bootstrap。層（B、C）ごとに group を復元抽出する（B は 30 回、C は 35 回）。group の中の case と、case の中の pair（Jev-first と Luna-only）はそのまま保つ。各 replicate の case 数は 130 に固定され、60:70 の重みが自動的に保たれる。
- 反復 20,000 回。seed `unit0-r2-boot-2026-10-05`。各 replicate で、層 B の正規順（group ID の code point 昇順）の 30 回、層 C の 35 回の順に `index(層の group 数)` で抽出する。全統計量が同じ抽出を共有する。
- 端点：昇順に並べた replicate の統計量の、1,000 番目を片側95%下限、19,000 番目を片側95%上限とする。D1 の case が0件の replicate の統計量は −∞ とする。
- 全部の差が0なら、点推定 0・下限 0 となり、全 turn の非退行は満たし、D1 の判定（点推定 ≥ 0.3）は満たさない。これは観測した標本の上での計算結果であり、観測していない tail の非退行を保証しない。

### 3.3 latency と cost の超過の統計量

各 replicate r で（baseline はその replicate の Luna-only の値）：

- E_p50(r) = [p50(Jev-first) − p50(Luna-only)] − min(150 ms, 0.10 × p50(Luna-only))
- E_p95(r) = [p95(Jev-first) − p95(Luna-only)] − min(500 ms, 0.10 × p95(Luna-only))
- E_cost(r) = [平均 cost(Jev-first) − 平均 cost(Luna-only)] − min(0.0005 USD, 0.05 × 平均 cost(Luna-only))

判定 3（D1 と全 turn の両方）を満たさない場合は、cap を全部 0 にする（悪化を許さない）。baseline が 0 なら cap は 0。latency は arm ごとに、normalize の開始から最終結果まで（失敗の時刻を含む）の実測区間であり、推定値を実測と呼ばない。個々の差の中央値は別の推定量として補足にだけ使う。

### 3.4 cost の値（§19c。§12 の cost の計算を置き換える。判定の規範はこれ1つだけ）

- Jev-first の turn の cost ＝ 各 Jev の call の provider が報告した金額（その call と同じ会計の範囲を覆うときだけ。なければ報告された入力 token × USD 0.042 / M の上界）＋ 各 Luna の call の上界（usage × 入力 USD 0.25 / M（cache write）・出力 USD 1.20 / M）。
- Luna-only の turn の cost ＝ 各 Luna の call の下界（usage × 入力 USD 0.02 / M（cache read）・出力 USD 1.20 / M）。
- 上の E_cost と capC は、この2つの値で計算する（capC は Luna-only の下界の平均から）。真の値を T・B、上界を U、下界を L とすると、T ≤ U、B ≥ L で、c(x) = min(0.0005, 0.05x) は非減少なので、T − B − c(B) ≤ U − L − c(L) が成り立つ。したがって、この判定は保守的な十分条件である。「実際の支出の測定」とは呼ばず、検証済みの料金契約に基づく bound の判定として報告する。標本が synthetic であることと bootstrap の限界は残る。
- 全ての実際の provider 呼出し（失敗、retry、repair、background を含む）を数える。dispatch した call の usage（入力と出力の token の両方）が1つでも欠ければ HOLD。Jev が金額を報告していても、usage の欠落の代わりにはしない（金額は別の field に記録するだけ）。machine が dispatch 0 を観測した arm は 0 とする（存在しない応答を要求しない）。
- **料金契約の凍結**：Luna は OpenAI の standard な text の `gpt-5.6-luna`（入力 USD 0.20 / M、cache された入力 USD 0.02 / M、出力 USD 1.20 / M、cache write は 1.25 倍）、Jev は OpenRouter の `typesafe/jev-1.13`（入力 USD 0.042 / M、出力 0）。一次の料金ページ（外部監査が 2026-10-04 UTC に確認：OpenAI の model と pricing のページ、OpenRouter の `typesafe/jev-1.13` の API のページ）を承認書に引用する。served の model の ID は完全一致で照合する（§19d）。Jev は `typesafe/jev-1.13` と `typesafe/jev-1.13-20260917` の2つだけ（同じ entry・同じ料金であることを外部監査が一次の endpoint の資料 `https://openrouter.ai/api/v1/models/typesafe/jev-1.13/endpoints` で確認）、Luna は `gpt-5.6-luna` だけ（日付つきの snapshot が返るなら、smoke で ID を確かめ、料金を確認して凍結するまで HOLD）。prefix や最新の alias へは広げない。応答の served model や service tier がこの契約と違えば、上界と下界は無効になり、cost は unknown（HOLD）、予算の判定では契約違反として run を中止する。1 call の入力の上限 60,000 token を強制するので、272k を超える長い context の料金帯は除外される。code に固定した単価だけでは、本番の料金契約の証明にはならない。
- call ごとに、`providerReportedCostUsd`、`costUpperBoundUsd`、`costLowerBoundUsd` を別の field に、料金契約の version と根拠つきで記録する。予約額を cost の実測に使わない。

## 4. 実行の予算と中止（実行の境界で強制する）

| 上限 | 値 | 強制する場所 |
| --- | --- | --- |
| normalizer turn | 130 × 2 = 260、1回だけ | harness の名簿 |
| 総額（hard cap） | USD 5 ＝ 精算済みの額 ＋ 未精算の予約 | Worker の中で、物理的な送信の直前。下の規則 |
| provider への全試行 | 2,080 回 | turn の開始の前 |
| 1 turn あたりの試行 | 8 回 | Worker の中で、物理的な送信の直前 |
| 全体の経過時間 | 5,400 秒 | turn の開始の前。segment をまたいで1つの clock |

- **予約**（§19a）：Worker の中で、provider への物理的な送信（focused、generic、audit、repair、retry、fallback を含む）の直前に、call ごとに計算して積み上げる。UTF-8 の byte 数は byte 単位の BPE の token 数を上回るので、入力 token の上限になる。
  - Luna（`gpt-5.6-luna`）：（request の byte 数 ＋ 512）× USD 0.25 / M ＋ その call の max_completion_tokens × USD 1.20 / M ＋ USD 0.0001。入力 60,000 token・出力 8,000 token を超える request は送信しない。単価は `workers/ai-proxy/src/aiUsagePricing.ts` の `GPT_5_6_LUNA_TEXT` の最高値（cache write）。
  - Jev（`typesafe/jev-1.13` に pin。外部監査が OpenRouter の一次のページで確認した単価）：（request の byte 数 ＋ 512）× USD 0.042 / M ＋ USD 0.0001。Jev の endpoint は出力の上限を送らず、出力の単価は 0 である。
  - Luna の request には、両方の arm で `service_tier: "default"` を明示する（省略は project の設定に従う `auto` であり、standard の料金の証明にならない）。送信前の境界では `default` だけを許可する。応答で返った tier が `default` でない・欠けている場合は、standard と推定せず、その turn のそれ以降の送信（repair や fallback）を止め、上界・下界を無効（unknown / HOLD）にし、料金契約の違反として run を中止する。予算の解放にも同じ証拠を要求する。isolated な eval Worker の経路だけの設定で、production の request は変えない。
  - request の model が pin と違えば送信しない。harness は turn ごとに、残りの hard な予算（USD 5 − 精算済み − 未精算の予約）を Worker に渡し、Worker は予約の合計がそれを超える送信を拒否する。
- **障害の停止の latch**：harness は run 全体の試行数・障害数・連続数を Worker に渡し、Worker と ledger の両方が、**物理的な結果ごとに**停止規則を判定する。最初に超えた時点で latch し、その turn の以降の送信を拒否する。後の成功で率が薄まっても、停止は消えない。最後の arm の精算で検出した停止も、run の終わりで必ず結果に残す。
- **精算**：turn の後、Jev は provider が報告した cost（なければ報告された入力 token × USD 0.042 / M の上界）、Luna は報告された usage × 上の Luna の上界の単価で、その call の予約を置き換える。**下界で予算を解放しない。** usage や cost が欠けた call は、予約の全額を保持する。精算の額がその call の予約を超えるか、served model・service tier が料金契約と違えば、hard cap を証明できないので、run を中止する。
- **turn の開始**：Luna の最大の予約（60,000 × USD 0.25 / M ＋ 8,000 × USD 1.20 / M ＋ USD 0.0001 ＝ USD 0.0247）× 8 回（USD 0.1976）と 8 試行が、残りの予算・試行数に収まるときだけ開始する（turn の途中で上限に当たらない）。
- 説明できない経路の送信：Worker の turn の間、記録の付いた2つの送信口以外からの fetch は拒否し、数えて報告する。1件でもあれば、その turn は不完全として中止する。この差し替えが Worker の runtime で効くことは、segment の readiness で、case を実行する前に確かめる。segment の deploy や readiness が失敗したら、provider に触れる前に run を中止し、記録する（自動の再試行はしない）。
- **障害による停止**：どちらの provider でも、HTTP 5xx・429・408、network の失敗、timeout をインフラの障害とする。分母は invalid_response を含む全ての実際の試行で、invalid_response は分子に入れない。累積の試行が 20 回以上になった後は、累積の障害率が 20% を超えた時点で停止する。20 回未満では、インフラの障害が連続5回で停止する。HTTP 401・403 など、設定や権限のエラー（4xx のうち 408・429 以外）と、served model の不一致は即時に中止する。判定は各 turn の後に行う。
- **token の失効**：eval token の失効（30分）は変えない。run を、新しい token を持つ isolated な `*-eval` Worker の segment に分割する。pair を開始する前に、2つの arm を終えるだけの残り時間（2 × (300 + 60) 秒 = 720 秒）を確認し、各 arm の前にも残りの arm 数で確認する。それでも pair が segment をまたいだら、その区間差を記録する。segment をまたいでも、総額・試行数・経過時間・消費・凍結した runtime は引き継ぎ、リセットしない。
- **不完全な turn**（失効、応答の喪失、検証できない記録）：実際に観測できた dispatch だけを下限として記録し、総数と usage は unknown とする。8 回と予約額の上限は、運用上の上限と予算の確保として**別の field** に入れ、Δdispatch・平均 cost・latency の実測には代入しない。run を中止する。
- **消費の記録の時点**：deploy → readiness（case を評価しない。readiness の間の provider への送信が0であることを、Worker の中で fetch を差し替えて機械的に確かめる。外の token が拒否されることも確かめる）→ token の残り・凍結した hash・予算を再検証 → canonical な ledger と排他の marker の durable な更新 → 最初の turn。更新に失敗したら、provider への送信はしない。deploy の時刻と upload の来歴（isolated な preview Worker、case データの hash）は、消費とは別に記録する。case の本文を log に出さない。最初の turn を開始した後の不確実な障害は、消費済み・HOLD とし、自動では再実行しない。
- 支出の ledger（append-only、各書込みを flush）は run ごとに1つで、作り直さない。
- **runtime の code と case のデータの分離**：Worker の runtime の code は、case のデータ・token の digest・失効の時刻を含まず、別に生成する data module から読む。code の bytes の hash は、smoke・holdout の全 segment・dry-run で同一になる。holdout の承認書は、smoke で確かめた code の hash（`workerCodeSha256`）を固定し、違えば実行しない。

### 4.2 smoke（development の calibration。採用の証拠ではない）

- 目的：remote の isolated preview Worker で、同じ runtime の code が動くこと、fetch の差し替え、readiness の送信0と外の token の拒否、Luna の `service_tier: "default"` の明示と応答の tier、served の ID、予約・精算・停止、segment の token の交代を確かめる。B / C のデータは含めない。canonical な holdout の ledger には触れない。label は付けず、判定は計算しない（status は `smoke_not_evidence`）。
- **開始前に固定する hard cap（提案）**：development の calibration から、question code ごとに ID の code point 順で最初の1件、計 2 cases × 2 arms ＝ 4 turn。物理的な provider の呼出し 32 回（1 turn 最大 8 回）、hard な USD 0.25（Luna の最大予約 × 8 ＝ USD 0.1976 が各 turn の前に収まること）、1,200 秒、1 pair ごとに token の segment を交代（2 segment）。承認書はこれをそのまま restate する。
- smoke で何かを直したら、hash を再凍結し、再監査を受ける。smoke の結果だけでは harness 全体の PASS にはならない。実行（real API）は、cap の合意と親の承認の後に行う。

### 4.1 時間の見積もり（推定。実測ではない）

過去の別の評価の実測（focused な turn の p50 約 1.2 秒・p95 約 1.9 秒、generic な retry を含む turn の p50 約 6.5〜6.7 秒・p95 約 12.7〜19.4 秒）から推定すると、260 turn は平均 7〜13 秒で 1,800〜3,400 秒、segment は 2〜4 個、各 deploy は約 20〜45 秒で、合計の見積もりは約 2,000〜3,600 秒、予備は約 1,800〜3,400 秒である。turn の timeout（300 秒）が続けば 5,400 秒の上限で止まる。この見積もりは今回の runtime の実測ではない。

## 5. label と review

- 両方の rubric を凍結した後、arm 名と、harness が持つ route / provider の手がかり（dispatch の記録、provider の状態、選んだ role、時間、usage、実行順、validation error の文面）を伏せた review 用の packet を作る。arm と X / Y の対応は、乱数で決めて別の key file に置き、packet には key の hash だけを書く。手がかりは field 単位で構造的に取り除き、semantic な結果の全体と元の入力は、user が引用した provider 名を含めて全部保持する（文字列の keyword で除外・拒否しない）。harness 自身が付ける arm の識別子（trace の request ID）が、入力に無いのに出力に現れたときだけ、漏洩として拒否する。semantic な文書の形などの残る手がかりは除けないので、reviewer が label ごとに記録する。
- **fresh な第三の reviewer**（gpt-6.1-sol xhigh。実装・development corpus・key を未閲覧。どちらの set の作者でもない）が、rubric に照らして joint に判定する。解決しない不一致は、もう一方の作者（B の case は C の作者、C の case は B の作者）が裁定する。それでも解決しなければ unknown として残す（議論を重ねて PASS にしない）。
- label の出所は `gpt-6.1-sol-independent-review` だけを r2 の判定に使う。各 label に reviewer、model（`gpt-6.1-sol`）、閲覧範囲（実装・development corpus・key・閲覧した set・packet）、役割を必須とする。出所と model が合わない label（旧い judge の名前、human、別の model）、開発の閲覧者（PolarWatt、CopperHopper、BronzeMaxwell、harness の作者）の label は拒否する。全員が gpt-6.1-sol 系であることの相関を記録する。human や Opus と偽らない。gold と呼ばない。
- review は packet、key、両 holdout、runtime、policy、結果の artifact の hash に束縛して取り込む。判定の前に、結果の file の実際の bytes の hash を計算して packet と照合し、結果と key から packet を作り直して、canonical な直列化で byte 単位に一致することを確かめる（label が、判定した出力そのものにしか付かないようにする）。実行の判定では、結果の runtime・policy・holdout・rubric の hash を承認書とも照合する。どれかが違えば、label が全部正しい形でも判定を拒否する。欠けた label、重複、判定不能は unknown として残り、正解にも誤り0件にもならない。

## 6. 承認書と閾値の記録

**閾値の記録**：下の値は、owner の DECISION 2 による委任に基づく **BronzeMaxwell と CopperHopper の合意**（事前登録 r2〜§18a）である。owner が個別に決めた数値ではない。CopperHopper の判定は、計画として PASS-WITH-NONBLOCKING（条件付きの合意）であり、harness の実行は別の監査を通るまで承認されていない。

| 欄 | 値 |
| --- | --- |
| 重大な誤り（最終結果、直接受理の joint false acceptance） | B と C のそれぞれで 0件 |
| 非劣性 margin と方法 | U_R < 0.05。悪化した group が 0件のときの平均悪化率の上限 1 − 0.05^(1/65) だけを使う。1件以上は HOLD |
| D1 の dispatch 削減 | 点推定 ≥ 0.3 semantic Luna dispatch / turn、層別 cluster bootstrap の片側95%下限 > 0 |
| 全 turn の dispatch | 点推定 ≥ 0、下限 ≥ 0 |
| latency p50 / p95 の許容 | min(150 ms, 10%) / min(500 ms, 10%)。dispatch の判定を満たした場合だけ。上限は 19,000 / 20,000 番目 |
| cost の許容 | min(0.0005 USD, 5%)。実 cost だけ。NA なら HOLD |
| 名簿 | 130 cases / 65 groups（B 60 / 30、C 70 / 35）、除外なし |
| 予算と中止 | hard な USD 5（精算済み ＋ 未精算の予約、§19a の call ごとの予約と精算）、2,080 試行、8 試行 / turn、5,400 秒、障害率の停止（§4）、自動の再実行なし |
| 単価の契約 | Luna 入力 0.25・出力 1.20 USD / M、Jev（`typesafe/jev-1.13`）入力 0.042・出力 0 USD / M、各 call ＋ USD 0.0001、最大 60,000 / 8,000 token、framing 512 |
| cost の判定 | §19c の上界・下界による判定だけ（Jev-first の上界 vs Luna-only の下界）。usage の欠落、料金の条件の違いは HOLD |
| census（採用の条件） | 窓・分子・分母・coverage・actor の下限は runtime の事前登録 §13・§16・§16a。complete な turn 200 以上、coverage 90% 以上、既知の actor 10 以上、片側95%下限 1% 以上 |
| 承認の記録 | 実行前に承認書（下）で restate する。approvedBy は BronzeMaxwell と CopperHopper |

承認書（JSON）は、`approved`、`approvedBy`（BronzeMaxwell と CopperHopper）、`authority`（`owner DECISION 2 delegation`）、`approvedAt`、`environment=isolated_synthetic_evaluation`、`worker`（`*-eval`）、catalog / gate の version、runtime / policy の hash、B と C の set と rubric の hash、上の上限（`limits`）と判定の規則（`decisionRules`）をそのまま、料金契約（`pricing`：version、Luna と Jev のそれぞれの endpoint・model・service tier・料金・上界と下界の単価・余裕・最大 token・一次の料金ページの URL と確認日、出典）、canonical な ledger と支出の ledger の場所、事前登録の hash、smoke で確かめた runtime の code の hash（`workerCodeSha256`）を持つ。harness は値を承認書から読まず、固定した値と照合し、違えば実行しない。

## 7. census（評価とは別の採用の条件）

census の窓、分子・分母、coverage の欠落の扱い、actor の cluster bootstrap（seed `unit0-census-2026-10-05`）は、runtime の事前登録の §13・§16・§16a を正とする。主な点：有効化の直後の JST の午前0時から 14 日間の満日、分母は窓の中で観測を開始した weekly-planning の semantic turn 全部、complete でない turn は主の推定で「適格でない」とみなす、延長の判断は complete な turn の数だけで1回だけ、actor が不明な turn は1つの cluster にまとめて既知の actor に数えない。これは machine の適格性の頻度であり、意味的に純粋な適格性の頻度ではない。

## 8. harness（`scripts/jev-contextual-unit0-*.mjs`）

```bash
# 名簿の検証だけ（provider calls 0）。本文は表示しない
node scripts/jev-contextual-unit0-eval.mjs --set-b <B set.json> --set-c <C set.json>
# mock の dry-run（network なし、証拠ではない）
node scripts/jev-contextual-unit0-eval.mjs --dry-run --scenario <name> --output-dir <dir>
# smoke（cap の合意と親の承認の後。証拠ではない）
node scripts/jev-contextual-unit0-eval.mjs --smoke-approved --approval <smoke-approval.json> --worker <name>-eval --output-dir <dir>
# 承認後の1回だけの実行
node scripts/jev-contextual-unit0-eval.mjs --run-approved --approval <approval.json> --worker <name>-eval \
  --set-b <B> --set-c <C> --output-dir <dir>
# blind な review の packet と key（key は reviewer に渡さない）
node scripts/jev-contextual-unit0-eval.mjs --blind-packet --results <results.json> --set-b <B> --set-c <C> --output-dir <dir>
# 判定（実行の判定では --approval が必須）
node scripts/jev-contextual-unit0-eval.mjs --decide --results <results.json> --packet <packet> --key <key> --review <review> \
  --set-b <B> --set-c <C> --approval <approval.json> [--spend-ledger <spend.jsonl>]
```

dry-run の scenario：`nominal`、`missing-usage`、`budget`、`pricing-violation`、`tariff-mismatch`、`tariff-unreported`、`segment-start-failure`、`presend-refusal`、`dispatch-cap`、`per-turn-cap`、`failure-rate`、`consecutive-failures`、`configuration`、`token-rotation`、`elapsed`、`token-expiry`。dry-run は development corpus の文面から作った mock の名簿（60 / 30 と 70 / 35）と mock の provider を使い、実際に deploy する bundle と同じ bytes を process の中で実行する。dry-run の上限の変更は、締める方向だけを許し、出力は証拠ではない。label は fixture 専用の出所を持ち、実際の判定では拒否される。

旧い v1 の paired runner（`jev-contextual-paired-eval.mjs` と、`jev-contextual-cloud-eval.mjs` / `jev-contextual-corpus.mjs`）は、development の診断と、消費済みの評価の再集計にだけ使う。r2 の判定には使わない。
