# Phase 3 Seven-View Audit

Status: merged-main PASS; Phase 3 complete
Date: 2026-08-28
Owning Issue: #213
Completed PR: #222
Target: Phase 3 product-observability telemetry aggregation and bounded admin read models

この文書はcanonicalなmetric semanticsやarchitectureを再定義しない。正仕様は`../spec/console-requirements.md`と`../architecture/telemetry-and-read-model.md`、実行順序は`../roadmap/current.md`を参照する。本書はPhase 4 UIへ進む前の敵対的検証記録である。

## Exit rule

7視点すべてでBLOCKER / MAJORが0件となり、PR #222のexact final HEADでTypeScript、full Vitest、Firestore Rules regression、production build、PR diff check、Browser Regression、UI Quality Automation、UI Regression Matrixがterminal successになった場合のみpre-merge PASSとする。

その後PR #222をmainへmergeし、exact merged mainを再監査して同じ責務・契約・data invariantが保たれ、主要CI / browser gateがterminal successであることを確認した時点でPhase 3を完了とする。

## Verified implementation candidate

実装差分を最後に変更したcandidate HEAD `abc23292236fb2ceecb41948fff3ff3f157d54b5` では、次がすべてterminal successとなった。

- TypeScript
- full Vitest: 440 files passed / 1982 tests passed
- Firebase Auth + Firestore EmulatorによるFirestore Rules regression
- production build
- PR diff check
- Browser Regression
- UI Quality Automation
- UI Regression Matrix

Rules regressionの初回失敗はAuth Emulator未設定によるharness configuration defectであり、production defectではなかった。Auth / Firestore emulatorを明示設定して再実行し、server timestamp付きprofile作成、通常owner update、偽timestamp拒否、registration timestamp事後変更拒否、cross-user update拒否を実Rules engineで確認した。

監査記録確定後のPR exact HEAD `3a565a0a921f73bdbcaf04b7b8a5df214c23d062` でも、draft解除後に再トリガーされたCIを含めて必要gateがgreenであることを確認した。

## Merged-main re-audit

PR #222はsquash mergeされ、merged main commitは `4d57ce510251005c636a707bd8ee4a058cf75a06` となった。

このcommitを対象に次を再確認した。

- parent `9ad6be8d6dacb6d0a0b4a0ac8bb6dca9383a92ed` との差分は、監査済みPR #222と同じ27 files / 同じ変更内容であり、merge時の追加差分はない。
- CI: TypeScript、full Vitest、Firebase Auth + Firestore Emulator Rules regression、production buildがsuccess。
- Browser Regression: Chromium regressionがsuccess。
- UI Quality Automation: bundle budget / browser qualityがsuccess。
- UI Regression Matrix: visual regression / cross-browser smokeがsuccess。
- review threadは0件で、merge前の未解決review指摘はなかった。

同SHA上で発生した`QA Result Summary`のfailureは、別branchのQA workflow resultを既存PRへcommentするnotification処理がGitHub App権限403になったものであり、Phase 3 production code / merged-main verification failureではないと分類した。この集約workflowの権限問題はPhase 3 completion gateとは分離する。

Merged-main re-audit result: PASS.

## 1. Responsibility / architecture boundary

Status: PASS

確認事項:

- analytics failureはplanner save / weekly-planning authorityへ昇格しない。
- weekly-planningのsemantic / scheduler / approval truthをtrace本文から再推論しない。
- active-user rolling window計算はserver-side scheduled projectionが所有し、UI / browser serviceへ集計責務を置かない。
- 登録ユーザー数はactivity telemetryから推測せず、profile registration authorityからbounded server-side aggregateとして読む。
- admin Overviewはraw telemetry / actor-day membership / profiles本文を通常read pathでscanしない。

発見済み問題:

- PR #220時点のOverviewがrolling distinct actor計算のためactor-dayをread時に走査していた。
- canonical Overview要件の「登録ユーザー総数 / 新規登録者」がPhase 3 read modelに欠落していた。`firstActivity`で代用すると登録と利用を混同し、UI側profile全件scanで補うとarchitecture invariantを破る状態だった。

修正:

