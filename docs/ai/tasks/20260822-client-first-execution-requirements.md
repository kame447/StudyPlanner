# StudyPlanner Client-First Execution 要件定義書

Status: canonical requirements baseline / implementation not started
Priority: Architecture P1
Created: 2026-08-22
Updated: 2026-08-22
Tracking: Issue #164
Baseline main: `8ab7cc292032a01eea2c1603b3bef3d43e262ec1`
Related: #47, #51, #45, #52, #89, #128, #152, #160, #163

## 0. 文書統制と Source of Truth

本書は Issue #164「クライアントファースト実行への移行可能性を監査し、決定論的ロジックを端末側へ寄せる」の要件定義における正仕様である。

Issue 本文は目的・背景・進捗管理の要約として扱い、要件、責務境界、受入条件、非機能要件、移行判定、WASM 採否、完了判定について本書と矛盾する場合は本書を優先する。

`PROJECT_MAP.md` は探索用 architecture index、`docs/ai/strategy/weekly-planning-roadmap.md` は週間計画の実行順序、各既存 task は個別 scope の正本である。本書はそれらを上書きして別実装を作る文書ではない。既存 scope と重なる場合は既存 owner を再利用し、責務を二重化しない。

本書を変更する場合は、同一 PR で少なくとも以下を同期する。

- 本書の `Updated` と変更履歴
- Issue #164 の Source of Truth 記述
- 影響する architecture / roadmap / task
- 影響する requirement ID のテストまたは verification plan

要件を満たせない実装上の都合を理由に、暗黙に要件を弱めてはならない。要件変更が必要な場合は、理由、代替案、リスク、採用判断を記録した上で本書を先に変更する。

## 1. Executive Summary

StudyPlanner は「すべてをクライアントへ移す」ことを目標にしない。

目標は次の三層を明確に分離することである。

```text
Client-first execution
  deterministic application logic
  local working state
  optimistic UI
  offline-capable read / allowed writes
  scheduling / validation / preview / analysis

Server authority and synchronization
  authentication / authorization
  shared canonical commit
  multi-device conflict control
  idempotency / ownership / account lifecycle
  trace retention and privileged policy

AI gateway
  provider credential protection
  quota / policy / observability
  semantic interpretation / repair / rendering requests
```

「どこで計算するか」と「どこを共有状態の正本にするか」を混同しない。

決定論的な計算は可能な限り端末で実行する。一方、複数端末で共有される確定状態、権限、一意性、秘密情報、監査可能性が必要な処理は server authority を維持する。

WASM は目標ではなく最適化手段である。TypeScript、Web Worker、データ構造改善で十分な処理を WASM 化しない。実測で明確な利益が証明された処理だけを候補とする。

## 2. 現行 main の確認済み事実

本要件は baseline main `8ab7cc292032a01eea2c1603b3bef3d43e262ec1` を調査した上で定義する。

### 2.1 すでに client 実行されている責務

週間計画 scheduler は `src/features/weeklyPlanning/semantic/weeklyPlanningStableV5PlacementEngine.ts` を中心とする純粋な TypeScript 実装であり、`GenericSchedulerInput`、Fact Graph、予定、時間割等を入力としてブラウザ内で候補を生成している。

Fact Graph、validation / canonicalization、progress projection、readiness、dialogue decision、preview lifecycle の主要部分も `src/features/weeklyPlanning/` 内の application / semantic / planning / scheduling / preview 層で実行されている。

したがって本件は、既存の client execution を server から「移植する」だけの作業ではない。すでに成立している責務境界を正式な architecture contract として固定し、保存・同期・offline・権限境界を完成させる作業である。

### 2.2 現行 local persistence

`src/features/weeklyPlanning/weeklyPlanningOwnedStorage.ts` は週間計画の owner-bound state、active session index、Stable V5 session を `window.localStorage` へ保存・復元する。

owner mismatch、invalid payload、active session recovery 等の防御は存在するが、localStorage は transaction、容量、複数 record atomicity、structured query、offline mutation queue の正本としては使用しない。

### 2.3 現行 cloud persistence

`src/repositories/` は repository contract を持ち、Firebase が有効な通常環境では `firebasePlannerRepository` / `firebaseAuthRepository` を使用する。local repository fallback は development / localhost 系に限定されている。

`src/lib/firebaseClient.ts` は Firestore を `initializeFirestore` で初期化しているが、baseline main では persistent local cache / IndexedDB persistence を明示的に構成していない。

### 2.4 現行 AI boundary

`src/services/ai/openAiCompatibleClient.ts` は本番想定経路で Firebase ID token を付けて Cloudflare AI proxy を呼ぶ。AI provider credential は proxy 側に置く構成である。

同 client には direct provider transport も存在するため、本要件では production と明示的な development / evaluation を分離し、production bundle / runtime に provider secret を要求しないことを hard requirement とする。

### 2.5 現行 server-authoritative operation

週間計画 approval は既存 task `20260731-weekly-planning-approval-operational-rollout.md` において deterministic Plan ID、server transaction idempotency、operation/item ledger、owner/session/preview revision binding まで実装・自動検証済みである。

