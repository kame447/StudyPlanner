# Study Planning Support App

## 概要

Study Planning Support Appは、学習予定と実績を月・週・日単位で管理し、自然言語入力と対話型の週間計画作成を支援するWebアプリです。

単に予定を自動生成するのではなく、利用者から得た条件、既存予定、固定予定、利用可能時間を区別して扱い、仮予定を確認してから通常予定へ保存する設計を採用しています。

現在は個人利用を中心としたMVPです。共有機能、複数端末をまたぐ厳密な承認制御、長期的な個別最適化などは後続実装です。

## 現在の到達点

2026年7月18日時点の`main`では、次の基本経路が接続されています。

```text
自然言語で計画条件を入力
  → 条件を解析・検証
  → 不足情報や高影響の曖昧さを対話で確認
  → 利用可能時間と制約を計算
  → 仮予定を生成
  → 利用者が内容を確認
  → 明示的な承認後に通常予定として保存
```

同一ブラウザ内での通常利用については、会話状態、仮予定、承認、部分失敗後の再試行まで自動テストされています。

一方、別端末や複数タブからの同時承認をサーバー側で一意化する処理、長期個別最適化、週間計画専用画面、本番環境での会話記録運用は未完了です。

## 主な機能

### 認証

- Firebase Authentication
- メールアドレスとパスワード
- メール確認
- Googleログイン
- Firebase未設定時のlocalStorageフォールバック
- 週間計画の会話記録を利用する場合の初回同意画面

### 予定管理

- 予定の作成、編集、削除
- 月・週・日単位の表示
- 重要予定、学校行事、塾、締切などの登録
- FirestoreまたはlocalStorageへの保存

### 実績管理

- 予定に対する実績記録
- 予定と実績の比較
- 現在は1予定に対して1実績を基本とする

### 自然言語による単発予定入力

- 自然言語から予定候補を生成
- 自然言語による既存予定の修正候補
- AIまたはルールベース解析
- 利用者確認後に反映

### 対話型の週間計画

- 学習対象、範囲、所要時間、期限、固定予定などを会話で収集
- 「今週」「来週」「週末」「日曜日まで」などの期間表現
- 「今すぐ」「1時間後」「今日20時」「明日」などの開始表現
- 複数の質問に対する一括回答
- 仮予定の生成、表示、個別削除、全破棄
- 明示承認後の通常予定への保存
- 部分失敗時の失敗項目だけの再試行
- 再読み込み後の古い仮予定を再計算必須として表示

## 週間計画の内部処理

週間計画は、AIへ全判断を任せる構成ではありません。自然言語の意味補完にはAIを利用しますが、状態更新、制約判定、仮予定生成の可否、保存可否は決定的な処理で管理します。

### 1. 入力と会話状態の所有

一つの週間計画セッションは、次の識別子を持ちます。

- `conversationId`
- `turnId`
- `requestId`
- 対象ユーザー
- 対象週
- 入力開始時のrevision

処理中に対象週が変わった場合、セッションがリセットされた場合、利用者が明示的に中止した場合は、後から返ってきた古い結果を現在の状態へ適用しません。

モーダルを閉じただけではセッションを中止しません。同じJavaScriptセッション内で開き直した場合は、完了した会話結果や仮予定を復元できます。

### 2. deterministic baseline

明示的で機械的に判定できる情報は、AIより先に決定的なparserで取得します。

主な対象は次のとおりです。

- 日付、曜日、時刻
- 所要時間、件数、年度範囲
- 「今週」「来週」「週末」などの期間短答
- 現在表示している質問に対する短い回答
- 明示的な訂正
- 確定済み情報の保護

たとえば、絶対日付に含まれる「日」を日曜日として誤認しないよう、算用数字、漢数字、混在表記を共通の日付tokenとして処理します。

### 3. AIによるsemantic補完

AIは、deterministic parserだけでは判断しづらい意味関係を補完します。

- 曖昧な言い換え
- 複数文の関係
- どの情報を訂正しているか
- 学習タスクの種類
- 優先関係
- 利用者の意図した制約

