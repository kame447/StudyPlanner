# Jev-first focused authorization 実動

Status: active
Updated: 2026-09-27
Tracking: Issue #305 / quality evidence #333 / security regression #335

## Active checkpoint

- branch: `feat/issue-305-jev-first-focused-authorization`（Git 書き込みは親が代行）
- base: `e8a7ab48566e70aa2534ef49a405cc30ae05a3b8`; latest pushed checkpoint: `9b35e3c2`
- pull request: 未作成
- scope: focused authorization の Jev-first dispatch、Luna focused fallback、fault injection、影響範囲の安全性回帰、任意実行の remote-dev 評価
- production configuration: `JEV_MODE=off` / `JEV_CANARY_PERCENT=0` を維持
- current state: production `dispatchFocusedAuthorization` を直接通す evaluator、typed 131件 corpus、remote-dev runner、#335 mock regression を実装。fault suite、tuning、固定後の holdout 50件（一度のみ）、paired Luna-only 50件（一度のみ）を実 remote dev で完走。full regression / build / dry-run / exact diff check は完了。
- next action: 親へ commit と ready PR 作成を依頼し、CI terminal success と独立監査を追う。
- unresolved: tuning/holdout の Luna controlled failure は retry で隠さず指標に保持する。Luna exact cost は cache内訳とHTTP failure usageがないため unknown。Worker 全体の ad-hoc strict `tsc` は baselineにも同一の既存6 errorsがあり、正式な repository script は未定義。Git commit/push/PR は親が代行する。

## Definition of done

- temporary Cloudflare remote dev で Jev-first と実 Luna fallback を production dispatch 経由で確認する
- abstain / unavailable / timeout / HTTP / malformed / model mismatch / stale context / abort を fault injection し、controlled fallback と両 provider failure を確認する
- tuning のみで gate を校正し、固定後の holdout を一度だけ評価する
- coverage、Luna 呼出し削減、false-create と Clopper–Pearson 上限、latency p50/p95、usage/cost を記録する
- focused authorization に関係する #335 security regression と通常回帰を green にする
- ready PR を作成し、全 required CI を terminal success まで追う

## Evidence log

- 2026-09-27: parent `CleverDarwin` に追加80件の `opus-5.5-limited-judge` を一括依頼。結果は human gold と呼ばない。
- 2026-09-27: `opus-5.5-limited-judge-v1` を受領。追加80件は create 21 / fallback 52 / ambiguous 7 / exclude 0。既存難例2件は `stored-injection-07=create_plan`、`abnormal-value-04=fallback`。追加80件の作成者も Opus 5.5 child であり、judge は作成者から独立していない。ambiguous 7件は label を保持し、安全性指標では fallback として false-create 分母に含める。
- 2026-09-27: temporary remote dev の fault suite 成功。Luna 単独 control は `create_plan`（2,113 ms、149 prompt / 20 completion tokens）。Jev timeout（1,600 ms超過）、HTTP 429、HTTP 500、malformed、model mismatch、provider abort、stale context/revision の全7件で実 Luna fallback が呼ばれ、最終判断は control と同じ `create_plan`。fallback latency は 946–2,971 ms。両 provider failure は HTTP 502 の controlled failure、decision `null`、legacy parser なし。全結果で最大権限は未保存案の作成要求のみ、approval/save は false。
- 2026-09-27: 現 gate（v1 uncalibrated）の tuning 81件を実 dispatch で完走。route は Jev accepted fallback 14 / abstain→Luna 67 / accepted create 0、Jev coverage と Luna 呼出し削減は各 17.28%。end-to-end false-create は 5 / negative 55（片側95% Clopper–Pearson 上限 18.17%）で、5件はいずれも abstain 後の Luna 判断。p50 1,247 ms / p95 1,629 ms。Jev usage 52,442 input / 5,782 output tokens、reported Jev cost subtotal USD 0.002202564。Luna cost は確認済み価格表がないため unknown のまま。最終 accuracy 58 / 81 は human gold に対する正解率ではなく、synthetic 29件 + 非独立 `opus-5.5-limited-judge` 52件への暫定一致。Luna invalid/HTTP failure を含む controlled failure は18件。
- 2026-09-27: case 単位の confidence / choice probability / condition-change / independent-meaning を追加した tuning v2 を同じ81件で実測。現 gate は accepted fallback 14 / abstain→Luna 67 / accepted create 0、Jev 自動 false-create 0 / negative 55（片側95% Clopper–Pearson 上限 5.30%）。end-to-end false-create は3 / 55（上限13.50%）、controlled failure 17件、p50 1,304 ms / p95 1,669 ms。usage は Jev 52,442 input / 5,783 output、Jev reported cost subtotal USD 0.002202564。Luna 67 call のうち usage reported は61、cost は67件すべて unknown。

