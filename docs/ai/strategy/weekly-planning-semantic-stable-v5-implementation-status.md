# 週間計画 Stable V5 semantic実装status

Status: canonical implementation status / production disconnected
最終更新: 2026-07-22

関連文書:

- [current contract v5](../weekly-planning-current-contract-v5.md)
- [schema registry](../../architecture/weekly-planning-semantic-schema-registry.md)
- [Stable V5 migration plan](weekly-planning-semantic-stable-v5-migration-plan.md)
- [semantic v5 roadmap](weekly-planning-semantic-v5-roadmap.md)

この文書は、Stable V5 migration planに対する現在の実装到達点を記録する。migration planの設計原則を変更しない。production接続、保存形式切替、mainへのmergeを許可する文書ではない。

## 1. 実装済みのStable識別子

```text
TypeScript document: WeeklyPlanningSemanticDocumentV5
TypeScript graph:    WeeklyPlanningFactGraphV5
schemaVersion:       weekly-planning-semantic-v5
JSON Schema name:    weekly_planning_semantic_document_v5
fact graph version:  weekly-planning-fact-graph-v5
```

これらは並列moduleの識別子として確定済みである。ただしproduction採用済みという意味ではない。

## 2. direct semantic core

次をAlpha 1 / Alpha 2と並列に実装済みである。

```text
Stable document型
→ direct strict JSON Schema
→ direct system/user prompt
→ direct runtime validator
→ Stable normalizer
→ direct canonicalizer
→ Fact Graph V5
```

Stable document、validator、canonicalizerはAlpha schema、Alpha validator、旧Fact Graph、旧canonicalizerへimportまたはprojectionしない。

Stable normalizerはinitial callと最大一回repairだけを許可する。provider failure、空応答、不正JSON、schema rejection、repair rejectionでparser fallbackしない。diagnosticsへraw response本文を保存しない。

## 3. Fact Graph V5

Fact Graph V5はGraph V1/V2を継承せず、現在必要なcollectionを直接定義する。

```text
planning window
task / study context / component
workload / effort estimate
temporal constraint / task date rule / recurrence
relation / uncertainty
correction intent / decision intent
availability declaration / constraint source request
```

canonical transactionは正式fact ID、source、revision、duplicate turn、expected revision、atomic rejectionを扱う。

## 4. lifecycle

Fact Graph V5には独立したlifecycle indexを追加済みである。

```text
active
superseded
removed
```

各entryはfact ID、created revision、terminal revision、supersede先を保持する。fact本体は監査のため削除しない。

lifecycle engineは次を実装する。

- expected revision確認
- operation keyによるidempotency
- active factだけを操作対象にする
- removeとsupersedeを区別する
- replacementを同一fact kindへ限定する
- active依存factを持つtargetの単独終了を拒否する
- correction intentのresolved fact IDを決定論的に適用する
- inactive factをscheduler read viewから除外する

proposal decisionの実適用と依存fact一括終了transactionは未実装である。

## 5. deterministic resolverとscheduler input

次のmoduleはGraph V2全体型ではなく、必要collectionだけのstructural read interfaceを受け取る。

```text
task date resolver
fixed commitment resolver
availability resolver
full-day availability adapter
commitment/date-rule adapter
generic work item compiler
generic scheduler input compiler
```

この変更によりFact Graph V5を旧Graph V1/V2へprojectせず、次まで直接渡せる。

```text
Fact Graph V5 active read view
→ task date eligibility
→ fixed task reservation
→ availability / external occupied windows
→ generic work item
→ relation
→ generic scheduler input
```

既存Alpha/V2 moduleも同じstructural interfaceを満たすため、旧テストと呼出しを維持する設計である。

## 6. dialogueとpreview gate

Stable V5専用pure policyを追加済みである。

- blocking issueをdomain priorityとstable keyで並べ、一件だけ質問対象にする。
- scheduler inputがreadyの場合だけpreview eligibleにする。
- preview gateは明示authorization、conversation ID、graph revisionを確認する。
- AIはreadiness、質問選択、preview許可を決めない。