本件でこの一意性契約を client-only へ戻してはならない。

### 2.6 既存 cloud session 方針

`20260731-weekly-planning-synced-conversation-session-store.md` は conversation / Fact Graph / preview / draft / pending question を cloud authoritative revision へ同期する方針を持つ。

本件はこの方針と矛盾しない。端末は working replica と計算主体、cloud は共有 commit の authority として扱う。

## 3. 背景と解決すべき問題

現状は client 側に多くの deterministic logic が存在する一方、local persistence、cloud repository、週間計画 session、approval ledger、trace、AI proxy が別々に進化している。

このまま feature 単位で個別最適化すると、以下の失敗が起こり得る。

- client で計算済みなのに不要な server round-trip を増やす
- localStorage と cloud state のどちらが正しいか不明になる
- reload / offline / multi-tab / multi-device で state が分裂する
- server-authoritative であるべき処理を client result だけで確定する
- Firebase offline cache と独自 IndexedDB queue を無計画に二重化する
- UI state、working state、shared committed state、trace を同一 revision と誤認する
- WASM 導入自体が目的化し、bundle、debug、test、運用コストが増える
- 新旧 storage を長期間 dual-write し、どちらが正本か不明になる

本要件はこれらを防ぐため、execution、persistence、synchronization、authority、migration の契約を先に固定する。

## 4. Business / Product Goals

### GOAL-001: Local-first responsiveness

AI 呼出し、認証、共有 commit 等を必要としない deterministic 操作は、正常ネットワークの有無に依存せず端末上で完了できること。

### GOAL-002: One owner per decision

同じ意味・状態・一意性判断を client と server で独立再実装しない。client が所有する deterministic decision と server が所有する authority decision を requirement ID 単位で一意にする。

### GOAL-003: Shared-state consistency

別端末・別tab・reload・一時的offline・response loss が発生しても、共有対象データが無言の last-write-wins や duplicate commit で壊れないこと。

### GOAL-004: Offline degradation

offline 時に利用可能な機能と利用不可な機能を明確に分離し、利用不可機能を成功したように表示しないこと。

### GOAL-005: Secret isolation

AI provider secret、privileged admin secret、server signing secret を client artifact / local persistence へ置かないこと。

### GOAL-006: Evidence-based WASM

WASM 導入は定量 benchmark と maintenance cost を通過した場合だけ行い、全面 rewrite を禁止すること。

### GOAL-007: Migration without user-visible data loss

既存利用者の予定、教材、時間割、週間計画stateを、storage方式変更のために消失・重複・別account混入させないこと。

## 5. Success Metrics

本件は「実装した」ではなく以下の観測可能な結果で評価する。

| Metric | Target |
| --- | --- |
| deterministic operation unnecessary network calls | 0 new round-trips |
| offline -> reload -> reconnect data loss in regression suite | 0 |
| duplicate semantic commit under 100 retries | 0 |
| silent last-write-wins for undefined conflict policy | 0 |
| production provider secret in client artifact/local persistence | 0 |
| scheduler p95 on reference benchmark | <= 250 ms target |
| general deterministic app result p95 | <= 100 ms |
| local hydration p95 on reference dataset | <= 500 ms target |
| post-migration p95/heap/gzip regression without approved ADR | <= 10% |
| WASM adoption without benchmark gate | 0 |

Performance target が baseline main ですでに未達の場合は、未達を隠して要件を削除しない。baseline、原因、改善計画を記録し、少なくとも migration による追加悪化を禁止する。

## 6. Stakeholders / Decision Rights

### Product owner

利用者体験、offline時の見せ方、競合解決UX、scope優先順位を決定する。

### Application architecture owner

client/server responsibility、repository contract、sync state machine、migration、dependency direction を所有する。

### Security / privacy owner

credential boundary、authorization、trace/privacy、account lifecycle、local sensitive data policy を承認する。

### AI subsystem owner

semantic meaning、repair、rendererとAI gatewayの境界を所有する。offline fallback のために legacy raw-text parser を復活させない。

### Verification owner

unit test green と production verification を混同せず、requirement ID と evidence を結び付ける。

一人の開発者が複数 role を兼任してもよいが、判断責務そのものを混同しない。

## 7. 非目標

本件では以下を目的にしない。

- React / TypeScript 全体の Rust 化
- UI framework の置換
- Firebase の無条件な廃止
- server persistence の廃止
- AI API の production client 直接呼出し
- approval / save の server idempotency 廃止
- trace privacy / personalization の既存独立 task を一つへ統合
- UI redesign
- AI prompt / semantic quality の再設計
- offline 中の AI semantic interpretation を擬似 deterministic parser で代替

## 8. Constraints and Assumptions

### CON-001

現行 React 18 / TypeScript / Vite 構成を前提とし、本件単独では framework migration を行わない。

### CON-002

Firebase / Firestore と Cloudflare AI proxy は現行 integration として扱う。置換は別のADRとscope承認がない限り本件の前提にしない。

### CON-003

modern browser client は改変可能であり、client binary / JS / WASM を秘密保持手段として扱わない。

### CON-004

