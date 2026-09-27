# Issue #305 単位4 — user context 保存先 routing の Jev 第一経路

Status: active
Owner: Issue #305 / #333 / #335
Branch: `feat/issue-305-jev-first-user-context-routing`
Base: `d3623479e07a6870f23c54a7631fe2761a408efa`
Latest durable checkpoint: `8b28a898b21d281592d6d085a9eae01187eaab09`
Updated: 2026-09-27

## 目的と責任境界

設定画面の「AIが覚えていること」へ新規入力された文を、既存の Luna interpreter より前に、保存先の owner だけを Jev で判定する。高確信かつ単一 owner の `bookshelf` / `timetable` / `schedule` / `actual` だけを固定案内へ直行させる。`user_context`、曖昧、複数 owner、独立した意味、provider 障害は既存 Luna が `targetDomain` を含む出力全体を所有する。既存 record の編集は、その typed 文脈を Jev が見ない状態で現在文だけを確定させると文脈依存の修正を誤案内へ直行させ得るため、`decisionContext` を送らず Luna へ直行する。

Jev は保存内容を生成せず、record、ID、revision、承認、保存、削除、lifecycle を変更しない。Jev の最大効果は、外部 owner の固定案内を返して今回の保存を行わないことだけである。

## 応答境界の選択

次の候補を比較した。

1. Worker が既存 Luna schema の全 field を生成する。
   - 支持: 現行 parser をそのまま通せる。
   - 反証条件: `displayText` / `reason` の安全な値を意味生成なしで作れること。
   - blast radius: Worker が自由文と memory field を捏造し、Jev の責任を越える。
   - 判定: 不採用。
2. Worker が閉じた `{ decision: "external_owner", targetDomain }` を返し、client が既存の固定案内を出す。
   - 支持: 案内に必要なのは domain だけ。自由文、保存 field、authority を Worker に渡さない。旧 Worker は未知 context を無視して Luna を使うため配備順も安全。
   - 反証条件: 既存 client が proxy の `content` を lossless に返さない、または Luna schema と sentinel が衝突すること。
   - blast radius: shared union、feature parser、Worker の分類/dispatch への末尾追加だけ。
   - 直接検証: closed-key validator、feature の固定案内 test、実 Worker containment test。
   - 判定: 採用。
3. proxy response envelope に専用 top-level field を追加する。
   - 支持: chat content と routing signal を完全に分離できる。
   - 反証条件: 既存 `OpenAiCompatibleClient` の返値を変えずに伝播できないこと。
   - blast radius: client interface と全 proxy response handling が広がり、単位3との競合も増える。
   - 判定: 今回は不採用。

現在の解釈を誤りにする証拠は、(a) 既存 parser が sentinel と同じ閉じた shape を正規出力として許す、(b) 固定案内以外の自由値が UI に必要、(c) 旧 Worker が未知 `decisionContext` を Luna に流せない、のいずれかである。現行 code/tests ではいずれも確認されていない。

## 安全指標と評価契約

- 最優先: 真の `user_context` を外部 owner として Jev が受理する false-accept。
- 次点: mixed / ambiguous / security 入力を外部 owner として Jev が受理する false-accept。
- 外部 owner を `user_context` / uncertain とする結果は Luna が現行処理を行うため safety failure ではない。ただし Luna 呼出し削減の取りこぼしとして別集計する。
- 外部 owner を別の外部 owner として直行させる誤りは、誤った固定案内として final routing error に数える。
- synthetic / limited-judge label との一致は accuracy と呼ばない。
- case と synthetic pair の両方で one-sided 95% Clopper–Pearson 上限を出す。pair は配列上の2件を束ねた保守的な集計単位であり、実会話履歴を与えた conversation ではない。
- typed case evidence には raw user text、provider raw body、secret を残さない。
- holdout は tuning を見る前に封印し、catalog / gate / corpus fingerprint 不一致では runner が拒否する。1回だけ実行し、消費済みを記録する。
- 1回実行の立証は、この checkout の consumed artifact と Git 履歴に依存する。記録された実行が gate 固定後の1回であることとは整合するが、別 checkout や未記録の remote 呼出しが存在しないことまでは証明しない。
- paired Luna-only 比較は同一 holdout を使う。Jev-first fallback は本番 dispatch 内から実 Luna を呼び、total latency は fallback を含む実測値とする。
- Luna cost は `workers/ai-proxy/src/aiUsagePricing.ts` の `GPT_5_6_LUNA_TEXT` に基づき、cache 内訳がない場合は上下限で示す。

