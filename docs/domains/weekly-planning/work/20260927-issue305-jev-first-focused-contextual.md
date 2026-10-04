# Issue #305 — focused contextual answer の Jev 第一経路

Status: PR #338 audit fixes locally verified / awaiting parent commit
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
- Worker がまだ知らない `decisionContext.purpose` は context なしと同じ通常 Luna
  経路へ進め、upstream へ context を転送しない。既知 purpose の形式不正、非 object、
  purpose 欠落は400にする。Browser の discriminated union は未知 purpose を型で拒否する。
- completed/remaining の二つの対象を持つ effort question で focused retry する場合、
  repair 指示を解釈する owner は Luna なので、2回目は `decisionContext` を送らない。

## 前方互換とデプロイ順序

監査時点の本番 Worker は #332 より前の `43aa4ab8` で、`decisionContext` を無視する
版であるため、現行本番への即時回帰はない。一方、#332〜#337 の Worker は未知の
context purpose を400にしていたため、新しい client を先に出すと非互換になり得た。
本変更後のリリース順序は **Worker を先、client を後** とする。Worker 先行状態では
未知 purpose が通常 Luna と同じ upstream body になることを回帰テストで固定し、今後の
単位追加や client/Worker の一時的な版ずれでも通常経路を維持する。

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
| Luna usage | prompt 10,834 / completion 1,855 tokens、USD 0.00244268〜0.00493450 |

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
2,967 / completion 278 tokens、cost は USD 0.00039294〜0.00107535。
fault injection は semantic quality の正解率や gold ではない。

追加 probe では low-confidence に加えて timeout、HTTP 429、HTTP 500、malformed、
model mismatch、provider cancelled、stale revision、effort cross-question を実行した。
9/9 で production contextual dispatch から actual Luna が呼ばれ、8件は
`quantity_role_answer / remaining`、effort cross-question は minutes を持つ
`effort_answer` になった。unexpected output key は全件0、Luna usage 合計は prompt
5,339 / completion 465 tokens、cost は USD 0.00066478〜0.00189275。stale revision
probe は evaluator harness 専用の current-context hook で高確信 role を棄却したもので、
本番 Worker はこの hook を渡さない。本番の freshness 境界は client の revision echo
検査と、active pending state からの target 再構築である。caller request 自体の abort は
Luna も中断すべき別条件であり、この probe の `cancelled` は provider abort outcome を表す。

### 予備 holdout（gate/catalog 固定後の1回のみ）

`ba8aa38f` で catalog v2 / gate v2 を固定してから、holdout 30件 / 25
conversation groups を1回だけ実行した。結果を見た gate/catalog 変更や再実行は
していない。すべて `synthetic_unreviewed` であり human gold ではないため、以下は
予備的な boundary evidence である。ただし30件のうち12件は、tuning 結果を見た後に
同じ作成者が追加しており、完全に独立した holdout ではない。この set は予備的かつ
消費済みで、今後の受入れ判断には tuning 閲覧前に新しく封印し、独立レビューした
set が必要である。

freeze 時点の catalog/gate source SHA-256 は
`b52dfb18c174bc30b49c56ffedd52409724d827a7e416e3c92a60978e988020c`
（`workers/ai-proxy/src/decision/contextualDecisionPolicy.ts`）、corpus SHA-256 は
`7f813b7d9711d10e53b83cbcdace369a209c3797016ef1b88f994a0d30e3e6e6`
（`scripts/jev-contextual-corpus.mjs`）。runner の case 単位 typed record は一時 stdout
だけで永続化しておらず、holdout 再実行を避けるため新たな artifact は作らない。

| 指標 | holdout result |
| --- | --- |
| expected quantity role | 12 |
| Jev role accepted / synthetic typed match | 8 / 8 |
| quantity-role false accept | 0 / 30、片側95% Clopper–Pearson 上限 9.50% |
| expected effort / provisional → generic miss | 0 / 8 |
| effort question の cross-question role Choice | 1 / 12（Luna fallback） |
| expected generic の Jev direct fallback | 3 / 10 |
| Luna fallback | 19 / 30 |
| provider unavailable / unexpected output key | 0 / 0 |
| Jev usage | input 25,271 / output 2,894 tokens、reported USD 0.001061382 |
| fallback Luna usage | prompt 11,461 / completion 2,007 tokens、USD 0.00263762〜0.00527365 |

