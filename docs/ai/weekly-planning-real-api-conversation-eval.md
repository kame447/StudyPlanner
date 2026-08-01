# 週間計画AI 実API会話結合テスト

## 目的

人間がStudyPlannerへ毎回発話を入力し、traceを手動で渡す作業を減らす。
Stable V5のapplication経路を複数ターン実行し、質問、誤回答、明示的修復、preview、preview後訂正、再preview、承認、保存まで確認する。

## 固定方針

- applicationから到達する週間計画runtimeはStable V5のみ。
- legacy実装は内部test-supportとして保持するが、env、URL、storage、UIからは選択できない。
- AI APIは意味解釈と利用者向け返答生成だけに使う。
- ユーザー役、採点、合否判定、原因推定にはAIを使わない。
- assistant文面の部分一致で状態を推定しない。
- 特定発話向けpatch、test削除、期待値緩和で通さない。
- 会話の自然さは別AIで採点せず、外部開発エージェントがtranscriptを読む。

## 対象経路

```text
固定scenarioと決定論的user driver
→ submitWeeklyPlanningApplicationTurn
→ controller
→ executeWeeklyPlanningTurn
→ 意味解釈AI
→ schema validation / repair
→ Fact Graph V5
→ machine pending question
→ scheduler
→ 返答生成AI
→ preview
→ 訂正 / stale preview無効化 / 再preview
→ draft block promotion
→ approval application
→ test repository保存
→ duplicate suppression / completion
```

ブラウザDOM、Firebase login UI、Production deployそのものは対象外とする。

## scenario

1. 明日の自然な複数ターン計画、既存予定回避、承認、保存。
2. 来週・別表現・非学習task。
3. 誤単位回答からの明示的修復。
4. 英語と数学の複数target訂正。
5. preview後訂正、旧preview無効化、再preview。

ユーザー役は固定発話と決定論的state machineで動く。
machine question code、target fact、Graph revision、preview状態を参照する。
manifestの必須発話順と必須checkが実行結果と一致しない場合は失敗とする。

## 対話停止と修復

次を別々に検出する。

- question、target、action、revision、preview数が変わらない状態反復。
- revisionだけ増え、同じquestion targetへ同じ回答を繰り返す意味的反復。

所要時間質問への「3ページです」のような型不一致はtaskやworkloadとして採用しない。
同じtargetを維持して聞き返し、その後の「3時間です」を元のtargetへ適用する。

machine-selected targetがGraphから消失している場合は、通常canonicalizerへ流さず、Graph、revision、applied turnを変えない`canonicalization_rejected`とする。

## 訂正とpreview lifecycle

明示的訂正ではexact `publicId`とkindで対象を解決する。
対象が一意でなければ推測せずuncertaintyを返す。

```text
publicIdとkindでtarget解決
→ replacementを既存containerへ再接続
→ 旧Factをsupersede
→ correction intentをconsume
→ 現在turnの重複containerをremove
→ schedulerへ修正後Graphを渡す
```

途中失敗時は訂正turn前のGraphへrollbackする。

preview後の訂正では旧previewを消去し、modeをpreview・draft実体から再計算する。
旧revisionのdraft blockは承認できず、修正後Graphから作ったpreviewだけ承認できる。
二重承認はapproval operationで抑止する。

## AI経路の合格条件

構造結果だけでは合格にしない。各turnで次を必須とする。

- Stable V5 traceに`semantic_provider_request`が1件以上ある。
- semantic requestは初回とrepairを合わせて最大2件。
- renderer requestは最大1件。
- 合計は1 turn最大3件。
- `responseSource`は`ai`。
- renderer responseは`rendered`。
- renderer decision branchは`ai_rendered`。

`deterministic_fallback`、`rules`、`system_message_bypass`で予定まで進んでも、実API会話成功として扱わない。

## 費用と停止上限

- 1 scenario最大8 turn。
- 5 scenario合計最大40 turn。
- 会話suite最大120 AI request。
- semantic 4ケースsuite最大12 AI request。
- 最初のfailed scenarioで残りを停止する。
- 上限はreport判定だけでなく、共通AI clientがfetch前に物理的に拒否する。

会話workflowでは次を設定する。

```text
VITE_AI_MAX_PROCESS_REQUESTS=120
```

