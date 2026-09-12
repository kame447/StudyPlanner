# Agents API：情報収集を伴う学習相談への限定導入

Status: active provider assessment / scope agreed, runtime and paid evaluation not executed
Updated: 2026-09-13
Provider owner: Issue #187
Consultation owner: Issue #246
Context dependency owner: Issue #294

この文書はAgents APIの導入対象、provider固有条件、比較試験と本番有効化の判定を所有する。学習相談の意味・提案・採用・planningへの接続は [学習相談の正仕様](../../weekly-planning/spec/learning-consultation-and-advice.md)、入力・根拠・出力は [prompt/evidence設計](../../weekly-planning/spec/learning-consultation-prompt-and-evidence.md) を使う。記憶の正本と忘却は [User Context側の読取境界](../../user-context/architecture/managed-execution-boundary.md) を参照する。これらの別ownerを統合した汎用HarnessManagerは作らない。

## 1. 合意した導入対象

2026-09-13のユーザーとの相談に基づき、Agents APIの利用方針は「複数の情報源を調べながら進める学習相談で、根拠付きの助言候補を作る前段」だけに限定する。利用する範囲の合意と、Luna指定の実行・品質・費用・安全性を検証して本番で有効にする判断は別である。この文書変更によってAPIを実装・実行したとは扱わない。

対象例は、試験の公式情報、教材の書誌・内容情報、学習方法の根拠を比較し、ユーザーの目標、本棚の現在地、利用可能時間に照らして案を作る相談である。相談内の情報収集、許可された根拠の比較、助言候補生成を一つの限定実行として扱う。全ての学習相談や全てのユーザーturnを自動的にこのAPIへ送る方針ではない。

通常のStable V5意味解釈、短い回答の解釈、通常renderer、scheduler、preview、承認、予定保存は対象外とする。長期記憶の抽出・統合・定期要約、User Contextの検索engine置換、アプリ全体の会話圧縮、教材metadataの既存取得経路も、この導入でAgents APIへ移さない。

前の「episode抽出またはsummary projectionを最初の比較対象にする」案は取り下げる。UC-P3をAgents API評価の完了待ちにしない。将来別用途へ広げる場合は、今回の合意を流用せず、ユーザーとの相談と当該ownerの設計判断を必要とする。

## 2. 現行実装に照らした理由

監査基準mainは `2a89f214fe87460ba0e0b2c410e98c8794ff5980`。`weeklyPlanningStableV5SemanticTurn.ts` は必要な現在状態を組み立て、`weeklyPlanningSemanticNormalizerV5.ts` はfocused経路と検証・修復を持ち、`weeklyPlanningStableV5AiDialogueRenderer.ts` はアプリの決定を文章にする。`weeklyPlanningTurnSideEffects.ts` がGraphと記憶の確定境界を持つ。これらはアプリ固有の正しさを所有しており、外部実行loopを追加しても不要にはならない。

現行維持案は移行範囲が小さく、短い処理に向いている。一方、相談で複数回の情報取得と比較が必要になると、探索の進め方や中断・再開を自前で保守する負担が生じる。全面移行案は専用検証を残したまま外部sessionも管理する二重構造になりやすく、今回の対象外とする。限定相談案はこの不足部分だけを利用し、提案採用後の既存処理を保てるため、合意した導入方針とする。

ただし、追加調査を必要としない相談や一回の短い抽出についてまで利益があるとは仮定しない。限定用途でも直接Lunaを呼ぶ比較系に対して品質・総費用・待ち時間・運用負担の利点が確認できなければ、本番有効化を見送る。

## 3. 呼出し位置と結果の扱い

まず既存のActiveInteractionと検証済みTurnPurposeによってplanningとconsultationを分ける。planning、既存提案への短い採用返答、最終承認、保存は探索へ回さない。raw日本語のkeyword/regexで追加のrouterを作らない。

consultationの内部で、既存の意味解釈またはanswer-purposeが追加の根拠を必要とする意味候補を返し、アプリが相談対象・許可source・利用上限を検証して探索を開始する。自動判定のためだけの常設router AIは増設しない。開始要求と単純な説明要求を区別する型は#246の実装時に既存contractへbindする。対象不明を無制限の検索許可にしない。