offline対応は「すべての機能がofflineで動く」ことを意味しない。AI、認証、server-authoritative operation は明示的にdegradeする。

### CON-005

Issue #47、#51、#45、#89、#128、#152、#160 の既存 responsibility を横取りせず、共通基盤が必要な場合のみ接続する。

## 9. 用語と状態モデル

### 9.1 Working State

現在の端末上で UI と deterministic application logic が使用する状態。未同期変更を含むことができる。

### 9.2 Shared Canonical State

server が owner / authorization / revision / idempotency を検証して受理した共有状態。複数端末で最終的に収束すべき状態である。

### 9.3 Local Replica

Shared Canonical State の端末内コピーと、未同期 Working State を保持する storage。localStorage に限定しない。

### 9.4 Operation

local state 変更を shared state へ反映するための再送可能な machine-readable mutation 単位。

### 9.5 Ephemeral State

表示中 modal、hover、入力途中など reload 後復元を要求しない UI state。

### 9.6 Durable Working State

conversation、Fact Graph、preview、draft、sync queue など reload / crash 後も必要な application state。

### 9.7 Server-authoritative Operation

client の成功判定だけでは完了できず、server acknowledgement が完了条件となる operation。

## 10. Target Architecture 原則

### ARCH-001: Execution と authority を分離する

Client は deterministic calculation の execution owner になれるが、shared commit の authority を自動的には持たない。

### ARCH-002: Pure core first

validator、canonicalizer、progress projection、readiness、scheduler、preview projection、分析計算は可能な限り network / storage API に依存しない pure application / domain function とする。

### ARCH-003: Side effect は adapter 境界へ隔離する

Firebase、IndexedDB、localStorage、AI proxy、trace transport、clock、browser lifecycle は adapter / application boundary から注入し、domain rule へ直接埋め込まない。

### ARCH-004: Local replica は repository contract の内側へ置く

UI component が Firebase / IndexedDB / localStorage の選択、fallback 順序、retry policy を知ってはならない。

### ARCH-005: Cloud sync と local compute を独立させる

sync failure が scheduler / validator の利用不能へ連鎖してはならない。ただし server-authoritative operation は offline で確定扱いにしない。

### ARCH-006: No silent conflict resolution

競合を `updatedAt` の新しい方で黙って上書きする一般規則を禁止する。entity / operation ごとに明示した policy がない場合は conflict として停止する。

### ARCH-007: Migration is a product behavior

storage migration は内部実装詳細ではなく、既存利用者のデータを守る product contract として test する。

### ARCH-008: One truth per data class

同一 data class について複数 storage が独立 mutation authority を持ってはならない。cache、replica、server authority の役割を明示する。

## 11. 責務配置の正仕様

| Capability | Target execution | Shared authority | Offline behavior | Requirement |
| --- | --- | --- | --- | --- |
| UI rendering / interaction | Client | none | available | EXE-001 |
| Fact Graph lifecycle | Client | cloud session revision when shared | existing state can continue | EXE-010 / SYNC-030 |
| validator / canonicalization | Client | privileged mutation only revalidated structurally | available | EXE-011 |
| progress / remaining derivation | Client | none | available | EXE-012 |
| readiness / blocking issue selection | Client | none | available | EXE-013 |
| scheduler / rescheduler | Client | none | available from hydrated constraints | EXE-014 |
| preview generation | Client | provenance/revision when shared | recompute allowed | EXE-015 |
| AI semantic interpretation | Client orchestration + Server gateway + Provider | Server gateway policy | unavailable for new free-text semantic turn | AI-001 / AI-003 |
| AI semantic repair | Client orchestration + Server gateway + Provider | Server gateway policy | unavailable | AI-001 / AI-003 |
| AI dialogue renderer | Client orchestration + Server gateway + Provider | Server gateway policy | current deterministic fallback contract only | AI-001 / AI-003 |
| authentication | Client SDK + Server/Firebase | Server | privileged operation may block | SEC-001 |
| normal planner CRUD | Client local replica + sync adapter | Server/Firebase after acknowledgement | policy-controlled optimistic mutation | SYNC-010 |
| weekly conversation shared session | Client local replica | Cloud revision | queue/reconcile per #47 | SYNC-030 |
| personalization | Client projection + repository | existing profile authority | last hydrated profile may be read | SYNC-040 |
| approval / final save uniqueness | Client request | Server transaction | cannot be finalized offline | AUTH-010 |
| trace collection | Client capture + Server storage | Server retention / ACL | bounded queue only where policy permits | OBS-020 |
| account deletion / privacy lifecycle | Server | Server | unavailable offline | SEC-020 |

## 12. Functional Requirements

### EXE-001: UI state update

AI / server acknowledgement を必要としない操作は、local application state を先に更新して UI へ反映できなければならない。

### EXE-010: Fact Graph

Fact Graph mutation、revision validation、canonicalization、derived Fact reconciliation は client deterministic code が所有する。

server は user raw text を再解釈して別 Fact Graph を生成してはならない。cloud session 同期時は schema、owner、revision、operation identity を検証し、client と同じ raw semantic meaning を再推論しない。

### EXE-011: Validation / canonicalization