- `observability_active_user_windows`へtoday / rolling 7-day / rolling 30-day exact distinct snapshotをmaterializeし、Overviewはbounded direct readだけを行う。
- profileを登録事実のauthorityとして維持し、Firestore server-side COUNT aggregationで総登録数 / 期間内新規登録数を取得する。登録日時が未移行の場合は新規登録数を0へ補完せず`null`とする。

## 2. Existing contracts / types / callers

Status: PASS

確認事項:

- browser admin serviceはshared `ObservabilityOverviewReadModel`を利用し、旧`distinctActiveActors`を独自に参照しない。
- `registeredUsers`は`activeUsers`と別contractであり、scopeを`firebase_project`として明示する。
- environmentはproduction / preview / development / testのtyped setだけを受け付ける。
- malformed checkpoint、wrong read-model version、corrupt daily rollup、corrupt user summaryを型castだけで通さない。
- user-summary cursorはexpected collection / actor identityと整合するものだけを受け付ける。

発見済み問題:

- admin environmentのtypoがproductionへ黙ってfallbackしていた。
- read-model corruptionまでHTTP 400のclient validation errorとして分類していた。
- Firestore read modelをruntime validationなしでcastしていた。
- legacy profileの`createdAt`にはFirebase Auth由来のRFC形式とISO形式が混在し得るため、文字列range queryを登録時刻authorityとして使用できなかった。

修正:

- invalid environmentを400 `observability_environment_invalid`で拒否する。
- storage / schema integrity failureは503として扱う。
- daily rollup / user summary / checkpoint / active-user snapshotをread時にfail closedで検証する。
- canonical registration fieldをFirestore timestamp `registeredAt`とし、Asia/Tokyoの期間境界をUTC timestampへ変換したaggregate queryだけを使う。

## 3. State / data invariants

Status: PASS

確認事項:

- duplicate telemetry deliveryでaggregateを二重加算しない。
- rollup projectionとcursor advanceを同一transactionでcommitする。
- late eventは`occurredAt`のreporting dayへ反映する。
- `observedAt + documentName` cursorには5分settle lagを置く。
- unknown token / costは0へ補完しない。
- latency histogram versionを混在mergeしない。
- production / preview / development / testを分離する。
- stale active-user snapshotは最新値のように表示せず`null`とする。
- registration backfillが未完了 / legacy timestamp不正の場合、期間内新規登録数はunknownを維持する。

発見済み問題:

- snapshot refresh失敗後、rollup cursorだけ進むと古いsnapshotが永久に残り得た。
- dirty stateを日付だけで持つと環境間でrepairを消せた。
- snapshot repair中に同じenvironment/dateへ新actorが追加されると、古いrepairが新しいdirty stateをclearできるraceがあった。
- unknown environment文字列が任意のread-model collection名へprojectionされ得た。
- registration backfill checkpointの破損cursorをnullへ落とすと先頭から再走査でき、診断countを二重加算し得た。
- non-string legacy `createdAt`から誤ったordered cursorを生成できた。

修正:

- checkpointへenvironment/date/revision付きdirty sourceを永続化する。
- snapshot成功後も、読み取ったrevisionとcurrent revisionが一致するときだけdirty sourceをclearする。
- unknown environment eventをrollupでrejectする。
- dirty sourceがsnapshotの30-day windowに影響する場合、Overviewはそのactive-user snapshotを返さない。
- registration backfill checkpoint / ordered profileをfail closedで検証し、異常値ではcheckpointを進めない。
- Overview readinessはbackfill checkpointを信用せず、profile総数とcanonical `registeredAt`を持つprofile数のserver-side COUNT parityで判定する。

## 4. UI / browser impact

Status: PASS

確認事項:

- PR #222はadmin UI component / navigation / stylesを変更しない。
- UI Phase 4開始前のinternal hardeningとして限定する。
- typed browser query serviceはserver read modelを受け取るだけで、actor-day / profileをscan・aggregateしない。
- `registeredUsers.scope = firebase_project`により、observability environment filterとFirebase project全体の登録数を同一概念として誤解しないcontractにする。
- merged mainでBrowser Regression、UI Quality Automation、UI Regression Matrixがgreenである。

## 5. Tests / harness

