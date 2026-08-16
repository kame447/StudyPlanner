# StudyPlanner Project Map

この文書は、StudyPlanner の「現在どの責務がどこにあるか」を最短で把握するための索引である。実装仕様を複製する巨大な仕様書ではなく、各機能の canonical implementation、関連する契約文書、テスト、永続化境界へ到達するための地図として扱う。

この文書がコードやテストと矛盾した場合、この文書を正しいものとしてコードを合わせてはならない。まず `main` の実装、契約、テストを確認し、この文書側の陳腐化を疑う。未マージの branch / PR は canonical state に含めない。責務の移動、正規入口の変更、legacy 経路の廃止を行う PR では、同じ PR でこの文書も更新する。

以下の各節は、原則として責務単位で並列に配置している。単なるファイル列挙ではなく、「変更理由が同じものをどこで探すべきか」を示すことを目的とする。

## 1. Source of Truth の階層

`PROJECT_MAP.md` は architecture index であり、挙動そのものの唯一の真実ではない。現在の挙動は `src/`、`workers/`、`firestore.rules` などの実装によって決まり、期待される契約は colocated tests、`docs/weekly-planning/weekly-planning-spec.md`、`docs/architecture/` の現行設計文書によって補強される。

`README.md` はプロダクト概要、主要機能、起動方法、現在の到達点を把握する入口である。`docs/weekly-planning/weekly-planning-spec.md` は週間計画のユーザー向け・機能的契約を調べる入口であり、`docs/architecture/` は週間計画の会話、availability、semantic schema、trace などの設計判断を調べる入口である。`docs/testing/` はテスト運用、`docs/ai/` はAI関連の監査記録や作業資料を置く場所である。

`AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、`.claude/skills/` は各実装エージェント向けの運用指示であり、アプリケーション仕様の Source of Truth として扱わない。特定エージェント用の指示と実装が食い違う場合、まず現在のコードと現行契約を確認する。

## 2. アプリケーション起動と全体構成

### `src/main.tsx`

ブラウザ上で React アプリケーションを起動する bootstrap entry point である。provider や root mount の変更はここから追う。

### `src/App.tsx`

アプリケーション全体の composition root に近い役割を持つ。認証状態、主要画面、モーダル、週間計画を含むアプリケーション機能の接続関係を追う入口である。個別機能の business rule を新しくここへ集約せず、各 feature / hook / domain 側へ委譲する。

### `index.html` と Vite 設定

`index.html` はフロントエンドHTML入口であり、`vite.config.mjs`、`tsconfig*.json`、`package.json` が build / TypeScript / test の実行契約を持つ。通常のローカル検証は `npm run typecheck`、`npm run test:run`、`npm run build` をまとめた `npm run verify` が基本入口である。

## 3. UI 層

### `src/components/`

React の画面・dialog・modal・表示コンポーネントを所有する。ここでは表示とユーザー操作の受け渡しを主責務とし、永続化方式や週間計画の意味解釈・readiness・scheduler の規則を直接所有しない。

日単位の画面は `DayView.tsx` を中心に、`DayTimeline.tsx`、`DayDetailModal.tsx`、`DayCalendarDialog.tsx`、`DayTimetableImportDialog.tsx` などへ分離されている。教材・科目管理は `BookshelfView.tsx`、`BookshelfMaterialDialog.tsx`、`BookshelfSubjectDialog.tsx`、`BookshelfDialogFields.ts` が主要入口である。管理画面は `AdminApp.tsx`、`AdminGuard.tsx`、`AdminViews.tsx`、`AdminUsersPage.tsx`、`AdminUserDetailPage.tsx`、`AdminReportViews.tsx` が主要入口である。

認証・初期設定は `AuthScreen.tsx`、`AuthAccessGateForm.tsx`、`InitialPrivacyConsentScreen.tsx`、`InitialWeekStartPreferenceScreen.tsx` などを入口とする。設定とAI runtime UI は `AppSettingsDialog.tsx`、`AiRuntimeSettings.tsx`、`AppSettingsSupportPanel.tsx` を追う。実績入力・追跡は `ActualEditorCard.tsx`、`ActualTrackingTools.tsx`、`FloatingActualTrackingPanel.tsx` などを入口とする。

週間計画の UI を変更する場合も、会話状態や承認判定そのものは `src/features/weeklyPlanning/` 側を正規実装として扱う。component 側へ同じ判断を再実装しない。

## 4. React state と UI orchestration

### `src/hooks/`

複数コンポーネントを跨ぐ React state、画面操作、repository 接続の orchestration を所有する。`usePlannerAppState.ts` はアプリ全体の操作を束ねる入口、`usePlannerDataState.ts` は予定・実績など主要データ状態の大きな入口である。認証は `useAuthSessionState.ts`、管理者情報は `useAdminData.ts` / `useAdminStatus.ts`、月送りは `useMonthPager.ts`、テーマは `useThemePreference.ts`、iOS viewport 対応は `useIOSViewportFocusGuard.ts` を追う。

hook は UI と application/domain の接続層として扱い、同じ domain rule を複数 hook に複製しない。週間計画の承認など feature 固有の規則は feature application API を経由する。

## 5. 一般ドメイン

### `src/domain/planner.ts`

予定管理に関するドメイン処理の入口である。UI 表示や Firebase 実装ではなく、予定という概念そのものの処理を探す場合に参照する。

### `src/domain/recurringPlan.ts`

繰り返し予定のドメイン処理を所有する。繰り返し生成・解釈の business rule を UI や repository adapter に重複させない。

## 6. User Planning Context

### `src/features/userPlanningContext/`

週間計画単一セッションを越えて参照する利用者の planning context を扱う feature である。`userPlanningContextSpace.ts` が状態空間・更新処理の主要入口、`userPlanningContextTypes.ts` が型契約を所有する。concern history や context space の期待挙動は同ディレクトリのテストで確認する。

一時的な発話上の条件を無条件に長期プロフィールへ昇格させない。週間計画固有の一時 state と、長期的に再利用する planning context は別責務として扱う。

## 7. 週間計画 feature の全体境界

### `src/features/weeklyPlanning/`

対話型週間計画の canonical feature root である。自然言語の意味理解、Fact / state の更新、確認、readiness、計画、availability、scheduler、preview、approval、保存、trace、eval を一つの巨大ファイルで処理せず、責務別の directory と facade に分離している。

基本原則は、AI が自然言語の意味理解・構造化を担当し、確認要否、進行方針、Fact lifecycle、revision、idempotency、readiness、scheduler、preview、approval、save などの権限を deterministic code が保持することである。AI 出力は候補であり、validation と state transition を迂回して直接 truth にしない。

root 直下の `types.ts` は feature 横断型、`weeklyPlanningReducer.ts` は state transition、`weeklyPlanningStorage.ts` と `weeklyPlanningOwnedStorage.ts` は client-side persistence / ownership、`weeklyPlanningTurnController.ts` と turn executor 系は一回の turn 実行境界、`weeklyPlanningTransforms.ts` は状態・表現間の変換を追う入口である。これらに新しい別責務を追加する前に、既存の責務別 directory へ置けないかを確認する。

### `src/features/weeklyPlanning/application/`

UI から週間計画 subsystem を利用する application boundary である。`useWeeklyPlanningApplication.ts` が React 側の主要 facade であり、session lifecycle、approval application、approval persistence policy、runtime lookup / resolver、外部 source 接続など、複数下位責務を一つのユースケースとして協調させる。

承認・保存経路を変更する場合は `weeklyPlanningApprovalApplication.ts`、availability 再確認は `weeklyPlanningApprovalAvailability.ts`、session ownership / lifecycle は `weeklyPlanningSessionLifecycle.ts` を主要入口として追う。UI から下位 singleton や persistence fallback 順序を直接選ばせず、application boundary に隠蔽する。

### `src/features/weeklyPlanning/intake/`

ユーザー turn から週間計画に必要な入力候補を受け取り、質問文脈、欠落情報、仮定、訂正などの intake concern を扱う。ここは raw text を最終 semantic truth にする場所ではなく、deterministic に安全に確定できるものと semantic interpretation へ渡すものを区別する境界である。

### `src/features/weeklyPlanning/semantic/`

AI を用いた意味理解、semantic schema、candidate normalization、grounding、correction / repair、validation を扱う中心である。モデル出力を application state へ直書きせず、typed candidate として閉じた validation を通す。モデル変更や prompt 簡素化を検討する場合はこの directory と `docs/architecture/weekly-planning-semantic-schema-registry.md`、semantic 関連テストを一緒に確認する。

### `src/features/weeklyPlanning/parsing/`

日付・時刻・数量・明示的な短答など、機械的に安全に解釈できる入力の parsing / normalization を扱う。ここへ日本語 keyword / regex を増やしてユーザー発話の意味全体を再解釈する経路を作らない。semantic ownership と deterministic syntax handling の境界を保つ。

### `src/features/weeklyPlanning/dialogue/`

「次に何を確認するか」「どの dialogue action を実行するか」「ユーザーへ何を表示するか」という対話制御を扱う。確認要否や進行可否は deterministic state に基づいて決め、AI が勝手に質問順序や保存可否を決定する構造にしない。grounding、question plan、renderer、repair agenda、表示文言を変更する場合の主要探索先である。

### `src/features/weeklyPlanning/pipeline/`

intake、semantic、state update、dialogue、planning などの処理を turn 単位で接続する orchestration layer である。pipeline 自体に各 domain rule を重複実装せず、それぞれの owner を呼び出す。

### `src/features/weeklyPlanning/planning/`

収集済みの canonical facts / constraints から、計画可能性、task の実行形状、必要条件などを deterministic に評価する領域である。AI が必要時間や計画可否を再計算するのではなく、検証済み状態を planning logic へ渡す。

### `src/features/weeklyPlanning/scheduling/`

利用可能区間と hard constraint を前提に、作業単位を具体的な時間へ配置する deterministic scheduler の所有場所である。既存予定や固定予定との競合、利用可能時間、配置可能量など、時間配置アルゴリズムの変更はここから追う。

### `src/features/weeklyPlanning/preview/`

scheduler が生成した未保存候補を preview として扱う責務を持つ。provenance、revision、参照 fact、仮定依存、候補 lifecycle など、保存前に必要な情報を追う。preview と確定済み通常予定を同一状態として扱わない。

### `src/features/weeklyPlanning/personalization/`

利用者固有の傾向や preference を週間計画へ安全に反映する責務を持つ。hard constraint や明示的な現在条件より優先させず、弱い推測を確定事実へ昇格させない。

### `src/features/weeklyPlanning/config/`

週間計画 feature 固有の設定・policy 値の置き場所である。runtime 設定と business rule を混同せず、変更時は利用側テストも確認する。

### `src/features/weeklyPlanning/profiling/`

週間計画 runtime の profiling / 計測に関する concern を隔離する。会話結果そのものの truth や scheduler rule をここで変更しない。

### `src/features/weeklyPlanning/trace/`

conversation / correction / runtime の追跡可能性を担う。デバッグ、監査、再現のための trace を扱うが、trace から business state を逆算して truth を作らない。関連する設計文書は `docs/architecture/weekly-planning-conversation-trace.md` である。

### `src/features/weeklyPlanning/evals/`

実会話に近いシナリオ、preview correction lifecycle、resumable conversation などの品質評価を置く。単体テストだけでは検出しにくい会話品質の回帰を確認する場所であり、モデル・prompt・heuristic の変更ではここを重点確認する。

### `src/features/weeklyPlanning/__tests__/`、`testFixtures/`、`testUtils/`

feature 横断の integration / regression test、再利用 fixture、test helper を所有する。新しい production responsibility を置かない。

## 8. 単発予定の自然言語入力

### `src/services/natural-language/`

単発予定の自然言語解析 pipeline の正規探索先である。`README.md` に記載されている `normalize → tokenizer → clause-parser → build-ast → lower-ir → compile → validate` の段階的処理を追う場合はこの directory を見る。各段階の assumption、diagnostic、unresolved field を保持し、解析結果をそのまま無検証で保存しない。

### `src/services/naturalLanguagePlanner.ts` と `src/services/naturalLanguageRules.ts`

既存の単発予定自然言語処理との互換・統合経路を含む大きなファイルである。`README.md` が旧 fallback を段階的に残していると説明しているため、新しい parser responsibility を無条件にここへ追加するのではなく、まず `src/services/natural-language/` の段階的 pipeline に置けるかを確認する。

### `src/data/naturalLanguageCatalog.json` と `naturalLanguageCatalog.ts`

自然言語解析で利用する catalog data とその型付きアクセスを所有する。解析アルゴリズムそのものとは分離して扱う。

## 9. Repository / persistence boundary

### `src/repositories/`

認証・予定データの永続化方式を application / domain から切り離す境界である。`repositoryContracts.ts` が repository 契約、`createRepositories.ts` が生成入口、`plannerRepository.ts` と `authRepository.ts` が抽象化の主要入口である。

Firebase 実装は `firebasePlannerRepository.ts`、`firebaseAuthRepository.ts`、`firebaseRepositories.ts` を追う。local fallback は `localStorageGateway.ts` と `localStorageStore.ts` を追う。backend 不可時の明示的な unavailable behavior は `unavailableRepositories.ts` が入口である。

呼び出し側が Firebase / localStorage の fallback 順序や concrete implementation を知る構造を増やさず、repository contract を通して利用する。

## 10. Shared library

### `src/lib/`

日付、ID、予定・実績の変換、月表示 projection、教材 pace、AI config、Firebase client、画像処理、admin analytics など、複数箇所から再利用される deterministic helper / shared integration utility を置いている。

代表的な入口として、日付処理は `date.ts`、実績は `actualTracking.ts` / `actualPlanMatching.ts`、教材は `bookshelfMaterials.ts` / `materialPace.ts` / `materialSubject.ts`、月表示は `monthEvents.ts` / `monthEventEditor.ts` / `monthViewProjection.ts`、AI 設定は `aiConfig.ts` / `aiModelPolicy.ts`、Firebase client は `firebaseClient.ts` / `firebaseConfig.ts` を追う。

`src/lib/` を新しい機能の雑多な置き場にしない。特定 feature だけが所有する変更理由を持つ処理は、可能な限りその feature / domain 側へ置く。

## 11. Service / external integration boundary

### `src/services/`

外部サービスやアプリケーションサービス寄りの処理を置く。管理機能は `adminService.ts` / `adminDataService.ts`、評価処理は `evaluationService.ts`、AI provider / client との接続は `src/services/ai/` を入口とする。

AI provider の通信責務と、週間計画の semantic policy は別物である。provider 接続は service 側、何を semantic candidate として許可するかは `src/features/weeklyPlanning/semantic/` 側で所有する。

## 12. 共通型・style・asset

### `src/types/`

複数 feature / layer から参照される共有型を置く。特定 feature だけで閉じる型は、その feature 内へ置くことを優先する。

### `src/styles.css` と `src/styles/`

アプリ共通 styling と分割 style を所有する。表示ロジックや domain rule を style 層へ持ち込まない。

### `src/assets/` と `public/`

bundled asset と静的配信 asset を所有する。

## 13. Firebase と backend boundary

### `firestore.rules`

Firestore の authorization / access control の Source of Truth である。client 側のチェックだけを security boundary とみなさない。

### `.firebaserc` と `firebase.json`

Firebase project / deploy 設定を所有する。Firestore rules の deploy は `npm run deploy:firestore-rules` が入口である。

### `workers/ai-proxy/`

AI API への server-side proxy boundary である。秘密情報、provider request、proxy 側の policy / observability を調べる場合の入口であり、deploy は `npm run deploy:worker` を使う。

## 14. Test と CI

### Colocated `*.test.ts` / `*.test.tsx`

production code の近くに置かれた単体・property・integration test が、その責務の具体的な回帰契約を持つ。ファイルを変更した場合は、同名・同責務の colocated test を最初に探す。

### `package.json`

Vitest の全体実行は `npm run test:run`、単発予定自然言語 pipeline は `npm run test:nl:run`、週間計画会話の foundation regression は `npm run test:weekly-ai:conversation:foundation`、週間計画 mutation test は `npm run test:mutation:weekly-planning` が入口である。全体の静的・テスト・build 検証は `npm run verify` を基本とする。

### `.github/workflows/`

CI、browser regression、週間計画の full / resumable conversation command、trace deployed contract など GitHub Actions の実行定義を所有する。ローカルテストが通っても workflow 固有の契約がある場合はここを確認する。

## 15. 設計文書の探索先

### `docs/weekly-planning/weekly-planning-spec.md`

週間計画の現行機能仕様を確認する第一候補である。

### `docs/weekly-planning/codex-implementation-guide.md`

週間計画を実装する際の詳細な作業・設計ガイドである。実装と食い違う場合は current code / tests を再確認する。

### `docs/architecture/weekly-planning-dialogue-architecture-v5.md`

週間計画 dialogue architecture の現行系列を確認する入口である。同 directory の v4 文書は過去設計との比較が必要な場合に参照する。

### `docs/architecture/weekly-planning-availability-architecture-v5.md`

利用可能時間、hard constraint、availability 系の設計を確認する入口である。

### `docs/architecture/weekly-planning-semantic-schema-v5.md` と `weekly-planning-semantic-schema-registry.md`

semantic schema と registry の設計・契約を確認する入口である。

### `docs/architecture/weekly-planning-conversation-trace.md`

会話 trace の構造・用途を確認する入口である。

### `docs/architecture-review.md`

全体構造のレビュー記録である。現在実装の truth として固定せず、技術的負債や過去の判断を調査する補助資料として扱う。

## 16. 変更内容から正規探索先を決める規則

画面の見た目や modal / dialog の責務なら `src/components/`、React state の協調なら `src/hooks/`、予定そのものの規則なら `src/domain/`、永続化方式なら `src/repositories/`、外部 API 接続なら `src/services/` を最初に調べる。

週間計画では、自然言語の意味理解なら `semantic/`、機械的 parsing なら `parsing/`、入力収集なら `intake/`、確認と会話進行なら `dialogue/`、turn 接続なら `pipeline/`、計画可否なら `planning/`、時間配置なら `scheduling/`、未保存候補なら `preview/`、承認・session lifecycle なら `application/`、追跡なら `trace/`、品質シナリオなら `evals/` を正規探索先とする。

同じ機能が複数場所に見える場合、「どのファイルから呼ばれているか」だけで所有者を決めず、「どの変更理由を所有する責務か」で決める。caller が singleton、fallback 順序、内部 condition、provider 実装などを知り始めた場合は、facade / application API の境界が漏れていないかを疑う。

## 17. Legacy / compatibility の扱い

ファイル名が古そうという理由だけで legacy と判定しない。現行 caller、tests、docs を確認してから扱う。ただし、`README.md` が単発予定自然言語解析について旧 fallback を段階的に残していることを明記しているため、`src/services/naturalLanguagePlanner.ts` / `naturalLanguageRules.ts` と `src/services/natural-language/` の関係を変更する場合は compatibility path の有無を必ず調べる。

週間計画でも `StableV5`、compatibility、migration などの名前を持つ経路を見つけても、名前だけを根拠に削除しない。current application facade、turn executor、regression test から到達可能かを確認する。

## 18. この文書の更新規則

新しい主要 feature を追加した場合、その責務、canonical directory、主要 facade、テスト入口、関連設計文書をこの文書へ追加する。責務を別 directory へ移した場合は古い path を残さず、同じ PR で地図を更新する。temporary branch や未マージ PR の状態は書かない。

leaf file を機械的に全件列挙することは目的にしない。新しいセッションの人間やAIがこの文書を読み、「どこを見れば本当の実装に到達できるか」「どこへ新しい責務を置くべきか」「どのテストで確認すべきか」を短時間で判断できる粒度を維持する。