## Tuning-only gate calibration

Tuning 81件（create 26 / safe-side fallback 55）の保存済み typed Jev 出力を再評価し、次の候補を比較した。いずれも直接検証できる反証条件は、expected fallback を Jev が `create_plan` として自動受理するケース、または expected create を強制 fallback として自動受理するケースの出現である。

| candidate | rule summary | Jev complete | accepted create / fallback | Jev false-create | evidence / risk |
| --- | --- | ---: | ---: | ---: | --- |
| v1 baseline | 0.97 confidence / 0.99 probability / auxiliary 0.01 | 14 / 81 (17.28%) | 0 / 14 | 0 / 55 | blast radius は最小だが、明白な authorization も全て Luna に落ちる |
| conservative | create 0.90/0.95 + auxiliary `<0.50`; fallback 0.80/0.90; strong auxiliary veto 0.90 | 50 / 81 (61.73%) | 11 / 39 | 0 / 55 | false-create 優先。negative raw-create の最大 0.73 confidence / 0.87 probability に対し余裕がある |
| coverage | create 0.80/0.90 + auxiliary `<0.60`; fallback 0.80/0.90; veto 0.90 | 53 / 81 (65.43%) | 14 / 39 | 0 / 55 | coverage は高いが create 側の tuning 分離余裕が小さい |
| tuning-boundary | create 0.74/0.88; fallback 0.66/0.63; veto 0.80 | 62 / 81 (76.54%) | 16 / 46 | 0 / 55 | tuning 最大値の直上で過適合の blast radius が大きい |

採用は `authorization-conservative-v2-tuning81`。false-create を最優先し、coverage 案より3件を Luna に残して create 側の confidence / probability に余裕を取った。question 文は変更しない。typed head が既に create と安全側 fallback を分離しており、question 変更による別の応答分布を増やさず、threshold だけを固定する方が直接検証可能だからである。holdout はこの固定後に一度だけ開く。

固定 gate を tuning v2 の保存済み typed 出力へ決定論的に replay すると、accepted create 11 / accepted fallback 39 / abstain→Luna 31、coverage / Luna削減は50 / 81（61.73%）。Jev 自動 false-create は0 / 55（片側95%上限5.30%）、end-to-end false-create は3 / 55（上限13.50%、全て Luna fallback 後）。controlled failure は10件、p50 216 ms / p95 1,563 ms、暫定 label 一致は68 / 81。Jev usage/cost は52,442 input / 5,783 output / USD 0.002202564、Luna は31 call中27件のみ usage reported（prompt 3,672 / completion 1,670）、cost unknown。これは再 API 呼出しではなく、同じ typed 証拠に固定 gate を適用した replay である。

## Final holdout (opened once)

gate と question を固定し、未開封 holdout 50件（create 13 / safe-side fallback 37）を temporary remote dev の production dispatch で一度だけ実行した。結果を見た後の threshold / question 調整や rerun はしていない。

- routes: accepted create 7 / accepted fallback 27 / abstain→Luna 16
- Jev coverage / Luna call reduction: 34 / 50 = 68.00%
- Jev 自動 false-create: 0 / 37、片側95% Clopper–Pearson 上限 7.78%
- end-to-end false-create: 2 / 37、上限 16.05%。`x333-kekkou-a` は非独立 `opus-5.5-limited-judge` の `ambiguous_safe_fallback`、Jev は raw `fallback` を confidence不足の `uncertain` として保留。`x333-compound-hai-b` は非独立 `opus-5.5-limited-judge` の `fallback`、Jev は raw `create_plan` を confidence不足の `uncertain` として保留。どちらも保留後の Luna が `create_plan` を返した
- controlled failure: 3 / 50。`x333-ii-kamo-b` は Luna invalid response、`x333-unrelated-tip-a` と `x333-width-mix-a` は Luna HTTP unavailable。全て HTTP 502 の controlled failure で legacy parser なし
- latency: p50 209 ms / p95 1,568 ms
- usage: Jev 32,440 input / 3,565 output tokens。Luna 16 call中14件が usage reported（prompt 1,942 / completion 834）、2件は upstream HTTP failure のため unknown
- cost: reported Jev subtotal USD 0.00136248。Luna は確認済み単価がないため16件すべて unknown、合計 cost も unknown
- 暫定 label 一致: 45 / 50。これは human gold の accuracy ではなく、synthetic 20件 + 非独立 `opus-5.5-limited-judge` 30件（うち ambiguous safe fallback 2件）への一致
- authority: 50 / 50で最大効果は未保存案の作成要求。approval/save は全件 false。Jev accepted の誤 label は0件

