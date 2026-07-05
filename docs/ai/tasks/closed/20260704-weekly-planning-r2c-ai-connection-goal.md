# [Goal] R2-C: AI interpreter の実接続と最小評価【条件付きクローズ 2026-07-05】

> **Closed note(2026-07-05・条件付きクローズ)**
>
> - Phase 1(escalation の fallback 進展考慮・validator の同一 slot eviction)、Phase 2(実 interpreter・全失敗経路の空配列縮退)、Phase 3(opt-in の最小 UI 接続)、Phase 5(CI が実 AI を呼ばず全 green: 303 passed / build 通過)は完了し、採用レビュー済み。
> - **Phase 4(実 AI 評価)は未実施。** 評価用 API key / model が現環境になく、また Node の評価ハーネスからは既存 Cloudflare proxy 経路が Firebase ログインセッション必須のため通らないことが調査で判明した。評価ハーネス自体はエラー可視化(接続失敗と実評価0件の区別)まで修正済み。
> - 実 AI 評価は独立タスク **`docs/ai/tasks/20260705-weekly-planning-r2c-eval.md`(R2-C-eval)** へ分離する。
> - **R2-D(renderer 実接続)の着手条件は、R2-C-eval の実 AI 評価が少なくとも1回完了していること。**

R2 AI foundation(`docs/ai/tasks/closed/20260704-weekly-planning-r2-ai-foundation-goal.md`、コミット `dab4c22`)の上に、**実 AI を interpreter にだけ接続し、安全に評価できる最小単位**を作る goal md である。設計メモは `docs/ai/strategy/weekly-planning-r2-ai-interpreter-design.md`。

**運用ルール**: 本mdに書かれていない範囲へ進まない。対象外の問題は発見事項として報告する。git add / commit / push はしない。Phase をまたいで変更を混ぜない。期待値変更は「現状固定」か「intended behavior 変更」かを明記する。

**大原則(不変)**: AI にスケジューリング・保存・承認・missing 判定・質問対象の選定を任せない。AI 出力は必ず `InterpretedCommandCandidate[]` → `validateInterpretedCandidates` → 既存 reducer 経由。AI が `PlanningIntakeState` を直接作る経路を作らない。

## 責任範囲(この goal がやること)

1. foundation レビューで残った**実接続の前提修正**(escalation の fallback 進展考慮、validator の同一 slot 優先処理)。
2. 既存 AI インフラ(`src/lib/aiConfig.ts` + `src/services/ai/openAiCompatibleClient.ts` + `workers/ai-proxy`)を再利用した**実 interpreter 実装**と失敗時縮退。
3. **opt-in の最小 UI 接続**(AI provider 設定が有効なときだけ async entrypoint を使う。呼び出し箇所の置換に限定)。
4. **評価ケース第1号の実 AI 評価**(golden 評価の初回実行と記録)。

renderer の実 AI 接続は**含めない**(R2-D として分離。fallback テンプレが現行文言のまま動くため、応答文はこの goal の間は従来どおり)。

## 着手前のユーザー確認事項(Phase 0・停止点)

以下が未確定のまま Phase 2 以降へ進まない。着手時にユーザーへ確認し、回答を作業報告に記録する。

1. **モデルとコスト**: 使用モデル(既存 `aiConfig` の provider/model 設定をそのまま使うか)、1ターンあたりの許容コスト・レイテンシ目安、失敗時リトライの有無(推奨: リトライなし・即縮退)。
2. **送信データ範囲**: `InterpreterStateSummary`(knownFields / confirmedSlots / planningRangeSummary)+当該ターンの userText のみを送る想定でよいか。**保存済み予定・生活制約の履歴・過去ターン全文は送らない**(spec §4.7)。
3. **評価合格基準**: 評価ケース第1号(fields 5件 / yearRange 2025〜2019 / field_first / 部分順序)について「validator 通過後に必須項目が command として得られること」を合格とする粒度でよいか。
4. **escalation 閾値**: 「fallback で進展したターンは escalate しない」(下記 Phase 1)の方針でよいか。

## Phase 構成

### Phase 1: 実接続の前提修正(foundation レビューの残論点)

実 AI を繋ぐ前に、コスト・正しさに直結する2点を直す。いずれも red → green(intended behavior 変更)で進める。

1. **escalation の fallback 進展考慮**: 現在 `deterministicCommandCount` は legacy fallback(branch A のタスク抽出、branch B の merge)の進展を数えないため、fallback が成功したターンでも escalate する(= 実接続後は無駄な AI 呼び出し)。`applyWeeklyPlanningUserTurnWithDiagnostics` の diagnostics に fallback 進展(例: tasks が増えた/置換された)を含め、`shouldEscalateToInterpreter` が進展ありターンで発火しないようにする。既存の「command 0件の長文で発火」「短答除外」「未注入不発」は維持する。
2. **validator の同一 slot 優先処理の完成**: 現在、同一 slot に低 confidence 候補 → 高 confidence 候補の順で来ると**両方**が結果に残る(先に受理した低い方を evict しない)。「confidence が高い方のみ残す」仕様どおりに、後から高い候補が来たら先の候補を結果配列から取り除き rejected(理由: `conflicting-slot-lower-confidence`)へ移す。後続が低い場合の既存挙動は不変。
3. あわせて escalation の未固定分岐(「command 生成あり・missing 減らず・missingBefore 非空 → 発火」)を現状固定テストで押さえる。

### Phase 2: 実 interpreter の実装

