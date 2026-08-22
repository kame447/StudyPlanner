# StudyPlanner

[![CI](https://github.com/kame447/StudyPlanner/actions/workflows/ci.yml/badge.svg)](https://github.com/kame447/StudyPlanner/actions/workflows/ci.yml)
[![Browser Regression](https://github.com/kame447/StudyPlanner/actions/workflows/browser-regression.yml/badge.svg)](https://github.com/kame447/StudyPlanner/actions/workflows/browser-regression.yml)

学習計画、実績、教材、時間割を一元管理し、自然言語を使った週間計画の作成を支援する Web アプリケーションです。

StudyPlanner は、予定を登録するだけのカレンダーではなく、計画と実績を分けて記録し、その差を次の計画に反映できる学習管理環境を目指しています。AI は自然言語の解釈に利用し、予定の配置、状態更新、承認、保存といったアプリケーション上の判断は通常のプログラムが管理します。

## 主な機能

### スケジュール管理

月・週・日単位で予定を確認し、作成、編集、削除、実績記録を行えます。予定と実績は別データとして扱い、計画どおりに進んだかを後から確認できます。

### AI 計画

チャット形式で学習対象、進捗、期限、利用できない時間、希望時間帯などを伝えると、既存予定や時間割を考慮して週間計画を作成します。生成結果はプレビューとして表示され、修正または承認した後に予定へ保存されます。

### 教材・進捗管理

教材や学習対象を登録し、現在の進捗を管理できます。教材情報は、予定や週間計画と連携できるよう独立したデータとして扱います。

### ホーム・時間割

ホームでは、今日の予定、次の予定、週間の進捗、継続状況をまとめて確認できます。時間割は授業などの固定予定として管理し、週間計画の空き時間計算にも利用します。

### レスポンシブ UI

デスクトップ、タブレット、スマートフォンに対応し、ライトモードとダークモードを利用できます。

## AI 計画の設計

週間計画では、AI を意思決定主体として扱いません。AI が担当するのは、ユーザーの発話と会話文脈を構造化された意味へ変換する部分です。

検証、参照先の確定、Fact Graph の更新、確認要否、readiness、空き時間計算、スケジューリング、プレビュー、承認、保存はアプリケーション側が管理します。計画へ大きく影響する情報が曖昧な場合はユーザーへ確認し、保存前には明示的な承認を要求します。

```text
User input
    ↓
AI semantic interpretation
    ↓
Validation / binding
    ↓
Fact Graph / application state
    ↓
Readiness / availability / scheduler
    ↓
Preview
    ↓
User approval
    ↓
Save
```

この責務境界の詳細は [`docs/architecture/README.md`](./docs/architecture/README.md) と [`docs/ai/weekly-planning-current-contract-v5.md`](./docs/ai/weekly-planning-current-contract-v5.md) を参照してください。

## 技術構成

フロントエンドは React 18、TypeScript、Vite で構成しています。認証には Firebase Authentication、永続化には Cloud Firestore を利用し、Firebase 未設定の開発環境では一部機能を localStorage へフォールバックできます。AI provider への公開環境からの接続は Cloudflare Workers を gateway として扱います。

テストには Vitest、fast-check、Playwright を使用し、CI は GitHub Actions で実行します。

実装上の責務と主要ディレクトリは [`PROJECT_MAP.md`](./PROJECT_MAP.md) にまとめています。

## 開発環境

Node.js と npm が必要です。

```bash
npm install --cache .npm-cache
npm run dev
```

Firebase や AI gateway を設定しなくても、一部機能はローカル fallback で確認できます。本番相当の認証、保存、AI 接続を確認する場合は環境設定が必要です。

### Firebase

`.env.local` または `.env` に Firebase の設定を追加します。

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
npm run deploy:worker
```

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

Playwright を使った Browser Regression は `.github/workflows/browser-regression.yml` で実行します。主要なユーザー操作を同じ条件で繰り返し検証し、別の変更による UI 回帰を検出するためのテストです。

## ドキュメント

リポジトリ全体の探索には [`PROJECT_MAP.md`](./PROJECT_MAP.md)、現在の architecture 文書には [`docs/architecture/README.md`](./docs/architecture/README.md) を使用します。

週間計画の現在契約は [`docs/ai/weekly-planning-current-contract-v5.md`](./docs/ai/weekly-planning-current-contract-v5.md)、現在位置は [`docs/ai/weekly-planning-current-contract-status.md`](./docs/ai/weekly-planning-current-contract-status.md)、実装順序は [`docs/ai/strategy/weekly-planning-roadmap.md`](./docs/ai/strategy/weekly-planning-roadmap.md) を参照してください。

README はプロダクトと開発環境の概要を示す入口です。実装、テスト、current contract と内容が食い違う場合は、README ではなく現在の実装と canonical documentation を基準にします。

## 開発状況

StudyPlanner は開発中です。現在の `main` を基準に主要機能とテストを継続的に更新しており、未マージの branch や PR は current specification には含めません。

## ライセンス

ライセンスは未設定です。
