# コードベース保守性・構造監査

Status: open
Created: 2026-07-17
Updated: 2026-07-17
Target repository: `kame447/StudyPlannner`
Target branch: `agent/weekly-planning-conversation-hardening`
Target head: `17cbd46aa13da44454f4c7dec8d1727ffc741931`
Related PR: `#5 feat: 週間計画の対話と履歴を改善`

## 目的

現在のコードベースを、単一責任原則、状態設計、依存方向、抽象度、型安全性、永続化境界、外部サービス境界、テスト構造、CSS構造、ビルド・CI運用の観点から横断的に監査し、スパゲッティ化の有無、保守性を損なう構造、今後の改善順序を明示する。

この文書はレビュー結果と改善方針だけを記録する。production code、test code、設定ファイル、依存パッケージは変更しない。

## 調査対象と保証範囲

今回の監査は、PR #5の変更ファイルだけを読む差分レビューではなく、現在のbranch上でapplication root、主要UI、hook、domain/application module、storage、AI boundary、repository接続、style、TypeScript設定、package scripts、test構造を関連付けて確認した。

重点的に確認した対象は次の通りである。

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
- PR #5の変更ファイル一覧、変更規模、最新head、検証記録

「すべての行に欠陥がない」という意味での完全性は保証できない。静的解析器、依存グラフ生成器、coverage計測、実行時profiling、アクセシビリティscannerを実行していないためである。一方、構造的な保守性判断に必要な主要な変更理由、状態所有、依存方向、副作用境界、契約の重複は監査対象に含めた。

## 評価原則

### 単一責任原則

ファイル行数ではなく「変更理由」の数で判定する。表示、永続化、業務規則、外部API、画面遷移、診断処理が同じmoduleを変更させる場合、責務集中と判定する。

### 状態の正規化

他のstateから導出できる値、相互に矛盾し得る値、同一情報の複製を避ける。複数のevent handlerへ遷移規則が分散する場合はReducerまたはapplication controllerへ集約する。

### 依存方向

UIはstorage schema、AI provider、approval protocol、repository実装などの詳細を直接知り過ぎない。上位層はuse case単位のinterfaceへ依存し、具体実装はcomposition rootで接続する。

### Readable Code

小関数の数だけで読みやすさを判定しない。一つのmoduleが異なる抽象度の処理を同時に知る場合、関数分割されていても構造的複雑性は残る。

### 契約の単一所有

同一概念のTypeScript型、runtime validation、JSON Schema、storage decoder、prompt説明を別々に手書きしない。差異が必要な場合はcapabilityまたはversionとして明示する。

## 総合結論

コードベース全体が無秩序なスパゲッティになっているわけではない。`src/features/weeklyPlanning/`には`intake`、`dialogue`、`pipeline`、`planning`などの機能境界があり、Action union、Reducer、閉じたruntime validation、property test、純粋関数が存在する。下位層では、状態遷移や入力検証を明示的な契約として扱おうとする設計が確認できる。

一方、上位のUI・application orchestration層では部分的なスパゲッティ化が進んでいる。現在の構造は「比較的整理されたdomain/application moduleの上に、巨大なroot component、god hook、複合modal、複合AI componentが載っている」状態である。

保守性の総合判定は中から高リスクである。全面書換えは不要だが、`App.tsx`、`usePlannerDataState.ts`、`NaturalLanguageAssistant.tsx`、`QuickEntryModal.tsx`へ新しい責務を追加し続けることは許容できない。次の大規模機能追加前に段階的な境界整理を行うべきである。

## 良好な構造

1. `weeklyPlanningReducer.ts`はpending turn、pending approval、revisionを一か所で検査し、非同期処理中の不正mutationを抑止している。
2. `weeklyPlanningStorage.ts`はlocalStorageの値を信頼せず、閉じたvalidatorで全体を検査する方針を取っている。
3. `WeeklyPlanningConversation.tsx`は会話履歴とtyping indicatorに責務が限定されたpresentational componentである。
4. `weeklyPlanningConversationMode.ts`はsession状態から表示modeを導出する純粋関数である。
5. `weeklyPlanningTurnExecutor.ts`は比較的小さいapplication orchestrationとして成立している。
6. property testと回帰testにより、非同期ownership、storage contract、pending mutation、revision contractを振る舞いとして固定している。
7. TypeScriptは`strict`、`noUnusedLocals`、`noUnusedParameters`が有効であり、最低限の型規律は強い。
8. root viewの一部はlazy importされており、画面単位のbundle分割を意識している。

これらはリファクタリング時に維持すべき基準である。

## 優先度P0: 次の大規模機能追加前に対応方針を確定する項目

### P0-1. `usePlannerDataState.ts`がapplication全体のgod hookになっている

対象: `src/hooks/usePlannerDataState.ts` 約1200行

