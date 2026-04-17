# Study Planning Support App

## 概要
勉強計画と実績を月・週・日単位で管理し、AIが入力補助と振り返り支援を行うWebアプリです。

このアプリの目的は、予定入力の面倒さを減らし、計画と実績のズレを見える化しながら、継続しやすい学習習慣を作ることです。

最初は個別利用をメインとし、将来的には共有機能にも対応できる構成を想定しています。

## コンセプト
既存の予定アプリは入力が面倒で続かないことが多いため、このアプリでは以下を重視します。

- なるべく少ない入力で予定を作れること
- 月 → 週 → 日 の順に掘って見られること
- 予定と実績を比較しやすいこと
- AIが自然言語入力を補助してくれること
- AIが継続や達成度を評価して、改善提案を返せること

## MVPで実装する範囲
最初のバージョンでは、以下を対象とします。

### 1. 認証
- Firebase Authentication
- メールアドレス + パスワード
- 初回のみメール確認
- Googleログイン

### 2. 予定管理
- 予定の作成、編集、削除
- 月・週・日単位での表示
- 重要予定の登録
  - 例: 模試、学校行事、塾、締切
- 最低限の予定情報で入力可能

### 3. 実績管理
- 予定に対して実際にやった内容を記録できる
- 予定と実績を比較できる
- まずは 1予定に対して1実績 を基本とする

### 4. AI入力補助
- 自然言語から予定を追加できる
- 自然言語で既存予定を修正できる
- AIが入力内容を推定して、ユーザーが確認・修正して反映する
### 自然言語予定解析パイプラインの現状
- 自然言語予定解析は `src/services/natural-language/` に段階分割したパイプラインとして整理している
- 処理は以下の責務に分かれている
  - normalize
  - tokenizer
  - clause-parser
  - build-ast
  - lower-ir
  - compile
  - validate
- 解析結果は途中段階ごとに確認できるようにし、`assumptions / diagnostics / unresolvedFields` を保持する
- 現在のパイプラインで対応済みの主な内容
  - time-only attach
  - override
  - relative ordering
  - enumeration
  - relative date
  - 複数独立イベント
- 既存 planner との接続は段階的に進める前提で、旧実装の fallback を急に削除しない
- なお、内部パーサの対応範囲が広がっていても、MVPとしての複雑な繰り返し予定 UI を実装済みという意味ではない

### 5. AI評価
- 達成度
- 継続度
- 計画の現実性

スコアだけでなく、短い改善コメントも返す

## 画面構成
### 月ビュー
- 月全体を一覧表示
- 各日セルには以下を表示
  - 目標勉強時間
  - 主な予定
- 横または上部から第1週、第2週…を選択できる

### 週ビュー
- 週間の予定と実績を比較しやすいUI
- 予定はベースのブロックとして表示
- 実績は重ねて見える形で表示
- 勉強の流れやズレが一目で分かることを重視

### 日ビュー
- その日の予定詳細
- 実績入力
- AIによる自然言語修正入力欄
- AI評価や簡単なコメント表示

## データの考え方
### 予定
最小限の情報で始める

候補項目

- id
- user_id
- title
- subject
- date
- start_time
- end_time
- type
- memo

### 実績
予定にひもづく形で管理する

候補項目

- id
- plan_id
- actual_start_time
- actual_end_time
- subject
- note

## 繰り返し予定
MVPでは複雑な繰り返しはまだ入れず、将来的に対応する前提で設計だけ余白を残します。

## 想定ユーザー
- 学生
- 勉強計画を立てたい人
- 勉強した実績を可視化したい人
- 手入力の多さで予定アプリが続かなかった人

## 技術方針
### フロントエンド
- Reactベース
- TypeScript
- レスポンシブ対応を前提とし、PCとスマホの両方でUIが崩れにくいことを重視

### バックエンド
- 認証は Firebase Authentication
- データ保存は Firestore
- OpenAI の API キー保護は Cloudflare Workers
- データアクセスは抽象化レイヤーを設ける

## 現在の技術スタック
- フロントエンド: React + TypeScript + Vite
- 認証: Firebase Authentication
- データベース: Cloud Firestore
- AIプロキシ: Cloudflare Workers
- ローカルAI: Ollama (`llama3.2:3b`)
- デプロイ想定:
  - フロント: Cloudflare Pages など静的ホスティング
  - 認証/DB: Firebase
  - AIキー保護: Cloudflare Workers Secrets

