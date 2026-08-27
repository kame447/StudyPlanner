# StudyPlanner

[![CI](https://github.com/kame447/StudyPlanner/actions/workflows/ci.yml/badge.svg)](https://github.com/kame447/StudyPlanner/actions/workflows/ci.yml)
[![Browser Regression](https://github.com/kame447/StudyPlanner/actions/workflows/browser-regression.yml/badge.svg)](https://github.com/kame447/StudyPlanner/actions/workflows/browser-regression.yml)

学習計画、実績、教材、時間割を一元管理し、自然言語を使った週間計画の作成を支援する Web アプリケーションです。

StudyPlanner は、学習予定と実績を分けて記録し、教材・時間割・進捗を含む情報から次の学習計画を作成します。AI は自然言語の解釈に利用し、スケジューリング、状態更新、承認、保存はアプリケーション側で管理します。

## 主な機能

### スケジュール管理

月・週・日単位で予定を確認し、作成、編集、削除、実績記録を行えます。予定と実績は別データとして扱い、計画どおりに進んだかを後から確認できます。

### AI 計画

チャット形式で学習対象、進捗、期限、利用できない時間、希望時間帯などを伝えると、既存予定や時間割を考慮して週間計画を作成します。生成結果はプレビューとして表示され、修正または承認した後に予定へ保存されます。

### 教材・進捗管理

教材や学習対象を登録し、現在の進捗を管理できます。

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

週間計画の正仕様は [`docs/domains/weekly-planning/`](./docs/domains/weekly-planning/README.md) に集約しています。runtime の責務境界は [`current-contract-v5.md`](./docs/domains/weekly-planning/architecture/current-contract-v5.md) を参照してください。

## 技術構成

フロントエンドは React 18、TypeScript、Vite で構成しています。認証には Firebase Authentication を利用します。永続化は責務別に分かれており、通常の planner data は Firebase / Cloud Firestore repository を中心に扱う一方、週間計画の conversation / working session state には現状 localStorage-backed storage も残っています。client-side execution、local durable state、server authority の現在境界と移行条件は [`docs/domains/client-runtime/`](./docs/domains/client-runtime/README.md) を正本として扱います。公開環境から AI provider へ接続する際は Cloudflare Workers を gateway として利用します。

管理・分析consoleは、UIからplanner collectionを都度全件scanする構造を最終形にせず、lightweight telemetry、集計read model、restricted diagnostic traceを分離する方針です。正仕様は [`docs/domains/product-observability/`](./docs/domains/product-observability/README.md) を参照してください。

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

週間計画は [`docs/domains/weekly-planning/README.md`](./docs/domains/weekly-planning/README.md)、current contract は [`docs/domains/weekly-planning/architecture/current-contract-v5.md`](./docs/domains/weekly-planning/architecture/current-contract-v5.md)、実装順序は [`docs/domains/weekly-planning/roadmap/current.md`](./docs/domains/weekly-planning/roadmap/current.md) を参照してください。

client-first execution と local/server authority の境界は [`docs/domains/client-runtime/README.md`](./docs/domains/client-runtime/README.md) と [`docs/domains/client-runtime/spec/client-first-execution-requirements.md`](./docs/domains/client-runtime/spec/client-first-execution-requirements.md) を参照してください。

学習レポートは [`docs/domains/reporting/README.md`](./docs/domains/reporting/README.md)、画面要件と集計不変条件は [`docs/domains/reporting/spec/learning-report.md`](./docs/domains/reporting/spec/learning-report.md) を正仕様として扱います。

管理・分析console、AI/API usage、service-wide telemetry、diagnostic drill-downは [`docs/domains/product-observability/README.md`](./docs/domains/product-observability/README.md) を入口とし、要件は [`console-requirements.md`](./docs/domains/product-observability/spec/console-requirements.md)、内部architectureは [`telemetry-and-read-model.md`](./docs/domains/product-observability/architecture/telemetry-and-read-model.md) を正仕様として扱います。

過去の task、audit、旧 architecture は [`docs/archive/`](./docs/archive/README.md) にあり、current implementation instruction として扱いません。

## 開発状況

StudyPlanner は開発中です。現在の `main` を基準に主要機能とテストを継続的に更新しています。

## ライセンス

ライセンスは未設定です。
