# Phase 3 Seven-View Audit

Status: active verification record
Date: 2026-08-28
Owning Issue: #213
Active PR: #222
Target: Phase 3 product-observability telemetry aggregation and bounded admin read models

この文書はcanonicalなmetric semanticsやarchitectureを再定義しない。正仕様は`../spec/console-requirements.md`と`../architecture/telemetry-and-read-model.md`、実行順序は`../roadmap/current.md`を参照する。本書はPhase 4 UIへ進む前の敵対的検証記録である。

## Exit rule

7視点すべてでBLOCKER / MAJORが0件となり、PR #222のexact final HEADでTypeScript、full Vitest、production build、PR diff check、Browser Regression、UI Quality Automation、UI Regression Matrixが必要な範囲でterminal successになった場合のみPASSとする。

PASS後もPR #222をmainへmergeしたexact merged mainを再監査し、そこで新しいBLOCKER / MAJORが出た場合はPhase 4へ進まない。

## 1. Responsibility / architecture boundary

Provisional status: PASS

確認事項:

- analytics failureはplanner save / weekly-planning authorityへ昇格しない。
- weekly-planningのsemantic / scheduler / approval truthをtrace本文から再推論しない。
- active-user rolling window計算はserver-side scheduled projectionが所有し、UI / browser serviceへ集計責務を置かない。
- admin Overviewはraw telemetry / actor-day membershipを通常read pathでscanしない。

発見済み問題:

- PR #220時点のOverviewがrolling distinct actor計算のためactor-dayをread時に走査していた。

修正:

- `observability_active_user_windows`へtoday / rolling 7-day / rolling 30-day exact distinct snapshotをmaterializeし、Overviewはbounded direct readだけを行う。

## 2. Existing contracts / types / callers

Provisional status: PASS pending final TypeScript

確認事項:

- browser admin serviceはshared `ObservabilityOverviewReadModel`を利用し、旧`distinctActiveActors`を独自に参照しない。
- environmentはproduction / preview / development / testのtyped setだけを受け付ける。
- malformed checkpoint、wrong read-model version、corrupt daily rollup、corrupt user summaryを型castだけで通さない。
- user-summary cursorはexpected collection / actor identityと整合するものだけを受け付ける。

発見済み問題:

- admin environmentのtypoがproductionへ黙ってfallbackしていた。
- read-model corruptionまでHTTP 400のclient validation errorとして分類していた。
- Firestore read modelをruntime validationなしでcastしていた。

修正:

- invalid environmentを400 `observability_environment_invalid`で拒否する。
- storage / schema integrity failureは503として扱う。
- daily rollup / user summary / checkpoint / active-user snapshotをread時にfail closedで検証する。

## 3. State / data invariants

Provisional status: PASS pending final tests

確認事項:

- duplicate telemetry deliveryでaggregateを二重加算しない。
- rollup projectionとcursor advanceを同一transactionでcommitする。
- late eventは`occurredAt`のreporting dayへ反映する。
- `observedAt + documentName` cursorには5分settle lagを置く。
- unknown token / costは0へ補完しない。
- latency histogram versionを混在mergeしない。
- production / preview / development / testを分離する。
- stale active-user snapshotは最新値のように表示せず`null`とする。

発見済み問題:

- snapshot refresh失敗後、rollup cursorだけ進むと古いsnapshotが永久に残り得た。
- dirty stateを日付だけで持つと環境間でrepairを消せた。
- snapshot repair中に同じenvironment/dateへ新actorが追加されると、古いrepairが新しいdirty stateをclearできるraceがあった。
- unknown environment文字列が任意のread-model collection名へprojectionされ得た。

修正:

- checkpointへenvironment/date/revision付きdirty sourceを永続化する。
- snapshot成功後も、読み取ったrevisionとcurrent revisionが一致するときだけdirty sourceをclearする。
- unknown environment eventをrollupでrejectする。
- dirty sourceがsnapshotの30-day windowに影響する場合、Overviewはそのactive-user snapshotを返さない。

## 4. UI / browser impact

Provisional status: PASS pending browser workflows

確認事項:

- PR #222はadmin UI component / navigation / stylesを変更しない。
- UI Phase 4開始前のinternal hardeningとして限定する。
- typed browser query serviceはserver read modelを受け取るだけで、actor-dayをscan / aggregateしない。

残条件:

- Browser Regression / UI Quality Automation / UI Regression Matrixのexact final HEAD確認。

## 5. Tests / harness

Provisional status: PASS pending CI

追加・強化した回帰:

- exact today / 7-day / 30-day distinct actor count。
- overlapping historical snapshot repairで同じactor-day日付を重複scanしない。
- environment isolation。
- missing snapshot時にraw membershipへfallbackしない。
- dirty snapshotを表示しない。
- preview-only dirty sourceでproduction snapshotを無効化しない。
- old dirty revisionのclearでnew revisionを消さない。
- poison environmentをrejectする。
- malformed checkpoint / incompatible schemaをfail closedにする。
- corrupt daily rollup / user summary / forged cursorをrejectする。
- retention対象にactive-user snapshotを含める。

原則:

- regression assertionをgreen化のために弱めない。
- fixtureもproduction invariantを満たす形にする。

## 6. Security / dependencies / observability

Provisional status: PASS with deferred account-deletion condition

確認事項:

- active-user snapshotはcount / environment / date / freshnessだけを保存し、actor ID集合を永続化しない。
- raw Firebase UID、email、prompt、user textをaggregateへ追加しない。
- admin readはFirebase authentication + `admins/{uid}.enabled`のserver-side確認を通す。
- CORSはallowlist originだけを許可する。
- invalid environmentをproductionへfallbackしない。
- dependency追加なし。
- telemetry / snapshot failureはproduct operation authorityを変更しない。

Deferred condition:

- canonical architectureはaccount deletion時にrestricted actor directory mappingを失効させることを要求する。現行StudyPlannerには正式なaccount deletion runtimeがないため、本PRでは架空の削除経路を追加しない。将来account deletion実装時の必須連動条件とする。

## 7. Git / operations / documentation

Provisional status: PASS pending final checkpoint

確認事項:

- parent Issue #213を再利用した。
- #220 merge後に実害のあるpost-merge findingが出たため、follow-up branch `fix/product-observability-phase3-audit` / PR #222を作成した。replacement Issue / retry PRは増殖させていない。
- branchはcurrent mainへ追随済みであることをmerge前に再確認する。
- canonical roadmapをPhase 3 audit状態へ同期する。
- domain READMEのPhase 1時点の古いimplementation statusを現在状態へ同期する。
- merge後にexact mainを七視点再監査する。

## Current audit result

BLOCKER: 0

MAJOR found and fixed during audit:

1. normal Overview read pathのactor-day full membership scan
2. snapshot refresh failure後のpermanent stale risk
3. environment-unscoped dirty repair
4. stale repairがnewer dirty workをclearできるrevision race
5. unknown environment projection
6. admin environment typoのproduction fallback
7. read-model corruptionのclient-error誤分類 / fail-open parsing
8. overlapping snapshot repairsの重複actor-day scans
9. domain entry documentationのstaleness

Final result: PENDING exact final HEAD CI and merged-main re-audit.
