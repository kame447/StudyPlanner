# Issue #305 — focused contextual answer の Jev 第一経路

Status: active / implementation and tuning preparation
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

## 現在地

- baseline: `e8a7ab48566e70aa2534ef49a405cc30ae05a3b8`
- worktree branch: rename 指示を受けたが Codex sandbox が `.git` ref log write を
  `Operation not permitted` で拒否。親へ branch rename / checkpoint commit/push を依頼済み。
- 実装済み（未 commit checkpoint）:
  - shared contextual discriminated context と strict validator
  - authorization default を保つ purpose-specific provider catalog 一般化
  - contextual catalog / conservative gate / off-shadow-canary dispatch
  - existing parser-compatible role/fallback response
  - effort / provisional / cross-question confusion の Luna fallback
  - contextual telemetry purpose と raw-text-free typed log
  - client projection、response revision correlation、trace envelope privacy exclusion
  - tuning / holdout 合成 corpus v1
- 検証済み:
  - `npm run typecheck`: success
  - targeted Vitest: 9 files / 102 tests passed
  - `git diff --check`: success（corpus追加前の checkpoint）
- 本番 config / secret / package-lock は未変更。

## 次の具体作業

1. remote-dev harness を `scripts/jev-contextual-*` に実装し、production projection /
   dispatch / provider と actual Luna fallback を短命 preview で接続する。
2. 難しい tuning case を親の `opus-5.5-limited-judge` へ送る。
3. tuning だけで gate/catalog を校正し、固定後に holdout を1回実行する。
4. typed case 結果と集計（raw text / prompt / raw response なし）を本記録へ追加する。
5. full typecheck / tests / build / worker typecheck / dry-run / diff を実行する。
6. branch checkpoint、PR、CI terminal green、親への完了 Mail。

## 未解決

- remote-dev 実動と tuning / holdout は未実施。
- difficult case の親 judge は未取得。
- full regression / build / Worker dry-run / CI は未実施。
- parent-assisted branch rename / commit / push が必要。
