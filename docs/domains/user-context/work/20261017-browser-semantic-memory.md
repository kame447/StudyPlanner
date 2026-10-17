# ブラウザ内 semantic memory の評価・実装記録

Status: active evaluation / rollout gates not complete
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

## 親実行の実モデル・browser結果

2026-10-17に、架空fixtureだけを使い、`Xenova/multilingual-e5-small@761b726d` のint8版をNode ONNX adapterで評価した。top-5の比較にはscore thresholdを適用していない。

| セット | retriever | recall@5 | negative FP records | FPありnegative queries |
| --- | --- | ---: | ---: | ---: |
| v1（28 positive / 6 negative） | lexical-baseline | 0.679 | 5 | 3/6 |
| v1 | vector | 0.929 | 30 | 6/6 |
| v1 | hybrid-rrf | 0.929 | 30 | 6/6 |
| holdout（18 positive / 4 negative） | lexical-baseline | 0.778 | 8 | 記録なし |
| holdout | vector | 1.000 | 20 | 記録なし |
| holdout | hybrid-rrf | 1.000 | 20 | 記録なし |

threshold sweepでは、v1で0.75にするとnegative 6/6に候補が出た。0.84ではrecall 0.929かつnegative 0/6、0.86ではrecall 0.857だった。holdoutは0.84でrecall 18/18、negative 0/4だったが、negativeの最高scoreは0.826で差が小さい。positive 18 queries中14 queriesで、無関係な別recordも0.84以上になった。hybridは追加候補を最大3件に制限する。

runtimeの `DEFAULT_SEMANTIC_MEMORY_MIN_SCORE=0.84` は暫定値として扱う。これは合成データによる候補品質の測定であり、実言語の人手gold、十分なprecision評価、実端末の性能評価を終えたthresholdではない。

親実行のdesktop browser結果（Playwright、最終snapshot `d42ceb9a`）: Chromium 156（WASM）、WebKit 27.2（WebGPU）、WebKit 27.2（WASM強制）の3 targetで、cold embed・WASM強制・cache保存・online reload（model/runtime通信を遮断）・offline reload・cache消去後offlineのunavailable・download中abortの8 checkが全件pass。診断cacheなしのWebKit WASM経路も8/8 pass。model load は8.2〜14.0秒、steady embed はChromium/WebKit WASMで約13ms、WebKit WebGPUで55〜74ms。公開model/tokenizerの取得量は135,138,425 bytes、通信method/body違反0件。

WebKitで判明した2点: (1) 約150MiBの単一Cache API entryは `Blob loading failed` で保存できない（quotaは1000MiB、1/50MiBは成功）。そのためmodel fileを32MiB以下のchunkとmanifest（最後に公開）で保存する。(2) Playwright WebKitのephemeral contextはpage reloadでCache API entryを失う（20 byte probeで再現、persistent contextでは保持）。WebKit lifecycleは新規の一時persistent profileで実行し、この差はtest環境のartifactとして記録した。**iPhone Safari実機は未実行**であり、desktop WebKitのpassを実機offline・低memory・PWA挙動の保証とみなさない。

親の評価結果にはcontext bytesとlatencyの数値が含まれていないため、ここでは未計測値を補わない。

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
| 1. bounded lexical/entity baselineと日本語paraphrase missを比較し、embedding unavailable時は現行結果を保持する | 検証済み | Node ONNX実モデルでv1/holdout比較を実施。index testはembedding unavailable時にbyte-identical lexical outputを確認。品質結果とthreshold限界は上記表を参照。 |
| 2. 小型多言語modelを端末内で遅延実行し、download/memory、iPhone Safari/WebKit WASM CPUとWebGPUを計測。Web Workerでmain threadを塞がない | 一部検証 | desktop Chromium/WebKitでWorker内の遅延読込、WebGPU/WASM、download量・load/embed時間を計測済み。iPhone Safari実機、Worker内memoryは未計測。 |
| 3. versioned・owner-scoped・破棄可能なlocal indexをcanonical ID/revision/lifecycle/deleteに結び、recall時に再検証 | 一部検証 | fake-indexeddbでowner/revision/lifecycle/forget/再検証/multi-tab fenceをunit test。実browserでのIndexedDB multi-tab E2Eは未実行。 |
| 4. multi-tab/pending write、cancel、quota/eviction、offline reload、model failure、device switch、低memory Safariでlexicalへ安全にdegrade | 一部検証 | desktop Chromium/WebKitでoffline reload・cache消去・abort・WASM強制がpass。quota超過・storage不可はunit testでlexical byte一致。実機の低memory・eviction・device switchは未検証。 |
| 5a. 人手レビュー可能な日本語synthetic corpusとlexical/vector/hybridの比較指標 | 検証済み | v1は37 records/36 queries、holdoutは新規24 queries。focused Vitest 4件pass。Node ONNX実モデル指標を上記に記録。fake値は品質証拠ではない。 |
| 5b. 実モデルのparaphrase・false positive・top-k・byte・latency品質とdesktop/iPhone Safari browser E2E | 一部検証 | 実モデルrecall・negative・trap比較とdesktop Chromium/WebKit lifecycle E2Eはpass。iPhone Safari実機、実言語の人手gold、precision調整は未実施。 |
| 6. Draft PR #719をon-device実装としてmergeせず、production deployment前にsecurity/forget/real-device gatesを完了 | 検証済み | 本workは既存client branch上のsynthetic evaluationのみ。PR #719のserver codeを再利用せず、production deploymentを行っていない。残りgateを満たすまでrollout不可。 |

### このwork unitで実行した検証

| Command | 結果 |
| --- | --- |
| `npm ci --cache /private/tmp/studyplanner-npm-cache` | 成功。npm audit summaryでmoderate vulnerability 2件を報告（このworkでは調査・修正対象外）。 |
| `npx tsc --noEmit -p tsconfig.json` | pass |
| `node ./node_modules/vitest/vitest.mjs --config vite.config.mjs run src/features/userPlanningContext/semanticMemory/evaluation` | pass: 4 passed、実モデルopt-in 1 skipped（既定）。 |
| `npm run build` | pass。既存repository entryのdynamic-import警告と500 kB超chunk警告を出力。 |
| `git diff --check` | pass |

### NOT RUN

- 実端末でのretrieval比較・latency・context bytes測定、WebGPU/WASM CPUとの性能比較、download/memoryの定量測定。
- **iPhone Safari real device / WebKit PWA**。実端末の性能・quota・offline・lifecycle・account switchは未検証。
- production deployment。gate 6のとおり、残るsecurity/forget/real-device gatesを満たすまでrolloutしない。