semantic workflowでは次を設定する。

```text
VITE_AI_MAX_PROCESS_REQUESTS=12
```

Productionではこの環境変数を設定しないため、request circuit breakerは無効である。

## timeout

共通AI clientはdirect OpenAIとWorker proxyの両方で90秒timeoutを持つ。
接続待ちだけでなく、response bodyの解析停止も同じtimeout対象とする。

## fail-fastとartifact

最初のfailed scenarioで残りを停止し、未実行scenario IDをreportへ残す。

artifactは次の各時点で上書き保存する。

- turn完了時。
- preview記録時。
- approval完了時。
- scenario成功・失敗確定時。

job timeoutが起きても、それ以前に完了したturnのtranscript、Stable V5 trace、renderer trace、request数を残す。

```text
artifacts/weekly-planning-real-api-conversation-eval/
  report.json
  report.md
  scenarios/<scenario-id>/
    transcript.md
    report.json
    turn-01.json
    preview-01.json
    approval.json
    failure.txt
```

API keyとAuthorization headerはartifactへ保存しない。

## 保存とtraceの安全性

- owner付きstaging envelopeを使用する。
- Stable V5 session scope確立後にStable V5 envelopeへ昇格する。
- Stable V5保存拒否時はstagingへ退避する。
- 保存成功時だけ旧keyを削除する。
- 訂正traceへ巨大Graphを保存せず、bounded diffを保存する。
- client 48KB、server 64KB、outbox再送、unknown field保持、truncationを回帰検証する。

## 決定論的foundation

```bash
npm run test:weekly-ai:conversation:foundation
```

主な検証対象:

- Stable V5 runtime固定とlegacy UI不在。
- 会話driverと状態・意味的反復停止。
- scenario manifest同期。
- 誤単位回答からの修復。
- 消失pending targetの原子的拒否。
- 単一・複数task訂正とrollback。
- preview訂正、stale preview拒否、再preview。
- owner storage移行と保存失敗fallback。
- trace size、outbox、Worker、unknown field、truncation。
- AI-only経路、request budget、fail-fast policy。
- AI timeoutとprocess request circuit breaker。

通常CIでは、これに加えてTypeScript checks、全Vitest、production build、diff checkを実行する。

## Repository Secret

Repository Actions Secretとして`OPENAI_API_KEY`が必要である。
コード、workflow入力、artifactへkeyを記載しない。

```text
Repository
→ Settings
→ Secrets and variables
→ Actions
→ New repository secret
→ Name: OPENAI_API_KEY
→ Secret: OpenAI API key
```

Secret未設定時はAPI requestを開始せず、次をartifactへ残して停止する。

```json
{
  "status": "blocked_missing_secret",
  "requiredSecret": "OPENAI_API_KEY",
  "apiRequestsStarted": 0
}
```

## GitHub Actions実行

```text
Actions
→ Weekly Planning Real API Conversation Eval
→ Run workflow
→ Branch: agent/weekly-ai-conversation-eval
→ run_real_api: true
→ Run workflow
```

foundation jobが成功した場合だけ、direct OpenAIの5 scenarioへ進む。
modelは`gpt-5.4-mini`固定である。

semantic schema 4ケースは`Weekly Planning Stable V5 Semantic Eval`を手動実行する。
こちらもOpenAI、`gpt-5.4-mini`、`OPENAI_API_KEY`を使用する。

## 現在の検証状態

GitHub Actionsで次を成功確認済み。

- TypeScript checks。
- 全Vitest regression suite。
- production build。
- diff check。
- real API workflow foundation。
- AI-only経路・request budget・fail-fast policy。
- incremental artifact接続。
- 1 scenario 8 turn、suite 40 turn・120 requestの上限。
- semantic suite 12 requestの上限。
- fetch前のprocess request circuit breaker。
- 最新mainの起動修正内容を同期したbranch単体CI。

未確認:

- OpenAI実API会話5 scenario。
- OpenAI semantic schema 4ケース。
- transcriptの自然さ。
- token usageと実費。
- Production Worker、Firebase auth、ブラウザDOM、Playwright E2E。

現在のblockerはRepository Actions Secret `OPENAI_API_KEY`未設定である。
preflight run `30679195853`ではfoundationが成功し、OpenAI request 0件で停止した。