semantic candidate の schema、reference、typed invariant、Fact lifecycle validation は network 非依存で実行可能でなければならない。

### EXE-012: Progress derivation

`scope_total / completed / remaining` 等の deterministic derived state は client で完結し、入力順序に依存せず同じ active facts から同じ結果へ収束しなければならない。

### EXE-013: Readiness

次に必要な情報、blocking issue、preview readiness は client canonical state だけから決定できなければならない。

### EXE-014: Scheduling

scheduler は server call を行わず、引数として与えられた canonical constraints だけから deterministic result を返す。

同じ scheduler version、同じ input、同じ timezone / calendar context では同じ result へ収束する。

### EXE-015: Preview

preview は saved Plan と明確に区別し、source revision / Fact refs / owner / conversation 等の provenance を失わない。

local recompute は許可するが、stale preview を server-authoritative save へ流してはならない。

### DATA-001: Storage capability decision

Durable Working State と sync queue の storage は、以下の候補を比較した ADR を作成して決定する。

- Firestore Web SDK persistent local cache
- application-owned IndexedDB repository
- hybrid

localStorage は bootstrap index、小さい preference、migration marker 等の限定用途へ縮退させる。大きな conversation / Fact Graph / mutation queue の最終設計として採用しない。

選定は feature convenience ではなく、transaction、multi-tab、migration、quota、query、error recovery、Firestore integration、testability を基準にする。

### DATA-002: Transactional durable write

UI が「端末に保存済み」「offline で保持済み」と表示する変更は、durable local transaction 完了後でなければならない。

複数 record を同一 revision として扱う session state は、partial write を正常状態として復元してはならない。

### DATA-003: Versioned schema

Durable local data は schema version を持ち、unknown future version を fail closed で扱う。

migration は old -> current の明示関数として test し、decode 中に live key へ破壊的な一時書込みを行わない。

### DATA-004: Account isolation

local data は owner scope を持ち、別 account の data を復元・同期・preview・approval に混入させない。

sign-out / account switch の cache retention policy を明示し、別 owner へ old cache を再保存しない。

### DATA-005: Storage failure behavior

quota exceeded、permission denial、corrupt record、transaction abort を success に変換しない。durable write を保証できない場合は user-visible degraded state または明示 error とする。

### SYNC-001: Sync state machine

共有対象の local change は最低限以下の状態を機械的に区別する。

```text
clean
→ dirty_local
→ queued
→ syncing
→ synced

queued/syncing
→ conflict
→ resolved → queued

queued/syncing
→ rejected
```

UI は `synced` と `local only / pending` を同じ成功表示にしてはならない。

### SYNC-002: Operation identity

再送可能 mutation は stable operation ID を持つ。同じ operation の network retry、response loss、reload、multi-tab retry が duplicate semantic mutation を生成してはならない。

operation record は少なくとも owner scope、entity / aggregate identity、schema version、base revision、payload または typed diff、local sequence、status を持つ。

access token、provider secret、raw credential を operation record へ保存しない。

### SYNC-003: Revision

共有 aggregate は server-authoritative revision または同等の compare-and-set contract を持つ。

client は stale base revision を用いた上書きを成功扱いにしてはならない。

### SYNC-004: Conflict policy registry

entity / aggregate ごとに conflict policy を明示する。

policy 未定義の競合は自動 merge せず `conflict` とする。

一般的な timestamp-only last-write-wins を default policy にしない。

### SYNC-005: Multi-tab

同一 browser profile で複数 tab が開いても、operation sequence と sync が duplicate commit を起こさない。

実装は single leader、Web Locks、BroadcastChannel、または idempotent multi-leader のいずれでもよいが、選択理由を ADR に残す。

### SYNC-006: Reconnect

network 復旧後、durable queue を loss なく再開し、再送中に tab close / reload が発生しても operation identity を維持する。

### SYNC-007: Server rejection rollback

optimistic mutation が server に拒否された場合、UI と local replica を `synced` として残さない。rollback または rejected/conflict state へ遷移し、利用者が修復可能であること。

### SYNC-010: Planner entity local replica

Plan、Actual、DayNote、MonthEvent、Todo、StudySubject、StudyMaterial、ScheduleTemplate、TimetableTerm、TimetablePeriod の repository contract は UI から変えず、local replica / sync implementation を repository 内へ隠蔽する。

### SYNC-030: Weekly Planning shared session

Issue #47 / `20260731-weekly-planning-synced-conversation-session-store.md` の責務を再実装しない。

conversation、Fact Graph、preview、draft、machine pending question を cloud と共有する場合は同 task の atomic revision / conflict / offline reconciliation 契約を本要件の sync infrastructure 上へ接続する。

### SYNC-040: Personalization replica

personalization profile の server authority、consent、TTL、reset contract は Issue #47 の既存 policy を維持する。

client は最後に正常 hydrate された profile を local projection に利用できるが、推定・古いlocal値でserver profileを無条件上書きしてはならない。

### AUTH-010: Approval / save

複数端末一意性が必要な approval / final Plan save は server acknowledgement を完了条件とする。