Jev role accepted case IDs:
`ctx-h-target-02`, `ctx-h-remaining-01`, `ctx-h-remaining-02`,
`ctx-h-completed-01`, `ctx-h-completed-02`, `ctx-h-remaining-03`,
`ctx-h-remaining-04`, `ctx-h-completed-04`。direct generic は
`ctx-h-security-01`, `ctx-h-security-02`, `ctx-h-security-05`。

### Luna-only paired comparison（同一 holdout）

同じ30件を Luna-only でも1回評価した。`focused_luna` は「Luna が owner」である
boundary label で、特定の一文を gold とするものではない。final boundary error は、
quantity role の exact typed 不一致、generic expected の non-fallback、または
Luna owner を迂回した場合だけを数える。

| 指標 | Jev-first | Luna-only |
| --- | ---: | ---: |
| sample / groups | 30 / 25 | 30 / 25 |
| final boundary error | 2/30 (`ctx-h-security-03`, `ctx-h-security-04`) | 3/30 (`ctx-h-security-01`, `ctx-h-security-03`, `ctx-h-security-04`) |
| error の片側95%上限 | 19.53% | 23.86% |
| generative LLM calls | 19 | 30 |
| call reduction | 11/30（36.7%） | baseline |
| latency p50 / p95 | 1,463 / 2,163 ms（paired estimate） | 1,415 / 1,956 ms（observed） |
| provider token usage | Jev 25,271/2,894 + Luna 11,461/2,007 | Luna 18,057/2,819 |
| cost | USD 0.003699002〜0.006335032 | USD 0.00374394〜0.00789705 |

Jev-first の最終判定、Luna 呼出し数、Luna token は production
`dispatchFocusedContextual` の end-to-end 実行で実測した。Luna-only の結果を後から
最終判定へ合成していない。推定なのは latency だけで、holdout で観測した Jev latency
に、fallback case だけ同一 case の
paired Luna-only latency を足した推定値である。別時刻のネットワーク揺らぎを含むため、
実測 end-to-end と偽らない。この小標本では generative call 削減は示したが、p50/p95
改善は示しておらず、むしろ Jev overhead 分だけ高い。Luna cost は
`AI_PRICING_VERSION=openai-public-2026-07-30-v1` の input/cached/cache-write/output
単価（USD 0.20 / 0.02 / 0.25 / 1.20 per million tokens）を使った。cache 内訳がないため、
prompt 全量 cached を下限、全量 cache-write を上限とする範囲であり、0とは扱わない。

### #335 safety regression

影響範囲の targeted regression は12 files / 214 tests green。strict bounded
projection、unknown-key rejection、stale response correlation、current-turn provenance、
protected projection、decision/approval、renderer integrity / memory、provisional の Luna
所有、Jev accepted/fallback の parser shape を含む。remote holdout / faults でも
quantity-role false accept 0、injection 3件の generic 直行、provider failure の actual
Luna fallback、unexpected output key 0を確認した。Jev response は role または
generic fallback に閉じ、preview authorization / approval / save authority を持たない。
加えて、攻撃文に対して mock Jev が高確信 `remaining` と低い補助 head を返す回帰を
固定した。その場合にも出力は exact pending workload に後段で束縛される role だけで、
approval / save / scheduler permission は付与されない。既存 injection case は
independent-meaning gate の配管回帰として区別した。

## Verification

- `npm run typecheck`: success
- `npm run test:run`: 572 files passed / 10 skipped、2,892 tests passed /
  45 skipped / 5 todo
- `npm run build`: success（2,214 modules transformed）
- #335 affected targeted regression: 12 files / 214 tests passed
- audit targeted regression（contextual Worker/dispatch、authorization、dual-target retry、
  client）: 5 files / 77 tests passed。retry 境界を限定した追試: 3 files / 43 tests passed。
  blank-purpose edge 追加後の最終 Worker 追試: 1 file / 11 tests passed
- Wrangler-generated runtime types + strict `tsc`: changed decision modules 固有 error 0。
  Worker dependency graph 全体では予約外の `materialMetadataApi.ts` 1件と
  `weeklyPlanningTraceApi.ts` 3件で nonzero。`origin/main` archive に同じ Wrangler
  4.140.0 / 同じ strict command を適用して同一4 errorsを再現したため baseline
  harness debt と分類した
- Wrangler 4.140.0 production dry-run: success、Total Upload 444.37 KiB / gzip
  90.44 KiB、`JEV_MODE="off"` / `JEV_CANARY_PERCENT="0"`、`--dry-run: exiting now.`
