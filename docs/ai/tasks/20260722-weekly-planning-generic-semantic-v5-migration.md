# 週間計画 汎用意味モデル v5 移行

Status: active / implementation in progress
開始日: 2026-07-22
Branch: `test/weekly-planning-semantic-schema-eval`
PR: #77

## 1. 目的

週間計画を院試・過去問中心のcommand/state/scheduler構造から切り離し、すべての学習者と一般タスクを扱える汎用task modelへ移行する。

正本となる意味構造は次である。

```text
PlanningDocument
├─ planningWindow
├─ tasks
│  ├─ category: study | non_study | unknown
│  ├─ studyDetails
│  ├─ workloads
│  ├─ effortEstimates
│  ├─ temporalConstraints
│  └─ recurrence
├─ relations
└─ uncertainties
```

院試、資格試験、大学受験、高校受験、学校課題、語学、日常学習等をtop-level専用型にしない。院試は`study` taskの`purpose=exam`と`contextLabel=大学院入試`として表す。

## 2. 固定済み方針

- raw user textの意味解釈主体は単一AI semantic normalizerだけとする。
- AIはcommand、state mutation、missing slot、readiness、preview、scheduler、approval、saveを決定しない。
- AI出力は`SemanticTurnDocument`とし、後段でraw textを再解釈しない。
- provider failure、空応答、不正JSON、schema不一致、全拒否でもparserへfallbackしない。
- AI出力をそのまま永続化せず、deterministic canonicalizerで`PlanningFactGraph`へ変換する。
- task、component、workload、effort estimate、temporal constraint、recurrence、relationを独立したfactとして扱う。
- 作業量と所要時間見積りを分離する。
- task局所の期間と計画全体のplanning windowを分離する。
- `examPrepScope`、分野配列と進捗配列の位置対応、`field + year`固定work itemを新しい正本に残さない。
- 新旧意味経路を同一turnでmergeしない。
- request ownership、stale rejection、preview authorization、approval、storage、security境界は維持する。

## 3. 作業手順

各作業単位の開始前に、このMD、architecture v5、current contract v5、semantic v5 roadmapを確認する。完了後は本MDの作業記録へ、変更、判断、注意点、検証結果を追記する。

### A. 正本文書更新

- [x] architecture v5を追加する。
- [x] v4をsuperseded扱いへ降格する。
- [x] current contractをsemantic document契約へ更新する。
- [x] roadmapへ移行streamと順序を追加する。
- [x] documentation indexの参照先をv5へ変更する。

注: v4本文はhistorical informationを失わないため削除せず、documentation indexでv5より下位のhistorical sourceへ降格した。

### B. SemanticTurnDocumentの安定化

- [x] 実験用v1からproduction候補schemaを分離する。
- [x] `quantityRole = declared | target | remaining | completed | unknown`を採用する。
- [x] runtime validatorを独立moduleにする。
- [x] raw response、parse error、schema versionの観測境界をnormalizerへ接続する。
- [x] 代表fixtureとproperty testを追加する。

raw response本文はdiagnostics/shadow reportへ含めず、response lengthだけを記録する。

### C. PlanningFactGraphとcanonicalizer

- [x] 正式ID、revision、source factをcoreが発行する。
- [x] local ID参照、親子関係、task relationを検証する。
- [x] partial factを破棄しない。
- [ ] correction、delete、proposal decisionをstable public refへ実適用する。
- [x] 同一turnのatomic commitと失敗時無変更のテストを追加する。

現在はcorrection/decisionをcanonical intentとして保持するだけであり、既存factへの破壊的適用はまだ行わない。

### D. AI semantic normalizer shadow経路

- [x] 現行interpreterとは別moduleで実装する。
- [x] production stateへ書き込まないshadow evaluationを追加する。
- [x] request body byte、latency、parse/schema rejectionを記録する。
- [x] provider failure時にparser fallbackしないことを固定する。

注: moduleとroutingは追加済みだが、実production turnからshadow callを起動する接続はまだ行っていない。

### E. Generic work item compiler