AI出力はtyped candidateとして受け取り、そのまま状態へ反映しません。

### 4. closed validationとstate更新

AI候補とparser結果は、型、値域、参照元、revision、現在の質問文脈を検証します。

確定済みの情報を、根拠の弱いAI候補で破壊的に上書きしません。拒否された候補、確認待ちの仮定、受理済みの事実は別の状態として保持します。

表示した質問だけを次の回答解釈の文脈として保存するため、内部で候補になっただけの質問へ利用者の短答を誤接続しません。

### 5. readiness判定

仮予定を生成できるかどうかは、単純な入力項目数ではなく、計画に必要な条件が実際に解決しているかで判定します。

主な確認対象は次のとおりです。

- 計画期間
- 学習タスクの識別
- 作業量
- 1単位あたりの所要時間
- タスクの実行形状
- 利用可能時間の根拠
- 高影響の期限不確実性
- 現在revisionに対する仮予定生成の許可

仮予定を止める高影響の不確実性だけを質問し、計画を止めない不確実性は未解決topicとして保持します。

### 6. 学習タスクの実行形状

学習内容から、暗記、演習、読解、執筆、問題解決、プロジェクト、復習などの実行特性を導出します。

この情報は、長い連続時間が必要か、短い時間へ分割しやすいかなどを判断するための補助情報です。現在の発話から得た一時的な条件を、利用者の永続的な習慣として自動保存することはありません。

### 7. 利用可能時間とhard constraint

既存予定、固定予定、時間割、必要なbufferを利用不可時間として扱います。

hard constraintは、行動傾向やAIの提案より常に優先されます。AIが都合のよい空き時間を新しく作ることはありません。

既存の空き時間には、次のようなannotationを付与できます。

- 帰宅後
- 食事前
- 食事後
- 就寝前
- 長い連続空き時間

annotationは配置判断の補助であり、利用可能時間そのものを増減させません。

### 8. 相対制約の解決

「夕食の前」「帰宅後」「寝る前」のような条件は、参照先となる予定や生活イベントが一意に特定できる場合だけ、絶対時刻の区間へ変換します。

参照先が曖昧、古い、循環している、同日の範囲外である場合は適用しません。固定予定と衝突する場合も、制約の一部分だけを勝手に採用しません。

### 9. 仮予定生成

次の条件を満たした場合だけschedulerを呼び出します。

```text
readinessがpreview可能
かつ
利用者が仮予定作成を明示的に許可
かつ
blocking conditionがない
かつ
revisionが現在状態と一致
かつ
全タスクに実行形状がある
かつ
利用可能時間の根拠が検証済み
```

schedulerは、計画期間内の利用可能区間へ作業単位を配置し、配置できた時間と配置できなかった時間を分けて返します。

実現可能性は次の状態で扱います。

- `feasible`
- `partially_feasible`
- `infeasible`
- `unknown`

必要に応じて、優先する、分割する、後ろへ回すといった選択肢を決定的なIDで提示します。AIは必要時間や空き時間を再計算しません。

### 10. previewと承認

生成結果は未保存のpreviewです。AIが「作成します」と述べただけでは保存もpreview生成も行いません。

previewには、生成元のrevision、参照した事実、仮定への依存、タスク参照、配置理由などのmetadataを保持します。

保存直前に次を再確認します。

- 同じ利用者の仮予定か
- 同じconversationから生成されたか
- revisionが古くないか
- 未確認の仮定へ依存していないか
- すでに保存済みの項目ではないか

### 11. 保存と再試行

週間計画の承認には、手動編集画面用の保存関数を流用しません。専用の保存処理を利用し、保存中に表示中の日付、月、表示モード、編集画面を変更しないようにしています。

一部の予定だけ保存に失敗した場合は、成功済み項目を再保存せず、失敗項目だけを再試行します。

承認中に週変更やリセットでセッションの所有権を失った場合は、次の項目の検索や保存を開始しません。ただし、すでに送信済みのrepository writeを通信途中で取り消す処理は未実装です。