client offline 状態で「保存完了」と表示しない。offline で intent を queue する場合も `pending server confirmation` と明示し、stale preview / owner / revision を reconnect 時に再検証する。

### AI-001: Production AI gateway

production の AI semantic interpretation、semantic repair、dialogue renderer を含む provider call は server-side gateway を通す。

provider API key を browser localStorage、IndexedDB、bundled environment value、source map、request payload へ置いてはならない。

### AI-002: Direct provider exception

direct provider transport は明示的な development / evaluation に限定する。

production build / production runtime が direct provider secret を要求しないことを architecture test で固定する。

### AI-003: Offline AI behavior

新規 free-text semantic interpretation、semantic repair、AI renderer が network / provider を必要とする場合、offline で deterministic regex / legacy parser へ fallback して意味状態を生成してはならない。

AI が必要な turn は `offline / AI unavailable` として停止し、既存 canonical state から実行可能な deterministic schedule / preview / analysis は継続可能にする。

### SEC-001: Authorization

client-side visibility / ownership check は UX guard であり security boundary ではない。shared mutation は Firestore Rules、server transaction、Worker auth 等の server-side authorization を通る。

### SEC-002: Client tampering assumption

client bundle、WASM、IndexedDB/localStorage contents、network request は利用者に閲覧・改変可能である前提とする。

server は client が送った `isAdmin`、billing tier、owner、approval completed、quota result 等を無条件に信頼しない。

### SEC-003: Sensitive local data

local replica に保存する field を inventory 化する。secret は保存しない。

raw conversation / trace を local に保持する場合は既存 privacy consent / retention 方針と整合し、trace 用 storage と operational state storage を混同しない。

### SEC-004: Production build boundary

production config で direct provider secret が必要なコード経路、environment validation、runtime selection が有効にならないことを構造テストで固定する。

### SEC-020: Account lifecycle

account deletion、consent withdrawal、server retention expiration により削除対象となった data が local replica だけに無期限残存しない cleanup contract を持つ。

### OBS-001: Sync observability

production で本文を保存せずとも、sync health を追跡できる privacy-safe metric を持つ。

最低限、operation type、success/failure/conflict/rejected、retry count、queue age、latency、schema version を集計可能にする。

### OBS-002: Performance observability

scheduler、validation、local hydration、migration、sync reconciliation の duration を開発 / evaluation で計測できる。

raw user content を performance metric の必須要件にしない。

### OBS-020: Trace separation

quality trace は business state の正本にしない。trace write failure が scheduler / save の truth を変更してはならない。

### MIG-001: Idempotent migration

現行 localStorage から新 local replica への migration は再実行可能でなければならない。

途中失敗、browser crash、容量不足でも old state と new state の双方を破壊してはならない。

### MIG-002: Cutover policy

無期限 dual-write を禁止する。

migration は `read-old / write-new`、shadow verification、cutover、old cleanup の段階を持ち、rollback window と version cutoff を記録する。

### MIG-003: No semantic migration

storage migration 中に raw conversation を AI へ再送して state を再生成してはならない。既存 typed state を versioned migration する。

### MIG-004: Account-scoped migration

migration は owner scope を明示し、account A の old state を account B の new storage へ移さない。

## 13. Offline Product Contract

### OFF-001: Offline で利用可能

最後に正常 hydrate 済みの local replica がある場合、以下は offline でも利用可能であること。

- 既存予定・実績・教材・時間割の閲覧
- 端末内 state だけで完結する UI 操作
- canonical data が揃っている deterministic progress calculation
- canonical constraints が揃っている scheduler / preview recompute
- local draft / working state の編集

### OFF-002: 条件付き offline mutation

通常 planner CRUD を offline queue 対象にする場合、repository ごとに明示的に許可する。許可していない entity を暗黙に queue しない。

### OFF-003: Offline で確定不可

以下は server acknowledgement なしに完了扱いにしない。

- sign-in / privilege refresh が必要な操作
- AI semantic / repair / renderer request
- approval finalization
- multi-device uniqueness を必要とする save
- account deletion
- privileged admin action
- server trace policy / retention change

### OFF-004: User-visible status

利用者が「保存済み」と「この端末だけに保存済み」を区別できること。

常時 badge を強制するものではないが、pending / conflict / rejected が無言になってはならない。

## 14. Conflict Contract

### CONF-001: No lost update

A端末とB端末が同じ server revision を基に異なる更新を行った場合、後着 request が先着 request を無条件上書きしてはならない。

### CONF-002: Safe automatic merge only

自動 merge は、数学的または domain contract 上 commutative / independent と証明できる変更に限定する。

### CONF-003: Human resolution

同一 scalar field の競合等、安全な merge が定義できない場合は、利用者へ current server value と local pending value を提示して選択可能にするか、feature ごとの明示的 resolution policy を実装する。

### CONF-004: Weekly Fact Graph

Fact Graph conflict は raw text diff ではなく revision / Fact operation identity で扱う。別端末が進めた Graph に current local diff を機械的に適用できない場合は再解釈せず conflict とする。

## 15. Non-Functional Requirements

### NFR-PERF-001: Local interaction latency

