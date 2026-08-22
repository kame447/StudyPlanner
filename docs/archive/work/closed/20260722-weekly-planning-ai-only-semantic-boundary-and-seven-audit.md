# 週間計画の意味解釈をAI専用経路へ分離 — PR #75完了記録・七視点監査

Status: closed / merged
Merged PR: #75
Merge commit: `48fe92669b016c2e96463578df86dc79589ddc01`
Merged at: 2026-07-22

## 1. 目的と最終契約

週間計画の自然言語意味解釈をAI interpreterの専有責務とし、通常経路、provider失敗、空応答、不正応答、schema不一致、候補全拒否、repair失敗を含むすべてのproduction経路から、決定論パーサーによる初期意味解釈と自動fallbackを除去した。

production executorはAI interpreter付きpipelineだけを使用する。AIはraw user text、直近会話、受理済みstate summaryからtyped command候補を生成する。決定論的coreはschema、shape、enum、値域、公開参照、confirmed slot、重複、競合、revision、readiness、feasibility、scheduler、approval/save gateを担当し、raw user textから新しい意味を生成しない。

rules parser、legacy reducer、legacy pipeline、legacy executorはtest-support境界へ隔離した。AI設定不備またはrules provider選択時は`WeeklyPlanningSemanticInterpreterError`でfail closedし、provider例外、不正JSON、空応答、候補全拒否、repair失敗でもparserへ戻らない。

## 2. 初回監査で確認した不具合

1. schema上有効な空responseがrepairされず、通常のmissing-slot対話へ戻る経路があった。
2. failed/rejected turnでもbehavior層がpreviewまたはassistant-suggested stateを生成できた。
3. production dependency graphが間接的に`parsing/weeklyPlanningText.ts`へ到達していた。
4. AI raw response本文をtraceへ永続化していた。

四件は、空responseの一回repairとfail-closed、失敗時artifactとstate mutationの全面抑止、純粋scheduling helperとprofile defaultsの物理分離、trace raw bodyの非永続化によって修正した。

## 3. 七視点監査

### 3.1 アーキテクチャと責務境界

監査対象はproduction entry point `weeklyPlanningTurnExecutor.ts`から到達する依存グラフである。executor自体からrules分岐は削除されていたが、初回監査ではdraft candidate generatorからsession chunking、daily distributionを経由して`parsing/weeklyPlanningText.ts`へ到達する依存が残っていた。

タスクプロファイル既定値を`profiling/studyTaskProfileDefaults.ts`、分数配分の純粋関数を`scheduling/minuteDistribution.ts`へ分離した。session chunkingは中立モジュールだけを参照し、文字列パーサーを含むdaily distributionへの依存を外した。

最終の再帰import検査では、executorから到達する68 production modulesのうち、`/parsing/`、`Parser`、`Parsing`、`Legacy`、`.testSupport`に該当するモジュールは0件であった。判定は採用可である。

### 3.2 AI schemaとruntime contract

AI response schema、`KNOWN_COMMAND_TYPES`、`ParsedWeeklyPlanningCommand`は同一の20 command typeを保持する。各candidateはJSON parse、optional null canonicalization、runtime shape validation、enum validation、値域検証、confirmed-slot競合、公開参照の存在確認を通過したものだけがreducerへ渡る。

意味出力総数が0のresponseも一度だけrepairする。repair後も空、JSON不正、shape不正、parse rejectionが残る場合は`invalid_candidates_after_repair`としてfail closedする。`strict: false`はprovider互換性のため維持するが、`additionalProperties: false`とruntime validatorをauthoritative contractとする。判定は採用可である。

### 3.3 状態遷移の原子性

provider error、invalid response、空応答、全candidate rejection、repair failureでは以前の意味状態を破壊せず、質問文脈、draft authorization、assumption ledgerを暗黙更新せず、preview artifactを生成しない。

`interpretationOutcome`が`failed`または`rejected`の場合、assistant-suggested mutationを実行せず、behavior actionを空にし、draft run、draft candidates、assumed draft、diagnosticsを抑止する。直前の`lastQuestionContext`とquestionsは保持する。判定は採用可である。

### 3.4 対話とユーザー体験

成功時はAI interpreterが確定したtyped factをdeterministic dialogue decisionとAI dialogue rendererへ渡す。失敗または全拒否時は通常のmissing-slot質問を再利用せず、意味状態を変更していないことを示すsystem messageを返す。

既存stateが院試フローでも、`failed`または`rejected`ではexam rendererを呼ばずsystem messageを優先する。AI設定不備またはrules provider選択時もparserへ切り替えない。判定は採用可である。

### 3.5 セキュリティと信頼境界

AI system promptは`userText`とrecent conversationを信頼できない引用データとして扱う。applicationはAIの自然言語説明を信頼せず、typed commandのshape、enum、値域、参照整合性だけを検証する。後段validatorによるraw-text再解釈は削除した。

task、constraint、proposal、correctionはstate summaryが公開したexact referenceだけを利用できる。confirmed slot上書き、不正期間、負または過大な時間、未知enumはreducer到達前に拒否する。入力は4,000文字、repairは1回に制限する。判定は採用可である。

### 3.6 trace、可観測性、プライバシー

traceは`interpretationSource=ai_interpreter`、`interpretationOutcome`、`stateMutationSource`、repair、accepted/rejected/parse-rejection数、providerまたはvalidation failureを別々に記録する。provider failure時に`fallback_used`を記録せず、AI失敗とparser fallbackを混同しない。

AI response本文は永続化せず、`rawResponseLength`だけを記録する。parse rejection、failure category、accepted/rejected countsは維持する。判定は採用可である。

### 3.7 テスト、変更範囲、マージ衛生

legacy parserの既存単体テストは`.testSupport.ts`を明示importし、本番契約テストと分離した。production boundary testはexecutorからの再帰import graphを検査する。空応答、repair空応答、provider error、全拒否、既存院試renderer、draft-ready failure、trace body非永続化の回帰テストを追加した。

最終headで全test suite、TypeScript、production build、PR diff checkが成功した。一時workflowとpatch搬送ファイルは最終treeから削除し、unresolved review threadは0件、draft解除後`mergeable=true`を確認した。判定は採用可である。

## 4. 検証結果

監査修正commit `e9cd3de4eaabe697f558c4957bf76dbe65351212`をクリーンなGitHub Actions runnerで検証し、その後の最終head `7b3938134f6da66a037881243fe86258f6732690`でも通常CIを再実行した。

- full test suite: success
- TypeScript and production build: success
- PR diff check: success
- unresolved review thread: 0
- Cloudflare branch preview deploy: success
- PR #75: squash merged

## 5. 残余リスク

外部AI provider自体の意味誤読は残る。実API real-evalは環境変数がない通常CIではskipされる。provider停止時はparser fallbackを行わず、ユーザーに再送を求める。これらは意味解釈責務をAIへ完全分離するための意図した制約であり、merge blockerではない。

## 6. 旧文書との関係

次のroot taskはPR #75で完了または契約変更されたため、active queueから外した。

- `20260721-weekly-planning-ai-semantic-ownership.md`: PR #75前の段階的契約。provider failure時のparser fallback許可を含むためsuperseded。
- `20260719-weekly-planning-ai-responsibility-boundary.md`: deterministic補助入力と限定fallbackを許可した旧境界のためsuperseded。
- `20260719-weekly-planning-rules-end-to-end-integration-test.md`: production rules経路を前提とするためsuperseded。

現在の契約は`docs/ai/weekly-planning-current-contract-status.md`を正とする。