予定、実績、日記、月間イベント、Todo、科目、教材、schedule template、時間割term、時間割periodを一つのhookが管理している。さらにrepositoryアクセス、domain変換、繰り返し予定編集、migration、画面遷移、editor state、notice、Firebase error診断、ログ要約まで同居する。

このmoduleには多数の独立した変更理由がある。時間割の正規化変更、Todo仕様変更、教材進捗変更、繰り返し予定編集、repository error処理が同じfileへ集約されているため、局所変更の影響範囲を判断しにくい。

改善方針:

- `usePlanOperations`
- `useActualOperations`
- `useTodoOperations`
- `useStudyCatalogOperations`
- `useTimetableOperations`
- `useScheduleTemplateOperations`
- `usePlannerNavigationState`

外部interfaceは当面`usePlannerAppState`のfacadeで維持し、利用側を一度に変更しない。楽観的更新、失敗時復元、notice、repository呼出順をcharacterization testで固定してから抽出する。

### P0-2. `App.tsx`がcomposition rootを越えてapplication service化している

対象: `src/App.tsx` 約670行

画面構成、認証分岐、legal route、theme、access gate、modal開閉に加え、週間計画turn ownership、request ID生成、message生成、approval ledgerのlocalStorage永続化、preview approval、通常予定への保存を担当している。

`submitWeeklyPlanningTurn`とapproval workflowはUI event handlerではなくapplication use caseである。root componentがapproval protocol、idempotency、proposal record、storage keyを知るため、週間計画の内部仕様変更がアプリ全体のcomposition rootへ波及する。

改善方針:

- `useWeeklyPlanningController`
- `WeeklyApprovalLedgerRepository`
- `WeeklyPlanningIdFactory`
- `WeeklyPlanningClock`

`App.tsx`はuser、planner repository adapter、controller、viewを接続するだけに戻す。

### P0-3. `NaturalLanguageAssistant.tsx`が別製品機能を同一componentに保持している

対象: `src/components/NaturalLanguageAssistant.tsx` 約800行

単発の自然言語予定追加・修正と、複数turnの週間計画を同時に扱う。AI呼出、提案編集、一括反映、会話、preview昇格、approval、日別移動、座標計算、巨大JSXが同居している。

改善方針:

- `OneShotPlanAssistant`
- `WeeklyPlanningWorkspace`
- `WeeklyPlanningComposer`
- `WeeklyPlanningPreview`
- `WeeklyPlanningApprovalActions`
- preview用pure selector

JSX断片を切るだけでは不十分である。state ownerとuse case boundaryを先に分離する。

### P0-4. `QuickEntryModal.tsx`が複数formの不可能状態を表現できる

対象: `src/components/QuickEntryModal.tsx` 約700行

Todo、単発予定、繰り返し予定、実績、AI入力、週間計画、科目・教材推定、予定紐付けを一つのmodalが扱う。独立した`useState`の組合せにより、UI上は到達しない状態も型上表現できる。

改善方針:

- modal shellとformを分離する
- form stateをdiscriminated union Reducerへ移す
- `kind: 'actual'`にrepeat stateを持たせない
- `kind: 'recurring_plan'`だけがweekdaysとrepeat scopeを持つ
- 週間計画propsの中継をcontroller objectへまとめる

### P0-5. command contractの正本が複数ある

対象:

- `weeklyPlanningCommandTypes.ts`
- `weeklyPlanningCommandRuntimeValidation.ts`
- AI structured output schema
- AI prompt説明
- command adapter
- storage decoder
- tests

TypeScript型、runtime validator、JSON Schema、promptが別々に手書きされている。`ConstraintSourceKind`とruntime validatorは`calendar`を許可する一方、AI schemaとprompt側では同じcapabilityが明示されていない。意図的差分であっても正本がないため、不整合か仕様か判断しにくい。

改善方針:

command catalogに次を集約する。

- discriminator
- payload contract
- runtime validation
- AI出力可否
- deterministic専用可否
- legacy読込可否
- JSON Schema
- optional null canonicalization

## 優先度P1: 機能変更と並行して増やさない項目

### P1-1. `PlanningState`に導出可能な重複stateがある

`mode`はdraft、preview、messages、intake、pending stateから導出できる。`lastAssistantMessage`もmessages末尾から導出できる。各actionが同じ整合性を維持する責任を負っており、action追加時の更新漏れを誘発する。

selectorへ移すか、更新を一つのstate finalizerへ限定する。

### P1-2. pipelineの段階は存在するがstage contractが弱い

`weeklyPlanningIntakePipeline.ts`と`weeklyPlanningBehaviorAwareIntakePipeline.ts`は、解釈、validation、reduction、assumption、draft request、scheduling dry-run、feasibility、dialogue、traceを知っている。

次のstageを型で固定する。

