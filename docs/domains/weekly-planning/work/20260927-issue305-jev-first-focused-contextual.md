# Issue #305 — focused contextual answer の Jev 第一経路

Status: active / calibrated, holdout pending
Updated: 2026-09-27
Tracking: Issue #305（品質証拠 #333、安全性回帰 #335）

## 目的と境界

Stable V5 の pending question への返答のうち、閉集合である quantity role
（`target` / `remaining` / `completed`）を Jev 第一経路へ移す。低信頼、補助
head の不一致、対象外、provider 障害、timeout、malformed response は既存の
Luna focused contextual answer へ戻す。Jev が高信頼で独立した意味または
generic fallback を示した場合だけ generic semantic へ進める。

本番設定の `JEV_MODE=off` / `JEV_CANARY_PERCENT=0` は変更しない。Jev は
formal binding、canonical ID、revision、question priority、scheduler placement、
preview、approval、save、persistence の authority を持たない。raw Japanese を
regex、辞書、legacy parser で再解釈する経路も追加しない。

## 現行 head の棚卸し

現行 Luna response と document builder / binding の実装を基準にした所有区分。

| head / decision | 現在の downstream | 本単位の owner | 理由 |
| --- | --- | --- | --- |
| `decision=quantity_role_answer` | exact pending workload に `quantityRole` を binding し、既存 task/component document を構築 | Jev 第一、Luna fallback | `quantity_role_unresolved` に限定すれば3択の閉集合。Jev は public/canonical ID を受け取らず、既存 builder が exact target binding を維持する |
| `quantityRole=target` | current planning operation の target role | Jev 第一、Luna fallback | 数値抽出を伴わない閉集合。question code 不一致は受理しない |
| `quantityRole=remaining` | 未完了 workload role | Jev 第一、Luna fallback | 同上 |
| `quantityRole=completed` | 完了済み workload role | Jev 第一、Luna fallback | 同上。completed を schedule permission にしない既存 application boundary は不変 |
| `decision=effort_answer` | `effortTarget` / `effortMeasurement` / `minutes` / `precision` の tuple を workload/estimate target へ binding | Luna 維持 | `minutes` は自由表現の抽出・換算。categorical field だけ Jev に分けても Luna 呼出しは減らず、一つの意味に二つの owner を作る |
| `effortTarget` | question target または separate estimate target を選択 | Luna 維持 | minutes と同じ発話内 tuple の参照意味 |
| `effortMeasurement` | total duration または per-unit | Luna 維持 | minutes の単位解釈と不可分 |
| `minutes` | positive finite number として validator を通り effort estimate を構築 | Luna 維持 | 開いた自然言語数値抽出であり Jev Choice の対象外 |
| `precision` | exact / approximate / unspecified | Luna 維持 | minutes の表現精度と同じ tuple |
| `decision=provisional_timebox` | effort fact を作らず scheduler-only contextual directive を発行 | Luna 維持 | scheduler permission であり、Jev の限定分類から直接昇格させない |
| `decision=fallback` | generic semantic normalization | Jev 第一の限定候補、低信頼は Luna | definite independent meaning / ambiguity の catch-all。Jev が正しい effort reply を誤って generic へ送る率を quantity-role false accept と分けて測る |
| `condition_change` / `independent_meaning` | auto route を veto または generic fallback | Jev 補助 head | primary Choice と同じ model 由来なので独立保証とは呼ばず、矛盾時は Luna に倒す |

## 採用した bounded contract

Browser は `purpose=focused_contextual_answer`、turn `requestId`、pending graph
`inputRevision`、`questionCode`、current user text、pending question の最小 typed
状態だけを Worker へ送る。task title、canonical/public ID、Fact Graph、relation、
scheduler permission、threshold、question catalog、model は送らない。shared validator
は全階層で未知 key を拒否し、文字数・revision・question-specific invariant を検証する。

Worker は固定 Choice `target / remaining / completed / focused_luna / fallback` と
`condition_change` / `independent_meaning` Noul を所有する。

- effort question で quantity role が返った場合は confidence に関係なく Luna へ戻し、
  cross-question confusion として数える。