Status: PASS

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
- Firestore COUNT aggregation request shape / timestamp filter / invalid resultを検証する。
- registered userの総数 / Asia-Tokyo境界 / backfill未完了時unknownを検証する。
- registration backfillのbounded paging、legacy timestamp normalization、malformed stateのfail-closedを検証する。
- Firebase Emulator Suiteでprofile作成時server timestamp必須、偽timestamp拒否、作成後のregistration timestamp改変拒否、通常profile更新維持、cross-user更新拒否を実Rules engineで検証する。

CI harness finding:

- Firestore Rules regression初回導入時、`firebase.json`にAuth Emulator設定がなくFirestoreだけ起動したため`auth/network-request-failed`となった。production defectではなくharness configuration defectと分類した。
- Auth / Firestore emulator portsを明示し、再実行でRules regressionがsuccessになった。

原則:

- regression assertionをgreen化のために弱めていない。
- fixtureもproduction invariantを満たす形にしている。

## 6. Security / dependencies / observability

Status: PASS with deferred account-deletion condition

確認事項:

- active-user snapshotはcount / environment / date / freshnessだけを保存し、actor ID集合を永続化しない。
- raw Firebase UID、email、prompt、user textをaggregateへ追加しない。
- admin readはFirebase authentication + `admins/{uid}.enabled`のserver-side確認を通す。
- CORSはallowlist originだけを許可する。
- invalid environmentをproductionへfallbackしない。
- registration timestampをclient-controlled analytics authorityにしない。
- new profileの`registeredAt`はFirestore `serverTimestamp()`で作成し、Rulesで`registeredAt == request.time`を要求する。
- profile作成後はowner updateでも`registeredAt`を変更可能fieldに含めない。
- legacy profile backfillはservice account boundaryだけから実行する。
- application dependency追加なし。
- `npm ci`時のapplication dependency auditは0 vulnerabilitiesだった。
- telemetry / snapshot / registration backfill failureはproduct operation authorityを変更しない。

発見済み問題:

- 初期案のclient-written `registeredAtIso`は既存profile update rulesと非互換で、かつ利用者が登録日時を改ざん可能なauthorityになっていた。

修正:

- client-written analytics timestamp案を破棄し、server timestamp + immutable-after-create rules + service-account legacy backfillへ変更した。

Deferred condition:

- canonical architectureはaccount deletion時にrestricted actor directory mappingを失効させることを要求する。現行StudyPlannerには正式なaccount deletion runtimeがないため、本PRでは架空の削除経路を追加しない。将来account deletion実装時の必須連動条件とする。

## 7. Git / operations / documentation

Status: PASS for merged-main state

確認事項:

- parent Issue #213を再利用した。
- #220 merge後に実害のあるpost-merge findingが出たため、follow-up branch `fix/product-observability-phase3-audit` / PR #222を作成した。replacement Issue / retry PRは増殖させていない。
- merge前、branchはmainに対して0 behindだった。
- PR #222はexact HEAD `3a565a0a921f73bdbcaf04b7b8a5df214c23d062` からsquash mergeした。
- merged main commit `4d57ce510251005c636a707bd8ee4a058cf75a06` のdiffは監査済みPR差分と一致した。
- canonical roadmap、domain README、registered-user authority / migration / unknown semanticsをcurrent stateへ同期する。
- PR本文へclient/workerをFirestore Rulesより先にdeployするrollout constraintを記録した。
- review thread / submitted reviewは0件で、未解決review指摘はなかった。

Branch lifecycle note:

- merged head branch `fix/product-observability-phase3-audit` はcleanup対象である。ただしbranch deletionは破壊操作のため、本監査では削除せず明示的な削除権限に従う。

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
10. canonical Overviewで登録ユーザー総数 / 新規登録者read modelが欠落
11. client-written registration timestampによるSecurity Rules非互換と改ざん可能なanalytics authority
12. registration backfill checkpoint / cursorのfail-open recovery
13. Firestore Rules regressionがCIで未検証だったこと

Current actionable production failures: 0.
Current unresolved BLOCKER / MAJOR: 0.

Pre-merge audit result: PASS.
Merged-main re-audit result: PASS.

Final result: Phase 3 complete. Phase 4 Console shell / Overview may begin using the bounded typed admin read model as its only analytics source of truth.
