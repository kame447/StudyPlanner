# Jev-first focused authorization 実動

Status: active
Updated: 2026-09-27
Tracking: Issue #305 / quality evidence #333 / security regression #335

## Active checkpoint

- branch: `exp/LivelyYukawa`（予定名への rename は Git dir read-only sandbox で親へ依頼中）
- base / current verified HEAD: `e8a7ab48566e70aa2534ef49a405cc30ae05a3b8`
- pull request: 未作成
- scope: focused authorization の Jev-first dispatch、Luna focused fallback、fault injection、影響範囲の安全性回帰、任意実行の remote-dev 評価
- production configuration: `JEV_MODE=off` / `JEV_CANARY_PERCENT=0` を維持
- current state: production `dispatchFocusedAuthorization` を直接通す evaluator、typed 131件 corpus、remote-dev runner、#335 mock regression を実装。typecheck と focused/security 68 tests は成功。fault suite と現 gate の tuning 81件は実 remote dev で完走。
- next action: tuning case result に confidence / probability / auxiliary heads を追加して現 question を再計測し、tuning のみで gate を校正する。固定後に holdout 50件を一度だけ開く。
- unresolved: current branch rename/commit/push は共通 Git dir の read-only sandbox で拒否され、親へ実行依頼中。tuning で Luna response の invalid 13件と HTTP unavailable 5件があり、production の max completion 80 到達と upstream HTTP failureとして観測された。retryで隠さず最終指標に controlled failure として保持する。

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
