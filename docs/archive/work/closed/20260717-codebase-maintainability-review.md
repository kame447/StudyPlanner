# コードベース保守性・構造監査

Status: completed audit / reference
Created: 2026-07-17
Closed: 2026-07-17
Original target branch: `agent/weekly-planning-conversation-hardening`
Original reviewed head: `17cbd46aa13da44454f4c7dec8d1727ffc741931`
Related PR: `#5 feat: 週間計画の対話と履歴を改善`
Post-merge baseline: `55f8e32c68cfd057494fadec0ed208cba267db12`
Current action status: `docs/ai/weekly-planning-pr5-post-merge-status.md`

## 1. 目的

コードベースを、単一責任原則、状態設計、依存方向、抽象度、型安全性、永続化境界、外部サービス境界、テスト構造、CSS構造、ビルド・CI運用の観点から横断的に監査した。

この文書は監査結果のcompletion recordであり、直接実装するroot taskではない。個別対応はroadmapとactive taskへ分離する。

## 2. 調査対象と保証範囲

重点対象:

- `src/App.tsx`
- `src/components/NaturalLanguageAssistant.tsx`
- `src/components/QuickEntryModal.tsx`
- `src/components/WeeklyPlanningConversation.tsx`
- `src/components/weeklyPlanningConversationMode.ts`
- `src/hooks/usePlannerAppState.ts`
- `src/hooks/usePlannerDataState.ts`
- `src/features/weeklyPlanning/`のstate、reducer、storage、turn executor、intake、dialogue、pipeline、planning関連
- `src/lib/openaiCompatibleClient.ts`
- `src/styles/quick-entry.css`
- `package.json`
- `tsconfig.json`
- PR #5の変更規模、検証記録、責務境界

静的解析器、依存グラフ生成器、coverage計測、runtime profiling、accessibility scannerは実行していない。したがって、全行に欠陥がないことを保証する監査ではない。

## 3. 総合結論

コードベース全体が無秩序なスパゲッティではない。`src/features/weeklyPlanning/`には`intake`、`dialogue`、`pipeline`、`planning`等の境界があり、Action union、Reducer、closed runtime validation、property test、pure functionが存在する。

一方、上位UI/application orchestration層は中から高リスクである。現在の構造は、比較的整理されたdomain/application moduleの上に、巨大なroot component、god hook、複合modal、複合AI componentが載る形である。

全面書換えは不要だが、`App.tsx`、`usePlannerDataState.ts`、`NaturalLanguageAssistant.tsx`、`QuickEntryModal.tsx`へ新しい責務を追加し続けるべきではない。次の大規模機能追加前にcontrollerとUI境界を段階的に整理する。

## 4. 良好な構造

- `weeklyPlanningReducer.ts`がpending turn、pending approval、revisionを一か所で検査する。
- `weeklyPlanningStorage.ts`がlocalStorage値を信用せずclosed validatorで検査する。
- `WeeklyPlanningConversation.tsx`が会話履歴とtyping indicatorのpresentational componentとして成立する。
- `weeklyPlanningConversationMode.ts`がsession stateから表示modeを導出するpure functionである。
- `weeklyPlanningTurnExecutor.ts`が比較的小さいapplication orchestrationとして成立する。
- property testと回帰testがasync ownership、storage contract、pending mutation、revision contractを固定する。
- TypeScriptの`strict`、`noUnusedLocals`、`noUnusedParameters`が有効である。
- root viewの一部はlazy importされ、画面単位のbundle分割を意識している。

これらはrefactor時に維持する。

## 5. P0相当の構造課題

### 5.1 `usePlannerDataState.ts`がgod hookである

予定、実績、日記、月間event、Todo、科目、教材、schedule template、時間割、repository access、domain変換、recurrence編集、migration、navigation、notice、Firebase diagnosticsが集中する。

候補:

- `usePlanOperations`
- `useActualOperations`
- `useTodoOperations`
- `useStudyCatalogOperations`
- `useTimetableOperations`
- `useScheduleTemplateOperations`
- `usePlannerNavigationState`

外部interfaceは当面`usePlannerAppState` facadeで維持し、characterization test後に段階抽出する。

### 5.2 `App.tsx`がcomposition rootを越えている

画面構成に加え、週間計画turn ownership、request ID、message、approval ledger、preview approval、通常予定保存を担当する。

候補:

- `useWeeklyPlanningController`
- `WeeklyApprovalLedgerRepository`
- `WeeklyPlanningIdFactory`
- `WeeklyPlanningClock`

### 5.3 `NaturalLanguageAssistant.tsx`が別製品機能を同時所有する

単発自然言語予定追加・修正と複数turn週間計画、AI呼出、提案編集、一括反映、会話、preview、approval、日別移動、巨大JSXが同居する。

state ownerとuse case boundaryを先に分け、単なるJSX断片分割で完了扱いにしない。

### 5.4 `QuickEntryModal.tsx`が不可能状態を表現できる

Todo、単発予定、繰り返し予定、実績、AI、週間計画、科目・教材推定、予定紐付けを独立`useState`の組合せで管理する。

modal shellとformを分け、form stateをdiscriminated union Reducerへ移す。

### 5.5 command contractの正本が複数ある