- `git diff --check`: success。PR 全体23 files、監査修正8 filesは予約範囲内
- `package-lock.json` / `workers/ai-proxy/wrangler.jsonc`: `origin/main` から変更なし
- 本番 deploy、secret value の読出し・出力・保存は未実施

## 現在地

- baseline: `e8a7ab48566e70aa2534ef49a405cc30ae05a3b8`
- worktree branch: `feat/issue-305-jev-first-focused-contextual`
- PR #338 current HEAD: `66a1d9e280d100aec46232feed4f659d49efe019`（監査修正の
  periodic checkpoint、CI 実行中）。blank-purpose edge とこの記録を含む最終3-file
  delta は親 commit 待ち。
- gate freeze checkpoint: parent-assisted commit/push `ba8aa38f`（upstream 設定済み）。
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
  - remote-dev initial fault probes 5件で actual Luna fallback 5/5
  - tuning-only catalog/gate 校正と最終 remote-dev tuning 30件
  - gate固定後の予備 holdout 30件（1回）と Luna-only paired baseline 30件
  - 拡張 remote fault probes 9件と #335 targeted 12 files / 214 tests
  - 監査修正: unknown-purpose 前方互換、dual-target Luna repair、harness-only stale hook、
    高確信攻撃 role の authority 境界、Luna cost range、holdout 独立性限界
- 検証済み:
  - 上記 Verification の local gate 一式
- 本番 config / secret / package-lock は未変更。

## 次の具体作業

1. 親へ監査修正8 filesの commit/pushを依頼する。
2. 更新後の PR #338 CI と再監査を terminal state まで追う。

## 未解決

- audit fix の local gate は完了。親 commit/push、更新後 CI、再監査は未実施。
- holdout は予備的・消費済みの合成30件で、うち12件は tuning 閲覧後に同じ作成者が
  追加した。false-accept 上限9.50%を超える強い主張や正式受入れには使わない。
- cache 内訳がないため Luna cost は範囲。paired latency は end-to-end 実測ではなく推定。

## Phase B Unit 0 — 2026-10-04 作業 checkpoint

- Owner: PolarWatt（統合: BronzeMaxwell、外部監査: CopperHopper）。Issue #305 を継続。
- Branch: `fix/issue305-focused-contextual-question-code`。Base / current HEAD: `5668fbfb7337b0f34bbae0ce9016765f12b60439`。既存 PR #338 は merge 済みで、子は新しい PR を作らない。
- Scope: provider-visible な質問 identity、wire / rejection regression、tuning / calibration corpus、paired harness、事前登録の準備。metrics 基盤・renderer・本番設定は対象外。
- Next: 修正基盤と評価 HOLD を分けて親へ提出する。親の exact diff review・commit / push・CI・外部監査を待つ。
- Exit: (a) 修正の基盤は focused tests / #335 / typecheck / verify と exact diff を確認して親へ提出する。(b) fresh 評価は準備のみ HOLD。owner の閾値登録・実行承認と、tuning を見ていない別作者の holdout 作成が必要。PolarWatt は holdout を作らず、有料・real API を実行しない。
- Git metadata は sandbox で編集不可。branch 改名・commit・push は親が行い、子は未 commit の diff を残す。

### 質問 identity の責務と採った設計

質問の種類を決める application envelope を唯一の入力 authority にし、Worker がそれを検証してから provider 用 state を作る。`FocusedContextualDecisionState` / `focusedContextualDecisionState` は questionCode、user text、bounded pending fields だけをコピーして freeze する。shadow と canary はこの同じ state を送り、gate も capture した identity を使う。canonical ID、owner、requestId、revision は provider に増やさない。browser 契約・off の Luna body・fallback・応答の相関は不変。

state / pending に questionCode を重複追加した入力は、値の一致にかかわらず strict validator が provider 前に拒否する。未知・malformed envelope code も拒否する。direct dispatch の non-off path にも validator を置いた。off の ingress validation は実 Worker handler のテストで確認する。catalog は `focused-contextual-answer-2026-10-04-v3` に更新し `state.questionCode` を参照する。gate の閾値・version は従来のままで、修正後の意味精度や採用を主張しない。

