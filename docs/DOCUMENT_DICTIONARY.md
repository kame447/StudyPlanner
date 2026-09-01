# StudyPlanner Documentation Dictionary

Status: canonical documentation-governance contract
Updated: 2026-09-02

この文書は、Markdownを「どこに置くか」「どれを正仕様として扱うか」を決める辞書である。文書の置き場所を読者名・agent名・作成時期で決めず、責務 × 文書種別 × lifecycle で一意に決める。

## 1. 配置キー

### Responsibility

最初に、その文書がどの責務の変更理由を所有するかを決める。

- `domains/scheduling/`: app-wide scheduled-event authority、occurrence projection、Plan / MonthEvent persistence migration
- `domains/weekly-planning/`: 週間計画のproduct/runtime/dialogue/scheduler/personalization/quality
- `domains/client-runtime/`: client-first execution、local execution、sync authority等のclient runtime責務
- `domains/reporting/`: 学習実績・予定・教材情報の集計とuser-facing learning report
- `domains/product-observability/`: service-wide product activity、AI/API usage、planning quality、operational drill-down向けtelemetry / analytics / read model責務
- `domains/external-integrations/`: 外部provider/APIとの接続、利用条件、adapter境界、fallback、外部dataと内部domain modelの分離
- `work/`: repository横断のtask運用ルール・template
- `archive/`: current decisionを所有しない履歴・監査証跡

新しい責務が増えた場合は `domains/<responsibility>/` を追加する。`ai/`、`testing/`、`strategy/`、`design/` のような「手段・読者・文書の雰囲気」をtop-level responsibilityとして追加しない。

### Document type

責務の中では次の種別を使う。

- `spec/`: user-facing requirement / product intent
- `architecture/`: runtime boundary、data flow、ownership、invariant
- `policies/`: 継続的に守るbehavior/policy
- `personalization/`: personalization固有の設計
- `quality/`: test/eval/verification policy
- `roadmap/`: current execution order / direction
- `work/`: 未完了のdurable task/checkpoint

必要のない種別directoryは作らない。

### Lifecycle

- `canonical`: 現在の正仕様。decision areaごとに原則1つ。
- `supporting`: canonical contractを補足する現行文書。親を明示する。
- `active`: 未完了作業。完了後はcurrent hierarchyに残さない。
- `historical`: 過去の判断・audit・PR/branch記録。`archive/`だけに置く。
- `superseded`: 後継へ置換済み。`archive/work/superseded/`へ置く。

`Status: active` という文字列だけでcurrent扱いしない。配置とcurrent code/Issueを優先する。

## 2. Authority order

競合した場合は次を優先する。

1. current production code / tests
2. domain canonical contract
3. domain supporting architecture/policy
4. current roadmap / active Issue / domain work record
5. archive evidence

archiveは現在の実装命令にならない。

## 3. Canonical path rules

### Scheduling

入口: `docs/domains/scheduling/README.md`

正本:

- scheduled-event authority、ScheduleOccurrence identity/time/busy semantics、Plan / MonthEvent / timetable projection境界: `architecture/scheduled-event-authority.md`
- current migration order / Phase 3 checkpoint: `roadmap/current.md`

current implementation ownerはIssue #278。`src/domain/scheduleOccurrence.ts`はcompatibility read modelであり、canonical persistenceそのものではない。

### Weekly planning

入口: `docs/domains/weekly-planning/README.md`

正本:

- runtime ownership: `architecture/current-contract-v5.md`
- semantic ownership: `architecture/weekly-planning-semantic-ownership-boundary-v5.md`
- dialogue/runtime structure: `architecture/weekly-planning-dialogue-architecture-v5.md`
- availability: `architecture/weekly-planning-availability-architecture-v5.md`
- product intent: `spec/product-intent.md`
- pre-scheduling learning consultation / advice requirement: `spec/learning-consultation-and-advice.md`
- scheduling behavior: `policies/scheduling.md`
- human grounding: `policies/human-grounding.md`
- memory/learning policy: `policies/adaptive-memory.md`
- test policy: `quality/test-philosophy.md`
- regression scenarios: `quality/regression-scenarios.md`
- execution order: `roadmap/current.md`

`spec/learning-consultation-and-advice.md` はIssue #246の正本であり、相談→助言→採用→既存Stable V5へのpromotionに関するproduct requirement、planned runtime boundary、state/lifecycle、failure、test、future evolutionを所有する。production codeが未実装の間は`architecture/current-contract-v5.md`のcurrent runtime baselineを上書きしない。

### Client runtime

入口: `docs/domains/client-runtime/README.md`

client-first executionの正仕様は `spec/client-first-execution-requirements.md`。作業状態はIssue #164を正とし、同じrequirements本文をtask文書へ複製しない。

### Reporting

入口: `docs/domains/reporting/README.md`

学習レポートのuser-facing requirement、情報階層、集計不変条件、navigation contractの正仕様は `spec/learning-report.md` とする。集計の詳細実装はproduction code/testsを正とし、specへfield-level実装を重複させない。

### Product observability

入口: `docs/domains/product-observability/README.md`

正本:

- management / analytics console product requirement、information hierarchy、metric semantics: `spec/console-requirements.md`
- telemetry、identity、aggregation、read model、privacy / retention、diagnostic drill-down architecture: `architecture/telemetry-and-read-model.md`
- execution order: `roadmap/current.md`