server acknowledgement 不要な一般 deterministic 操作は、reference browser benchmark で p95 100 ms 以内に application result を返すこと。

### NFR-PERF-002: Scheduler budget

7日 horizon、movable work item 200件、busy interval 2,000件の benchmark dataset に対し、Chromium 4x CPU throttling 相当の reference run で scheduler p95 250 ms 以内を目標とする。

250 ms を超える場合は、WASM より先に algorithm / data structure / Web Worker offload を評価する。

### NFR-PERF-003: Main-thread blocking

50 ms を超える long task が通常操作で継続的に発生する deterministic workload は main thread へ固定しない。Worker 等への offload を評価する。

### NFR-PERF-004: Local hydration

reference dataset の durable local replica から初期 usable state を p95 500 ms 以内で hydrate することを目標とする。

### NFR-PERF-005: Regression gate

移行により既存 benchmark の p95 latency、peak heap、gzip bundle size のいずれかが 10% を超えて悪化する場合、理由と trade-off を ADR へ記録しない限り merge 不可とする。

### NFR-REL-001: Crash durability

「端末に保存済み」と判定した operation は、page reload / browser crash simulation 後に復元できなければならない。

### NFR-REL-002: Retry safety

同じ operation を100回再送しても、duplicate semantic commit を生成しないことを test する。

### NFR-REL-003: Partial failure

batch / multi-record operation の途中失敗を完全成功として復元しない。

### NFR-REL-004: Convergence

test harness 上で network が復旧した後、conflict がない durable queue は自動的に drain して shared state へ収束する。

### NFR-SEC-001: Secret scanning

production asset / source map / local persistence fixture に provider secret を含まない architecture / build check を追加する。

### NFR-SEC-002: Rules and transaction tests

server-authoritative mutation は Firestore Emulator または同等の integration test で unauthorized owner、stale revision、duplicate operation、malformed payload を拒否する。

### NFR-PRIV-001: Data minimization

sync / performance metric は raw prompt、raw response、full conversation を必須 field としない。

### NFR-MAINT-001: Dependency direction

UI -> application -> domain / repository contract -> adapter の依存方向を維持し、UI から Firebase / IndexedDB concrete API を直接呼ぶ新規経路を作らない。

### NFR-MAINT-002: One storage owner

同一 data class について、localStorage、IndexedDB、Firestore cache がそれぞれ独立 truth として mutation を受け付ける構造を禁止する。

### NFR-MAINT-003: Versioned contracts

local schema、sync operation、server endpoint / collection document の compatibility boundary は version を持つ。

### NFR-COMPAT-001: Browser support

current production が対象とする modern Safari / Chromium / Firefox 系で必須機能が利用可能であること。特定 API に依存する場合は feature detection と fallback / unsupported behavior を定義する。

### NFR-TEST-001: Traceability

各実装PRは変更した requirement ID と、その requirement を証明する automated / manual evidence を PR body に列挙する。

## 16. WASM Adoption Gate

### WASM-001: Candidate scope

WASM 候補は CPU-bound pure logic に限定する。

初期候補は scheduler / search / optimization 等であり、React rendering、Firebase SDK、AI HTTP request、DOM操作、単純 CRUD を候補にしない。

### WASM-002: TypeScript baseline first

WASM spike 前に TypeScript baseline の profiler、benchmark dataset、correctness tests を固定する。

### WASM-003: Adoption threshold

次のいずれかを満たさない限り production WASM を採用しない。

- representative p95 CPU time を 30%以上改善
- 同一 latency budget 内で throughput を 2倍以上改善
- TypeScript では満たせない明確な algorithm / reuse requirement を満たす

さらに以下を同時に満たすこと。

- output correctness が TypeScript reference implementation と一致
- incremental gzip payload、startup latency、memory overhead が計測済み
- browser fallback / load failure behavior がある
- debug symbol / source map / CI toolchain が管理可能
- security boundary を WASM の「読みにくさ」に依存しない

### WASM-004: Bundle gate

WASM 導入による initial gzip payload 増加が 250 KiB を超える場合は、lazy load、code split、または採用見送りを必須検討とする。

### WASM-005: Worker before WASM

問題が main-thread blocking であり CPU総量ではない場合、Web Worker offload を WASM より先に評価する。

## 17. Migration Plan

### Phase 0: Inventory and baseline

コード変更前に current main の execution / persistence / authority matrix を確定し、scheduler、hydration、bundle、sync の benchmark を保存する。

Deliverables:

- architecture inventory
- benchmark baseline
- data/storage inventory
- secret/trust boundary inventory

### Phase 1: Architecture guards

既に client execution である deterministic logic を architecture test / dependency rule で固定する。

Server round-trip を増やす regression を防ぐ。

### Phase 2: Local durable storage ADR

Firestore persistent local cache、application-owned IndexedDB、hybrid を spike / ADR で比較し、Durable Working State と sync queue の owner を一つに決める。

### Phase 3: Repository local-replica abstraction

UI contract を変えずに local replica + cloud sync を repository / application boundary へ導入する。

最初から全 entity を移行せず、1種類の低リスク entity で end-to-end pattern を証明する。