| 候補 | 支持証拠 / 反証条件 | 影響と判断 |
| --- | --- | --- |
| Browser state に questionCode を重複して入れる | provider の欠落は直せる。旧 client の wire contract と一致しない場合は互換性の問題になる | mismatch validation と旧 client 対応を増やす。採らない |
| 検証済み envelope から Worker が typed projection を一度作る | 同じ bounded state が二つの code で有効であることを再現。実 Worker の wire pair で context の差を確認。dispatch が projection を省く、gate が別 identity を使うなら反証 | 最小の送信変更。freeze で await 後も identity を固定。採用した基盤修正 |
| 質問別に固定 catalog を選ぶ | catalog の条件に質問 identity を埋められる。provider の choice set と gate / adapter がずれたら反証 | version / choice / evaluation adapter の同期箇所が増える。代替として成立するが今回採らない |
| Envelope 全体を provider に送る | questionCode は届くが、requestId / revision も届く | semantic 判断に不要な相関情報まで送信する。privacy 範囲を増やすため採らない |

「この解釈が誤りとなる条件」は、wire にコードが無いこと、gate / provider が違うコードを使うこと、質問コード以外にも意味解釈上の context が欠けていること。最初の二つは deterministic test で閉じた。最後の意味上の十分性は fresh な独立評価が必要であり、基盤のテストだけで証明しない。

### trace 除外契約

新しい Jev provider projection / catalog は client の diagnostic trace に保存しない。envelope と current text の重複保存を避け、既存の focused Luna prompt / structured response・requestBytes・typed route を診断に残す。provider の catalog version / gate version / input revision / requestBytes は既存の text-free decision metric/log が保持する。metrics 基盤は変更していない。

`focusedContextualTrace.test.ts` は actual Worker → 実 normalizer → trace runtime を接続し、初回 append 失敗後の persistent outbox、memory reset 後の retry、client byte bound、Worker preparation / server byte bound を通して、役割回答と代替 diagnostic が残り、provider-only の追加 projection が保存されないことを確認する。既存 prompt 内の pendingQuestion は元から diagnostic に入るので、それまで消す契約にはしない。trace schema field は増やしていない。既存の大容量 truncation gate も回帰で確認する。

### fresh 評価の準備（HOLD）

詳細は [事前登録準備](20261004-issue305-contextual-preregistration.md)。実装者の tuning / calibration は24 cases / 22 groups、label は synthetic_unreviewed、gold ではない。凍結 hash / 時刻 / 作者 / 閲覧者 / 未評価状態は来歴 JSON に残す。holdout は未作成で、独立作者へ [文面を含まない仕様](20261004-issue305-contextual-holdout-author-spec.md) だけを渡す。

paired harness は実 semantic normalizer の turn 全体を Jev-first / Luna-only で比較し、実 fetch 境界の dispatch、elapsed latency、実 usage / reported cost を計測する準備ができた。role だけでなく全 tuple / scope の review label を別 artifact で join する。未 review、欠測 usage、欠落 case / arm は NA。監査で指摘された「部分集合だけの jointCorrectness=1」は complete gate と欠測件数の出力を追加して修正した。旧 runner の欠測 token を0で合算する箇所も除去し、消費済み corpus は diagnostic only と明示した。

実 API 評価は未実行。owner の採用閾値・予算・統計手法・実行承認が未登録であり、基盤 merge と評価 / 採用を分ける。本番設定は off / 0 のまま。renderer、scheduler、save、approval、lifecycle は変更していない。

残る ingress の限界: raw JSON の重複 key は既存の `JSON.parse` の後勝ちに従う。validation・gate・provider は同じ parse 済み object の identity を使うので食い違わない。ingress で厳格に拒否するのは別の判断（親判断 ORRERY #2292）。Unit 0 の duplicate rejection は envelope と state / pending の複数 field の整合を対象とする。

### Unit 0 verification checkpoint

- `npm run typecheck`: exit 0（Wrangler 4.143.1 runtime types を再生成。初回の log path の sandbox error は生成/型検査を失敗させなかった。最終 verify は writable な log path を使う）。
- focused wire / contract / harness: 68 tests green の後、trace outbox regression 1 test と欠落分母3 tests を追加してそれぞれ green。
- #335 の影響範囲: 38 files / 443 tests、exit 0。contextual role/fallback/identity、OpenRouter redirect / bounded response、Worker authorization containment、client correlation / stale response、contextual retry / ID binding、current-turn / external / supplemental / stored provenance、numeric / Unicode、approval / renderer / memory の authority 境界、trace persistence を含む。semantic 品質や実 provider の注入耐性の証明ではない。
- 最終 `WRANGLER_LOG_PATH=/private/tmp/polarwatt-wrangler-logs WRANGLER_SEND_METRICS=false npm run verify`: exit 0（fresh app/Worker typechecks、full unit/integration、production build）。実行後は記録文書だけを更新し、code / test / config / corpus は変更していない。snapshot hash / dirty manifest / toolchain は `/Users/Shogo/.agentstack/runtime/jev-impl-reports/unit0-questioncode.md` に記録する。HEAD は base のままで、Git publication・CI・最終統合 review は親が担当する。

