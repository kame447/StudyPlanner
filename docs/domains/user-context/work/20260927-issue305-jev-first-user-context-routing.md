# Issue #305 単位4 — user context 保存先 routing の Jev 第一経路

Status: active
Owner: Issue #305 / #333 / #335
Branch: `feat/issue-305-jev-first-user-context-routing`
Base: `d3623479e07a6870f23c54a7631fe2761a408efa`
Latest durable checkpoint: `2acc516a7ad2f0f75bff9d6543d1884e96df656f`
Updated: 2026-09-27

## 目的と責任境界

設定画面の「AIが覚えていること」に入力された文を、既存の Luna interpreter より前に、保存先の owner だけを Jev で判定する。高確信かつ単一 owner の `bookshelf` / `timetable` / `schedule` / `actual` だけを固定案内へ直行させる。`user_context`、曖昧、複数 owner、独立した意味、provider 障害は既存 Luna が `targetDomain` を含む出力全体を所有する。

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
- case と conversation group の両方で one-sided 95% Clopper–Pearson 上限を出す。
- typed case evidence には raw user text、provider raw body、secret を残さない。
- holdout は tuning を見る前に封印し、catalog / gate / corpus fingerprint 不一致では runner が拒否する。1回だけ実行し、消費済みを記録する。
- paired Luna-only 比較は同一 holdout を使う。Jev-first fallback は本番 dispatch 内から実 Luna を呼び、total latency は fallback を含む実測値とする。
- Luna cost は `workers/ai-proxy/src/aiUsagePricing.ts` の `GPT_5_6_LUNA_TEXT` に基づき、cache 内訳がない場合は上下限で示す。

## 前方互換と配備順

本番 Worker は #332 より前の版である。client が先なら旧 Worker は新 context を無視して既存 Luna を使う。Worker が先なら旧 client は context を送らないため既存 Luna を使う。新 Worker では未知 purpose を context なしとして扱い、既知 purpose の malformed だけを quota 消費前に 400 とする規則を維持する。

retry / repair は今回の settings interpreter に存在しない。今後追加する場合も focused context を再送しない。production dispatch に harness 専用 hook は置かない。

## 完了条件

- typed context / response、gate、dispatch、client projection、Worker 分岐が実装済み。
- off/0 と既存 authorization/contextual の契約が不変。
- tuning だけで policy を確認し、封印 holdout は1回だけ実行済み。
- Luna-only paired 比較、case/group CP 上限、費用範囲、実 latency p50/p95 が記録済み。
- timeout / 429 / 5xx / malformed / model mismatch / provider abort が実 Luna fallback に到達。
- #335 の routing と実 Worker containment、#152 V06、通常 test/typecheck/build/CI が green。
- PR review と CI が terminal success。

## 現在地 / 次の具体作業 / 未解決

現在地:

- branch は base `d3623479` から開始。親が Git write を所有する。
- `shared/userContextRoutingDecision.ts`: bounded context と closed external-owner response を追加。
- `userContextRoutingPolicy.ts`: 6-choice catalog と conservative external-only gate を追加。
- `userContextRoutingDispatch.ts`: off/shadow/canary、typed direct response、全 defer/fault の Luna fallback を追加。
- feature は raw text だけを Jev projection に入れ、typed direct response を既存固定案内へ変換する。stored `existingRecord` は Jev state に入れない。
- 単位3の引渡し後、focused union に1型、`worker.ts` に分類 / purpose 検証 / dispatch / failure resolver の1経路を末尾追加した。既存 authorization/contextual の順序と挙動は変更していない。
- tuning 52件、holdout 64件を別 text / group で作成した。holdout は各 class 16件、合計32 conversation group。mixed 28件は親の一括判定で全件 `route=luna`, `targetDomain=null`、source=`opus-5.5-limited-judge`（human gold ではない）に固定した。
- holdout は tuning 前に `sealed_unconsumed` として封印済み。fingerprint は catalog=`c3a284e53846d229f1932cae34acf00efc98f266986100ba4efed60aac0bdc4e`、gate=`9bcb1fc70281dc2420cce5ad18b0254716b45a52fbdd0bfd90ca9e9b28c90854`、corpus=`0a1a19be935a77dd9a4bda19f8a30e453dc00c4c1c77e637b56e8d9ae64510e6`。
- runner は Wrangler 4.140.0 のみを受理し、holdout は上記 seal/hash が一致し `consumed=false` の場合だけ実行する。成功時は raw text を含まない typed result で同じ artifact を `consumed` に更新する。
- exact checkpoint 後の local `npm run verify` は green: typecheck、583 test files / 3,024 passed（10 files / 45 tests skipped、5 todo は既存 observation contract）、production build 2,215 modules。runner の `node --check` も green。build の既存 dynamic/static import と chunk-size warning 以外に失敗なし。
- remote runner がブラウザ用 AI client / Firebase の実行時依存を引き込まないよう、既存 Luna schema・prompt・strict parser・message builder・固定 owner 案内を副作用のない contract module へ抽出した。従来 module は同じ public symbol を再 export するため、app 側の契約は不変。
- contract 抽出後の focused verification は 11 files / 126 tests green（user-context routing、Luna evaluation、Worker containment、#335 security regression を含む）。`npm run typecheck` と production build 2,216 modules も green。既存 build warning 以外に失敗なし。
- remote dev は Wrangler OAuth の期限切れで、親がユーザーの再ログイン待ち。親から再開通知が来るまで tuning / holdout / paired / fault probe は実行しない。

次の具体作業:

1. 親の Wrangler OAuth 再開通知を待つ。
2. 再開後、remote tuning → gate 固定確認 → holdout 1回 → Luna-only paired → faults の順に実行する。
3. typed evidence と集計を本記録へ反映し、親へ commit / PR 依頼を送る。

未解決:

- remote tuning / holdout / paired / fault は Wrangler OAuth 再認証待ちで未実行。holdout 自体は封印済み・未消費。
- 実 provider 校正、実費用/latency、CI は未完了。local full test/build は green。