### 12. 保存状態のユーザー分離

週間計画stateは、`version + ownerId + payload`のenvelopeとして保存します。

所有者が一致しない状態、別ユーザーのlegacy draft、壊れたpayloadは読み込みません。承認履歴もユーザー単位のkeyへ分離しています。

## 単発予定の自然言語解析パイプライン

単発予定の自然言語解析は`src/services/natural-language/`に分割されています。

```text
normalize
  → tokenizer
  → clause-parser
  → build-ast
  → lower-ir
  → compile
  → validate
```

各段階の結果を確認できるようにし、`assumptions`、`diagnostics`、`unresolvedFields`を保持します。

現在対応している主な内容は次のとおりです。

- time-only attach
- override
- relative ordering
- enumeration
- relative date
- 複数独立イベント

旧実装のfallbackは段階的に残しています。内部parserが表現を解析できても、複雑な繰り返し予定UIまで完成していることを意味しません。

## 実装状況

### 実装済み

- 月、週、日ビュー
- 予定と実績の基本CRUD
- Firebase Authentication
- FirestoreとlocalStorageの保存切り替え
- 自然言語による単発予定候補
- deterministic parserとAI semantic補完
- 週間計画の対話stateと質問管理
- planning rangeのpending state
- 仮予定生成の明示許可gate
- 仮予定の個別削除、全破棄、承認
- stale async resultの破棄
- 二重送信防止
- 日本語IME中の送信防止
- 部分失敗後の承認再試行
- 承認保存による画面遷移副作用の分離
- reload後の仮予定を再計算必須として表示
- 週間計画stateと承認履歴のユーザー分離
- 会話記録の同意画面、匿名化、redaction、TTL用の削除日時
- 全体テスト、週間計画テスト、TypeScript、production buildを実行するCI

### 部分実装または追加検証が必要

- ブラウザ上でのclose/reopen、週変更、reset、cancel、IME、focus restoration
- 会話記録保護の本番用secret、Firestore TTL、Rules、Workerの適用
- 管理者限定閲覧と削除処理の実環境確認
- 週間計画と単発AI入力が同じ汎用画面内に残っている状態
- behavior annotationを利用した配置改善
- legacy fallbackと新pipelineの段階的移行
- 既存schedulerの配置品質に対する実利用roleplay

### 実装予定

- Firestore上のserver-side claim
- 複数タブ、複数端末、crash retryを含むexact-onceに近い承認
- 週間計画専用の会話・preview・承認画面
- account-linked personalization profile
- 月曜始まり、日曜始まりの利用者設定
- 学習内容ごとの所要時間補正
- 継続しやすい学習時間と分割方法の学習
- 提案の採用、修正、拒否傾向の反映
- 計画と実績の差分を用いた安全な個別最適化
- traceのpagination、index、archive、schema migration
- 通知とリマインド
- 複雑な繰り返し予定
- 共有機能
- 複数実績
- スマホアプリ

## 現在保証していないこと

- AI出力だけで予定が自動保存されること
- すべての自然言語表現を正しく解釈できること
- 別端末から同時承認しても重複が絶対に発生しないこと
- browser reload後のbehavior-aware仮予定をそのまま承認できること
- 利用者の習慣を自動学習して次回計画へ反映すること
- 本番環境で会話記録のTTL削除がすでに稼働していること

## 画面構成

### 月ビュー

月全体の予定と目標勉強時間を確認します。

### 週ビュー

週間の予定と実績を比較します。予定を基準ブロックとして表示し、実績との差を確認できる構成です。

### 日ビュー

その日の予定詳細、実績入力、自然言語修正、AI評価を扱います。

## データとrepository

Firebase設定がある場合はFirestoreを使用し、未設定の場合はlocalStorageへフォールバックします。

主なcollectionは次のとおりです。

- `profiles`
- `plans`
- `actuals`
- `day_notes`
- `month_events`
- `app_catalogs / natural_language_v1`