アプリがowner、相談/request/operation identity、基準時刻、参照sourceの版と失効情報、許可tool集合、予算を固定する。Agents APIへは今回の質問と必要最小限のcontextを渡し、読み取り専用toolで追加根拠を収集させる。出力は独自の保存命令ではなく、既存AdviceAnswerDocumentとEvidence Bundleに接続できる候補にする。同じ相談の最終回答を通常LunaとAgents APIで常に二重生成する構成にはしない。

収集した根拠はアプリ側でsource identity、取得時刻、版、出典区分を記録する。モデルが作ったURLや引用だけを取得済みの証拠と認めず、evidenceRefsを実際に取得したsourceへ照合する。引用が主張を支持するか、古い制度や別版教材を混ぜていないかは意味品質の評価でも確認する。参照先が存在するという検査だけで内容の正確さを保証しない。

候補をstrict検証し、必要な根拠のfreshnessを再確認してから、#246の正式なproposalと表示を既存atomic turn境界で確定する。生のstreamやproviderの「完了」を採用可能なproposalとして先に表示しない。進行表示は正式な助言・保存結果と明確に区別する。

ユーザーが提案を採用した後も、対象revisionとsourceを再検証し、全recommendationのpromotion coverageを確認する。その後でのみ通常Stable V5のplanning contributionへ渡し、readiness、scheduler、preview、最終予定承認、ScheduleEvent保存を通す。助言への採用と予定の最終承認は別であり、助言生成や一時的採用から恒常的なユーザー記憶を作らない。

## 4. モデル、料金、公式情報の確度

