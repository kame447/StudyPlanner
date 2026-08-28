# Product Observability Roadmap

Status: canonical execution order
Updated: 2026-08-28
Owning Issue: #213

## Current phase

Phase 1「Canonical design」、Phase 2「Telemetry foundation」、Phase 3「Aggregation and read models」は完了済みである。Phase 3の初回実装はPR #220、post-merge adversarial auditで見つかったcorrectness / recovery / bounded-read / registration / Rules verificationのhardeningはPR #222でmainへ統合した。

PR #222のmerged main commit `4d57ce510251005c636a707bd8ee4a058cf75a06` を対象に七視点再監査を行い、TypeScript、full Vitest、Firestore Rules regression、production build、Browser Regression、UI Quality Automation、UI Regression Matrixがterminal successとなった。監査済みPRとの差分一致も確認し、Phase 3 completionを確定した。

現在の次phaseはPhase 4「Console shell and Overview」である。管理UIを先に作ってread modelの不足をUI側集計で埋めず、Phase 3で確定したsource of truthとbounded query contractだけを利用して実装する。

## Completed foundation

### Phase 1: Canonical design

Status: completed by PR #215.

Canonical owner:

- `../README.md`
- `../spec/console-requirements.md`
- `../architecture/telemetry-and-read-model.md`

product-observability / weekly-planning / reporting / client-runtime の責務境界、privacy / retention、metric semantics、read-only admin boundaryを確定した。

### Phase 2: Telemetry foundation

Status: completed by PR #216 - #219.

PR #216 で typed telemetry contract、authenticated ingestion、opaque actor identity、idempotent persistence、retention、failure isolationを導入した。

PR #217 で production AI proxy request / outcome metricをdurable化した。

PR #218 でproviderが実際に返したtoken usage、cached/cache-write usage、versioned pricing boundaryを導入した。未知値は0へ補完せず、算出不能なcostは`null`として保持する。

PR #219 でweekly-planning application layerが決定したtyped planning outcomeをanalyticsへprojectionした。trace本文やUI表示からplanning truthを再推論しない。

## Phase 3: Aggregation and read models

Status: completed by PR #220 and hardening PR #222.

実装済みの主要責務は、actor-day presence、daily service / AI usage / planning quality rollup、pseudonymous user summary、mergeable latency histogram、rollup checkpoint、authenticated bounded admin read endpoint、typed browser query serviceである。

post-merge adversarial auditで、rolling active-userのnormal read cost、snapshot recovery / environment isolation / revision race、runtime read validation、登録ユーザーread model、profile registration timestamp authority、Firestore Rules回帰検証を追加でhardeningした。

登録ユーザー総数と期間内新規登録者はactivity telemetryから推測せず、profile registration authorityをserver-side COUNT aggregationで読む。新規profileのcanonical `registeredAt`はFirestore server timestampで作成し、作成後は利用者から変更できない。legacy profileはbounded service-account backfillを行い、移行が不完全な間の新規登録数は0ではなくunknownとする。

completion gateとして次を確認済みである。

- rolling active userが日次countの単純加算ではなくdistinct actor unionで定義される
- user summaryとdaily rollupがraw Firebase UID / email / prompt / user textを保持しない
- late eventを`occurredAt`の日付へ正しく反映できる
- malformed eventや失敗したrollupでcheckpointを不正に進めない
- transaction retryで二重加算しない
- p50 / p95をdaily percentileの平均から作らない
- observability failureがproduct operationのauthorityを変えない
- retentionとread-model lifecycleがboundedな運用契約になっている
- admin read pathがraw telemetry / actor-day / profile本文を通常時に全件scanしない
- 登録ユーザーをfirst activityで代用せず、profile authorityからbounded readする
- registration timestampがclientから偽造・事後変更できず、legacy backfill不完全時に新規登録数を0へ補完しない
- Firebase Emulator Suiteでprofile registrationのSecurity Rules契約を実動検証する
- exact merged mainでTypeScript、full Vitest、Firestore Rules regression、production build、Browser Regression、UI Quality Automation、UI Regression Matrixを通す
- 七視点監査でBLOCKER / MAJORが0件である

Completion PR: #222
Merged main commit: `4d57ce510251005c636a707bd8ee4a058cf75a06`

Phase 3は完了しており、Phase 4 UIの開始条件を満たしている。

## Phase 4: Console shell and Overview

次の実装phaseとしてnavigation shellとOverviewを実装する。

Overviewでは、登録ユーザー、今日利用したユーザー、過去7日 / 30日利用、主要product activity、AI/API、planning quality、read-model freshnessを一画面から把握できるようにする。

`WAU`等の略語だけを主表示にせず、「過去7日間に利用したユーザー」のような意味を主表示にする。

UI component内で再集計せず、Phase 3のtyped admin queryだけを利用する。

## Phase 5: Users and AI / API

Usersでは全体trend、検索、filter、個別timeline、user → session → request / trace drill-downを実装する。

AI / APIではmodel / purpose / phase別request、token、failure、latency、推定費用を表示する。

AI/API usage・原価の細部残件は Issue #160 を #213 配下のtrackerとして扱う。reasoning token等、providerが返す追加usageは推測値で補完せずraw factとして保持する。

## Phase 6: Planning Analytics

weekly-planning typed outcomeからsession funnelと品質指標を作る。

preview / approval / save / failed / fallback / repair / stale / unscheduled等を期間・version別に比較できるようにする。

`abandoned`はruntime上の一意なauthorityが定義されるまで発火させない。

## Phase 7: Log Explorer and Debug Bundle

feature-owned diagnostic adapterを共通Log Explorerへ接続する。

詳細traceはrestricted diagnostic layerのまま扱い、analytics sourceへ昇格させない。

Debug Bundleはbounded / versioned / redactedなJSONとして生成する。

## Phase 8: System and legacy removal

telemetry ingestion、rollup freshness、AI proxy等のsystem statusを統合する。

新consoleのread pathが十分検証された後、不要になったbrowser-side full collection scanやduplicate admin aggregationを削除する。

legacy pathを恒久fallbackとして残さない。

## Pull request policy

Issue #213をparentとして、各phaseをreviewableなrelease unitへ分ける。同じ失敗やretryを理由にreplacement Issue / branch / PRを増殖させない。

各PRはmerge前にcanonical roadmapのcurrent checkpointと次のconcrete actionを更新する。

完了済みPRのhead branchはmerge後に削除し、repositoryにはmain、active branch、明示的に正当化されたlong-lived branchだけを残す。