### Phase 4: Offline queue and conflict

operation ID、revision、queue、retry、conflict state、multi-tab coordination を実装し、network off / reload / response loss を browser regression で固定する。

### Phase 5: Weekly Planning durable session integration

Issue #47 の synced conversation session を新 sync foundation 上へ接続する。別の session repository を二重実装しない。

### Phase 6: Production authority hardening

Issue #51、#45、#89 等の production-only gate と整合させ、approval、trace、privacy、account lifecycle を確認する。

### Phase 7: Performance optimization

profiling 結果に基づき algorithm、memoization、data structure、Worker を順に評価する。

### Phase 8: WASM decision

WASM-001〜005 を満たす候補だけ spike し、採用または不採用 ADR を残す。

WASM 不採用は正常な完了結果である。

## 18. Rollout / Rollback Requirements

### ROL-001: Feature flag

storage / sync cutover は rollback 可能な feature flag または version gate を持つ。

### ROL-002: Shadow validation

可能な migration では new read model / sync result を shadow comparison し、差分を user-visible truth へ反映する前に検出する。

### ROL-003: Rollback safety

rollback しても new schema で作成した shared data を旧 client が誤解釈しない compatibility policy を持つ。

### ROL-004: Cutoff

旧 storage / compatibility path の削除条件を version / date / migration completion で明示する。

## 19. Verification Strategy

### 19.1 Unit / property tests

- pure validator / canonicalizer determinism
- progress convergence
- scheduler determinism
- operation encode/decode
- migration idempotency
- conflict classifier
- sync state reducer

### 19.2 Integration tests

- repository local replica -> cloud adapter
- stale revision rejection
- retry / response loss
- server idempotency
- owner mismatch
- local transaction crash recovery
- local schema migration

### 19.3 Emulator tests

- Firestore Rules authorization
- transaction contention
- duplicate operation
- stale base revision
- account deletion / retention where applicable

### 19.4 Browser Regression

最低限以下を自動化する。

1. online -> offline -> local edit -> reload -> online -> convergence
2. two tabs edit same entity
3. two tabs submit same operation
4. migration途中でreload
5. local cache corruption
6. quota / storage failure
7. server rejection after optimistic update
8. AI required turn while offline
9. scheduler / preview while offline
10. logout / account switch isolation

### 19.5 Performance tests

- scheduler fixed dataset p50/p95
- local hydration p50/p95
- migration duration
- sync queue drain duration
- bundle gzip size
- WASM候補はTypeScriptと同一datasetで比較

### 19.6 Production verification

自動 test green だけで operationally deployed と記録しない。

Production では最低限、正常sync、reconnect、multi-device、server rejection、account isolation、AI proxy、approval一意性を観測する。

## 20. Requirement Traceability Matrix

| Requirement group | Primary owner | Mandatory evidence |
| --- | --- | --- |
| EXE-* | client application/domain | unit/property + architecture test |
| DATA-* | local persistence adapter | migration/integration + browser failure test |
| SYNC-* | repository/sync application | integration + multi-tab + emulator where server involved |
| AUTH-* | approval/server application | transaction/emulator + production verification |
| AI-* | AI client/proxy boundary | architecture test + offline/browser behavior + provider-path verification |
| SEC-* | server rules/proxy/build boundary | security/architecture + emulator/build check |
| OBS-* | metrics/trace adapter | privacy-safe payload tests |
| MIG-* | storage migration | idempotence + crash/reload + rollback evidence |
| OFF-* | product/application | browser network-off regression |
| CONF-* | sync conflict owner | concurrent integration + resolution behavior |
| NFR-* | cross-cutting | benchmark/security/test evidence |
| WASM-* | performance architecture | benchmark + ADR |
| ROL-* | release/migration | rollback/shadow/cutoff evidence |

要件IDのない実装変更を禁止するものではないが、Issue #164 scope の変更は最低1つの本書 requirement へ trace できなければならない。trace できない場合は scope 外か、本書の要件不足である。

## 21. Acceptance Criteria

以下をすべて満たすまで Issue #164 を完了扱いにしない。

- [ ] 本書が main に存在し、Issue #164 から canonical Source of Truth として参照される
- [ ] current execution / persistence / authority inventory が baseline main と照合済み
- [ ] deterministic client-owned capability を architecture guard で固定
- [ ] Durable Working State の storage ADR が承認済み
- [ ] localStorage の責務縮退方針と migration が定義済み
- [ ] shared mutation の operation identity / revision / sync state machine が実装済み
- [ ] conflict policy registry が存在し、default silent LWW がない
- [ ] multi-tab duplicate safety が自動検証済み
- [ ] offline -> reload -> reconnect の browser regression がgreen
- [ ] production AI secret がclientへ存在しないことをbuild/architecture testで固定
- [ ] AI required turn のoffline fallbackがlegacy semantic parserへ戻らない
- [ ] approval / final save のserver authorityを維持
- [ ] Issue #47 cloud session方針との重複実装がない
- [ ] migrationがidempotentでrollback可能
- [ ] performance baselineとpost-migration比較が保存されている
- [ ] WASM候補がWASM-001〜005で評価され、採用/不採用ADRがある
- [ ] `npm run typecheck` green
- [ ] `npm run test:run` green
- [ ] `npm run build` green
- [ ] relevant Browser Regression green
- [ ] relevant Emulator / concurrency tests green
- [ ] Production verification record がある
- [ ] `PROJECT_MAP.md`、関連architecture、roadmap、taskが最終責務境界と同期している