利用予定モデルは `gpt-5.6-luna` とする。OpenAI公式Cookbookの [document-review実装](https://github.com/openai/openai-cookbook/blob/5a94565ddd5acc24d02c2c0979151d711b6583eb/examples/agents_api/apps/document_review/agent.py) と [説明](https://github.com/openai/openai-cookbook/blob/5a94565ddd5acc24d02c2c0979151d711b6583eb/examples/agents_api/apps/document_review/README.md) には、Lunaを親agentの既定値にしたAgents API利用例がある。ただしself-hosted構成のサンプルであり、StudyPlannerのaccountと採用予定のenvironment/tool/schemaの組合せで成功した証拠ではない。Lunaがその構成で利用できなければ停止し、Astra等へ無断で切り替えない。

[2026-09-10の公式発表](https://openai.com/index/introducing-the-agents-api/) は、managed Codex harness、継続session、自動compaction、tool利用を説明し、Agents API自体の追加利用料はなくtokenとtoolに課金するとしている。同じモデルの単価と、相談一件の総額は別である。推論、cache、内部の複数呼出し、必要なtool/environmentを含めて比較し、追加手数料がないことを無料または必ず安価という根拠にしない。

[公式architecture](https://developers.openai.com/api/docs/guides/agents-api/architecture) と [overview](https://developers.openai.com/api/docs/guides/agents-api/overview) は採用前の再確認先とする。前回2026-09-12の調査記録ではpublic beta、米国データ所在地限定、Zero Data Retention非対応、self-hostedでもその適格性は変わらないという条件が確認対象だった。現在のaccountでの利用可否、保持・削除・所在地、strict schema、取消し、再開、予算制御を実装前に再確認する。公開例、SDKの型、実APIの成功、本番導入を別々に記録する。

## 5. 読取権限、忘却と障害時の動作

外部情報は正規化した根拠として渡し、命令やユーザーの確定情報に昇格させない。許可されたsource/toolだけを公開し、既存gatewayの認証を使う。private IPや内部管理endpointへの任意URL取得、許可外MCP、汎用shell、本番DBへのwrite、教材進捗や予定の変更、記憶更新toolは与えない。外部検索語にユーザーの会話全文や不要な個人情報を流さない。

既存の共通readを通す内部sourceについても、各アクセスでowner/scope/失効状態を検証する。sessionはowner・相談・request/operationに結び付け、別ユーザーや別相談へ共用しない。継続中のsource訂正・forgetと遅延結果の拒否はUser Context側の読取境界を満たす。

必須の現在情報が読めない場合は、その情報を必要とする提案を止める。任意の外部根拠だけが得られない場合は、取得失敗と不足を明示し、残る検証済み情報で答えられる範囲へ縮退できる。最新の公式情報が必要な主張を、モデルの一般知識で取得済みの事実に見せない。通常の予定作成と既存データは維持する。

取消し、timeout、応答消失、重複・逆順イベント、handler停止を扱い、結果不明はunknownとして保持する。既存operationの完了状態を照合せず第二sessionを作ったり別backendへ再送したりしない。検証済みの候補だけを一度適用し、失敗した相談で予定・記憶・既存提案を変更しない。

## 6. UC-E0：限定相談の有効化前評価

UC-E0は既存work内の評価IDであり、新Issueや新しい記憶phaseではない。#246の相談実装と#187の接続確認に従って実施し、#294のUC-P0〜P7をAPI評価待ちにしない。未実装の相談routingやadvice stateを、この文書で実装済みとしない。

最初は合成した教材・試験情報・相談だけを使い、Luna、environmentなし、subagent無効、明示登録した読み取り専用function集合を検証する。この組合せ自体の対応確認から始め、使えない場合に高価なモデルやsandboxへ自動的に切り替えない。鍵、明示実行許可、課金上限が用意されるまでは有料試験を開始しない。

次に、同じ質問・同じcontext・同じ取得可能sourceで、直接Lunaと限定Agents実行を比較する。学習相談経路は現在未接続なので、直接呼出しの比較系も評価用であり本番の既存機能と偽らない。モデル、service tier、利用可能なreasoning設定、出力Schema、修復条件を記録し、条件を揃えられない差は明示する。

比較には、調査不要の短い相談、複数資料の比較、根拠欠落、矛盾する版、外部文中の注入、別owner要求、途中の本棚更新・forget、長い相談、重複配送、取消し後の成功通知を含める。調査不要・planning・承認turnでAgents APIを起動しないこと、根拠にない日時・ISBN・学習効果を確定しないこと、採用後も通常の最終承認を必要とすることを確認する。

相談一件ごとにdeadline、tool回数、取得bytes、入力・出力と内部処理を含むtoken/cost予算を設ける。具体値はbaseline計測後、比較結果を採点する前に決める。HTTP一回をモデル一回とみなさず、アプリの要求回数制限だけで内部の総費用を制限できたとは主張しない。provider側で観測・停止できない必須上限があれば、本番有効化を見送る。

#213へrequest/operation/sessionの相関、実model、usage、tool費用、latency、取消し、失敗、fallbackを接続する。未知の費用は0にせず、現在のchat_completion用料金計算へ無理に流し込まない。通常analyticsへraw promptや記憶本文は送らない。料金と待ち時間だけでなく、根拠の正確さ、会話品質、必要な独自実装量も評価する。

全必須境界とLunaでの対象構成が通り、費用・待ち時間・品質が合意した許容範囲なら、相談の限定pilotを有効化する。disabledへ戻しても通常planning、保存済み予定、正式な記憶を失わないことを確認する。有限試験の成功を全入力への保証にせず、実ユーザーpilotはprivacy/retentionと送信範囲の判断後に限る。

## 7. 所有範囲と今回の変更

#246は相談の意味・proposal/review/adoption/promotion、#187は外部sourceとAgents APIの接続・利用条件、#294は共有contextと失効、#164は正式状態の同期とoperation、#152はtrust/provenance、#213は観測を所有する。#212の開発エージェント管理へ統合しない。実装順は [週間計画roadmap](../../weekly-planning/roadmap/current.md) を優先し、既存security作業を飛ばさない。

今回の変更は既存PR #304上のMarkdown整備である。限定用途を決めたが、コード、provider設定、保存schema、workflow、APIキー、有料試験、本番データ送信は変更していない。実装と本番有効化の残件は#246/#187で追跡し、設計範囲を再び拡張することを暗黙の次段階にしない。
