# StudyPlanner

StudyPlanner は、学習計画を立てるだけでなく、実際にどこまで進んだかを記録し、その差を見ながら次の計画につなげるための学習管理 Web アプリです。

カレンダーへ予定を入れるだけではなく、

```text
「来週までに数学の問題集を30ページ進めたい」
「水曜日は18時からバイトがある」
「昨日できなかった分を組み直したい」
```

といった内容を普段の言葉で伝えながら、現在の予定、空いている時間、学習対象、進捗を踏まえて計画を作れることを目指しています。

現在は個人開発中の Web アプリです。機能を増やすだけでなく、AI が勝手に重要な判断をしないこと、変更によって既存機能を壊さないこと、PC とスマートフォンの両方で使えることを重視して開発しています。

## 何ができるのか

主な機能は、それぞれ異なる役割を持つ機能として次のように分かれています。

- ホーム: 今日の予定、次の予定、今週の進み具合などをまとめて確認する
- スケジュール: 月・週・日単位で予定を確認し、作成・編集・削除・実績記録を行う
- 教材: 教材や学習対象を登録し、学習の進捗を管理する
- AI 計画: チャット形式で条件を伝え、学習計画を組み立てる
- 時間割: 固定予定として扱う授業などを管理する
- 認証・設定: アカウント、テーマ、AI 接続などを管理する

UI はデスクトップ、タブレット、スマートフォンに対応し、ライトモードとダークモードを利用できます。

## AI 計画のイメージ

AI 計画では、ユーザーが最初から細かいフォームを埋めるのではなく、会話しながら必要な条件を揃えていきます。

たとえば、次のような流れです。

```text
ユーザー
「来週までに数学の問題集を30ページ進めたい」

StudyPlanner
「水曜日は18時から予定があります。
それ以外の空き時間を使って計画を作りますか？」

ユーザー
「お願いします」

StudyPlanner
→ 既存予定と重ならない時間へ学習を配置
→ 1週間分の計画をプレビューとして表示

ユーザー
→ 内容を確認し、必要なら修正
→ 問題なければ承認

StudyPlanner
→ 承認された予定だけを保存
```

実際の会話では、学習対象、進捗、期限、所要時間、固定予定、希望時間帯などを必要に応じて確認します。

## AI に何を任せ、何を任せないか

StudyPlanner は、AI に予定作成の全権限を渡す設計ではありません。

自然な文章の意味を理解することは AI が担当します。一方で、その解釈をそのまま正しい事実として採用するのではなく、アプリケーション側で型、参照関係、現在の状態との整合性などを検証します。

その後の状態更新、確認が必要かどうか、計画を作れる状態かどうか、既存予定との衝突、具体的な時間配置、プレビューの有効性、承認、保存といった処理は、決定的なプログラムが担当します。

そして、機械が勝手に決めるべきではない部分はユーザーへ返します。計画へ大きく影響する情報が曖昧な場合は確認し、生成した計画は一度プレビューとして見せ、ユーザーが明示的に承認してから保存します。

役割を簡略化すると次のようになります。

```text
ユーザー
  希望・制約・訂正を伝える
  高影響の曖昧さを判断する
  最終的な計画を確認して承認する

        ↓

AI
  自然言語と会話文脈の意味を解釈する
  構造化された候補を返す

        ↓

StudyPlanner の決定的な処理
  AI 出力を検証する
  状態と制約を管理する
  空き時間を計算する
  スケジュールを配置する
  preview / approval / save を管理する
```

この境界により、「AI がそれらしい予定を生成したから、そのまま保存する」という動作を避けています。

## 予定と実績を分けて管理する

StudyPlanner では、「やる予定だったこと」と「実際にやったこと」を分けて扱います。

予定を作って終わりではなく、実績を記録することで、計画との差を後から確認できます。ホームやスケジュール画面では、この差を次の学習判断に使いやすい形で見せることを目指しています。

## 主要な画面

### ホーム

今日の予定、次の予定、今週の進捗、継続状況などを一画面で確認するための入口です。画面サイズに応じて情報量と配置を調整します。

### スケジュール

月・週・日単位で予定を確認します。予定の追加、編集、削除に加えて、実際に行った学習を記録できます。

### 教材

利用している教材や学習対象を管理します。教材の詳細や進捗を確認し、今後は教材構造や学習範囲と計画をより強く連携させることを想定しています。

### AI 計画

ChatGPT のような会話 UI を中心に、学習計画に必要な情報を集めます。計画が作成可能になると、実際に保存する前のプレビューを提示します。

会話履歴はアプリケーション状態と分離して扱い、画面上の会話を消すことと、計画セッションそのものを初期化することを区別しています。

## 現在のアーキテクチャ

フロントエンドは React と TypeScript で構築しています。画面表示、アプリケーション処理、ドメイン処理、データアクセスをなるべく分離し、機能が増えても一つの巨大なコンポーネントへ判断が集中しない構成を目指しています。

週間計画は `src/features/weeklyPlanning/` を中心とした独立した feature として扱っています。

現在の基本的な処理境界は次の通りです。

```text
ユーザー入力
  ↓
AI による semantic interpretation
  ↓
validation / formal binding
  ↓
Fact Graph と状態更新
  ↓
clarification / readiness 判定
  ↓
availability / scheduler
  ↓
preview
  ↓
ユーザーによる修正・承認
  ↓
save
```

AI の文章表現からアプリケーション状態を逆算したり、AI が scheduler や保存処理を直接決定したりしないことを重要な境界としています。

