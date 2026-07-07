# 質問文生成の責務分離(deterministic な slot 決定 + AI 質問文 + deterministic fallback)【R2-D 完了】

> **完了記録(2026-07-07・未コミット差分。監査で採用可判定)**
>
> R2-D(AI dialogue renderer の実接続)まで実装。監査で観点1・2を満たすと確認済み。
> - **RenderInput 契約の充実**: `DialogueNextQuestion`(slotKey / intent / questionKind / options)。dialogueManager の questionPlan(`8d695d2`)を入力に、AI へは slotKey・intent・questionKind・options のみ渡し、計画外の missing(unit_duration_estimate 等)を送らない。
> - **structured schema**: `WEEKLY_PLANNING_DIALOGUE_RENDERER_RESPONSE_FORMAT`(json_schema・questions[slotKey,text])。
> - **validation(観点1)**: `sanitizeDialogueRenderOutput` が数の一致・計画外 slot・重複・欠落を全チェックし、最終出力を questionPlan 順に再構成。AI は各 slot の text のみ変更でき、対象/数/順序/slot identity を変えられない。
> - **production injection**: `NaturalLanguageAssistant` が AI provider 有効時に `createAiWeeklyPlanningDialogueRenderer` を注入。既存 openAiCompatibleClient / aiConfig を再利用。
> - **failure fallback(観点2)**: parse 失敗・非配列・型不正・数不一致・計画外・重複・欠落・call failure のすべてで部分採用せず deterministic fallback(受理サマリ+slot 別メンター調文言)へ。fake で5系統固定。
> - deterministic fallback のメンター調化(R2初期-4 統合)も実装済み。renderer 未注入時も ask_missing_info はこの deterministic renderer を使用。
> - weeklyPlanning 368 passed / build 成功 / `git diff --check` OK。
>
> **R2-D 本体の完了条件外(後続改善事項)**: retry policy、prompt tuning、実 AI 品質評価 / golden eval、コスト・レイテンシ計測は R2-D 完了条件に含めない。実 AI 評価(renderer の実ブラウザスモーク)は R2-C-eval と同様に別途1回行うのが望ましい。
>
> **監査で見つかった後続候補(production 未修正)**:
> 1. `renderWeeklyPlanningDialogueMessage` が renderer 注入時、質問のないターン(ask_missing_info 以外 / nextQuestions 空)でも `render()` を呼び AI コールを消費する(sanitize で null→fallback のため正しさ影響なし・コストのみ)。`decision.kind === 'ask_missing_info' && nextQuestions.length > 0` で render をガードする最適化余地。
> 2. `fallbackQuestionText` の `meal_bath_constraints` case は targetSlot 写像(→ `life_constraints`)により到達不能なデッドコード(害なし)。

質問文について、「何を聞くか」の判断まで AI に任せず、missing 判定・次に確認する slot の決定は **deterministic なアプリ側**に残し、その構造化情報を AI に渡して**自然な日本語の質問文だけ**を生成させたい。AI が適切でない箇所まで AI 化しない。縮退時の deterministic renderer も含め、責務分離とコスト・レイテンシを設計する。

R2-D(renderer 実 AI 接続)にはまだ進まない。本タスクは **renderer 基盤(AI 未接続)** の範囲で、deterministic な質問文品質の改善と RenderInput 契約の確定までを行う。

本mdの範囲外へ進まない。git add / commit / push はしない。

## 確定している事実

コード確認済み(R2-B renderer 基盤・closed):

- `weeklyPlanningDialogueRenderer` は既に存在し、`DialogueRenderInput`(acceptedFacts / assumptions / nextQuestions / styleConstraints)→ `DialogueRenderOutput`(acknowledgement + questions)の境界、plan 外 slotKey の破棄、未注入/失敗時の deterministic テンプレ fallback(`createWeeklyPlanningDialogueMessage`)を持つ。
- ただし `nextQuestionsFromDecision` は `decision.requiredFields` を最大2件スライスし、`intent` に `messageKey` を流用しているだけで**粗い**。deterministic fallback 文言は現状の事務的テンプレのまま。
- 「何を聞くか」の決定(missing → 提示 slot)は `20260707-weekly-planning-staged-dialogue-known-info.md`(質問計画)側の責務。本タスクはその出力を受けて「どう言うか」に集中する。

つまり **責務分離の骨格は既にあり**、本タスクは RenderInput の質を上げ、deterministic fallback 文言をメンター調にし、AI 差し込み口の契約を確定することが主眼。

## 実装範囲

- `DialogueRenderInput` の充実: `nextQuestions[].intent` を messageKey 流用ではなく、slot ごとの構造化意図(何を知りたいか + 既知情報の差分文脈)にする。質問計画タスクが渡す「1〜2論点・既知サマリ」を受け取れる形にする。
- **deterministic fallback renderer の質問文をメンター調に改善**: 一度に1〜2論点、既知を短く受け止めてから次を尋ねる文体。現状の「週間計画に必要な情報がまだ足りません。次に◯◯を教えてください。」を置き換える。これは AI 未接続でも有効な改善であり、R2初期-4(文言トーン改善)をここに統合する。
- AI 差し込み口の契約確定: fake renderer で「構造化 RenderInput → 自然文」を検証し、AI に渡すのは質問文生成のみ(slot 決定・missing 判定は渡さない)ことをテストで固定。**実 AI 接続は R2-D で行い、本タスクでは fake のみ**。
- コスト・レイテンシの設計方針を報告: 質問文生成だけを AI に任せる場合の呼び出し頻度、fallback で十分なケース(単純な1 slot 質問はテンプレで足りる 等)の切り分け方針。

## 回帰テスト

- deterministic fallback(renderer 未注入)で、メンター調の質問文が生成され、1〜2論点に収まること。既知情報がある場合は受け止め文が含まれること。
- fake renderer が構造化 RenderInput を受けて自然文を返し、plan 外 slot が破棄されること(既存挙動の維持)。
- RenderInput が slot 決定/missing 判定を含まず質問文生成に必要な情報のみを持つこと(責務分離の契約テスト)。
- 既存 renderer テスト(plan 外破棄・fallback)が期待値変更なしで green(fallback 文言テストは intended 変更として明記して更新)。

## 完了条件

- deterministic fallback の質問文がメンター調・1〜2論点になり、テストで固定されている。
- RenderInput の契約が「何を聞くかは持たず、どう言うかに必要な情報のみ」で確定し、fake renderer でテストされている。
- コスト・レイテンシの切り分け方針が報告されている。
- 既存テスト全 green、build 成功。

## 依存

- 質問計画(`staged-dialogue-known-info`)が「1〜2論点・既知サマリ」を出力する前提。**質問計画の Phase 1 設計が先**。本タスクはその出力契約を受け取る。両者を同時に進める場合は RenderInput を共有契約として先に固定する。

## 触らない範囲

- 実 AI 接続・ai-proxy・モデル・プロンプト本番化(R2-D)。
- 「何を聞くか」の決定ロジック(質問計画タスク)。missing 判定 / slot 決定は deterministic 側に残す。
- scheduling、work item、AI interpreter の入力側。
- UI レンダリング。

## 停止条件

- fallback 文言のメンター調化が dialogueMessages の広範な既存テスト赤化を招き、現状固定/intended の切り分けが収まらないとき。
- RenderInput の充実が質問計画タスクの未確定な出力契約に依存して決められないとき(質問計画 Phase 1 を先行させて報告)。
- 変更が dialogue renderer / messages と対応テストの外へ波及するとき。
- 説明できない新規テスト失敗が出たとき。

## 検証(Node 22)

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```
