# コードベース保守性レビューと段階的リファクタリング方針

Status: open
Created: 2026-07-17
Target repository: `kame447/StudyPlannner`
Target branch: `agent/weekly-planning-conversation-hardening`
Target head: `c348ec6e35df67bb637de64bb4e767a8a1138267`
Related PR: `#5 feat: 週間計画の対話と履歴を改善`

## 目的

現在のコードベースを、単一責任原則、状態の正規化、依存方向、読みやすさ、テスト容易性、変更容易性の観点から確認し、スパゲッティ化の有無と今後の保守リスクを判定する。

この文書はレビューと改善方針だけを記録する。production code、test code、設定ファイル、依存パッケージは変更しない。

## 参照した設計原則

本レビューでは、単にファイル行数だけで良否を判定しない。主に次の原則を用いる。

1. 単一責任原則

   モジュールやコンポーネントが持つ「変更理由」が一つに近いかを確認する。表示変更、永続化変更、業務ルール変更、外部API変更が同じファイルを修正させる場合、責務が集中していると判断する。

2. Reactの状態設計

   矛盾し得る状態、他の状態から導出できる重複状態、同じ情報の複製を避ける。複数のイベントハンドラへ状態遷移が散らばる場合は、Reducerや専用controllerへ集約する。

3. 依存性逆転と境界

   UIがstorage、AI client、approval protocol、scheduler内部型などの実装詳細を直接知り過ぎていないかを確認する。上位層は用途単位のinterfaceへ依存し、具体的な実装はcomposition rootで接続する。

4. Readable Code

   名前、処理順、局所性、抽象度を確認する。小さい関数へ分割されていても、一つのファイルが多数の業務段階を知っている場合は、構造上の複雑さが解消されたとはみなさない。

参考にした公式資料は、React公式の「Choosing the State Structure」「Extracting State Logic into a Reducer」、Microsoft LearnのSOLIDおよびapplication layer設計資料である。

## 結論

コードベース全体が無秩序なスパゲッティになっているわけではない。特に`src/features/weeklyPlanning/`以下には、`intake`、`dialogue`、`pipeline`、`planning`、`scheduling`、`trace`という機能境界があり、Action union、Reducer、閉じたruntime validation、property testも存在する。`WeeklyPlanningConversation.tsx`や`weeklyPlanningConversationMode.ts`のように、責務が小さく入力と出力が明確な実装もある。

一方、上位のUI・application orchestration層には部分的なスパゲッティ化が進んでいる。現状を端的に表すと、「比較的整理された下位モジュールの上に、巨大なcomposition component、god hook、巨大な複合フォームが載っている」状態である。

保守性の総合判定は中から高リスクである。現時点で全面書換えを行う必要はないが、`App.tsx`、`usePlannerDataState.ts`、`NaturalLanguageAssistant.tsx`、`QuickEntryModal.tsx`へ同じ形で機能を追加し続けるのは危険である。次の大規模機能追加より先に、境界を保った段階的リファクタリングを行うべきである。

## 良好な点

以下は概念レベルで並列な長所である。

1. `src/features/weeklyPlanning/`は、UIから独立したdomain/application処理を置く方向へ進んでいる。

2. `weeklyPlanningReducer.ts`は、pending turn、pending approval、revisionを一か所で検査し、非同期処理中の不正なmutationを抑止している。状態遷移を各componentの`setState`へ分散させていない点は良い。

3. `weeklyPlanningStorage.ts`は、保存値を信頼せず閉じたvalidatorで検査している。セキュリティと破損耐性の方針自体は妥当である。

4. `WeeklyPlanningConversation.tsx`は、会話履歴表示とtyping indicatorだけを扱う小さいpresentational componentになっている。

5. `weeklyPlanningConversationMode.ts`は、sessionの有無から初期表示を決める純粋関数であり、UIから判定ロジックを分離できている。

6. 回帰テストとproperty testが多く、非同期ownershipやstorage contractを振る舞いとして固定しようとしている。

これらは今後の分割方針の基準として維持する。

## 優先度別の指摘

以下は優先度が高い順に並べる。行数は問題そのものではなく、責務数と依存範囲を確認するための補助指標として扱う。

### P1-1. `usePlannerDataState.ts`がgod hookになっている

対象: `src/hooks/usePlannerDataState.ts` 約1200行

このhookは、予定、実績、日記、月間イベント、Todo、科目、教材、時間割term、時間割period、schedule templateを同時に管理している。さらに、repositoryアクセス、domain変換、繰り返し予定編集、データ正規化とmigration、画面遷移、editor状態、notice表示、診断ログまで同居している。

変更理由が明確に複数ある。例えば、時間割termの正規化を変更する場合、予定保存のエラーハンドリングと同じファイルを編集する。Todoの仕様変更でも、教材進捗や繰り返し予定の処理を含む巨大なhookを再確認する必要がある。これは単一責任原則に対する最も大きな違反である。