対象:

- TypeScript command types
- runtime validation
- AI structured output schema
- prompt説明
- command adapter
- storage decoder
- tests

command catalogへdiscriminator、payload、runtime validation、AI出力可否、deterministic専用可否、legacy読込可否、JSON Schema、null canonicalizationを集約する。

## 6. P1相当の構造課題

### 6.1 `PlanningState`に導出可能な重複stateがある

`mode`、`lastAssistantMessage`等をselectorへ移すか、更新を単一finalizerへ限定する。

### 6.2 pipeline stage contractが弱い

次の段階を型で固定する。

1. interpret
2. validate and canonicalize
3. reduce intake state
4. resolve assumptions and repairs
5. build planning request
6. schedule preview
7. select dialogue action
8. record trace

後段が前段の内部表現へ直接アクセスしない形にする。

### 6.3 storage moduleがdomain schemaを複製する

closed validationは維持し、aggregateごとのdecoderを所有module近傍へ置く。storageはversion、migration、decoder呼出、save/loadを担当する。

### 6.4 CSSが子孫DOMからmodeを推測する

`:has(.weekly-draft-preview)`等に依存せず、rootへ`data-layout`または明示modifier classを渡す。

### 6.5 dependency injectionがfactory defaultで止まる

AI interpreter、renderer、clock、ID factory、ledger repositoryを`WeeklyPlanningDependencies`等で注入可能にする。

### 6.6 repositoryがsingleton importで固定される

planner repository portをoptionsまたはcomposition rootから渡し、in-memory実装とhook単体testを可能にする。

### 6.7 error handling、diagnostics、user noticeが同居する

- infrastructure error mapper
- application error code
- UI notice formatter

へ分離する。

### 6.8 root props surfaceが過大である

feature単位のview model/controller objectへまとめる。万能Contextへ移行しない。

## 7. P2相当のarchitecture guard

- lint、format check、feature boundary、cycle detectionがない。
- TypeScript検査範囲が主に`src`へ限定される。
- dependency upgrade時に`skipLibCheck: false`を確認するjobがない。
- bundle size警告をbudget化していない。
- testがdomain invariant、parser/validator、Reducer、workflow、component、migration、E2Eへ分類されていない。
- 大規模PRによりreview localityが低下した。
- task Markdownのstatus、branch、head、superseded関係を自動検査していない。

PR #5の最終規模:

- 366 commits
- 86 changed files
- 7618 additions
- 901 deletions

今後はstorage contract、UI extraction、pipeline contract等を独立PRへ分ける。

## 8. 重大問題と判定しなかった項目

- directory数が多いこと自体
- Reducerを利用していること
- Contextを利用していないこと
- runtime validatorが長いこと

state machine library、万能Context、validation削減へ直ちに移行しない。

## 9. 推奨実施順

### Phase 0. 現行契約の固定

- App turn/approval workflowのapplication test
- planner data operationの成功・失敗・rollback characterization
- QuickEntryModal kind別submit contract
- 単発AIと週間計画の境界test
- bundle、cycle、coverage baseline

### Phase 1. 週間計画controllerをAppから抽出

turn、preview昇格、approval、ledger、message/request IDを移す。UIとdomain仕様は変更しない。

### Phase 2. AI componentを機能境界で分割

単発AIと週間計画を分け、preview selectorと表示を分離する。

### Phase 3. QuickEntryModalをshellとformへ分割

form stateをdiscriminated union Reducerへ移す。

### Phase 4. planner data hookをuse case単位へ分割

時間割、study catalog、Todo、templateから先に抽出し、予定・実績・recurrenceを後段で分ける。

### Phase 5. command catalogとstorage decoderを整理

正本、capability、version、migrationを明示する。

### Phase 6. repository portとerror boundaryを整理

singleton repository、Firebase diagnostics、notice formatterを分離する。

### Phase 7. CI architecture guardを追加

lint、format、cycle、boundary、bundle budget、全runtime境界のtype checkを導入する。

### Phase 8. testとtask documentationを再編する

contract別test分類、重複test削減、task metadata整合性検査を行う。

## 10. 共通禁止事項

- 行数を減らすだけの機械的分割をしない。
- props drilling解消だけを目的に万能Contextを導入しない。
- UI分割とdomain仕様変更を同じPRで行わない。
- storage versionをmigrationなしで変更しない。
- testを通すために`any`や広い`Record<string, unknown>`へ弱めない。
- runtime validationを保守性の名目で削除しない。
- property testをexample testへ置換して契約範囲を狭めない。
- repository差替えのためだけに過剰なclass hierarchyを導入しない。
- 巨大fileを責務不明な`utils.ts`へ移動するだけで完了扱いしない。

## 11. Post-merge disposition

PR #5の機能実装は、保守性だけを理由に破棄しない。ただし、現在の巨大moduleへさらに責務を追加することは停止する。

current implementation facts、known bug、検証不足、優先順位は`docs/ai/weekly-planning-pr5-post-merge-status.md`へ統合した。

次の大規模機能開発より先に、少なくとも次を進める。

1. Issue #21修正
2. merge後main/browser検証
3. request ownership統一
4. controller抽出
5. AI component分離
6. QuickEntryModal shell/form分離