### Paired Luna-only comparison

同じ holdout 50件を、同じ production Luna focused message builder / response format で Luna-only として一度だけ別実行した。生成結果は非決定的なので case 単位の failure は4件で入れ替わったが、比較対象の標本、label、件数は同一である。

| metric | Luna-only | Jev-first final | assessment |
| --- | ---: | ---: | --- |
| generation LLM calls | 50 / 50 | 16 / 50 | 34 call、68.00%削減（Jev classifier call は別に50） |
| false-create | 2 / negative 37 | 2 / negative 37 | 悪化なし。両実行とも同じ `x333-kekkou-a` / `x333-compound-hai-b` |
| controlled failure | 3 / 50 | 3 / 50 | 件数は同じ。非決定的な Luna 応答のため case ID は一部異なる |
| 暫定 label 一致 | 45 / 50 | 45 / 50 | 悪化なし。human gold accuracy ではない |
| latency p50 | 1,014 ms | 209 ms | 79.39%短縮 |
| latency p95 | 1,353 ms | 1,568 ms | 15.89%悪化。abstain 時の Jev→Luna serial fallback が tail を増やす |

Luna-only の usage は prompt 6,935 / completion 2,687 tokens、Jev-first は Jev 32,440 / 3,565 tokensに加え、usage reported の Luna 14 callで prompt 1,942 / completion 834 tokens（残る2 HTTP failureはunknown）。API 応答には Luna の dollar cost と prompt cache/cache-write 内訳がないため、repository の production pricing policy `openai-public-2026-07-30-v1` も exact cost を unknown とする。従って dollar saving は断定しない。

参考レンジとして同 policy の prompt rate（cached USD 0.02/M〜cache-write USD 0.25/M）と output USD 1.20/M を reported token にだけ適用すると、Luna-only は USD 0.000067262〜0.000099163 / turn。Jev-first の既知 subtotal は Jev reported USD 0.0000272496 / turn + reported Luna 14 call分で USD 0.0000480424〜0.0000569756 / turnだが、HTTP failure 2 callの usage/cost が不明なので完全な1 turn costではない。

false-create 2件は Jev 自動受理の誤りではなく、現行 Luna-only でも同じ case ID に再現した既存誤りである。`x333-kekkou-a`（曖昧な丁寧表現）と `x333-compound-hai-b`（context-dependent compound answer）は、#333 の日本語比較証拠へ返す Luna 改善項目として扱う。

## Issue #335 evidence

- 通常CI用 mock regression は既存 Issue #152 adversarial corpus を直接再利用し、direct/stored injection、role confusion、Unicode、異常値、条件付き承認、保存/承認要求を Jev accepted と Luna fallback の両経路へ通す。関連100 tests（provider/gate、dispatch、first-route evaluator、security 31件）は green。
- 実動 corpus は stored/indirect injection、Unicode、abnormal、conditional、mixed turn、draft-vs-save を含む。holdout では Jev accepted と abstain→Luna の両方が発生し、authority violation は0 / 50。tuning typed replay でも0 / 81。
- `create_plan` は未保存案の作成要求だけであり、Jev/Luna は approval、save、canonical ID、配置、状態遷移を返せない。両 provider failure も controlled failure のままである。

## Verification

- `npm run typecheck`: success
- `npm run test:run`: 570 files passed / 10 skipped、2,878 tests passed / 45 skipped / 5 todo
- focused provider/dispatch/evaluator/security: 最終100 tests passed（gate boundary、paired Luna evaluator、security 31件を含む）
- `npm run build`: success（2,213 modules transformed）
- changed Worker decision modules: Wrangler-generated runtime typesを含む strict `tsc` で変更モジュール固有 error 0。Worker全体へ到達すると diff外の既存6 errorsで nonzeroとなり、`origin/main` archiveでも同じ6 errorsを再現したため harness/baseline debtに分類
- Wrangler 4.140.0 production dry-run: Total Upload 425.63 KiB / gzip 87.61 KiB、`JEV_MODE="off"` / `JEV_CANARY_PERCENT="0"`、`--dry-run: exiting now.` まで確認。runbookどおり親の検証はWrangler自身の exit code未取得として記録
- `git diff --check origin/main`: success。変更11 filesは全て予約範囲内、`package-lock.json` と `workers/ai-proxy/wrangler.jsonc` は未変更