修正方針は、画面単位ではなくuse case単位に分ける。候補は次の通りである。

- `usePlanOperations`
- `useActualOperations`
- `useTodoOperations`
- `useStudyCatalogOperations`
- `useTimetableOperations`
- `usePlannerNavigationState`

これらを`usePlannerAppState`または小さいfacadeで束ねる。repository呼び出しとReact state更新の順序を変えないこと、既存の楽観的更新・失敗時復元・notice文言を先にcharacterization testで固定することが必要である。

### P1-2. `App.tsx`がcomposition rootを越えてapplication service化している

対象: `src/App.tsx` 約670行

`App.tsx`は、画面の組み立て、認証分岐、legal route、modal開閉、theme、access gateだけでなく、週間計画のturn ownership、request ID生成、message生成、approval ledgerのlocalStorage永続化、preview approval検証、通常予定への保存処理まで担当している。

特に`submitWeeklyPlanningTurn`と`approveWeeklyDraftBlocks`は、UIイベントハンドラではなく週間計画application workflowである。approval guard用のproposal record再構成、idempotency markerのmemo付与、重複保存検査まで`App.tsx`が知っているため、approval protocolの変更でroot componentを編集する必要がある。

修正方針は、`useWeeklyPlanningController`または同等のapplication controllerを設け、次をまとめて返すことである。

- 表示用の週間計画state
- turn送信command
- preview昇格command
- approval command
- reset、remove、clear command

approval ledgerは専用repositoryへ分離し、`App.tsx`はuser、plans、repository adapterをcontrollerへ接続するだけにする。Contextの導入は必須ではない。まずはroot componentからworkflowを外すことを優先する。

### P1-3. `NaturalLanguageAssistant.tsx`が二つの製品機能を一つに抱えている

対象: `src/components/NaturalLanguageAssistant.tsx` 約800行

このcomponentは、単発の自然言語予定追加・修正と、複数turnの週間計画を同時に扱う。さらに、AI呼び出し、提案編集、一括反映、会話入力、preview昇格、approval、日別preview移動、時間軸の座標計算、巨大なJSXを持っている。

`weeklyPlanningWeekStartDate`と`weeklyPlanningRevision`をpropsで受け取りながら`void`で捨てている点は、interfaceが実利用とずれている明確な兆候である。message ID生成も`App.tsx`側のfactoryとは別に存在し、同一概念の生成責務が分散している。

修正方針は、最初に次の二つへ機能境界を分けることである。

- `OneShotPlanAssistant`
- `WeeklyPlanningWorkspace`

その後、週間計画側を`WeeklyPlanningComposer`、`WeeklyPlanningPreview`、`WeeklyPlanningApprovalActions`へ分ける。previewの座標計算と集計はpure selectorへ移す。単にJSX断片を多数の小componentへ切るのではなく、状態所有者とuse case境界を先に決める。

### P1-4. `QuickEntryModal.tsx`に不可能状態を作りやすいstateが集中している

対象: `src/components/QuickEntryModal.tsx` 約700行

このmodalは、Todo、時間指定予定、繰り返し予定、実績、AI入力、週間計画、科目推定、教材推定、実績と予定の紐付けを扱う。多数の独立した`useState`と多数のpropsがあり、`entryKind`、`inputMethod`、`mode`、duration、repeat kind、material source、subject sourceの組合せによって、UI上は到達しない状態も型上は表現できる。

また、週間計画に関する多数のpropsを`App`から`NaturalLanguageAssistant`へ中継しており、modal自身の責務と関係しない変更でもinterfaceが拡張される。

修正方針は、modal shellと各formを分離することである。

- `QuickEntryModalShell`
- `TodoQuickEntryForm`
- `ScheduledPlanQuickEntryForm`
- `RecurringPlanQuickEntryForm`
- `ActualQuickEntryForm`
- `AiQuickEntryPanel`

フォーム状態はdiscriminated unionを持つReducerへ寄せる。例えば`kind: 'actual'`のstateにはrepeat設定を持たせず、`kind: 'recurring_plan'`だけがweekdaysを持つ形にする。これにより、条件式の組合せではなく型で不可能状態を排除できる。

### P1-5. 週間計画command contractの定義元が複数ある

対象:

- `weeklyPlanningCommandTypes.ts`
- `weeklyPlanningCommandRuntimeValidation.ts`
- `weeklyPlanningAiInterpreterCore.ts`
- `weeklyPlanningStorage.ts`
- commandを扱う各adapterとtest

同じcommandについて、TypeScript型、runtime validator、AI structured output用JSON Schema、prompt説明が別々に手書きされている。変更時に一つだけ更新してもcompilerが他の表現との差分を検出できない。