- `focused_luna` は effort tuple / provisional / その他の Luna-owned focused interpretation。
- definite independent meaning は既存 parser が読める `decision=fallback` JSON を返す。
- uncertainty、head conflict、unavailable は Luna へ戻す。
- accepted quantity role も Luna と同じ response shape を返し、既存 parser、document
  builder、binding を通す。

## 評価規則

`scripts/jev-contextual-corpus.mjs` の合成 corpus は conversation group 単位で
tuning / holdout を分離する。ラベルは `synthetic_unreviewed` であり gold ではない。
threshold / question catalog の調整は tuning のみで行い、固定後の holdout は1回だけ
実行する。

pending question の範囲内にある曖昧さは `focused_luna` とする。範囲外の独立した
意味を高信頼で検出した場合だけ `generic_semantic` へ直行する。Jev 自身の低信頼や
head conflict は意味上の generic 判定ではなく Luna fallback である。

### 限定 judge（gold ではない）

Label source: `opus-5.5-limited-judge`（claude-opus-5-5 / CleverDarwin）。

| case | 判定 | 理由 |
| --- | --- | --- |
| `ctx-t-remaining-03` | `quantity_role_answer / remaining` | completed を否定して remaining を自己完結に示し、独立条件を含まない |
| `ctx-t-generic-04` | `focused_luna` | 「その方」は pending question 内の参照が曖昧。generic 直行の根拠はなく、Luna focused が必要なら fallback する |
| `ctx-t-effort-ambiguous-01` | `focused_luna` | 直前の見積もりへの同意とも読め、minutes 解釈の owner である Luna に残す |

主要指標:

- quantity role false accept（最優先）
- expected quantity role の class 別 typed 一致と Luna fallback 率
- expected effort / provisional が Jev generic fallback へ誤って直行する取りこぼし
- effort question の cross-question quantity choice
- generic semantic expected case の受理 / Luna fallback
- abstain / unavailable / timeout / malformed と actual Luna fallback
- sample / conversation-group 数、および false-accept の Clopper–Pearson 片側95%上限
- Jev / Luna の usage、latency、reported cost（未知値を0にしない）

## Security #335 対応範囲

mock / remote-dev の両方で、direct/role-confusion/Unicode injection、異常数値、
provisional の Jev 昇格禁止、preview/approval/save authority 非付与、unknown-key / stale
revision rejection、Jev failure 後の Luna fallback を確認する。Jev response は typed role
または existing fallback JSON にしかならず、formal mutation を直接返せない。

## Remote-dev 実動結果

### tuning-only 校正（catalog v2 / gate v2）

初期の authorization 相当の保守 gate（Choice confidence 0.97、selected probability
0.99、補助 Noul 0.01 以下）は、30件すべてを安全側の Luna に戻し、quantity role
直行が0/12だった。候補を次のように比較した。

| 候補 | tuning evidence / 反証条件 | blast radius | 判断 |
| --- | --- | --- | --- |
| 保守閾値を維持 | false accept は避けるが Jev 置換が0件。直行が目的でなければ成立 | 最小 | 不採用。実移行の完了条件を満たさない |
| 補助 Noul を無視して Choice だけ緩和 | direct role の Choice は多くが正しい。一方、Unicode injection / 独立質問でも role Choice が出るため反証済み | security と generic 境界まで拡大 | 不採用 |
| pending 内 ambiguity の catalog 定義を修正し、role 専用閾値と補助上限を校正 | direct role と負例が tuning 上で分離。holdout で false accept が出れば反証 | contextual role の canary のみ。authorization は不変 | 採用 |

catalog v2 は pending question 内だけの曖昧さを `focused_luna`、範囲外の意味を
`fallback` と明示し、選択肢間の否定・対比を別条件と数えない。gate v2 は role に限り
confidence 0.80、selected probability 0.85、condition change 0.40 以下、independent
meaning 0.60 以下を要求する。generic fallback の primary Choice は従来どおり
confidence 0.97 / selected probability 0.99 とし、definite auxiliary fallback は0.95
以上に限定する。effort question の role Choice と `focused_luna` はこれらの閾値より
前に必ず Luna へ戻す。

固定直前の tuning 実動は30件 / 21 conversation groups。合成ラベルは gold ではなく、
以下の一致は accuracy と呼ばない。

