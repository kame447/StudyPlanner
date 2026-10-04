# Issue #305 Unit 0 — contextual paired 評価の事前登録準備

Status: active / HOLD — owner thresholds unregistered, evaluation unexecuted
Updated: 2026-10-04
Authority: [Phase B の採用規則](20261004-issue305-jev-hierarchical-input-interpretation.md#採用規則)
Technical record: [既存 focused contextual 記録の Unit 0 追記](20260927-issue305-jev-first-focused-contextual.md#phase-b-unit-0--2026-10-04-作業-checkpoint)

## 固定するもの

- Scope: weekly-planning の semantic normalization turn 全体。renderer・最終文・scheduler・commit・save は除外する。synthetic の率を本番頻度と呼ばない。
- Development corpus: `scripts/jev-contextual-development-corpus.json`、version `focused-contextual-question-identity-development-v3`。tuning 12 cases / 11 groups、calibration 12 cases / 11 groups。group は split を跨がない。来歴は `scripts/jev-contextual-development-provenance.json`。SHA-256 `75e2cbbfc962b7c93647bf0c1197860bc94e1e70de9e62f99412ad722cfa22ba`、凍結 `2026-10-04T14:25:25.464Z`。
- Generator: launch role に指定された gpt-6.1-sol / xhigh、agent PolarWatt。確認済み閲覧者は PolarWatt と CopperHopper（gpt-6-astra、再現 fixture の生成と harness の外部監査）。この二名と corpus を見た agent は独立 holdout 作者から除外する。BronzeMaxwell は review 中に diff file を作成・保存したが、内容を表示せず case の文面は未読である。この取扱いは閲覧とは区別して来歴 JSON に残す。以後の閲覧者は親が来歴へ追記する。implementation author の synthetic label であり、独立証拠でも gold でもない。旧 corpus を adapter の診断で読んだ作者が、契約から別場面を作成したもの。旧 corpus の import / 変形による生成はしていない。
- Holdout: **未作成**。実装者は作らない。[独立作者向け仕様](20261004-issue305-contextual-holdout-author-spec.md) だけを、tuning 文面を見ていない作者に渡す。作者・閲覧者・freeze hash/time・未消費状態は owner が後で登録する。
- Catalog: `focused-contextual-answer-2026-10-04-v3`。質問 identity は検証済み envelope から作る immutable provider projection に含まれる。
- Gate: `contextual-conservative-v2-calibrated`（既存 gate の値を維持する。名前は旧校正の識別子で、新契約の独立校正済みという意味ではない）。未知 code / duplicate / malformed envelope は provider 前に reject。quantity role の直接受理は quantity question だけ。effort / provisional は既存 Luna owner。none / abstain / unavailable / cross-question は既存 focused Luna へ、generic meaning は normalizer の全文 generic 経路へ進む。
- Runtime / policy hashes: offline runner が表示する。実装・catalog・gate・依存の hash を approval document に固定し、変化した場合は real run を拒否する。calibration 後に gate を変更する場合は再監査・version 更新・再凍結し、holdout を見る前に確定する。

## paired 手順

1. owner が母集団、各 artifact hash、group、label の来歴、gate / catalog、runtime、閾値、最大予算・中止条件を結果を見る前に登録する。本番の eligible frequency は Unit 1 の別証拠が必要。
2. tuning のみで契約・候補・gate の問題を診断し、calibration の別 group で閾値を確認する。calibration を見て変更したときは、その事実を記録し holdout の独立性を保つ。
3. 独立作者の sealed holdout は gate freeze 後に一度だけ実行する。親が固定した hash-keyed ledger に開始前の consumption record を exclusive create する。失敗・中断も消費を取り消さない。ローカル file guard は他のディレクトリやコピーに対する全世界の消費証明ではないため、親が canonical ledger を所有する。
4. 同じ case の Jev-first / Luna-only を連続して実行し、AB / BA を交互にする。両腕は実際の `createWeeklyPlanningSemanticNormalizerV5` を使う。Jev-first は production contextual dispatch に provider projection を通し、Luna-only は off 経路にする。他の Jev unit は有効化しない。
5. 実際の provider fetch 境界で dispatch を記録する。focused 呼出しの成功や attemptCount を Luna の dispatch とみなさない。generic fallback / audit / repair / retry も同じ normalizer turn に入る。呼出し後の network / HTTP / malformed 失敗にも1 dispatch を残す。provider 前の拒否は0 dispatch であり、正しい resolution とは限らない。
6. semantic result の全 tuple / scope を両腕同じ規則で review する。review artifact は corpus hash と runtime hash に束縛する。label の独立性と出所を case/arm ごとに記録する。未 review は NA とし、fallback を正解に換算しない。
7. preregistered 全 turn と D1 eligible の分母を固定する。不完全な pairs は分母から削除しない。incomplete / missing observation は dispatch-free と呼ばず NA。owner が AND の採用 gate を判定し、未証明なら HOLD にする。

## 出力する指標

| 指標 | 定義と制限 |
| --- | --- |
| D1 直接受理率 | quantity_role_unresolved の全 turn に対する Jev role response かつ normalizer accepted の数。意味正解率とは別 |
| joint false acceptance | accepted direct role のうち、全命題・target・量・unit・scope・条件を保たない数。veto 偽陰性を含む。未 review があれば rate / bound は NA |
| joint correctness / 非劣性 | 両腕の全文 semantic result を比較。同じ case の差・group の依存をレビューする。head 正答率の積は使わない |
| semantic Luna dispatch / turn | 初回・focused・audit・repair・retry・fallback による実 fetch 数。pair の Jev-first − Luna-only を同じ case で差分集計 |
| raw dispatch-free / 正しい resolution かつ free | 実 Luna 0回の率と、そのうち正しい resolution の率を分ける。shadow / race で Luna が実行された turn は free ではない。この harness は canary/off だけで比較 |
| mutating commit rate | **NA**。この harness は semantic boundary までで application commit を実行しない。別の application gate が必要 |
| semantic latency p50 / p95 | normalize 開始〜最終結果までの実測 elapsed。Jev latency に別の Luna run を足す推定はしない。timeout 等は実測に含むが不完全結果は採用 proof にしない |
| usage / 実 cost | 実 provider usage の input/output tokens と、provider が返した cost のみ。未 dispatch は既知の0、dispatch 後の欠測は NA。usage の一部欠測でも total は NA。Luna が cost を返さなければ cost gate は未証明 |
| 不確実性 | joint false acceptance は case と「同じ group に1件でも誤受理があれば失敗」の group 単位で one-sided Clopper–Pearson upper95。group 間の独立性も実証ではなく作成条件。非劣性・latency/cost の区間と予算中止判定は owner の事前登録が必要 |

## owner が事前登録する採用閾値（空欄）

| 欄 | 値 |
| --- | --- |
| minimumEligibleFrequency | |
| minimumDispatchReductionPerTurn | |
| maximumJointFalseAcceptance | |
| jointNonInferiorityMargin | |
| maximumLatencyP50RegressionMs | |
| maximumLatencyP95RegressionMs | |
| maximumCostRegressionUsdPerTurn | |
| minimumIndependentGroups | |
| 最大費用 / dispatch 予算と中止条件 | |
| 非劣性・latency/cost 区間の判定法 | |
| approval owner / approvedAt | |

空欄を0として扱わない。runner は owner・実行承認・artifact/runtime/policy hash・数値閾値・executionLimits（providerDispatchesPerTurn / totalElapsedMs）・inferenceProcedure が欠けた real run を拒否する。isolated `*-eval` Worker を指定し、production Worker は使わない。case / arm の欠落時は jointCorrectness を含む全 turn の率を NA とし、登録分母・未観測数・未 review 数を保持する。追加の費用予算・統計手法・census の承認は親が確認する。runner の準備は、production の有効化や有料 API 実行の承認ではない。

## オフラインでできること

```bash
node scripts/jev-contextual-paired-eval.mjs --split tuning
node scripts/jev-contextual-paired-eval.mjs --split calibration
npm run test:run -- scripts/jev-contextual-paired.test.mjs
```

最初の二つは corpus / hash / missing approval を表示して終了する。network / provider calls は0。owner が後で実行する command は `--run-approved --approval <owner-document> --worker <isolated-eval-worker> --corpus <frozen-json> --split <split> --output <result-json>` を追加する。Worker は既存の provider Secret を使い、Secret を取り出さない。

review 後は `--summarize --results <result-json> --labels <joint-review-json>` でオフライン集計できる。joint-review-json は corpusHash、runtimeSha256、labels を持ち、各 label は caseId、arm、correct、source、independent、reviewer、rationale を持つ。rate は label 出所つきで読む。summary は採用判断を自動化せず HOLD のままである。

取り込み時は artifact framing と case / arm / dispatch を検証し、不正・未知の provider / schema / identity / completeness は、数値の summary を出す前に拒否する。新 artifact は `schemaVersion=jev-contextual-paired-v1`、corpusVersion / corpusHash / runtimeSha256 / policySha256 / split / attemptedAt / status / expectedTurns / summary / pairs を持つ。旧 producer の version key だけが無い同じ完全な framing は `legacy_unversioned_v0` と明示する。過去の runtime hash は current checkout と一致する必要はないが、hash と来歴は必須であり、欠けた metadata を current fingerprint で埋めない。cached summary は再利用せず、検証済み dispatch の count と usage total を照合して再計算する。semantic result の framing 検証は意味正解の証拠にはならず、boolean な jointCorrect には reviewer / source / independent / rationale が必要。途中終了は `incomplete_HOLD` とし、欠落 case / arm の全分母と NA を保つ。

既存 `jev-contextual-cloud-eval.mjs` / `jev-contextual-corpus.mjs` は消費済みの診断専用。runner summary に consumed_diagnostic_only を記録し、欠測 token を0へ変換する集計を除去した。旧 holdout の結果は新しい独立証拠には数えない。