1. interpret
2. validate and canonicalize
3. reduce intake state
4. resolve assumptions and repairs
5. build planning request
6. schedule preview
7. select dialogue action
8. record trace

後段が前段の内部表現へ直接アクセスしない形にする。

### P1-3. storage moduleがdomain schemaの複製場所になっている

厳格なvalidation方針は正しいが、PlanningState、intake、draft、preview、behavior metadataのdecoderが一つのstorage fileに集約されている。

aggregateごとのdecoderを所有module近傍へ置き、storageはversion判定、migration、decoder呼出、保存だけを担当する。

### P1-4. CSSが子孫DOMからapplication modeを推測している

`quick-entry.css`はmanual entry、AI、週間計画会話、preview、confirmationを一つに保持し、`:has(.weekly-draft-preview)`などで親layoutを切り替える。子componentのclass変更が親layoutを壊す。

feature単位へ分割し、rootへ`data-layout`または明示的modifier classを渡す。

### P1-5. dependency injectionがfactory defaultで止まっている

AI interpreterやdialogue rendererの生成がglobal configとconcrete factoryへ依存する。controller抽出時に`WeeklyPlanningDependencies`としてAI interpreter、renderer、clock、ID factory、ledger repositoryを注入できる形へ揃える。

### P1-6. repositoryがsingleton importで固定されている

`usePlannerDataState.ts`は`plannerRepository`を直接importする。hook単体のtest、in-memory実装、将来のbackend移行で差替え境界が弱い。

`UsePlannerDataStateOptions`へrepository portを追加し、production defaultだけcomposition rootで渡す。すべてをContext化する必要はない。

### P1-7. error handling、diagnostics、ユーザー通知が同じhookにある

Firebase errorの構造解釈、log summary、ユーザー向けfallback文言がdata operationと同居する。provider固有の診断とapplication failureを分ける。

- infrastructure error mapper
- application error code
- UI notice formatter

の三層に分け、ユーザー向け文言がFirebase内部形式へ引きずられないようにする。

### P1-8. root componentのprops surfaceが過大である

`usePlannerAppState`から多数のentity、editor state、navigation、CRUD commandを一括destructureし、さらに週間計画操作をQuickEntryModalへ渡す。props変更の連鎖が大きい。

画面またはfeatureごとのview model/controller objectへまとめる。ただし巨大な万能Contextへの移行は行わない。

## 優先度P2: architecture guardとして整備する項目

### P2-1. lint、format、dependency boundary、cycle checkがない

`package.json`にはbuildとVitestがあるが、lint、format check、import boundary、循環依存検査がない。

導入順:

1. unused import、React Hooks、unsafe type escapeのlint
2. format check
3. feature boundary rule
4. cycle detection
5. changed-file complexity report

既存fileへの単純な行数上限は、意味のない分割を誘発するため採用しない。

### P2-2. TypeScript検査範囲が`src`に限定されている

`tsconfig.json`の`include`は`src`だけである。Worker、scripts、設定生成処理がJavaScriptまたは別設定で存在する場合、application本体と同じstrict contractで検査されない。

改善方針:

- application用tsconfig
- worker用tsconfigまたはworker独自check
- scripts用check
- root solution config

を分け、CIで全境界を検査する。

### P2-3. `skipLibCheck`によりdependency型不整合を見逃し得る

現在の規模では現実的な設定だが、FirebaseやReact更新時の型不整合を完全には検出しない。常時無効化を必須としないが、dependency upgrade PRでは`skipLibCheck: false`の検証jobを用意する価値がある。

### P2-4. bundle size警告が既知だがbudget化されていない

PR説明にはdynamic/static import重複と500kB超chunkの警告が残る。lazy importは存在するが、依存の置き場所や共有chunkの構成を継続監視する仕組みがない。

bundle analyzerを常時導入する必要はないが、production buildでchunk上限超過を記録し、増加量をPRごとに確認できるようにする。

### P2-5. test数は多いがtest architectureの分類が必要である

回帰test、property test、component testが多いこと自体は強みである。一方、同じ仕様を複数のcatch-all testが重複して固定すると、構造変更が難しくなる。

各testを次に分類する。

- domain invariant
- parser/validator contract
- reducer transition
- application workflow
- component interaction
- storage migration
- end-to-end critical path

内部実装の呼出順ではなく外部契約を固定する。

### P2-6. 大規模PRが構造判断を難しくしている

PR #5は最新時点で359 commits、86 changed files、約7,482 additionsである。複数の設計改善、バグ修正、storage、UI、AI contract、property testが一つのPRへ蓄積している。

機能として正しくてもreview localityが低下する。今後は、親taskを維持しつつ、storage contract、UI extraction、pipeline contractなどを独立PRへ分ける。

### P2-7. documentation statusの整合性を自動検査していない