- [x] task/component/workloadから一般work itemを生成する。
- [x] `exam_year`は単位の一つとして扱う。
- [x] ordinal unitとactual rangeを分離する。
- [x] estimated minutesが不足する場合のreadiness境界を定義する。

注: 旧schedulerへのadapterは未実装であり、現行preview生成には未接続である。

### F. Dialogue/readiness統合

- [ ] accepted fact diffからacknowledgementを生成する。
- [ ] 一度に一件の高影響質問を選ぶ。
- [ ] exam専用rendererと一般rendererを統合する。
- [ ] explicit authorization前にpreviewを生成しない。

### G. Production切替と旧構造削除

- [ ] executorを新経路へ一括切替する。
- [ ] 同一turnで旧commandと新factをmergeしない。
- [ ] state migrationを実装する。
- [ ] 旧prompt、command schema、exam専用state、adapter、rendererを削除する。
- [ ] 全テスト、build、roleplay、real-eval、七視点監査を完了する。

## 4. 必須評価ケース

1. 院試過去問2分野＋研究15時まで＋前後関係。
2. 資格試験の分野、問題数、1問あたり時間。
3. 大学受験の科目、教材、年度、ページ、問題。
4. 学校課題の締切、時間帯、複数task。
5. 日常学習の反復、1回あたり量、希望時間帯。
6. 仕事・家事・移動と学習の混在。
7. task局所期間がplanning windowへ漏れない。
8. partial time factを保持する。
9. correctionで対象factだけを変更し、無関係factを維持する。
10. provider failure時にstateを変更せずparserへfallbackしない。

## 5. 作業記録

### 2026-07-22 / API schema experiment

変更:

- `task → study details → component → workload`を中心とする実験schemaを追加した。
- GitHub Models APIの`openai/gpt-4.1`で実入力を評価した。

結果:

- targeted 3ケースすべてJSON Schema parse成功。
- 学校課題、仕事＋TOEICはstrict pass。
- 院試例はtask分離、2分野、数量対応、研究15時まで、前後関係を正しく保持した。

判断:

- `total | target | remaining | completed`は早期確定を要求しすぎる。
- 明示量だが意味役割が未確定の場合の`declared`が必要である。
- workload、effort estimate、temporal constraint、planning windowを別要素にする。

注意点:

- GitHub Modelsは短時間連続呼び出しで429になるため、real-evalは低頻度・再試行付きにする。
- 実験workflowはproduction routingを変更しない。

### 2026-07-22 / 作業A: 正本文書更新

確認した文書:

- `weekly-planning-current-contract-status.md`
- `weekly-planning-roadmap.md`
- `weekly-planning-dialogue-architecture-v4.md`
- `weekly-planning-docs-index.md`

発見:

- v4と旧current contractはAI出力をtyped commandと定義しており、新方針と競合する。
- v4にはexam互換経路とprovider failure時rules fallbackの古い記述が残る。
- 旧roadmapのqueueに汎用意味モデル移行streamが存在しない。

変更:

- `weekly-planning-dialogue-architecture-v5.md`を追加した。
- `weekly-planning-current-contract-v5.md`を追加した。
- `weekly-planning-semantic-v5-roadmap.md`を追加した。
- documentation indexの最優先参照をv5文書へ切り替えた。
- v4は本文を破棄せずhistorical sourceとして明示した。

### 2026-07-22 / 作業B: stable semantic document

確認した文書:

- current contract v5 §1〜3
- architecture v5 §3〜6
- semantic v5 roadmap V5-B

変更ファイル:

- `semantic/weeklyPlanningSemanticDocument.ts`
- `semantic/weeklyPlanningSemanticValidator.ts`
- `semantic/weeklyPlanningSemanticValidator.test.ts`

判断:

- taskだけでなくcomponent、workload、effort、constraint、recurrence、relation、uncertainty、correction、decisionにもresponse-local IDを付ける。
- workloadの意味役割が未確定なら`declared`とする。
- relative planning windowはsymbolicのまま保持し、AIにISO日付を計算させない。
- effort/constraint/recurrenceのtargetは同一taskまたはそのcomponentに限定する。
- source excerptが空のfactを拒否する。

検証:

- Cloudflare Pagesの独立production buildはcommit `2f4fef7`で成功した。
- GitHub Actionsは3 workflowともjob step開始前にfailureとなり、step/log blobが生成されなかった。コード由来のtest failureとは確定できない。

注意点:

- GitHub Actionsの実行枠またはrunner起動境界を確認するまで、追加testは「実装済み・未完走」と区別する。
- 一時診断workflowは原因確認後に削除する。

### 2026-07-22 / 作業C: fact graph foundation

確認した文書:

- current contract v5 §4
- architecture v5 §6
- semantic v5 roadmap V5-C

変更ファイル:

- `semantic/weeklyPlanningFactGraph.ts`
- `semantic/weeklyPlanningSemanticCanonicalizer.ts`
- `semantic/weeklyPlanningSemanticCanonicalizer.test.ts`

実装:

- conversation ID、turn ID、fact kind、semantic local IDからdeterministicな正式fact IDを生成する。
- expected revision不一致をstate無変更で拒否する。
- 同一turn再適用をduplicateとしてstate無変更にする。
- task/component/workloadの所有関係とrelationを正式IDへ変換する。
- `latest_end`のstartTime=nullを維持する。
- correction/decisionはintent factとして保持し、既存factへまだ適用しない。

未解決:

- active/superseded/removed lifecycleとcorrection実適用。
- persisted graph migration。
- GitHub Actionsによるunit/property test完走。

### 2026-07-22 / 作業D: shadow semantic normalizer

確認した文書:

- current contract v5 §1、§8
- architecture v5 §5、§10 Phase 3
- semantic v5 roadmap V5-D

変更ファイル:

- `semantic/weeklyPlanningSemanticNormalizer.ts`
- `semantic/weeklyPlanningSemanticNormalizer.test.ts`
- `semantic/weeklyPlanningSemanticShadowEvaluation.ts`
- `semantic/weeklyPlanningSemanticShadowEvaluation.test.ts`
- `src/lib/aiModelPolicy.ts`
- `workers/ai-proxy/src/modelPolicy.ts`
- `workers/ai-proxy/src/modelPolicy.test.ts`

実装:

- 専用purpose `weekly_planning_semantic_normalizer`を追加した。
- initial callと最大一回のschema repairだけを許可した。
- initial/repair provider failure、repair後schema failureをfail closedで返す。
- parser/rules fallbackを持たない。
- request bytes、response length、latency、attempt、validation errorsを記録する。
- shadow reportは意味本文を返さず集計件数だけを返す。
- shadow evaluatorはproduction stateを引数に取らない。

注意点:

- production executorへshadow callを接続していないため、本番APIコスト・latencyへの影響はまだない。
- raw AI responseをtraceやreportへ保存しない。

### 2026-07-22 / 作業E: generic work item foundation

確認した文書:

- current contract v5 §6
- architecture v5 §8
- semantic v5 roadmap V5-E

変更ファイル:

- `semantic/weeklyPlanningGenericWorkItems.ts`
- `semantic/weeklyPlanningGenericWorkItems.test.ts`

実装:

- workload fact一件を一般work demand一件へ変換する。
- `exam_year`をpage、problem、word、minute等と同列のunitとして扱う。
- ordinal rangeと明示actual rangeを分離する。
- duration-per-unit、total duration、session duration、time workloadからestimated minutesを計算する。
- 見積りがない場合は推測せずblocking issueを返す。
- `declared`/`unknown` quantity roleはfactを保持しつつactionabilityをblockedにする。
- completed workloadは候補生成から除外する。
- fractional discrete unitを丸めず拒否する。

判断:

- 300語や20問を即座に300件/20件へ展開しない。workload fact一件を一つのwork demandとして保持し、実際の分割は後続scheduler policyへ委譲する。
- splitPolicyはtime workloadだけ`splittable`、mock examだけ`atomic`、それ以外は根拠がないため`unknown`とする。

検証上の注意:

- Cloudflare build `b841d0c`でfailureを検出した。
- ES2020 targetに対してtestで`Array.at`を使用していたため、index参照へ修正した。
- 修正後buildと全test完走は未確認である。