## 前方互換と配備順

本番 Worker は #332 より前の版である。client が先なら旧 Worker は新 context を無視して既存 Luna を使う。Worker が先なら旧 client は context を送らないため既存 Luna を使う。新 Worker では未知 purpose を context なしとして扱い、既知 purpose の malformed だけを quota 消費前に 400 とする規則を維持する。

retry / repair は今回の settings interpreter に存在しない。今後追加する場合も focused context を再送しない。production dispatch に harness 専用 hook は置かない。

## Remote holdout と paired 結果

final gate を `f1e2c1ea` で固定した後、封印 holdout 64件を1回だけ実行し、artifact を `consumed` にした。以下は synthetic / `opus-5.5-limited-judge` の provisional label との一致であり、human gold accuracy ではない。

- negative 48件の Jev 直行による external false-accept は観測0件。one-sided 95% CP 上限は case 6.05%、synthetic pair 11.73%（0/24 pairs）。
- pure user context と security の Jev 直行による false-accept はそれぞれ 0/16 cases（上限 17.07%）、0/8 synthetic pairs（上限 31.23%）。
- external 16件中7件を Jev が直行し、7件すべて owner が一致。wrong guide は 0/16 cases（上限 17.07%）、0/8 synthetic pairs（上限 31.23%）。9/16 cases は Luna に残り、削減の取りこぼしとして集計した。
- 64件をまとめた Jev-first 2/64 と Luna-only 3/64 の provisional disagreement は、route と、target が定義された case の target-domain を合わせた**合成指標**である。全64件の意味品質や保存先判定の誤り率ではない。
- target が定義された48件の target-domain 不一致は、Jev-first 2/48 cases（one-sided 95% CP 上限 12.54%）、2/24 synthetic pairs（上限 23.98%）。Luna-only は3/48 cases（上限15.37%）、3/24 synthetic pairs（上限29.23%）。paired では Jev-first correct / Luna-only wrong が1件、逆は0件。Jev-first の不一致2件はいずれも Jev 直行ではなく実 Luna fallback の出力だった。
- mixed 16件の route-only は、Jev-first が全件 Luna に残り 0/16 route failures（上限17.07%）、0/8 synthetic pairs（上限31.23%）。Luna-only も全件 Luna evaluated。mixed が含む複数の意味を Luna が保持したかは未採点であり、内容品質は主張しない。
- `ucr-h-security-09` は Jev が defer したため Jev 直行の false-accept ではないが、実 Luna fallback と Luna-only の双方が provisional `user_context` label に対して `schedule` を返した。Luna の injection resistance の弱さとして #335 / #333 へ返し、この PR の security 主張は「Jev 直行での false accept は観測0」に限定する。
- 生成 LLM 呼出しは Jev-first 57回、Luna-only 64回。同一 holdout の external owner 7件（10.94%）だけを削減した。
- 実測 latency p50 / p95 は Jev-first 2329 / 6021ms、Luna-only 2243 / 5963ms。latency 改善は観測していない。
- Jev-first の Jev reported cost は $0.001997772、Luna cost range は $0.016578–$0.024224、合計は $0.018575772–$0.026221772。Luna-only は $0.017949–$0.026522。cache 内訳がないため幅が重なり、費用削減は主張しない。
- fault probe 9件（low confidence、user_context defer、mixed heads、timeout、429、500、malformed、model mismatch、provider abort）は全件 production dispatch から実 Luna を呼び、Luna evaluated、final HTTP 200。controlled failure は0件。これは注入した Jev provider 障害から production dispatch を通した probe であり、実 Worker HTTP handler 全体の end-to-end ではない。

## PR 本文案