同じ親task配下にopen、closed、reopenedのMarkdownが多数存在する。実装完了とtask status、PR bodyの記述が手動同期であるため、古い指示書が現行仕様に見える可能性がある。

front matterまたは固定metadataを採用し、closed taskの参照先、superseded関係、target commitを明示する。

## 現時点で重大な問題と判定しなかった項目

### directory分割そのもの

`weeklyPlanning`以下のdirectory数は多いが、現時点では概念境界を表している。directoryが多いことだけを理由に統合しない。

### Reducerの利用

state machine libraryへ直ちに置換する必要はない。現在のReducerとproperty testで契約を維持できている。状態数がさらに増え、遷移表を人間が追えなくなった時点で検討する。

### Context未使用

props drillingがあるからといって全stateをContextへ移す必要はない。controller objectとfeature boundaryで解決できる範囲を先に処理する。

### runtime validationの厳格さ

validatorが長いことを理由に検証を弱めない。分割対象は責務の置き場所であり、closed schemaの保証ではない。

## 推奨実施順

### Phase 0. 現行契約の固定

- Appのturn/approval workflowをapplication testで固定
- planner data operationの成功・失敗・rollbackをcharacterization testで固定
- QuickEntryModalのkind別submit contractを固定
- AI単発入力と週間計画の境界をcomponent testで固定
- bundle、cycle、coverageのbaselineを取得

### Phase 1. 週間計画controllerをAppから抽出

turn、preview昇格、approval、ledger、message/request IDを移す。UIとdomain仕様は変更しない。

### Phase 2. AI componentを機能境界で分割

単発AIと週間計画を分け、preview selectorと表示を分離する。

### Phase 3. QuickEntryModalをshellとformへ分割

discriminated union Reducerを導入し、不可能状態を型から除外する。

### Phase 4. planner data hookをuse case単位へ分割

時間割、study catalog、Todo、templateから先に抽出し、予定・実績・recurrenceを後段で分ける。

### Phase 5. command catalogとstorage decoderを整理

正本、capability、version、migrationを明示する。

### Phase 6. repository portとerror boundaryを整理

singleton repository、Firebase diagnostics、notice formatterを分離する。

### Phase 7. CI architecture guardを追加

lint、format、cycle、boundary、bundle budget、全runtime境界のtype checkを導入する。

### Phase 8. testとtask documentationを再編する

contract別test分類、重複test削減、task metadataの整合性検査を行う。

## 共通禁止事項

- 行数を減らすためだけの機械的分割をしない。
- props drilling解消だけを目的に万能Contextを導入しない。
- UI分割とdomain仕様変更を同じPRで行わない。
- storage versionをmigrationなしで変更しない。
- testを通すために`any`や広い`Record<string, unknown>`へ弱めない。
- runtime validationを保守性の名目で削除しない。
- property testをexample testへ置換して契約範囲を狭めない。
- repository差替えのためだけに過剰なclass hierarchyを導入しない。
- 既存の巨大fileを、責務が曖昧な`utils.ts`へ移動するだけで完了扱いしない。

## 完了判定

- [ ] `App.tsx`が週間計画workflowとledger実装を直接持たない。
- [ ] `NaturalLanguageAssistant.tsx`が単発AIと週間計画の両方を所有しない。
- [ ] `QuickEntryModal.tsx`が全form stateを単独所有しない。
- [ ] `usePlannerDataState.ts`が全entity CRUD、navigation、diagnosticsを単独所有しない。
- [ ] command型、runtime validation、AI capabilityの正本が明示される。
- [ ] `PlanningState`の導出state更新責務が一か所になる。
- [ ] storage version、migration、current decoderが分離される。
- [ ] repository portをtestで差し替えられる。
- [ ] provider error、application error、UI noticeが分離される。
- [ ] feature import boundaryと循環依存をCIで検査できる。
- [ ] `src`以外のruntime codeにも適切なstatic checkがある。
- [ ] bundle size増加を継続確認できる。
- [ ] testが契約層別に分類され、catch-all重複が整理される。
- [ ] task Markdownのstatusとsuperseded関係が明示される。
- [ ] 各抽出PRで全test、production build、`git diff --check`が通る。
- [ ] UI、保存session、preview、approval、予定保存に回帰がない。

## 最終判定

今回確認した主要構造について、指摘箇所以外が完璧であるとは判定しない。下位moduleには良好な境界がある一方、上位UI/application層、repository接続、error boundary、static architecture guard、PR運用に追加の保守性課題がある。

PR #5の機能実装自体を、保守性だけを理由に直ちに全面破棄する必要はない。ただし、現在の巨大moduleへさらに責務を追加することは停止すべきである。

判定は「機能面の再レビューとは独立して、構造改善taskを必須化した条件付き採用」である。次の大規模機能開発より先に、Phase 0からPhase 3を少なくとも完了させることを推奨する。