実際に`ConstraintSourceKind`とruntime validatorは`calendar`を許可する一方、AI schemaとsystem promptは`calendar`を明示的に許可していない。これがlegacy互換の意図的差分であっても、その差分を表す単一のcapability定義がないため、将来の変更者は不整合なのか仕様なのかをコードだけで判断しにくい。

修正方針は、command catalogを単一の所有境界に置くことである。最低限、次を一つのregistryまたは近接したmodule群から導出できるようにする。

- discriminator
- payload contract
- runtime validation
- AIが出力可能かどうか
- JSON Schema
- optional null canonicalization

全面的なschema library導入を先に決める必要はない。まず「どの定義が正本か」と「deterministic専用、AI出力可能、legacy読込専用の差」を明示する。

### P2-1. `PlanningState`に導出可能な重複状態がある

対象:

- `src/features/weeklyPlanning/types.ts`
- `src/features/weeklyPlanning/weeklyPlanningReducer.ts`

`mode`は、`draftBlocks`、`previewCandidates`、`messages`、`intakeState`、pending stateから多くの場合に導出できる。Reducer内では各actionがnested ternaryを使って`mode`を手動更新しており、新しいaction追加時に更新漏れが起きる可能性がある。

`lastAssistantMessage`も`messages`の末尾から導出できるため、同じ情報を二重に保持している。二つの値が一致する保証をすべてのactionが負担している。

修正方針は、まずselectorで導出している利用箇所へ移し、保存契約への影響を確認した後にstateから削除することである。削除が難しい場合でも、更新を一つの共通関数だけに限定する。

### P2-2. pipelineが段階を持つが、段階境界が型として弱い

対象:

- `weeklyPlanningIntakePipeline.ts` 約640行
- `weeklyPlanningBehaviorAwareIntakePipeline.ts` 約520行

両pipelineは、解釈、command validation、state適用、clarification、assumption lifecycle、draft request生成、scheduling dry-run、feasibility、dialogue planning、traceを扱う。各処理は関数化されているが、上位moduleが全段階の詳細を知っているため、追加仕様が同じorchestratorへ積み上がりやすい。

修正方針は、pipelineを次の明示的なstageへ分け、各stageのinputとoutputを型で固定することである。

1. interpret
2. validate and canonicalize
3. reduce intake state
4. resolve assumptions and corrections
5. build planning request
6. schedule preview
7. choose dialogue action
8. record trace

stage間のdata contractを固定し、後段が前段の内部データへ直接アクセスしないようにする。ファイルを細かくすること自体ではなく、処理順と依存方向を明示することが目的である。

### P2-3. `weeklyPlanningStorage.ts`がdomain schemaの複製場所になっている

対象: `src/features/weeklyPlanning/weeklyPlanningStorage.ts` 約660行

保存値を厳密に検査する方針は正しい。しかし、PlanningState、intake state、draft block、preview candidate、behavior metadataの全validatorとenum集合を一つのstorage fileが所有しているため、domain型の変更がstorageの巨大なswitch・validator修正へ波及する。

修正方針は、aggregateごとのruntime decoderを所有moduleの近くへ置き、storageはversion判定、migration、aggregate decoder呼び出し、保存だけを担当することである。旧version互換と現在version validationを同じ関数へ混ぜない。

### P2-4. `quick-entry.css`がdeep markupへ依存している

対象: `src/styles/quick-entry.css` 約1570行

manual entry、AI assistant、週間計画会話、preview、confirmation画面のstyleが一つのfileに集まっている。`:has(.weekly-draft-preview)`や`:has(.weekly-planning-confirmation-screen)`で親modalのlayoutを子孫要素から切り替えており、子componentのclass名変更が親layoutを壊す。

修正方針は、feature単位にstyleを分け、rootへ`data-layout="weekly-preview"`のような明示的状態を渡すことである。CSSがDOM内部を探索してapplication modeを推測しない構造にする。

### P2-5. 静的な保守性チェックが不足している

対象: `package.json`

現状のscriptにはTypeScript buildとVitestはあるが、lint、format check、import boundary、循環依存検査がない。テストが多くても、未使用props、依存方向の逆流、巨大moduleへの新規責務追加を自動では止められない。

修正方針は、一度に厳しい数値制限を導入するのではなく、次の順で追加する。

1. unused import、React Hooks、危険な型逃げを検出するlint
2. CIでのformat check
3. `components`から`features/*/internal`へ直接依存しない境界規則
4. 循環依存検査
5. 新規または変更fileだけを対象とするcomplexity監視

既存fileへ機械的な行数上限を掛けるだけでは、意味のない分割を誘発するため採用しない。

### P3-1. dependency injectionの適用範囲が中途半端である