- `createAiWeeklyPlanningInterpreter(config)` を新設し、`WeeklyPlanningIntakeInterpreter` interface を実装する。**新しい HTTP 経路を作らず**、既存の `createOpenAiCompatibleClient`(`src/services/ai/openAiCompatibleClient.ts`)と `getAiConfig()`(`src/lib/aiConfig.ts`、Cloudflare ai-proxy 経由)を再利用する。
- 出力は `JsonSchemaResponseFormat`(client が対応済み)で `InterpretedCommandCandidate[]` 相当の構造化 JSON を受け、**パースできない・schema に合わない場合は空配列を返して縮退**する(validator の前に落とす。例外を上へ投げない)。
- プロンプトには stateSummary(knownFields / confirmedSlots / planningRangeSummary)と userText、command 型の説明、confidence 付与の指示を含める。**Phase 0 で確認した送信データ範囲を超える情報を含めない。**
- 呼び出しは1ターン最大1回。タイムアウト(既存 client の設定に準拠)超過・エラー時は空配列(= 決定的経路のみの結果になる)。
- fake ベースの既存テストは不変。実 AI クライアントは DI で注入するため、unit テストは「schema 不正応答で空配列」「例外で空配列」「正常応答が candidates に変換される」を**モック応答**で固定する(実 API は呼ばない)。

### Phase 3: opt-in の最小 UI 接続

- 週間計画モードの pipeline 呼び出し箇所(`NaturalLanguageAssistant.tsx` 内の `runWeeklyPlanningIntakePipeline` 呼び出し)を、**AI provider が有効(`aiConfig` が 'openai' 等)のときのみ** `runWeeklyPlanningIntakePipelineWithInterpreter` + 実 interpreter を使う形に切り替える。provider が 'rules' または未設定なら従来の同期経路のまま。
- 変更は呼び出し箇所の置換と async 化に**限定**する。UI の見た目・メッセージ表示・承認導線・renderer には触れない。これを超える UI 変更が必要になったら停止して報告する。
- 応答文は従来どおり(renderer 未接続。fallback テンプレのまま)。

### Phase 4: 評価ケース第1号の実 AI 評価(golden 初回)

- `weeklyPlanningEvaluationCases.ts` の `aiInterpreterFoundation` ケースを**実 AI で流す評価手段**を作る。CI では実行しない(環境変数などで明示 opt-in する vitest 別ファイル、または `scripts/` 配下の手動スクリプト。既存構成に合わせて選ぶ)。
- 合格判定は Phase 0 で確認した基準(必須項目の充足: fields / yearRange / priorityPolicy が validator 通過後に command として得られる)。全文一致は要求しない。
- 実行結果(合否・得られた candidates・rejected とその理由・レイテンシ・トークン/コストの目安)を報告に記録する。**不合格でもこの goal は失敗ではない**(プロンプト改善の材料として記録し、改善の反復は次 goal へ)。

### Phase 5: 検証して停止

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check
git diff --stat
git status -sb
```

CI 相当のテストが実 AI を呼ばないこと(ネットワークなしで全 green)を確認して停止する。R2-D(renderer 実接続)への引き継ぎ事項を報告する。

## 完了条件

- Phase 1 の2修正が intended として red → green で入り、escalation が「fallback 進展ターンで不発」「同一 slot は高 confidence のみ残る」になっている。
- 実 interpreter が既存 client/config 再利用で実装され、失敗・不正応答・タイムアウトのすべてで空配列縮退すること(モックでテスト固定)。
- provider 無効時は従来経路と完全一致(既存テスト green 維持)。UI 変更が呼び出し箇所の置換に収まっている。
- 評価ケース第1号の実 AI 実行結果(合否・コスト・レイテンシ)が記録されている。
- 送信データが Phase 0 で確認した範囲に収まっていることがプロンプト実装から確認できる。

## 触らない範囲(対象外)

- **renderer の実 AI 接続**(R2-D)。あわせて `nextQuestions.intent` が messageKey の流用で粗い問題も R2-D の前提課題として繰り越す(この goal では触らない)。
- プロンプトの本格チューニングの反復(初版+評価1回まで。改善反復は次 goal)。
- 応答文言・トーン改善、daily/weekday/weekend target、明示 duration と過去問文脈の共存、年度範囲 parser 修正(それぞれ別タスク)。
- scheduler、保存・承認導線、legacy fallback の削除・意味論変更、`looksLikeWeeklyPlanningRequest`。
- 既存の決定的 parser の削除・仕様変更。
- ai-proxy(worker 側)の改修(既存のまま使う。足りない場合は停止して報告)。
- 既存 regression テストの入力・期待値(Phase 1 の intended 変更で特定されたものを除く)。

## 停止条件

- Phase 0 の確認事項が未回答のまま Phase 2 に進む必要が生じたとき。
- 既存 `openAiCompatibleClient` / `aiConfig` / ai-proxy の再利用で実現できず、これらの改修が必要になったとき。
- UI 変更が呼び出し箇所の置換+async 化を超えて広がるとき。
- 送信データ範囲を超える情報(保存済み予定・生活制約履歴・過去ターン全文)をプロンプトに含めないと精度が出ないと判明したとき(拡張せず報告)。
- CI テストが実 AI 呼び出しなしで green を維持できないとき。
- 説明できない新規テスト失敗が出たとき。

## Codexへの実装指示(要約)

1. Phase 0 の確認結果を報告してから Phase 1 へ。Phase 1 は red → green(intended)。Phase 2/3 はモックテスト先行。Phase 4 は実 AI 1回の評価と記録。Phase 5 で停止。
2. AI 呼び出しの失敗は例外にせず空配列縮退。決定的経路の結果が常に最低保証。
3. 評価不合格はプロンプト改善材料として記録するだけにし、その場で反復チューニングしない。
4. `docs/ai/codex-task-guide.md` に従う。
