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

各作業単位の開始前に、このMD、architecture v5、current contract、roadmapを確認する。完了後は本MDの作業記録へ、変更、判断、注意点、検証結果を追記する。

### A. 正本文書更新

- [ ] architecture v5を追加する。
- [ ] v4をsupersededへ降格する。
- [ ] current contractをsemantic document契約へ更新する。
- [ ] roadmapへ移行streamと順序を追加する。
- [ ] documentation indexの参照先をv5へ変更する。

### B. SemanticTurnDocumentの安定化

- [ ] 実験用v1からproduction候補schemaを分離する。
- [ ] `quantityRole = declared | target | remaining | completed | unknown`を採用する。
- [ ] runtime validatorを独立moduleにする。
- [ ] raw response、parse error、schema versionの観測境界を定義する。
- [ ] 代表fixtureとproperty testを追加する。

### C. PlanningFactGraphとcanonicalizer

- [ ] 正式ID、revision、source factをcoreが発行する。
- [ ] local ID参照、親子関係、task relationを検証する。
- [ ] partial factを破棄しない。
- [ ] correction、delete、proposal decisionを後から適用できるstable public refを定義する。
- [ ] 同一turnのatomic commitと失敗時無変更をテストする。

### D. AI semantic normalizer shadow経路

- [ ] 現行interpreterとは別moduleで実装する。
- [ ] production stateへ書き込まないshadow evaluationを追加する。
- [ ] request body byte、latency、parse/schema rejectionを記録する。
- [ ] provider failure時にparser fallbackしないことを固定する。

### E. Generic work item compiler

- [ ] task/component/workloadから一般work itemを生成する。
- [ ] `exam_year`は単位の一つとして扱う。
- [ ] ordinal unitとactual yearを分離する。
- [ ] estimated minutesが不足する場合のreadiness/proposal境界を定義する。

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

### 2026-07-22 / 作業A開始

確認した文書:

- `weekly-planning-current-contract-status.md`
- `weekly-planning-roadmap.md`
- `weekly-planning-dialogue-architecture-v4.md`
- `weekly-planning-docs-index.md`

発見:

- v4とcurrent contractはAI出力をtyped commandと定義しており、新方針と競合する。
- v4にはexam互換経路とprovider failure時rules fallbackの古い記述が残る。
- roadmapのqueueに汎用意味モデル移行streamが存在しない。

対応:

- architecture v5を新しい正本として追加し、関連文書を同期する。