production renderer、preview UI、approval保存には接続していない。

## 7. read-only shadow

Stable V5のread-only shadow evaluator moduleを追加済みである。

reportは次を記録する。

- semantic schema version
- JSON Schema name
- fact graph version
- normalizer / validator / canonicalizer version
- provider outcome
- attempt / repair
- validation errors
- canonicalization outcome
- semantic / fact collection counts

raw conversation本文、raw response、semantic本文、外部予定本文はreportへ保存しない。

production turnからshadow evaluatorを起動する接続は未実装である。full automated testとStable実AI real-eval前に接続してはならない。

## 8. persistence準備

保存処理へ接続しないpure moduleとして次を追加済みである。

```text
Fact Graph V5 validator
Fact Graph V5 serializer / parser
owner-bound persisted envelope
migration metadata
session cutover marker
executor generation guard
```

persisted envelopeはowner、Fact Graph V5、source state/schema/graph version、migration version、migration timestampを保持する。

unknown envelope version、owner mismatch、破損graph、不正migration metadataをfail closedで拒否する。versionだけを書き換えない。

session cutover guardはlegacyとstable_v5を同一sessionで混在させない。Stableへcutoverしたsessionを旧executorが読み書きすること、旧形式へdowngrade保存することを拒否する。

現行production stateからFact Graph V5への具体的decoderは、旧stateの実型と保存境界を確認できていないため未実装である。raw conversationをAIへ再投入してmigrationしてはならない。

## 9. Stable統合pipeline

production副作用を持たない並列pipelineとして次を追加済みである。

```text
Stable normalizer
→ lifecycle付きdirect canonicalization
→ Fact Graph V5
→ active scheduler read view
→ generic scheduler input
→ Stable dialogue decision
```

provider failure、normalization rejection、canonicalization rejectionでは入力graphを変更しない。duplicate turnをidempotentに扱う。

production conversation handler、現行scheduler実行、preview UI、repository、保存処理は呼び出さない。

## 10. real-eval

Stable V5専用real-eval harnessとGitHub Actions workflowを追加済みである。

評価対象:

- 非連続allowed dates
- 非連続weekday集合
- weekday集合とexact exclusion
- whole-day unavailable
- authoritative calendar source request
- direct validation
- direct canonicalization

実AIによるStable V5 real-eval成功は未確認である。GitHub Actionsがstep開始前に終了し、step、log、artifactが生成されないfailureは実行基盤失敗であり、AI評価失敗ではない。

## 11. automated test追加範囲

追加済みtestは次を対象にする。

- schema世代・識別子・依存関係
- Alpha 2とStable field compatibility
- direct Stable validator
- direct canonicalizer
- normalizer repair / fail closed
- shadow telemetry
- Graph V5からtask date resolver
- Graph V5からfixed commitment resolver
- Graph V5からavailability resolver
- Graph V5からgeneric scheduler input
- semantic統合pipeline
- dialogue pipelineとpreview authorization
- lifecycleとactive read view
- persistence envelope round-trip
- owner mismatch / unknown version / broken graph
- cutover generation guard
- Stable direct coreのAlpha import禁止

repository全体のsemantic test、Worker routing、`tsc --noEmit`、Vite production buildは、GitHub Actions実行基盤とrepository取得経路の問題により未確認である。

## 12. production接続状況

次は未接続である。

```text
production conversation handler
production feature-flagged shadow invocation
現行scheduler実行
preview UI
approval flow
repository
保存処理
旧state migration
external timetable/calendar production adapter
```

Alpha 1 / Alpha 2、Graph V1/V2は削除していない。PR #77はDraftのまま維持し、mainへmergeしない。

## 13. 次gate

順序は次とする。

```text
full repository automated verification
→ Stable V5実AI real-eval
→ production read-only shadow接続
→ 旧state型・repository境界の調査
→ deterministic migration decoder / dry-run
→ proposal decisionと依存fact一括lifecycle transaction
→ old scheduler adapter / renderer rehearsal
→ rollback verification
→ production cutover
→ rollback observation
→ Alpha runtime依存削除
```