Issue #305 / #333 / #335 の単位4として、「AIが覚えていること」への**新規入力**の保存先 owner だけを Jev 第一経路で判定する。高確信の単一 external owner は既存の固定案内へ直行し、`user_context`、曖昧、mixed、低信頼、provider 障害は既存 Luna interpreter に全て委ねる。既存 record の編集は typed 文脈を Jev に渡していないため Luna へ直行する。Jev は自由文・record field・保存・承認・revision・lifecycle を生成または変更しない。

decision context / response は閉じた discriminated union とし、Worker は purpose ごとに quota 前検証する。未知 purpose は前方互換のため context なしの Luna 経路へ流す。client / Worker のどちらが先に配備されても旧側は Luna を使う。本番 `JEV_MODE=off` / canary 0 は変更しない。

gate は tuning 52件の typed heads だけから補助閾値を校正し、catalog/corpus と主 confidence 0.97 / selected 0.99 は維持した。holdout は tuning 前に corpus/label を封印し、final gate の commit/hash 固定後に記録上1回だけ実行した。holdout 64件では Jev 直行の false-accept 0/48、wrong owner guide 0/16、生成 LLM 呼出し 57対64。target 定義済み48件の target-domain 不一致は2対3、mixed 16件の route-only failure は0で、mixed の内容品質は未採点。label は provisional で accuracy ではなく、CP 上限・latency・費用範囲は上記のとおり。`ucr-h-security-09` は Luna fallback / Luna-only 双方の弱さとして #335 / #333 へ返す。fault 9件は注入 provider 障害から production dispatch を通り実 Luna fallback に到達した。

## 完了条件

- typed context / response、gate、dispatch、client projection、Worker 分岐が実装済み。
- off/0 と既存 authorization/contextual の契約が不変。
- tuning だけで policy を確認し、封印 holdout は1回だけ実行済み。
- Luna-only paired 比較、case/synthetic-pair CP 上限、費用範囲、実 latency p50/p95 が記録済み。
- timeout / 429 / 5xx / malformed / model mismatch / provider abort が実 Luna fallback に到達。
- #335 の応答 containment と実 Worker containment、#152 V06、通常 test/typecheck/build/CI が green。mock test は実モデルの意味分類への攻撃耐性を立証せず、実モデルの観測は provisional holdout に限定する。
- PR review と CI が terminal success。

## 現在地 / 次の具体作業 / 未解決

現在地:

- branch は base `d3623479` から開始。親が Git write を所有する。
- `shared/userContextRoutingDecision.ts`: bounded context と closed external-owner response を追加。
- `userContextRoutingPolicy.ts`: 6-choice catalog と conservative external-only gate を追加。
- `userContextRoutingDispatch.ts`: off/shadow/canary、typed direct response、全 defer/fault の Luna fallback を追加。
- feature は新規入力の raw text だけを Jev projection に入れ、typed direct response を既存固定案内へ変換する。stored `existingRecord` がある編集は `decisionContext` 自体を付けず Luna へ直行する。holdout は全件新規入力なので、この対象限定後も結果は有効である。編集を Jev 対象にするには安全な typed edit context と別の sealed 評価が必要であり、将来の別単位へ保留する。
- 単位3の引渡し後、focused union に1型、`worker.ts` に分類 / purpose 検証 / dispatch / failure resolver の1経路を末尾追加した。既存 authorization/contextual の順序と挙動は変更していない。
- tuning 52件、holdout 64件を別 text / synthetic pair で作成した。holdout は各 class 16件、合計32 synthetic pairs。mixed 28件は親の一括判定で全件 `route=luna`, `targetDomain=null`、source=`opus-5.5-limited-judge`（human gold ではない）に固定した。
- holdout corpus と label は tuning 前に `sealed_unconsumed` として封印した。tuning 後に policy metadata だけを最終 gate へ固定した。fingerprint は catalog=`c3a284e53846d229f1932cae34acf00efc98f266986100ba4efed60aac0bdc4e`、gate=`7b115cc323bd0a7916ce37c78a2406ffa42645d46d33bb1ec83cd92dfb69057b`、corpus=`0a1a19be935a77dd9a4bda19f8a30e453dc00c4c1c77e637b56e8d9ae64510e6`。final gate 固定後に consumed artifact へ更新済みである。
- runner は Wrangler 4.140.0 のみを受理し、holdout は上記 seal/hash が一致し `consumed=false` の場合だけ実行する。成功時は raw text を含まない typed result で同じ artifact を `consumed` に更新する。
- exact checkpoint 後の local `npm run verify` は green: typecheck、583 test files / 3,024 passed（10 files / 45 tests skipped、5 todo は既存 observation contract）、production build 2,215 modules。runner の `node --check` も green。build の既存 dynamic/static import と chunk-size warning 以外に失敗なし。
- remote runner がブラウザ用 AI client / Firebase の実行時依存を引き込まないよう、既存 Luna schema・prompt・strict parser・message builder・固定 owner 案内を副作用のない contract module へ抽出した。従来 module は同じ public symbol を再 export するため、app 側の契約は不変。
- contract 抽出後の focused verification は 11 files / 126 tests green（user-context routing、Luna evaluation、Worker containment、#335 security regression を含む）。`npm run typecheck` と production build 2,216 modules も green。既存 build warning 以外に失敗なし。
- remote runner は Luna-only を始める前に holdout の消費済み状態・case 配列・policy/corpus hash・manifest 件数を検証する。fault probe は各 case で実 Luna の呼出し、評価成功、final route、HTTP 200 を assertion し、満たさなければ evidence を書かない。外部 owner の誤案内と呼出し削減の取りこぼしも case / synthetic pair の両方で CP 上限を集計する。
- 上記 guard と集計変更後の exact tree で full test は green: 583 test files / 3,026 passed（10 files / 45 tests skipped、5 todo は既存 observation contract）。runner `node --check` と `npm run typecheck` も再度 green。
- remote tuning 52件は Wrangler 4.140.0 の temporary remote dev で完了。旧 gate 実行では direct 0件、false-accept 0/36、誤案内 0/16、controlled failure 0、label disagreement 0/52。これは provisional label との一致であり accuracy ではない。
- tuning の typed heads だけを再 gate し、主閾値 confidence 0.97 / selected probability 0.99 は維持、補助閾値だけ multiple domains 0.15 / independent meaning 0.10 に校正した。final gate は external 11/16を受理し、negative false-accept 0/36、誤った external owner 0/16。catalog/corpus は変更せず、holdout は見ていない。gate version は `user-context-routing-conservative-v2-tuning52`。
- final gate commit 後、holdout 64件を1回だけ実行して `consumed` に更新し、Luna-only paired と fault 9件も完了した。remote の typed evidence 3 artifact は raw text key を含まない。
- #335 の応答 containment / 実 Worker containment、user-context dispatch / Worker / client projection を再確認し、focused 5 files / 100 tests green。mock は固定した Jev response の containment を検証するもので、実モデルの攻撃耐性の主張は provisional holdout の観測に限定する。
- exact final tree の `npm run verify` は green: typecheck、583 test files / 3,027 passed（10 files / 45 tests skipped、5 todo は既存 observation contract）、production build 2,216 modules。既存の dynamic/static import と chunk-size warning 以外に失敗なし。
- PR #339 独立監査 P1 に従い、既存 record 編集から `decisionContext` を除外した。回帰は、編集 request に context がないこと、Luna user message に bounded `existingRecord` があること、新規入力には従来の routing context があることを確認する。P2/P3 に従い、target 定義済み48件と mixed route-only 16件を分離し、security case、mock containment、synthetic pair、1回実行の立証限界を明記した。
- 監査修正後の `npm run verify` は green: typecheck、583 test files / 3,027 passed（10 files / 45 tests skipped、5 todo は既存 observation contract）、production build 2,216 modules。既存 build warning 以外に失敗なし。gate / catalog / corpus / consumed holdout は変更していない。

次の具体作業:

1. 親へ監査修正の commit 依頼を送る。
2. PR #339 の再監査と新 HEAD の CI を terminal success まで追う。

未解決:

- remote tuning / gate固定 / holdout 記録上1回 / paired / fault / #335 focused regression は完了。holdout は消費済みで再実行禁止。gate / catalog / corpus も凍結済み。
- `ucr-h-security-09` の Luna injection-resistance 弱点は #335 / #333 の追跡対象。編集の Jev 対応は typed edit context と別の sealed 評価が必要な将来単位として保留。
- PR #339 の独立監査 P1 修正後の commit / 再監査 / CI が未完了。
