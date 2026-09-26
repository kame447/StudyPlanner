# StudyPlanner

[![CI](https://github.com/kame447/StudyPlanner/actions/workflows/ci.yml/badge.svg)](https://github.com/kame447/StudyPlanner/actions/workflows/ci.yml)
[![Browser Regression](https://github.com/kame447/StudyPlanner/actions/workflows/browser-regression.yml/badge.svg)](https://github.com/kame447/StudyPlanner/actions/workflows/browser-regression.yml)

学習計画、実績、教材、時間割を一元管理し、自然言語を使った週間計画の作成を支援する Web アプリケーションです。

StudyPlanner は、学習予定と実績を分けて記録し、教材・時間割・進捗を含む情報から次の学習計画を作成します。AI は自然言語の解釈に利用し、スケジューリング、状態更新、承認、保存はアプリケーション側で管理します。

## 主な機能

### スケジュール管理

月・週・日単位で予定を確認し、作成、編集、削除、実績記録を行えます。予定と実績は別データとして扱い、計画どおりに進んだかを後から確認できます。

学習予定と一般予定は canonical な `ScheduleEvent` を保存上の正本とし、共通の `ScheduleOccurrence` projection を通じて月・週・日・AI計画が同じ occurrence identity / time / busy semantics を参照します。`TimetableTemplate` は別の template lifecycle を維持したまま occurrence projection へ合流し、同じ source から import 済みの Plan がある場合は二重表示・二重 busy を防ぎます。Issue #278 の移行と consumer 統合は完了済みです。正仕様は [`docs/domains/scheduling/`](./docs/domains/scheduling/README.md) にあります。

### AI 計画

チャット形式で学習対象、進捗、期限、利用できない時間、希望時間帯などを伝えると、既存予定や時間割を考慮して週間計画を作成します。生成結果はプレビューとして表示され、修正または承認した後に予定へ保存されます。

学習戦略・教材選択・進める順序・目安期限を予定作成前に相談し、AI の助言をユーザーが採用した場合だけ通常の計画へ接続する機能を Issue #246 で設計中です。これは未実装の planned capability であり、現在の production 機能としては扱いません。正仕様は [`learning-consultation-and-advice.md`](./docs/domains/weekly-planning/spec/learning-consultation-and-advice.md) にあります。

### 教材・進捗管理

教材や学習対象を登録し、現在の進捗を管理できます。書籍教材の追加では ISBN または教材名から共有 catalog / NDL Search を使った候補検索を利用でき、検索を使わず従来どおり手入力でも登録できます。外部書誌は候補情報として扱い、教科・進捗・章構造・学習量は StudyPlanner 側が所有します。

### ホーム・時間割

ホームでは、今日の予定、次の予定、週間の進捗、継続状況をまとめて確認できます。時間割は授業などの固定予定として管理し、週間計画の空き時間計算にも利用します。

### 学習レポート

ホームの週間進捗から、今日・今週・今月・累計の学習時間、期間ごとの推移、教材・科目別の内訳を確認できます。レポートは主要タブではなく、ホームから必要なときに開く二次画面として扱います。

### レスポンシブ UI

デスクトップ、タブレット、スマートフォンに対応し、ライトモードとダークモードを利用できます。

## AI 計画の設計

週間計画では、AI を意思決定主体として扱いません。AI が担当するのは、ユーザーの発話と会話文脈を構造化された意味へ変換する部分です。

検証、状態管理、確認要否、空き時間計算、スケジューリング、プレビュー、承認、保存はアプリケーション側が管理します。計画へ大きく影響する情報が曖昧な場合はユーザーへ確認し、保存前には明示的な承認を要求します。

```text
User input
    ↓
AI semantic interpretation
    ↓
Validation / application state
    ↓
Scheduler
    ↓
Preview
    ↓
User approval
    ↓
Save
```

Issue #246 の planned consultation extension でもこの責任境界を維持します。AI が教材・学習順序・目安期限を提案しても、その回答は user fact、accepted planning condition、preview、saved Plan、durable memory のいずれにも自動昇格しません。ユーザーが採用した scope だけを既存 Stable V5 の planning flow へ戻します。

週間計画の正仕様は [`docs/domains/weekly-planning/`](./docs/domains/weekly-planning/README.md) に集約しています。runtime の責務境界は [`current-contract-v5.md`](./docs/domains/weekly-planning/architecture/current-contract-v5.md)、planned learning consultation の要件は [`learning-consultation-and-advice.md`](./docs/domains/weekly-planning/spec/learning-consultation-and-advice.md) を参照してください。

## 技術構成

フロントエンドは React 18、TypeScript、Vite で構成しています。認証には Firebase Authentication を利用します。永続化は責務別に分かれており、通常の planner data は Firebase / Cloud Firestore repository を中心に扱う一方、週間計画の conversation / working session state には現状 localStorage-backed storage も残っています。client-side execution、local durable state、server authority の現在境界と移行条件は [`docs/domains/client-runtime/`](./docs/domains/client-runtime/README.md) を正本として扱います。公開環境から AI provider へ接続する際は Cloudflare Workers を gateway として利用します。

時間が確定した予定の永続化正本は canonical な `ScheduleEvent` です。月・週・日・AI計画は保存形式を個別に再解釈せず、`src/domain/scheduleOccurrence.ts` の共通 `ScheduleOccurrence` projection を利用します。legacy `Plan` / `MonthEvent` は migration 入力・compatibility shape として残り得ますが、post-cutover の第二の write authority ではありません。現在の責任境界は [`scheduled-event-authority.md`](./docs/domains/scheduling/architecture/scheduled-event-authority.md) を参照してください。

管理・分析 console は、UI から planner collection を都度全件 scan する構造を最終形にせず、lightweight telemetry、集計 read model、restricted diagnostic trace を分離する方針です。正仕様は [`docs/domains/product-observability/`](./docs/domains/product-observability/README.md) を参照してください。

外部 API は provider 固有 response を product domain へ直接流さず、Cloudflare Worker 上の integration boundary で正規化します。書籍教材の初期実装では共有 catalog を先に参照し、miss 時だけ NDL Search へ問い合わせることで外部依存と不要な request を抑えます。

テストには Vitest、fast-check、Playwright を使用し、CI は GitHub Actions で実行します。

実装上の責務と主要ディレクトリは [`PROJECT_MAP.md`](./PROJECT_MAP.md) にまとめています。

## 開発環境

Node.js と npm が必要です。

```bash
npm install --cache .npm-cache
npm run dev
```

Firebase や AI gateway を設定しなくても、一部機能はローカル fallback で確認できます。本番相当の認証、保存、AI 接続を確認する場合は環境設定が必要です。

### 環境変数

Firebase と AI proxy を利用する場合は `.env.local` または `.env` に設定を追加します。

```bash
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_APP_ID=your-app-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id
VITE_FIREBASE_MEASUREMENT_ID=
VITE_CLOUDFLARE_AI_PROXY_URL=https://your-worker-name.your-subdomain.workers.dev
VITE_APP_ACCESS_KEY=shared-preview-key
```

Firestore Rules は次のコマンドでデプロイします。

```bash
npm run deploy:firestore-rules
```

### AI gateway

公開環境では AI provider の secret をフロントエンドへ埋め込まず、Cloudflare Workers 側に設定します。

```bash
npx wrangler login
npx wrangler secret put OPENAI_API_KEY --config workers/ai-proxy/wrangler.jsonc
npx wrangler secret put OBSERVABILITY_IDENTITY_SECRET --config workers/ai-proxy/wrangler.jsonc
npm run deploy:worker
```

`OBSERVABILITY_IDENTITY_SECRET` は telemetry 上の利用者識別子を Firebase UID から分離するための server-only secret です。十分に長いランダム値を設定し、フロントエンドへ公開しないでください。

`workers/ai-proxy/wrangler.jsonc` の環境設定はデプロイ先に合わせて設定してください。

### Jev focused authorization（OpenRouter）

[Issue #305](https://github.com/kame447/StudyPlanner/issues/305) の初回対象だけを実装しています。既存の認証済み `/chat/completions` に用途を限定したdecision contextを渡し、Worker内のprovider port / OpenRouter adapterで判定します。既存のfocused生成LLM、generic semantic、承認・保存の境界は維持します。TypeSafe直結やCloudflare Workers AIへの切替は、このprovider portへ別adapterを実装する責務です。

OpenRouterのserver-only secretは次で登録します。値を引数、ソース、Issue、ログへ貼らないでください。

```bash
npx wrangler secret put OPENROUTER_API_KEY --config workers/ai-proxy/wrangler.jsonc
```

既定値は `JEV_MODE=off` / `JEV_CANARY_PERCENT=0` です。`shadow` はWorkerの `waitUntil` 内で比較記録だけを行い、既存LLMの応答を待たせず、Jevから正式状態を書き換えません。`canary` は明示した5・25・100%でのみ選択されます。現在の閾値は未校正なので、日本語gold/holdout評価と#152の該当security gateが完了するまで本番canaryを有効化しません。rollbackは `off` へ戻してWorkerを再デプロイします。今回の実装自体はデプロイや本番有効化を行いません。

モデルは `workers/ai-proxy/src/decision/decisionPolicy.ts` へ集約しています。要求は固定release `typesafe/jev-1.13`、応答は公式に確認したrelease/dated snapshotのみ許可し、`latest` や未検証snapshotへの自動追従はしません。モデル更新時はrequest ID、response allowlist、catalog/gateの校正を合わせて見直します。Jevは1.5秒でtimeoutし再試行せず、canaryのJev＋focused LLM全体を85秒で打ち切ります。

低確信度・補助判定の不一致・欠落値・モデル不一致・通信障害は既存focused LLMへ戻します。明確な条件変更や独立した意味はgeneric semanticへ渡します。両providerの失敗は現行のcontrolled failureへ戻り、legacy自然言語parserは復活させません。汎用入力や長すぎる入力は従来経路を使います。

通常テストはmockのみでキー不要です。実APIの疎通試験は環境変数 `OPENROUTER_API_KEY` を設定したプロセスで、次を明示実行します。`.env` の自動読込や通常CIからの課金API起動はありません。既存のsecret managerから環境変数を渡すか、ローカルではshell履歴へ値を残さない非表示入力を使ってください。

```bash
npm run test:jev:live
```

この試験は合成した日本語の `create_plan / fallback` 判定を実Jevへ1件送り、HTTP成功に加えてdecision・分布・入力tokenを確認します。1件の疎通成功は日本語品質や本番rolloutの承認を意味しません。キー未設定なら試験は明示的に失敗し、成功扱いにしません。

キーをCloudflareのSecretに登録済みなら、Wranglerへログインした端末から次の任意試験も実行できます。キーを端末へ取り出さず、一時remote dev内で同じadapterと本番の1.5秒timeoutを検証します。本番コードやroutingはデプロイせず、通常CIにも追加しません。

```bash
npm exec --yes --package=wrangler@4.140.0 -- node scripts/jev-cloud-smoke.mjs --worker studyplanner-ai-proxy
```

検証コードは3分で失効する認証付きの合成入力専用です。終了時に開発サーバーを停止し、一時ファイルを削除します。判断結果の採用gateは疎通確認とは別に記録し、`abstained`なら既存LLMへ戻す方針を維持します。API仕様・日本語品質・本番設定の問題を隠すためにgateを緩めないでください。

モデル、latency、成功/fallback、shadow比較、token数、OpenRouter報告costを既存 `ai_request_metric` と内容を限定したWorkerログへ記録します。不明なusage/costはnullのまま保持します。OpenRouterの応答本文、送信state、ユーザー入力全文、key、例外本文を新規のdecisionログやtraceへ保存しません。週間計画traceは既存の結果・byte数・状態を維持し、providerごとの安全な数値診断は#213のtelemetryを使います。

2026-09-26確認の一次資料は [OpenRouter Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request)、[Jev tutorial](https://openrouter.ai/docs/guides/community/jev-tutorial)、[TypeSafe primitives](https://docs.typesafe.ai/introduction)、[TypeSafe confidence](https://docs.typesafe.ai/confidence) です。SDK互換やchat APIから仕様を推測せず、`POST https://openrouter.ai/api/alpha/decisions` の `state / questions / answers / usage` 契約を使います。

### スマートフォンからのローカル確認

LAN 内の端末から HTTPS で開発環境へ接続する場合は、開発用証明書を生成できます。

```bash
npm run cert:dev -- 192.168.0.5
```

IP アドレスは開発 PC の LAN IP に置き換えてください。

## テスト

通常の検証は次のコマンドで実行します。

```bash
npm run verify
```

`npm run verify` は TypeScript の型チェック、Vitest、production build を順番に実行します。

Playwright を使った Browser Regression は `.github/workflows/browser-regression.yml` で実行します。主要なユーザー操作を同じ条件で繰り返し検証し、別の変更による UI 回帰を検出します。

## ドキュメント

文書の配置ルールは [`docs/DOCUMENT_DICTIONARY.md`](./docs/DOCUMENT_DICTIONARY.md) が正本です。文書は agent 名や用途ではなく、責務・文書種別・lifecycle で配置します。

リポジトリ全体の探索は [`PROJECT_MAP.md`](./PROJECT_MAP.md)、全文書の入口は [`docs/README.md`](./docs/README.md) を使用します。

予定のapp-wide authority / occurrence projection / Plan・MonthEvent統合移行は [`docs/domains/scheduling/README.md`](./docs/domains/scheduling/README.md) を入口とし、正仕様は [`scheduled-event-authority.md`](./docs/domains/scheduling/architecture/scheduled-event-authority.md) を参照してください。

週間計画は [`docs/domains/weekly-planning/README.md`](./docs/domains/weekly-planning/README.md)、current contract は [`docs/domains/weekly-planning/architecture/current-contract-v5.md`](./docs/domains/weekly-planning/architecture/current-contract-v5.md)、planned learning consultation requirement は [`docs/domains/weekly-planning/spec/learning-consultation-and-advice.md`](./docs/domains/weekly-planning/spec/learning-consultation-and-advice.md)、実装順序は [`docs/domains/weekly-planning/roadmap/current.md`](./docs/domains/weekly-planning/roadmap/current.md) を参照してください。

client-first execution と local/server authority の境界は [`docs/domains/client-runtime/README.md`](./docs/domains/client-runtime/README.md) と [`docs/domains/client-runtime/spec/client-first-execution-requirements.md`](./docs/domains/client-runtime/spec/client-first-execution-requirements.md) を参照してください。

学習レポートは [`docs/domains/reporting/README.md`](./docs/domains/reporting/README.md)、画面要件と集計不変条件は [`docs/domains/reporting/spec/learning-report.md`](./docs/domains/reporting/spec/learning-report.md) を正仕様として扱います。

管理・分析console、AI/API usage、service-wide telemetry、diagnostic drill-downは [`docs/domains/product-observability/README.md`](./docs/domains/product-observability/README.md) を入口とし、要件は [`console-requirements.md`](./docs/domains/product-observability/spec/console-requirements.md)、内部architectureは [`telemetry-and-read-model.md`](./docs/domains/product-observability/architecture/telemetry-and-read-model.md) を正仕様として扱います。

外部API/providerの採否、利用条件、normalization、fallbackは [`docs/domains/external-integrations/README.md`](./docs/domains/external-integrations/README.md) を入口とし、書籍教材検索の正仕様は [`material-metadata.md`](./docs/domains/external-integrations/spec/material-metadata.md) を参照してください。

過去の task、audit、旧 architecture は [`docs/archive/`](./docs/archive/README.md) にあり、current implementation instruction として扱いません。

## 開発状況

StudyPlanner は開発中です。現在の `main` を基準に主要機能とテストを継続的に更新しています。

## ライセンス

ライセンスは未設定です。
