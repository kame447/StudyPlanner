# ブラウザ内 semantic memory の評価・実装記録

Status: active evaluation work / runtime・index integration not complete
Updated: 2026-10-17
Owner Issue: #294

## 目的と決定

Laplanceの長期記憶について、既存のbounded lexical/entity検索を基準に、日本語の言い換え検索が改善するかを比較する。候補発見を目的とし、memoryの正本・意味のauthority・保存判断を置き換えない。

推論は利用者端末内で必要時だけ行う。常時稼働server、新しいremote embedding/API、Tencentへのmemory送信は採用しない。Firestoreと `userPlanningContext` のcanonical recordが唯一の正本であり、ローカルvector indexは破棄可能な検索cacheとする。会話AI provider、Firestore schema、canonical recordの形式は変更しない。Draft PR [#719](https://github.com/kame447/StudyPlanner/pull/719) のPython/Cloudflare server実装は採用・再利用しない。

## 責務分割

| 層 | 責務 |
| --- | --- |
| `semanticMemoryContract.ts` | model descriptor、`SemanticMemoryEmbedder`、owner/revision付きsource参照などの共有型。今回の評価コードはこの契約を読む。 |
| `semanticMemory/runtime/` | 公開weightの遅延取得、端末内inference、Web Worker、WebGPU/WASM選択と失敗処理。 |
| `semanticMemory/index/` | owner-scoped disposable index、同期・forget、lifecycle/revision/contentのrecall時再検証。 |
| `semanticMemory/evaluation/` | 合成日本語fixture、既存selector＋評価専用lexical scorer、契約embedderのvector比較、RRF比較、指標とopt-in test。 |

契約の場所: `src/features/userPlanningContext/semanticMemory/semanticMemoryContract.ts`。この作業は `semanticMemory/evaluation/**` と本work recordに限定し、README/roadmapのnavigation更新は親へ提案する。

## 評価の範囲と限界

合成fixtureは2 owner、37 records、36 queries。exact keyword、paraphrase、略語/かな/漢字/数字表記、無関係なnegative、revoked/superseded/archive/別ownerのtrapを含む。lexical baselineは現行 `selectUserPlanningContextPromptRecordsV2` のbounded出力を候補とし、scope keyのexact containmentを評価専用に与えた後、文字bigram Diceで順位づけする。これはproductionの自然言語解釈ではない。vectorはcontract portだけに依存する。hybridは順位融合の評価用候補である。

指標はpositive queryのmacro recall@k/precision@k、negativeのfalse-positive件数、trap違反数、選択record JSONのUTF-8 byte数、index準備時間、query latencyの平均/p50/p95。test用fake embedderの値は配線・順位計算の動作確認に限り、semantic qualityやdevice性能の証拠ではない。実モデル比較は環境変数で明示有効化し、adapter経由で実行する。feature flag `VITE_SEMANTIC_MEMORY_ENABLED` はOFF既定、さらに利用者の明示opt-inが必要。

## Privacy / safety

- fixtureは架空の記録・owner・会話IDだけを使う。実ユーザーの記憶やembeddingをfixture、log、評価出力へ含めない。
- user memory textとembeddingをremote API、Tencent、hosted embedding provider、CDN uploadへ送らない。ダウンロード可能なのは公開model weightsのみで、weight取得とuser-memory inferenceを分離する。
- owner/lifecycle filterはsimilarityより先に適用する。revoked、superseded、archived、historical、別ownerは通常候補へ含めない。similarityは権限・鮮度・正しさを決めない。
- canonical source recordの確認をrecall時にも行い、cacheは再構築・破棄可能でなければならない。忘却、account switch、revision競合、offline stale dataはruntime/index側の必須gateである。
- production rollout/deploymentは行わない。現行会話providerとFirestoreの権限境界は維持する。

## Issue #294 acceptance gates

Issue comment [6232696407](https://github.com/kame447/StudyPlanner/issues/294#issuecomment-6232696407) の順序を保持する。状態はこのwork unitの証拠だけを示し、全Issue完了の宣言ではない。

| Gate | 状態 | 根拠 / 残り |
| --- | --- | --- |
| 1. bounded lexical/entity baselineと日本語paraphrase missを比較し、embedding unavailable時は現行結果を保持する | 未検証 | baseline・fixture・指標を用意。real modelとの品質比較は未実行。 |
| 2. 小型多言語modelを端末内で遅延実行し、download/memory、iPhone Safari/WebKit WASM CPUとWebGPUを計測。Web Workerでmain threadを塞がない | 未検証 | runtimeと実機計測が必要。 |
| 3. versioned・owner-scoped・破棄可能なlocal indexをcanonical ID/revision/lifecycle/deleteに結び、recall時に再検証 | 未検証 | index同期・forget・stale cacheの統合検証が必要。 |
| 4. multi-tab/pending write、cancel、quota/eviction、offline reload、model failure、device switch、低memory Safariでlexicalへ安全にdegrade | 未検証 | runtime/indexのfailure・lifecycle gateが必要。 |
| 5a. 人手レビュー可能な日本語synthetic corpusとlexical/vector/hybridの比較指標 | 検証済み | fixture 37件/queries 36件とharnessを作成。focused test 3件pass。通常testのfake値は品質証拠ではない。 |
| 5b. 実モデルのparaphrase・false positive・top-k・byte・latency品質とdesktop/iPhone Safari browser E2E | 未検証 | 実モデル/実browser実行が必要。 |
| 6. Draft PR #719をon-device実装としてmergeせず、production deployment前にsecurity/forget/real-device gatesを完了 | 検証済み | 本workは既存client branch上のsynthetic evaluationのみ。PR #719のserver codeを再利用せず、production deploymentを行っていない。残りgateを満たすまでrollout不可。 |

### このwork unitで実行した検証

| Command | 結果 |
| --- | --- |
| `npm ci --cache /private/tmp/studyplanner-npm-cache` | 成功。npm audit summaryでmoderate vulnerability 2件を報告（このworkでは調査・修正対象外）。 |
| `npx tsc --noEmit -p tsconfig.json` | pass |
| `node ./node_modules/vitest/vitest.mjs --config vite.config.mjs run src/features/userPlanningContext/semanticMemory/evaluation` | pass: 3 passed、実モデルopt-in 1 skipped（既定）。 |
| `npm run build` | pass。既存repository entryのdynamic-import警告と500 kB超chunk警告を出力。 |
| `git diff --check` | pass |

### NOT RUN

- 実モデルadapterによるopt-in test（通常はskip。モデル比較の実行証拠はない）。
- このevaluation harnessからのdesktop実機browser E2E、WebGPU/WASM、model download、memory、Worker計測（parentからruntime smoke passの報告はあるが、retrieval比較は別途未実行）。
- **iPhone Safari real device / WebKit PWA**。実端末の性能・quota・offline・lifecycle・account switchは未検証。
- runtime/indexとの統合、複数tab、forget/revocation伝播、production build/deployment。