週間計画traceのruntime schema / lifecycleはこのdomainへ移さず、`domains/weekly-planning/`とIssue #45 / #89をownerとして維持する。product-observabilityはservice-wide projection / consumerとして扱う。

### External integrations

入口: `docs/domains/external-integrations/README.md`

書籍教材metadataの検索、共有catalog、provider fallback、manual fallbackの正仕様は `spec/material-metadata.md` とする。

外部provider/APIの採否、adapter境界、利用条件、quota、fallbackなどの調査証拠はこのdomainの`work/`へ置く。現在の全体追跡Issueは#187である。

教材、予定、週間計画など各product domainの意味・lifecycle・永続modelそのものはexternal-integrationsへ移さない。外部サービス固有のresponseや運用条件を内部domainへ漏らさない接続境界だけを所有する。

## 4. Work record rules

未完了taskは責務domainの `work/` に置く。横断的なtask template/運用規則だけ `docs/work/` に置く。

完了:

`docs/archive/work/closed/`

置換済み:

`docs/archive/work/superseded/`

active taskのfilenameは日付を含めてよい。canonical spec/architecture/policyは原則として日付をfilenameに含めず、stable pathを維持する。

## 5. Archive rules

`docs/archive/` は証跡保管庫であり、現在の探索入口ではない。

- `archive/audits/`: adversarial audit / review evidence
- `archive/work/closed/`: 完了task
- `archive/work/superseded/`: 後継へ統合されたtask
- `archive/weekly-planning/`: 旧architecture、旧status、PR/branch/debug記録
- `archive/engineering/`: repository横断の過去refactor/engineering記録

historical文書内の旧path/branch/PRは当時の証跡として残してよい。current文書からarchiveへ依存して仕様を成立させない。

### Archive invariant transfer gate

文書をarchiveへ移すことと、その文書に含まれる概念を廃止することは別である。

canonical / design / task / audit文書をarchiveへ移す前に、必ず次を行う。

1. 文書内の「当時だけの実装手順」と「現在も成立する原則・不変条件・要件」を分離する。
2. current production code、tests、open Issue、current canonical docsと照合する。
3. 現在も生きている概念ごとにcurrent owner文書を一つ決める。
4. current ownerに同じ概念が十分な強さで記述されていなければ、archive移動と同じ変更で昇格・統合する。
5. current behaviorを証明する回帰scenarioがhistorical test planにしか存在しない場合は、version非依存のscenarioを`quality/`へ抽出する。

禁止:

- `closed` / `superseded` / 古いversionという理由だけで、その文書が確立した現役invariantまでcurrent docsから消す。
- 詳細な旧文書を丸ごとcurrentへ戻して、古い実装手順まで再び正仕様にする。
- archive文書だけが現行behaviorの唯一の説明になる状態を残す。

正しい移行は次の形とする。

```text
historical task / design
├─ old procedure / old type / old branch → archive
└─ durable principle / invariant → current owning spec / architecture / policy / quality
```

## 6. Naming rules

禁止:

- canonical directory名にagent名 (`ai`, `codex`, `claude`, `gemini`) を使う
- `strategy`、`misc`、`notes`、`temp` のように責務が不明なbucketを増やす
- 同じcontractを `current-status` / `guide` / `roadmap` に重複記載する
- PR/branch固有の状態をcanonical architectureへ残す

推奨:

- pathを見ただけでownerとdocument typeが分かる
- canonical filenameはstable
- execution orderはroadmap 1箇所
- current statusはdomain READMEへ集約
- detailed field truthはcode/type/schemaがownerなら文書へ全量複製しない

## 7. Placement algorithm

新しいMDを作る前に順番に判定する。

1. どの責務の変更理由か。
2. current decisionか、workか、historyか。
3. currentなら spec / architecture / policy / quality / roadmap のどれか。
4. 既存canonical文書へ追記できない理由があるか。
5. 同じdecisionを別文書でも所有していないか。

5で重複するなら新規文書を作らず、ownerを1つに寄せる。

archiveへ移す場合は、さらに`Archive invariant transfer gate`を通す。

## 8. Migration map

2026-08-22以前の主要pathは次へ移行した。

- `docs/ai/weekly-planning-current-contract-v5.md` → `docs/domains/weekly-planning/architecture/current-contract-v5.md`
- `docs/architecture/*` → `docs/domains/weekly-planning/architecture/` または `docs/archive/weekly-planning/`
- `docs/weekly-planning/weekly-planning-spec.md` → current principlesは`docs/domains/weekly-planning/spec/` / `policies/`へ、旧詳細計画はarchiveへ
- `docs/ai/strategy/*` → owning domainの `policies/` / `roadmap/` / `personalization/` またはarchive
- `docs/ai/testing/*` → `docs/domains/weekly-planning/quality/`
- `docs/ai/tasks/*` → owning domainの `work/`、closed/supersededはarchive
- `docs/ai/audits/` → `docs/archive/audits/`
- `docs/testing/weekly-planning-roleplay-*` → historical原文はarchive、現役scenarioは`quality/regression-scenarios.md`

## 9. Update gate

責務、canonical path、document lifecycleを変えたPRでは同時に次を更新する。

- `docs/README.md`
- 対象domain `README.md`
- `PROJECT_MAP.md` のdocument navigation
- `README.md` のcanonical links（該当する場合）
- Issue本文のcanonical task/spec path（該当する場合）

移動後にcurrent文書が旧canonical pathを参照していないことと、archiveされた文書だけがcurrent invariantの唯一の根拠になっていないことを確認する。