詳しい責務の場所を探す場合は [`PROJECT_MAP.md`](./PROJECT_MAP.md) を参照してください。

## データ保存

Firebase が設定されている環境では Firebase Authentication と Cloud Firestore を利用します。

開発環境などで Firebase が設定されていない場合は、一部のデータを localStorage へ保存して動作させることもできます。

データアクセスは repository / storage gateway を経由し、UI が Firestore や localStorage の詳細を直接判断しない構成を基本としています。

## 品質保証

StudyPlanner は個人開発ですが、機能と画面が増えているため、手動確認だけに依存しないようにしています。

通常のロジックについては TypeScript の型チェックと Vitest の unit / integration / component / property test を利用します。

さらに、Playwright を使った Browser Regression を GitHub Actions で実行し、実際の Chromium 上で主要なユーザー操作を確認します。

E2E を使う目的は、単に「画面を一度操作できた」ことを確認するためだけではありません。毎回同じ条件と操作で主要導線を再実行し、別の修正によって以前の機能が壊れていないかを継続的に確認するためです。

現在の基本的な検証は次の流れです。

```text
TypeScript checks
  ↓
unit / integration / component tests
  ↓
production build
  ↓
Browser Regression
  ↓
必要な箇所を人間が確認
```

AI の自然な会話品質や、見た目として本当に正しいかといった内容は、すべてを固定文字列や画像差分だけで正解判定できるとは考えていません。機械的に保証できる不変条件は自動化し、仕様や体験としての判断が必要な箇所には人間のレビューを残す方針です。

## 現在保証している範囲と今後の課題

現在の main では、予定・実績の基本管理、主要画面、認証、教材管理、対話型週間計画、プレビューと承認、レスポンシブ UI、ダークモード、主要導線の Browser Regression などが接続されています。

一方で、StudyPlanner はまだ開発中です。特に、複数端末・複数タブをまたいだ厳密な同時実行制御、長期的な個別最適化、共有、通知、より高度な同期・オフライン実行などは、現在の単一ユーザー向け基本体験とは別の課題として扱っています。

未完成の機能について、README の説明だけを正仕様として実装を推測しないでください。現在の実装と canonical documentation を優先します。

## 技術スタック

主要技術は、技術レイヤーごとに次の通りです。

- UI: React 18, TypeScript
- Build: Vite
- Authentication: Firebase Authentication
- Database: Cloud Firestore
- AI gateway: Cloudflare Workers
- Test: Vitest, fast-check, Playwright
- CI: GitHub Actions

## ローカルで起動する

### 必要なもの

Node.js と npm が必要です。

Firebase や AI gateway を設定しなくても、一部機能はローカル fallback を利用して確認できます。本番相当の認証・保存・AI 接続を確認する場合は、それぞれの設定が必要です。

### インストールと起動

```bash
npm install --cache .npm-cache
npm run dev
```

Vite の開発サーバーが起動します。

### 基本検証

```bash
npm run verify
```

`npm run verify` は現在、型チェック、Vitest、production build を順番に実行します。

個別に実行する場合は次を使用します。

```bash
npm run typecheck
npm run test:run
npm run build
```

Browser Regression は GitHub Actions の `.github/workflows/browser-regression.yml` で実行されます。Playwright は application package から分離した `tests/e2e/` の test runner として導入しています。

## Firebase を利用する

`.env.local` または `.env` へ Firebase の設定を追加します。

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

Firebase の必須項目がない環境では localStorage fallback を利用します。

Firestore Rules をデプロイする場合は次を使用します。

```bash
npm run deploy:firestore-rules
```

## AI gateway を利用する

公開環境では、AI provider の secret をフロントエンドへ置かず、Cloudflare Workers を gateway として利用する構成です。

```bash
npx wrangler login
npx wrangler secret put OPENAI_API_KEY --config workers/ai-proxy/wrangler.jsonc
npm run deploy:worker
```

`workers/ai-proxy/wrangler.jsonc` の環境設定も対象環境に合わせて設定してください。

## スマートフォンからローカル開発環境へ接続する

LAN 内のスマートフォンから HTTPS で確認する場合は、開発用証明書を生成できます。

```bash
npm run cert:dev -- 192.168.0.5
```

IP アドレスは開発 PC の LAN IP に置き換えてください。生成した証明書は `.cert/` に保存されます。

## ドキュメントの読み方

初めてリポジトリを見る場合は、この README の次に [`PROJECT_MAP.md`](./PROJECT_MAP.md) を読むと、機能ごとの実装場所を追いやすくなります。

週間計画の現在契約や開発方針を調べる場合は、次の文書を入口にします。

- [`docs/ai/weekly-planning-current-contract-v5.md`](./docs/ai/weekly-planning-current-contract-v5.md)
- [`docs/ai/weekly-planning-current-contract-status.md`](./docs/ai/weekly-planning-current-contract-status.md)
- [`docs/ai/strategy/weekly-planning-roadmap.md`](./docs/ai/strategy/weekly-planning-roadmap.md)
- [`docs/ai/testing/weekly-planning-test-philosophy.md`](./docs/ai/testing/weekly-planning-test-philosophy.md)

README は「StudyPlanner が何をするプロダクトなのか」を把握する入口です。詳細な内部契約や現在進行中の作業は、実装、テスト、PROJECT_MAP、canonical documentation を確認してください。

## ライセンス

現在は個人開発中です。公開範囲とライセンスは今後整理します。