### Unit 0 audit repair — PR #430 / `56105689`

親が提出を `24012e47`（question identity 修正）と `56105689`（評価準備）に分けて push した後、外部監査が評価 artifact の公開 importer を BLOCK した。未知 provider を非 Luna として数え、全 dispatch が未知でも Luna 0 / free rate 1 を出す欠陥である。修正の基盤そのものへの指摘ではない。現在の作業は同じ branch / PR の監査修正であり、新しい評価は引き続き未実行・HOLD。

候補は、provider enum だけの検証、壊れた arm を unknown へ変換、artifact 全体の厳密な取り込み検証の三つ。enum だけでは欠けた hash・食い違う identity / totals が残る。unknown 変換は部分的な壊れ方を隠してしまう。実際の producer の framing と対応する strict validator を選び、不正 artifact は summary を出す前に拒否する。反証条件は、producer の正当な記録を拒否すること、未知 dispatch が rate に入ること、missing usage / pair / arm の分母が縮むこと。実 producer と mock fetch で作った artifact を CLI に渡して確認する。

`jev-contextual-paired-artifact.mjs` は framing、corpus / runtime / policy hash、case / group / arm / question / catalog / gate の identity、boolean completeness、provider / status / usage、semantic result の framing、review 来歴を検証する。Luna 回数と usage total は検証済み dispatch と照合し、欠測は null のままにする。semantic document の意味正解を importer が判定するわけではない。joint label と独立性の証拠は引き続き owner / reviewer の責務である。

新 producer は `jev-contextual-paired-v1` を付ける。旧 producer の version key だけが無い完全な framing も `legacy_unversioned_v0` と明示して扱う。過去の runtime / policy hash は現在の checkout と一致しなくてもよいが、64文字の hash と来歴が必要で、現在の fingerprint から補完しない。cached summary は信用せず、検証済み records から再計算する。登録 case / arm が欠けた artifact は `incomplete_HOLD` のまま、全分母と NA を保持する。

この差分も未 commit のまま親に渡す。最終 focused / typecheck / verify と exact HEAD / content hash は audit repair の報告書へ記録する。PR の更新、外部監査、CI、merge は親が継続する。

修正後の verification: exact HEAD `561056895a88b12c4094dfcf274d75924bab8ffa` + 未 commit の5 files。focused 5 files / 110 tests、`npm run typecheck`、最終 `WRANGLER_LOG_PATH=/private/tmp/polarwatt-wrangler-logs WRANGLER_SEND_METRICS=false npm run verify` がすべて exit 0（641 files / 4195 tests pass、45 skipped / 1 todo、fresh app/Worker typechecks・production build pass）。監査の元 artifact は CLI exit 1 / stdout 0 bytes。既定の offline runner は HOLD / providerCalls 0。verify 後はこの Markdown の記録だけを更新した。差分 hash / 5 files の inventory / ログの pointer は `/Users/Shogo/.agentstack/runtime/jev-impl-reports/unit0-ingestion-repair.md` に記録する。

その後の親依頼 ORRERY #2307 により、CopperHopper（gpt-6-astra、再現 fixture の生成と harness 外部監査）の corpus 閲覧を来歴に追加した。BronzeMaxwell が review 中に diff を作成・保存した範囲は、文面の未読と区別して記録した。独立作者の仕様は PolarWatt / CopperHopper / corpus を見た全 agent を除外する。runner も既知の二名を拒否し、それ以外の tuningExposure=false の真実性は owner が確認する。provenance JSON は corpus hash の入力に含まれず、凍結 corpus 自体の hash は変えていない。追加変更後の最終検証は別途実施する。

追加変更後の最終 verification: 同じ HEAD + 未 commit の7 files。focused 5 files / 111 tests、fresh app/Worker typechecks を含む `npm run verify` が exit 0（641 files / 4196 tests pass、45 skipped / 1 todo、production build pass）。verify 後はこの記録文書だけを追記した。corpus SHA-256 は `75e2cbbfc962b7c93647bf0c1197860bc94e1e70de9e62f99412ad722cfa22ba` のままであり、runner の hash 入力は corpus JSON の bytes だけである。親が commit / push / 外部監査 / CI を継続し、fresh 評価は未実行・HOLD のまま。
