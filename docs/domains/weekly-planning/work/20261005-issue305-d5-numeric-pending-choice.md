# Issue #305 r2-E：数値の pending 回答と候補 Choice

担当 LushCurie、統合 BronzeMaxwell、外部監査 CopperHopper。
branch `feat/issue305-d5-numeric-pending-choice`、base / HEAD `8e62377e0c59d8b5ac820358781a8c3584433a9a`。
変更は未 commit。GitHub 書込み、有料 API、本番・shadow・canary の有効化、deploy は行っていない。

## 正本と提出する単位

owner の DECISION 4 は `/Users/Shogo/.agentstack/runtime/jev-owner-decisions-approved.md` にある。採用条件と受理の三段構造は [Issue #305 の設計判断](20261004-issue305-jev-hierarchical-input-interpretation.md) に従う。

提出には、別々の責務を持つ次の内容がある。

- **共通の port**：application が作った最小 context と完全な候補を、認証・quota のある Worker 経由で Jev に渡す。envelope、相関、確率分布を検証する基盤。off / shadow は provider を呼ばず、既存の通常の off Luna は維持する。基盤の merge は言語精度や route の採用を意味しない。
- **D5 の dormant PoC**：単一の不足する時間量について、選択証拠と normalization document を保持する。normalizer の hook はなく、通常の実行経路から参照されない。controller / reducer / 永続化の閉包は **HOLD**。
- **paired harness と事前登録の草案**：同じ葉、binding、gate、binder で flat / hierarchy / 未解釈 span / Luna を比べる。今の結果は合成の配線検査だけである。有料評価は承認された事前登録の凍結後に限る。

親の Mail #2393 は、証拠を失う normalizer の opt-in を除去して dormant とすることを承認した。#2397 は、D の API に合わせる adapter と test double までを E の範囲とし、D merge 後の実接続を親の担当とした。

## 範囲とデータの流れ

初めの D5 は `missing_effort_estimate`、ちょうど1つの active workload、質問と同じ `total_duration` または `duration_per_unit`、完全な workload scope、minute、exact な正の整数に限定する。有限 domain は raw text を見る前に application が固定する。値の集合と policy version は manifest の source revision に含め、選択時と commit の同期準備時に再照合する。

葉には target、measurement、minutes、precision、valueUnit、perUnit、scope を一緒に入れる。値を丸めたり、桁に分けたり、raw の日本語から候補を抽出したりしない。session-duration、custom unit、別 target、別 measurement、既存 estimate の置換、曖昧な unit 選択はこの初版に含めない。

選択を実行する前と、認証 await 後の実際の proxy fetch 直前、各 node の返答後に、Unit 2 が live observation を照合する。none、校正のない menu、低確率、mixed、失敗、stale、budget 超過は document を返さず、未変更の全文を既存 Luna に渡せる。複数 node の親選択で部分的な graph を作らない。

言語が1つの exact な量だけを表すかは provider の仕事である。近似、分数、相対、複数の数値・量、mixed、target / measurement 切替は provider の none と whole-turn の補助 gate の対象とする。mock の none / mixed はその gate の封じ込め検査であり、実際に日本語の purity を検出できる証拠ではない。

共通 port は menu の255 option（none 込み）、完全な葉254件、UTF-8 の本文8,000 bytes、envelope 240,000 bytes などの上限を持つ。階層でも送る完全な葉の合計上限を維持する。D5′ の将来の大きな domain にそのまま適用できるとは主張しない。

`createCandidateChoiceClient().choose(request, beforeDispatch)` は相関が一致した typed な結果だけを返す。分布から選択と margin を Unit 2 が検査する。補助 score を意味の十分性に変換する policy も明示的な校正を必須とし、Worker へ閾値を送らない。製品で使える校正値はまだない。

共通 Choice は C5 の `scope.reference=content_addressed_only` を尊重する provider criterion を持ち、ordinal / deictic / history-only を none とする。独立した grounding head や、この criterion の精度の実証はない。

## 選択証拠と D の境界

普通の semantic document に変換して accepted を返す案では、manifest / hash / epoch が実 consumer に届かないことが監査で判明した。既存の graph revision と turn の検査だけで候補・権限・質問・ledger の freshness を保証できないため、この案を採用しなかった。

`tryNumericPendingChoiceRouteV5` は、Unit 2 の同じ process 内の staged capability、manifest、選択した完全 leaf、全文、document を保持する。`prepareNumericPendingCommitV5` は現在の machine state、domain / policy version、ledger、document 全体を同期的に照合し、既存 binder による純粋な graph の plan を作る。

`createNumericPendingControlledAdapterV5` は D の `commitControlledCandidateTurn` に渡す `{selected, branch, prepare}` を作る。receipt は注入された D の `prepareLocalCandidateReducerCommit` が発行する。E は receipt を作らず、D の module を import / 編集しない。

統合で必要なこと：

1. `readCurrent()` は実 PlanningState の pending と、その sibling の `intakeState.c5SelectionLedger` を返す。渡す ledger と sibling は exact に同じでなければならない。
2. immutable な pre-finalization input graph と、`readRuntimeGraph()` の実 runtime graph を区別する。同期 prepare までは同じ元 graph、finalize 後は選択後 graph と照合する。
3. await を伴う continuation の後に `prepare()` を呼び、D の実 reducer が opaque receipt と `revalidateFinalized` を検査する。domain / policy version、pending presentation、入力、ledger が変われば拒否する。
4. actual graph / reducer / checkpoint receipt を一緒に決着させる。unknown は回復を優先し、新しい選択、retry mutation、Luna の別 mutation を禁止する。
5. 実 controller で stale / 再提示 / permission / domain drift、replay、保存失敗・不明の回帰を通す。E の test double はこれを代替しない。

この adapter は現在 production caller を持たない。process-local capability の再読込み、remote source authority、cross-tab / device CAS を実装していない。

## 局所的な反証と trace

production の document builder と `applyWeeklyPlanningStableV5ContextualAnswer` を呼ぶ integration test は、total / per-unit の leaf が graph になるまで target、measurement、minutes、precision、unit を保持し、stale revision / 同 turn replay を適用しないことを確認する。これは pending の measurement を使う既存 binder に対する**局所的な証拠**であり、actual controller の閉包ではない。

request trace の追加は親 #2384 / #2403 が許可した最小 projection である。question identity、target、scope、menu、hash、epoch を bounded に保存する。全文は既存 messages に1度だけ保存する。token / secret / auth / owner・permission / census は除く。上限超過には truncate、元 bytes、checksum を残す。

回帰は実 Choice client の serialized request と projection、turn diagnostic の client 予算、初回 append 失敗、persistent outbox、memory reset 後の retry、Worker preparation、server document の予算を通す。未知 sentinel の保持と大容量値の明示 truncate を含む。census は trace に混ぜない。

Choice client は A の `semanticCensusObserver.observe('focused', dispatch)` と構造的に同じ port を受け、各 node に新しい request join を付ける。fixed join は複数 request の closure の代替にならない。fallback は同じ A scope の Luna client を使う。E の検査は複数 node と fallback の observer contract までであり、A の実 facade、D の selection-before-normalizer、options の維持は親の統合時に検査する。

## Paired harness

`scripts/jev-numeric-paired-harness.ts` は URL / key、corpus discovery、有料実行の入口を持たない。adapter は Unit 1 recorder を実際の provider fetch に付ける。proxy の成功を provider dispatch と数えない。失敗した送信も数え、usage の欠測は null / NA のままにする。

各 case の元入力と graph をコピーし、葉・順序・domain version・校正 policy・machine binding の非対称を拒否する。flat と span は全葉の flat menu、hierarchy は同じ葉を幅10で分ける。span は凍結した offset の証拠だけであり、candidate を削らず、全文の gate を維持する。offset は span 腕だけに渡す。

全4腕に、完全な1つの leaf と同じ document であることの共通 gate を適用した後、同じ既存 binder を呼ぶ。Luna の document から effort だけ部分的に抜き出して成功とはしない。この endpoint は有限 D5 domain の局所的な受理であり、scope 外を含む製品の全 turn commit ではない。

`runNumericCardinalityDiagnostics` は 10 / 50 / 100 / 250 の domain を別々に実行し、machine binding を固定する。stratum ごとに dispatch / correctness / latency / usage を集計し、実頻度の分母に混ぜない。合成の fetch 検査では hierarchy が1 / 2 / 2 / 3 node となることを確認した。これは provider の性能実測ではない。

時刻の開始は arm の preparation 前、終点は局所 graph binder と recorder の全 pending settle 後である。provider 個別時間、normalization 結果、局所 binder 結果を区別する。`semanticResolution=success` は局所 graph が適用できたという意味で、joint correctness の label ではない。mutatingCommit は false。actual controller commit までの latency と品質は欠測である。

## 事前登録案 v0：未承認・実行不可

以下は親と外部監査が変更・合意して凍結する**草案**であり、有料 API の承認ではない。結果を見る前に corpus、label provenance、code / catalog / model、domain、gate、budget、統計方法と停止条件の SHA-256 を登録する。

### Population と labels

- weekly-planning の typed numeric pending だけ。actual census の頻度、合成 / fixture / sealed model-authored の評価を別にする。user-context と混ぜない。
- 実装・開発 corpus を見ていない別の作者が新しい numeric case を作り、別の判定者が labels を作る。model / synthetic は human gold と呼ばない。消費済み holdout は診断に限る。
- 提案：独立した40 source family ×4 variant の160 sealed case。別の calibration set で gate を決め、sealed set を tuning に使わない。family 内の最小対は相関するものとして扱う。
- exact total / per-unit、同じ値と異なる target / measurement / scope、候補外、negation、近似、分数、相対、複数数値、mixed、current と history、stale / 再提示 / permission / policy-domain drift を含める。各 family の構成と labels は実行前に固定する。
- label は完全な tuple と全文の追加意味、期待する fallback / reject、formal effect、重大 error の分類を持つ。判定不能は unknown として残す。span の proposal と、その recall / authority の判定も別に凍結する。

### 比較と gate の提案

- 主比較は flat complete tuple と Luna 単独。同じ葉の hierarchy / span は比較腕であり、flat より良いと仮定しない。
- calibration の候補値は top probability ≥0.995、margin ≥0.99、補助の condition-change / independent-meaning ≤0.001。menu kind / option count / depth ごとに検証し、未校正 menu は fallback。これは実行・本番の default ではない。
- 全登録 case を分母にする。none / failure / fallback / retry / repair / late work を含める。観測不足や unjoined event を complete・0 dispatch・free としない。
- critical false acceptance、誤 target / scope / measurement / precision、mixed 意味の脱落、stale、authority 違反は **0 件必須**。0 件をリスク0と解釈しない。
- joint correctness の paired 差（flat − Luna）の片側95%下限 ≥−1 percentage point。correct-free は、raw Luna dispatch=0 に加えて label で全文の joint correctness と正式な受理を確認できた場合に限る。
- 平均 semantic Luna dispatch 削減（Luna − flat）の点推定 ≥0.10 / turn、片側95%下限 >0。Jev を実行しただけでは成功としない。
- latency の paired p95 比の片側95%上限 ≤1.00、平均 known cost 差の片側95%上限 ≤0。tradeoff の例外はこの草案にない。欠測 cost / latency で non-regression を認定しない。
- source family 単位の paired cluster bootstrap（10,000 resample、seed 3050405）を提案する。全ゼロの paired 差、退化した resample、非定義の p95 / cost 比では bootstrap のゼロ幅区間で非劣性を認定せず HOLD とする。別の conservative な group-aware bound が必要なら結果を見る前に再登録する。40 family では margin を証明できない可能性を残し、事後に gate を緩めない。case を独立 IID として CP bound を作らない。cluster の独立性・代表性は別の仮定として記載し、合成から本番頻度や0 riskを推論しない。
- hierarchy / span の比較、候補数 strata は副次診断として分離する。主比較の失敗を別腕の良い結果で取り消さない。任意の多重比較の採用判断は追加の事前登録を要する。

### Freeze と停止

- actual D controller / reducer と durable receipt に接続し、A の whole-turn closure を通した code snapshot の全 hash、Worker binding / model version、Luna model、sampling、timeout、retry / repair / background の上限を凍結する。今の E 単体 harness はこの adoption endpoint を供給しない。
- 現行 local harness の腕順は flat → hierarchy → span → Luna で固定しており、timing は順序効果を除いた精度の主張に使わない。sealed 評価の order、seed、concurrency、arm provenance を隠した label 手順と残る unblinding は、実 integration harness と一緒に結果を見る前に凍結する。
- 比較腕は同じ state、domain、measurement、同じ全 turn gate、同じ binder を使う。完全な document / leaf 検査の失敗を部分成功にしない。製品経路で fallback する場合は元の全文のまま既存 Luna を通す。
- 提案する予算は physical provider dispatch 合計3,000、既知 cost 25 USD の小さい方で停止。欠測 cost がある場合も dispatch cap を守り、費用上限を保証できる保守的 reservation / Worker enforcement がないまま開始しない。親の署名なしにはどちらの予算も実行許可にならない。
- code / corpus / labels / gate が途中で変わる、critical error、観測の join 不明、usage 不明を0にする必要が生じる、上限の執行が不明なら止め、同じ登録結果に別 segment を混ぜない。
- 親と CopperHopper の gate 合意、corpus / label の凍結、budget enforcement、D/A の actual integration 証拠が揃うまで、有料実行と adoption は HOLD。

## 代替案と反証条件

1. 既存の focused な独立 head を広げる：adapter はあるが、target / measurement の組合せと binder の置換を局所の数値 gate だけで防げない。blast radius は既存の広い Luna 契約。完全 tuple と実 controller の不変性を既存 head で示せれば、この判断は再考できる。
2. 完全 tuple の共通 port と証拠保持 PoC：今回の選択。新 transport の strict envelope と off 不変性を直接検証できる。blast radius は新 port と限定 trace projection。live observation が候補の echo、domain が raw text 依存、実 consumer の再検証が抜ける場合は採用不可。
3. 調査だけに留める：exposure が最小だが、C5/D5′も使う port を完成させる今回の範囲を満たさない。bounded port の安全性を示せなければこの選択へ戻る。

「自分の解釈を誤りにする証拠」は、不完全な pending scope / unit、通常 document からの証拠の再構成、await 後の stale 受理、target / measurement / precision の変化、全 turn の削減なし、trace の機密混入である。機械的閉包と semantic 精度、基盤 merge と route adoption を分ける。

## 検証 checkpoint

2026-10-05：最終の API / trace / harness / strict ledger projection を含む focused 12 files・132 tests は成功。app / Worker の `npm run typecheck` は成功（Worker types 再生成）。最終 `WRANGLER_LOG_PATH=/private/tmp/LushCurie-wrangler-logs npm run verify` は exit 0：fresh app / Worker typecheck、664 passed test files、4,455 passed tests（10 files / 45 tests skipped、1 todo は既存の選択的評価等）、production build 成功。追加の dormant guard もこの full run に含む。build の既存 chunk size 警告を記録した。exact diff は runtime 報告に記録する。GitHub / CI / merge は親の担当。

次の action：E の exact diff と local verify を親 / 外部監査へ提出。D/A merge 後、親が実 controller・永続化・observer closure の統合と、未証明の gate を検査する。D5 の production caller はなく、採用は HOLD のままである。