| 指標 | tuning result |
| --- | --- |
| expected quantity role | 12 |
| Jev role accepted / synthetic typed match | 10 / 10 |
| quantity-role false accept | 0 / 30、片側95% Clopper–Pearson 上限 9.50% |
| expected effort / provisional → generic miss | 0 / 9 |
| effort question の cross-question role Choice | 3 / 11（すべて Luna fallback） |
| expected generic の Jev direct fallback | 2 / 9 |
| Luna fallback | 18 / 30 |
| provider unavailable / unexpected output key | 0 / 0 |
| Jev usage | input 25,254 / output 2,892 tokens、reported USD 0.001060668 |
| Luna usage | prompt 10,834 / completion 1,855 tokens、cost unknown |

Jev role accepted case IDs:
`ctx-t-target-01`, `ctx-t-target-02`, `ctx-t-remaining-01`,
`ctx-t-remaining-02`, `ctx-t-remaining-03`, `ctx-t-completed-01`,
`ctx-t-completed-02`, `ctx-t-completed-03`, `ctx-t-remaining-04`,
`ctx-t-completed-04`。holdout を開く前に catalog / gate をこの状態で凍結した。

### fault injection + actual Luna fallback

Wrangler 4.140.0 の一時 remote dev で production contextual dispatch を使用し、
injected Jev outcome の後段は既存 Worker Secret を内部利用する actual Luna で実行した。
本番 deploy、設定変更、secret 値の読出しは行っていない。

| probe | Jev gate | Luna | final typed result |
| --- | --- | --- | --- |
| low confidence | `abstained / uncertain` | called | `quantity_role_answer / remaining` |
| timeout | `unavailable / timeout` | called | `quantity_role_answer / remaining` |
| malformed | `unavailable / invalid_response` | called | `quantity_role_answer / remaining` |
| network | `unavailable / network` | called | `quantity_role_answer / remaining` |
| effort question + role choice | `deferred / cross_question_choice` | called | `effort_answer` with minutes |

5/5 で Luna fallback が実動し、unexpected output key は0。Luna usage 合計は prompt
2,967 / completion 278 tokens。価格表を渡していないため cost は未知であり0とは扱わない。
fault injection は semantic quality の正解率や gold ではない。

## 現在地

- baseline: `e8a7ab48566e70aa2534ef49a405cc30ae05a3b8`
- worktree branch: `feat/issue-305-jev-first-focused-contextual`
- durable checkpoint: parent-assisted commit/push `e307fda4`（upstream 設定済み）。
  Codex sandbox は `.git` metadata write を拒否するため、以後の commit/push/PR は親が代行する。
- 実装済み（未 commit checkpoint）:
  - shared contextual discriminated context と strict validator
  - authorization default を保つ purpose-specific provider catalog 一般化
  - contextual catalog / conservative gate / off-shadow-canary dispatch
  - existing parser-compatible role/fallback response
  - effort / provisional / cross-question confusion の Luna fallback
  - contextual telemetry purpose と raw-text-free typed log
  - client projection、response revision correlation、trace envelope privacy exclusion
  - tuning / holdout 合成 corpus v1（tuning 30件 / holdout 30件、計46 conversation groups）
  - short-lived remote-dev evaluation harness（raw text / prompt / raw response を出力しない）
  - remote-dev fault probes 5件で actual Luna fallback 5/5
  - tuning-only catalog/gate 校正と最終 remote-dev tuning 30件
- 検証済み:
  - `npm run typecheck`: success
  - targeted Vitest: 9 files / 102 tests passed
  - `git diff --check`: success（corpus追加前の checkpoint）
- 本番 config / secret / package-lock は未変更。

## 次の具体作業

1. 凍結済み catalog/gate で30件の holdout を1回だけ実行する。
2. typed case 結果と集計（raw text / prompt / raw response なし）を本記録へ追加する。
3. full typecheck / tests / build / worker typecheck / dry-run / diff を実行する。
4. branch checkpoint、PR、CI terminal green、親への完了 Mail。

## 未解決

- holdout の実 API は未実施。catalog/gate は tuning-only で凍結済み。
- full regression / build / Worker dry-run / CI は未実施。
- 次の意味 checkpoint で親へ commit/push を依頼する。
