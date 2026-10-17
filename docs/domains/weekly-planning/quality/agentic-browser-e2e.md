# 会話型 Agentic Browser E2E（TesterArmy）

Status: supporting quality guide
Owner: [週間計画テスト方針](test-philosophy.md)
Tracking: [Issue #726](https://github.com/kame447/StudyPlanner/issues/726)

## 検証責務

TesterArmy/e2eは、自然言語の操作目標を `agent.act` へ与え、ブラウザ上で探索的なユーザー操作を行う補助runner。判定の正本は `expect(screen...)` による独立した画面contractと、必要な場合の既存Playwright・domain・実API側の証拠とする。

本pilotでは `tests/agent-e2e/` が独立したnpm依存と`e2e.config.ts`を所有し、既存の`tests/e2e/`や`browser-regression.yml`には手を加えない。UIの操作しやすさを調べる用途と、Firestore保存・再読込・重複防止を保証する用途を混同しない。

初期ケースでは、アプリ本体のAI計画コンポーネントを使うローカルharness（`/real-weekly.html`）と、プレビューharness（`/?scenario=preview`）を操作する。ただし会話のruntime gatewayと保存先はstubであり、AIプロバイダ・Cloudflare Worker・Firestoreの意味解釈と永続化は通らない。会話の日本語品質やオンラインE2E成功をこのpilot単体で主張しない。

## ローカル実行

リポジトリrootで次を実行する。root依存はアプリのVite harness、nested依存は固定したTesterArmy専用runnerを提供する。

```sh
npm ci
npm ci --prefix tests/agent-e2e
npm run test:agentic:smoke
```

初回はブラウザエンジンが必要。自動導入に失敗した場合は `./tests/agent-e2e/node_modules/.bin/e2e-web install chromium` を実行する。

モデルを使用する探索テストでは、環境変数 `OPENAI_API_KEY` に有効なAPIキーを与えた上で次を実行する。モデルの既定値は`gpt-5-mini`で、`LAPLANCE_AGENT_E2E_MODEL`で変更できる。モデル呼出は有料であり、通常のsmokeはモデル不要。

```sh
npm run test:agentic
```

この端末のようにClaude Code CLIへログイン済みなら、追加APIキーなしで `StepExecutor` からローカルClaude CLI（既定モデル: haiku）を呼び、AIが選んだ画面操作をTesterArmyの認可・記録付きブラウザ操作として実行できる。これはGitHub Actionsでは実行しない。テスト対象は合成データを使うローカルfixtureのみであり、CLIにはテスト画面のテキストが渡される。

```sh
cd tests/agent-e2e
claude auth status
LAPLANCE_AGENT_E2E_AUTH=claude-cli npm run test:agent -- --no-cache
```

GitHub Copilotが使える環境では、既存の`gh auth login`でログイン済みなら下記のようにGitHub CLIの認証を利用できる。認証情報はローカルのe2e資格情報ストアへ保存し、Git管理・ログ・Issueへ書き込まない。`gpt-6-luna`がそのCopilotプランで有効な場合にのみ実行し、利用可能モデルは `e2e models github-copilot` で都度確認する。ただしモデル一覧の有効表示は実際の推論権限を保証せず、Copilotが`MODEL_UNAVAILABLE`を返す場合はモデル名を無制限に再試行しない。標準のGitHub Actionsでこの認証は使わず、個人認証の操作テストはローカル限定とする。

```sh
cd tests/agent-e2e
npx e2e login github-copilot --from-gh
npx e2e models github-copilot
LAPLANCE_AGENT_E2E_AUTH=copilot npm run test:agent -- --no-cache
```

ChatGPTの対応サブスクリプションを使いたい場合は、`cd tests/agent-e2e && npx e2e login openai` で別途認証し、`LAPLANCE_AGENT_E2E_AUTH=chatgpt npm run test:agent` として実行できる。利用可能なモデルは `npx e2e models openai` で確かめる。APIキー方式とこのOAuth方式は混同しない。

必要に応じて `npm --prefix tests/agent-e2e run test:agent -- --no-cache` でキャッシュなしのモデル操作を検証できる。ローカルは成功した操作のreplayを許し、CIはcacheを無効にする。replay成功は新しい探索をした証拠ではないため、重大な変更時には`--no-cache`で再試行し、失敗traceを確認する。

## GitHub Actions

`.github/workflows/agentic-browser-e2e.yml` はmain向け全PRとmainへのpushで無課金smokeを実行する。手動の`workflow_dispatch`では`run_agent=true`と、GitHub Actions Secret `OPENAI_API_KEY` を設定した場合のみモデルを使った検証を実行する。秘密情報はコミット・issue・traceへ含めず、専用の合成データしか操作しない。ランナーは匿名telemetryを明示的に無効化し、`.e2e/`の成果物を短期間保存する。

## 既存Playwrightとの契約比較（Issue #730）

旧 `tests/e2e/weekly-planning-modal.spec.mjs` の「existing weekly session opens directly ...」は `/?weekly=1` で入力欄・送信ボタンが見えることのみを検査していた。同ファイルの送信とpendingのテストもこの状態を前提に検査しているため、検出範囲が重複する。2026-10-17に `tests/agent-e2e/tests/weekly-conversation.e2e.ts` の `smoke: an existing weekly session has a usable accessible composer` へ移管。新テストは同じ実ブラウザの合成harnessで、入力欄と送信ボタンの可視性に加えて、入力時に送信ボタンが有効になることを検査する。CIはmain向け全PRとmain pushでこのmodel-free smokeを実行するため、変更時の回帰監視を省略しない。

同じ「週間計画」でも、`weekly-planning-modal.spec.mjs` のEnter/Ctrl+Enter・pending中のキャンセルと再送抑止、`weekly-preview-approval.spec.mjs` のイベントpayload・二重promote防止、`weekly-real-application.spec.mjs` のcontroller/reducer・保存・reload等は別の故障を検査するため保持する。モデル操作の成功のみを根拠に状態不変条件を置き換えない。

## 移行条件と次の拡張

既存Playwrightの決定論的な検証を先に削除しない。同一契約・対象環境・故障検出を新runnerが保持し、継続CIが通り、費用・安定性・保守負担が下がることを観測した場合にだけ、重複部分の置換を検討する。

実プロバイダ会話から予定保存までのE2Eは、既存のonline手順と隔離テストアカウント、厳密な保存/reload/重複検査を維持する。モデルだけに「保存できた」と判断させない。ライブアカウント・本番ユーザーデータの使用、モデルにtest hookを許可する設計、実際に到達していない状態を肯定する`agent.assert`は行わない。Issue #488の実装作業とこのテストrunner導入は別責務とする。