## 本番移行で必要なもの
- Firebase プロジェクト
  - Authentication の `メール / パスワード` と `Google` を有効化
  - Firestore Database を作成
  - `Authorized domains` に本番ドメインを追加
- Firestore rules の反映
  - `npm run deploy:firestore-rules`
- Cloudflare Workers
  - `workers/ai-proxy/wrangler.jsonc` の `FIREBASE_WEB_API_KEY` と `ALLOWED_ORIGIN` を本番値へ更新
  - `OPENAI_API_KEY` を Worker secret に保存
  - `npm run deploy:worker`
- フロントの本番ホスティング
  - Cloudflare Pages などに `dist` を deploy
  - `VITE_CLOUDFLARE_AI_PROXY_URL` を本番 Worker URL に設定
- 環境変数
  - `VITE_FIREBASE_*`
  - `VITE_CLOUDFLARE_AI_PROXY_URL`
  - 必要なら `VITE_APP_ACCESS_KEY`

## 限定公開キー
- ログイン画面の前に、共有キーを1回だけ入力する軽い制限を入れられます
- `.env` / `.env.local` / Pages の環境変数に `VITE_APP_ACCESS_KEY` を設定すると有効になります
- 通過後はブラウザの `localStorage` に保持するので、毎回入力は不要です
- これはあくまで弱いアクセス制限です
  - 本格的な秘匿や招待制ではありません
  - 共有先が少人数で、URL直打ち対策をしたい程度の用途向けです

## 将来的にやりたいこと
- 共有機能
- 繰り返し予定の強化
- AIによるより詳細な学習分析
- スマホアプリ展開
- 通知やリマインド
- 複数実績対応
- 教材や科目ごとの分析

## 実装メモ
### このMVPでの認証
- Firebase Authentication を使う
- 初回登録時は確認メールを送り、以後はメールアドレス + パスワード、または Google でログインする
- Firebase 環境変数が無い場合だけ localStorage のフォールバックを使う

### このMVPでのデータ保存
- Firebase 設定がある場合は Firestore に保存する
- Firestore では `profiles / plans / actuals / day_notes / month_events` を使う
- 自然言語解析の教材辞書は `app_catalogs / natural_language_v1` で管理する
- データアクセス層は `storage gateway -> repository` の構成に分離してある
- Firebase 設定が無い場合だけ localStorage のフォールバックで動く
- repository の生成は `src/repositories/index.ts` に集約してあり、保存先の切り替え箇所を1か所にしている

### 保守性のための整理
- 予定・実績・日次メモの生成処理は `src/domain/planner.ts` に集約
- 画面全体の状態管理は `src/hooks/usePlannerAppState.ts` にまとめ、`App.tsx` は描画中心にしている
- 自然言語解析の辞書は Firestore を優先し、repo 内 JSON は fallback と seed 元として管理している

### このMVPでのAI機能
- 自然言語入力はUIから分離した service で叩き台を生成
- AI評価も service 側でスコア算出と短いコメント生成を行う
- どちらも必ずユーザー確認を挟む前提
- 自然言語入力は OpenAI 互換クライアント経由で Ollama / OpenAI互換API を切り替えられる
- Ollama が使えない場合はルールベース解析にフォールバックする
- ルールベース解析で使う科目・予定種別の辞書は JSON で管理する

### AI接続の考え方
- AI接続設定は画面上から切り替えられる
- OpenAI の APIキーは UI から入力すると `sessionStorage` にだけ保存される
- そのため、キーをこのリポジトリの `.env` や `.env.local` に置かなければ、作業中のコード参照からは見えない
- ただし、フロントエンドから直接 OpenAI API を呼ぶ方式は個人ローカル利用向け
- 公開Webアプリとして使う場合は Cloudflare Workers 経由を使う

### Ollamaで自然言語入力補助を使う
1. Ollama を起動
2. 使うモデルを取得

```bash
ollama pull llama3.2:3b
```

3. 必要なら `.env.example` を元に `.env.local` または `.env` を作成

```bash
VITE_AI_PROVIDER=ollama
VITE_AI_BASE_URL=http://127.0.0.1:11434/v1
VITE_AI_MODEL=llama3.2:3b
VITE_AI_API_KEY=ollama
```

4. アプリ起動後、AI入力補助の `AI接続` から `Ollama / OpenAI互換 / ルールのみ` を切り替える

補足