## 22. Merge Gates

各実装 PR は最低限以下を満たす。

1. 対応する requirement ID を PR body に列挙する。
2. requirement を守る自動 test または明示的な verification evidence を示す。
3. 既存の server authority を client convenience のため弱めない。
4. storage / sync / semantic ownership の二重化を作らない。
5. current main との diff を責務単位で説明する。
6. typecheck / full test / build を通す。
7. browser / emulator / real environment が必要な項目を unit test の成功だけで完了扱いにしない。
8. migration / rollback が必要な変更は、cutover前にrollback pathを検証する。
9. requirement ID と evidence の対応がレビュー可能である。

## 23. Dependency / Scope Coordination

### Issue #47

cloud conversation / Fact Graph session と personalization rollout を所有する。本件は共通 sync foundation を提供し得るが、別の session truth を作らない。

### Issue #51

approval multi-device uniqueness の production rollout を所有する。本件は server authority を維持し、その実装を local-only へ戻さない。

### Issue #45 / #89

trace privacy / lifecycle / production recovery を所有する。trace を operational state storage の正本へしない。

### Issue #128

legacy saved-preview approval compatibility を所有する。storage migration と preview metadata version が交差する場合は migration order を共同で定義する。

### Issue #152

prompt injection / adversarial AI security を所有する。client-first化で untrusted text が新しい server instruction boundary を横断しないよう整合させる。

### Issue #160

AI usage / cost observability を所有する。本件の AI gateway はその計測を迂回しない。

### Issue #52 / #163

UI / navigation scope であり、本件の persistence / execution architecture を UI component へ直書きしない。

## 24. Risk Register

### RISK-001: Double cache

Firestore persistent cache と独自 IndexedDB を同じ data class の独立 truth として併用すると conflict が二重化する。

Mitigation: DATA-001 / ARCH-008。

### RISK-002: Offline false success

offline write を server save と同じ表示にすると、利用者が同期済みと誤認する。

Mitigation: SYNC-001 / OFF-004。

### RISK-003: Multi-tab replay

複数tabが同じ queue を drain すると duplicate operation を発行し得る。

Mitigation: SYNC-002 / SYNC-005 / server idempotency。

### RISK-004: Stale preview save

offline 中に preview を再計算し、別端末で Graph が更新された後に古い preview を保存する危険がある。

Mitigation: source revision binding + AUTH-010。

### RISK-005: Migration data loss

localStorage -> new storage の途中失敗で両方を削除する危険がある。

Mitigation: MIG-001 / MIG-002 / MIG-004。

### RISK-006: WASM over-engineering

性能根拠なくRust/WASMを導入するとbuild、debug、bundle、採用難易度が悪化する。

Mitigation: WASM adoption gate。

### RISK-007: Client trust escalation

client-firstをclient-authoritativeと誤解し、owner / quota / approvalをclient値で確定する危険がある。

Mitigation: ARCH-001 / SEC-001 / SEC-002。

### RISK-008: Server rejection after optimistic UI

clientが成功表示した後にserverがowner/revision/rulesでrejectし、UIとcloudが分裂する危険がある。

Mitigation: SYNC-001 / SYNC-007 / OFF-004。

## 25. Definition of Done

本件の Definition of Done は「クライアント側のコードが増えた」ことではない。

次の状態をもって完了とする。

- deterministic logic の execution owner が明確で、不要な network 依存がない
- local working state が transactional / versioned / owner-bound に保存される
- offline / reload / reconnect が test で保証される
- shared state は operation identity と revision を通じて server authority へ収束する
- multi-tab / multi-device が silent lost update / duplicate save を起こさない
- AI secret と privileged decision が client へ移っていない
- migration / rollback が運用可能である
- performance が baseline から悪化していない
- WASM は実測で採用または不採用が決定されている
- architecture docs / issue / task / tests が同じ責務境界を示している

## 26. Change Control

本書の requirement を削除・緩和・別 owner へ移す場合、PR に以下を記載する。

- 変更対象 requirement ID
- 変更理由
- 現行実装 / production evidence
- 代替案
- security / data-loss / offline / multi-device 影響
- migration / rollback 影響
- acceptance test の変更

単なる実装困難、期限、コード量を理由に hard requirement を暗黙削除しない。

## 27. Change Log

### 2026-08-22

Initial canonical requirements baseline.

Baseline main の実装を確認し、client-first execution、server shared authority、AI gateway、local durable state、offline sync、conflict、migration、security、performance、WASM adoption gate、verification、Definition of Done を統合した。

同日 adversarial document review で requirement traceability を再監査し、AI責務表のID対応、personalization `SYNC-040`、Success Metrics、Stakeholders、Constraints、Traceability Matrix、Change Control を追加した。