対象: `weeklyPlanningTurnExecutor.ts`、AI interpreter factory周辺

`weeklyPlanningTurnExecutor.ts`自体は約100行で、application orchestrationとして比較的読みやすい。一方、内部でglobal AI configを取得し、concrete interpreterとrendererを生成している。単体テストやprovider差替えの境界がfactory defaultへ依存している。

これは直ちに大きな問題ではないが、controller分離時に`WeeklyPlanningDependencies`としてAI interpreter、dialogue renderer、clock、ID factoryを注入できる形へ揃えると、UIと外部実装の結合を下げられる。

## 推奨する実施順

次の順序は、互いに独立した項目の列挙ではなく、回帰リスクを抑えるための依存順である。

### Phase 0. 現行挙動の固定

既存のproperty testと回帰testを維持し、`App.tsx`、`usePlannerDataState.ts`、`NaturalLanguageAssistant.tsx`、`QuickEntryModal.tsx`から抽出する処理についてcharacterization testを先に追加する。

この段階では責務移動だけを行い、文言、保存形式、UI、scheduler結果を変更しない。

### Phase 1. 週間計画controllerを`App.tsx`から抽出

`submitWeeklyPlanningTurn`、approval workflow、ledger persistence、message/request ID生成を専用controllerとrepositoryへ移す。`App.tsx`の役割をrouting、global state接続、view compositionへ戻す。

### Phase 2. `NaturalLanguageAssistant`を二つの機能へ分割

単発AI入力と週間計画を分離し、週間計画previewのselectorと表示componentを抽出する。未使用propsを削除し、週間計画の操作群は一つのcontroller objectとして渡す。

### Phase 3. `QuickEntryModal`をshellとformへ分割

manual formをkind別に分け、Reducerのdiscriminated unionで不可能状態を排除する。AI入力は独立panelとして接続する。

### Phase 4. `usePlannerDataState`をuse case別に分割

まず時間割と教材管理のように依存が比較的独立した領域から抽出し、その後に予定・実績・繰り返し予定を分ける。移行中は`usePlannerAppState`の外部interfaceを維持し、呼び出し側を一度に変更しない。

### Phase 5. command contractとstorage decoderを整理

正本となるcommand catalogを定め、AI schema、runtime validation、source capabilityを近接させる。storage validatorはaggregate decoderへ分割し、version migrationと現在schema validationを分離する。

### Phase 6. architecture guardをCIへ追加

lint、format、dependency boundary、cycle detectionを導入し、再びroot componentやgod hookへ責務が戻らないようにする。

## 各Phaseの共通禁止事項

以下は概念レベルで並列な禁止事項である。

- ファイル行数を減らすためだけの機械的分割をしない。
- props drillingを消すことだけを目的にglobal Contextへ全stateを移さない。
- 既存Reducerの非同期ownership契約を、単純な`useReducer`置換で失わない。
- UI分割とdomain仕様変更を同じPRで行わない。
- storage version変更をmigrationなしで行わない。
- testを通すために型を`any`や広い`Record<string, unknown>`へ弱めない。
- 現在の厳格なruntime validationを、保守性を理由に削除しない。

## 完了判定

このレビュー文書の対応は、次の条件を満たした時点で完了とする。

- [ ] `App.tsx`が週間計画workflowとledger実装を直接持たない。
- [ ] `NaturalLanguageAssistant.tsx`が単発予定提案と週間計画の両方を所有しない。
- [ ] `QuickEntryModal.tsx`がTodo、予定、繰り返し、実績、AIの全form stateを単独所有しない。
- [ ] `usePlannerDataState.ts`が全planner entityのCRUDとUI navigationを単独所有しない。
- [ ] commandのTypeScript型、runtime validation、AI出力可否の正本が明示される。
- [ ] `PlanningState.mode`と`lastAssistantMessage`の重複状態を維持するか削除するかが決定され、更新責務が一か所になる。
- [ ] storage version、migration、current decoderの責務が分離される。
- [ ] feature間のimport boundaryと循環依存をCIで検査できる。
- [ ] 各抽出PRで全テスト、production build、`git diff --check`が通る。
- [ ] UI、保存済みsession、preview、approval、予定保存の既存挙動に回帰がない。

## 最終判定

保守性だけを理由にPR #5を直ちに採用不可とするほど、全体構造が崩壊しているわけではない。しかし、今回の変更で追加された週間計画責務が`App.tsx`と既存の巨大componentへ流入しており、この形を標準化してはいけない。

したがって判定は「条件付き採用、構造改善を次の大規模機能より先に実施」である。最優先は全面書換えではなく、`App.tsx`から週間計画controllerを抽出し、`NaturalLanguageAssistant`と`QuickEntryModal`の状態所有境界を分けることである。並行して`usePlannerDataState`の分割計画を立てる。