- 現在の Ollama 利用は `llama3.2:3b` 固定
- 追加プリセットやカスタムモデル入力は UI に出さない

### OpenAI互換APIを個人利用で使う
1. `npm run dev`
2. AI入力補助の `AI接続` を開く
3. `OpenAI互換` を選ぶ
4. `接続先URL` を `https://api.openai.com/v1` にする
5. `モデル名` を使いたいモデルにする
6. APIキーを画面で入力して `設定を反映` する

補足

- この入力方法なら、APIキーはこの会話にも repo にも出ない
- ただしブラウザ実行環境には入るので、公開用途ではそのまま使わない
- 既に `.env` を git 管理している場合は、秘密情報を入れないこと

### OpenAIをCloudflare Workers経由で使う
1. Cloudflare で Worker を作成するか、この repo の `workers/ai-proxy` を deploy する
2. Worker の secret に `OPENAI_API_KEY` を保存する
3. Worker の vars に `FIREBASE_WEB_API_KEY` と `ALLOWED_ORIGIN` を設定する
4. deploy 後の Worker URL を `.env.local` または `.env` の `VITE_CLOUDFLARE_AI_PROXY_URL` に入れる
5. Firebase 設定を入れた状態で `npm run dev` を再起動する
6. AI入力補助の `AI接続` で `OpenAI互換` を選び、モデル名だけ設定して使う

補足

- `VITE_CLOUDFLARE_AI_PROXY_URL` があるとき、`OpenAI互換` は Cloudflare Workers 経由で OpenAI を呼ぶ
- この場合、OpenAI の secret key はブラウザに出ない
- Worker では Firebase ID token を Google の `accounts:lookup` で検証してから OpenAI を呼ぶ
- AI補助の既定値は OpenAI (`gpt-5.4-mini`)

### スマホ実機確認で HTTPS 警告を出さない
`@vitejs/plugin-basic-ssl` だけだと自己署名証明書のため、スマホでは `ERR_CERT_AUTHORITY_INVALID` が出ます。警告を消したい場合は、信頼済みローカル証明書を使います。

1. `mkcert` をインストール
2. このリポジトリで証明書を生成

```bash
npm run cert:dev -- 192.168.0.5
```

補足

- `192.168.0.5` の部分は、スマホから開くときの PC の LAN IP に置き換える
- 生成された証明書は `.cert/` に保存され、Vite が自動で優先使用する
- iPhone / Android では、`mkcert` のローカル CA を端末側でも信頼する必要がある
- 証明書生成後は `npm run dev` を再起動する

### Firebaseを使う
1. Firebase プロジェクトを作成
2. Authentication で `メール / パスワード` と `Google` を有効化
3. Firestore Database を作成
4. `firestore.rules` を Firebase に反映する
4. `.env.example` を参考に `.env.local` または `.env` へ以下を設定

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

5. `npm run dev` を再起動

補足

- 上の必須4項目が設定されている場合は Firebase を使う
- 未設定の場合は localStorage のフォールバックで動く
- Firestore は `profiles / plans / actuals / day_notes / month_events` を使う
- 教材・教科辞書は `app_catalogs / natural_language_v1` を使う
- 初回サインイン後、自動で fallback JSON を Firestore に seed する
- repo 側の catalog version が新しい場合は、サインイン時に Firestore catalog を自動更新する
- Firestore rules は `npm run deploy:firestore-rules` でも反映できる
- `VITE_APP_ACCESS_KEY` を入れると、ログイン画面の前に共有キー入力が追加される

### Cloudflare Workers を使う
1. Cloudflare にログインして Workers を有効化する
2. `workers/ai-proxy/wrangler.jsonc` の `FIREBASE_WEB_API_KEY` と `ALLOWED_ORIGIN` を自分の環境に合わせる
3. `npx wrangler login`
4. `npx wrangler secret put OPENAI_API_KEY --config workers/ai-proxy/wrangler.jsonc`
5. `npm run deploy:worker`
6. deploy 後の URL を `.env` の `VITE_CLOUDFLARE_AI_PROXY_URL` に入れる

補足

- `ALLOWED_ORIGIN` は本番のフロント URL に合わせる
- ローカル確認だけなら一時的に `http://localhost:5173` や `https://192.168.x.x:4173` にしてよい
- Worker は Firebase の ID token を検証するので、ログイン済みユーザーだけが AI を使える

## 起動方法
```bash
npm install --cache .npm-cache
npm run dev
```

## 確認方法
```bash
npm run build
```