データアクセスはstorage gatewayとrepositoryへ分離し、repository生成は`src/repositories/index.ts`へ集約しています。

週間計画の会話記録と長期個別最適化profileは、通常予定や互いの保存責務から分離する方針です。

## 会話記録とprivacy

週間計画の会話記録について、次の境界を実装しています。

- 初回利用前の同意
- Firebase UIDをtraceへ直接保存しない
- サーバー側HMACによる期間限定subject token
- メールアドレス、電話番号、URL内識別情報、認証情報候補のredaction
- 会話本文、snapshot、metadataへの180日後の削除日時
- 一般利用者と通常管理者からの本文直接閲覧の拒否
- 限定閲覧操作のaudit log
- 本番での明示feature flag

コード上の境界は実装済みですが、本番用secret、Firestore TTL policy、Rules、Worker、法務・privacy確認は別途必要です。

## 技術スタック

- フロントエンド: React、TypeScript、Vite
- 認証: Firebase Authentication
- データベース: Cloud Firestore
- AI proxy: Cloudflare Workers
- ローカルAI: Ollama
- デプロイ先: Cloudflare Pagesを想定
- テスト: Vitestを中心としたunit、integration、component、property test

## 関連ドキュメント

週間計画の詳細は次を参照してください。

- `docs/ai/weekly-planning-current-contract-status.md`
- `docs/ai/strategy/weekly-planning-roadmap.md`
- `docs/architecture/weekly-planning-dialogue-architecture-v4.md`
- `docs/weekly-planning/weekly-planning-spec.md`
- `docs/testing/weekly-planning-roleplay-test-plan.md`
- `docs/testing/weekly-planning-roleplay-status.md`

READMEは機能の概観を示します。実装契約や未完了taskの優先順位は、current contract statusとroadmapを正とします。

## 開発環境

### 必要なもの

- Node.js
- npm
- Firebaseプロジェクト
- Cloudflareアカウント
- 必要に応じてOllama

### 起動

```bash
npm install --cache .npm-cache
npm run dev
```

### 確認

```bash
npm run test:run
npm run build
```

### Firebase設定

`.env.local`または`.env`へ設定します。

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

Firebaseの必須項目が未設定の場合はlocalStorageで動作します。

### Cloudflare Workers

```bash
npx wrangler login
npx wrangler secret put OPENAI_API_KEY --config workers/ai-proxy/wrangler.jsonc
npm run deploy:worker
```

`workers/ai-proxy/wrangler.jsonc`の`FIREBASE_WEB_API_KEY`と`ALLOWED_ORIGIN`を環境に合わせて設定します。

WorkerはFirebase ID tokenを検証してからAI APIを呼び出します。

### Ollama

```bash
ollama pull llama3.2:3b
```

必要に応じて次を設定します。

```bash
VITE_AI_PROVIDER=ollama
VITE_AI_BASE_URL=http://127.0.0.1:11434/v1
VITE_AI_MODEL=llama3.2:3b
VITE_AI_API_KEY=ollama
```

アプリの`AI接続`から、Ollama、OpenAI互換、ルールのみを切り替えられます。

### OpenAI互換API

個人ローカル利用では、画面から接続先URL、モデル名、APIキーを設定できます。APIキーは`sessionStorage`にのみ保持します。

公開WebアプリではCloudflare Workers経由を使用してください。フロントエンドへsecret keyを埋め込まないでください。

### Firestore Rules

```bash
npm run deploy:firestore-rules
```

### スマホ実機用のローカル証明書

```bash
npm run cert:dev -- 192.168.0.5
```

IPアドレスは開発PCのLAN IPへ置き換えます。生成された証明書は`.cert/`へ保存されます。

## 限定公開キー

`VITE_APP_ACCESS_KEY`を設定すると、ログイン画面の前に共有キー入力を追加できます。

これは少人数向けの軽いアクセス制限であり、正式な招待制や強い認可ではありません。

## ライセンス

現時点では個人開発中です。公開範囲とライセンスは今後整理します。
