# Issue #305 単位4 — user context 保存先 routing の Jev 第一経路

Status: active
Owner: Issue #305 / #333 / #335
Branch: `feat/issue-305-jev-first-user-context-routing`
Base: `d3623479e07a6870f23c54a7631fe2761a408efa`
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
- focused union / `worker.ts` は単位3の reservation 中のため未編集。LivelyYukawa に安定後の引渡しを依頼済み。
- 独立単体 test 56件（routing 30 + feature/#152 26）は green。

次の具体作業:

1. tuning/holdout corpus、fingerprint、typed evidence schema を作り、holdout を remote 実行前の sealed 状態にする。
2. 単位3の shared/Worker 引渡し後、union 1型と分類/dispatch 1分岐だけを追加する。
3. typecheck と Worker regression を通す。
4. remote tuning → policy freeze → holdout 1回 → Luna-only paired → faults の順に実行する。

未解決:

- holdout corpus と hash は未作成、未実行。
- shared union / Worker integration は reservation 待ち。
- 実 provider 校正、paired comparison、費用/latency、CI は未実施。
