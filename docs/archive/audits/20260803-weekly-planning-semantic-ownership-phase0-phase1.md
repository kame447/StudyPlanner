# 週間計画 semantic ownership Phase 0・Phase 1監査

Status: completed for classification / implementation removal not started
Date: 2026-08-03
Parent task: `docs/ai/tasks/20260803-weekly-planning-ai-semantic-ownership-reset.md`
Branch: `agent/weekly-ai-conversation-eval`

## 監査目的

P0タスクのPhase 0とPhase 1に従い、Stable V5のAI応答後に実行される処理を、ユーザー発話の意味を再解釈する処理、意味を変えない機械的処理、schema不足を隠す処理へ分類する。

本監査では回帰コード自体は削除しない。削除前に、呼出位置、入力、出力、AI出力の置換有無、schema・validatorとの関係を固定する。

## 判定基準

「ユーザー文、sourceText、作業名、数量、単位、会話表現を読み、AIが返した意味とは別の意味表現を生成、補完、分割、上書き、拒否する処理」は意味理解であり、決定論的後段へ置かない。

「AIがすでに選択した意味表現について、JSON形式、列挙値、数値範囲、参照先、revision、所有者、完全一致重複、安全な状態遷移だけを確認する処理」は機械的処理として残せる。

「本来schemaで表現すべき意味を、ユーザー文の再解析や後段の構造変換によって擬似的に通す処理」はschema不足を隠す処理とする。schema修正後に削除する。

## 実行経路

`weeklyPlanningSemanticNormalizerV5.validateSemanticResponse` は、AIのraw responseを検証する前に、作成承認とcontextual short-answerについてユーザー文から別のsemantic documentを生成して返す。該当しない場合も、raw JSONの完全一致重複除去、schema parse、planning window補正、task boundary補正、ユーザー文とのcoverage検査を順に実行する。

したがって現状のaccepted documentは、必ずしもAIのraw responseを検証して得た文書ではない。Phase 3では、この入口で意味置換を行う経路を最優先で除去する必要がある。

## 分類結果

### contextual short-answerの独自解釈

対象は `weeklyPlanningContextualAnswerDocumentV5.ts`、`weeklyPlanningContextualAnswerGroundingV5.ts`、およびnormalizer先頭の `createGroundedContextualAnswerDocumentV5` 呼出である。

判定は「意味理解なのでAIへ戻す」。さらに、既存workloadへ所要時間を結び付ける短答表現がschemaで十分に表現できない部分は「schema不足を隠す処理」にも該当する。

根拠は、数量役割、時間表現、訂正表現、対象名、対象数量、日付・時間帯、scope変更を日本語の正規表現と語句列挙で判定し、AIのraw responseとは無関係に新しいsemantic documentを生成しているためである。

Phase 3ではproduction経路から削除する。先にPhase 2で、pending questionへの回答対象、既存factへの参照、所要時間の対象factをAI文書で直接表現できるようにする。

### creation authorizationの独自解釈

対象は `weeklyPlanningCreationAuthorizationV5.ts` とnormalizer先頭の `createGroundedCreationAuthorizationDocumentV5` 呼出である。

判定は「意味理解なのでAIへ戻す」。

根拠は、「これで予定を作って」等の表現を語句列挙で判定し、AI応答をparseする前に `planningIntent: create_plan` の別文書へ置換しているためである。これはvalidationでも安全制御でもない。

Phase 3では削除する。作成承認はAIが明示的なintentまたはdecisionとして返し、後段はreadiness、revision、二重承認だけを検証する。

### direct work coverageのユーザー文再抽出

対象は `weeklyPlanningDirectWorkCoverageV5.ts`、normalizerの `directWorkCoverageErrorsV5`、repair promptへ渡す `missingDirectWorkExpectationsV5` である。

判定は「意味理解なのでAIへ戻す」。

根拠は、ユーザー文を区切り、作業名、数量、単位、訂正cueを再抽出し、AI文書のtask・component・workload・effortEstimateとの意味的な包含関係を比較しているためである。labelの部分一致も意味判断であり、形式検証ではない。

Phase 3ではproduction validationとrepair payloadから削除する。欠落検出が必要なら、AI自身へ原発話と現在状態を渡して自己修正させるか、raw responseとaccepted documentの構造的不変条件だけを検証する。

### task boundaryの意味的自動分割

対象は `weeklyPlanningTaskBoundaryContractV5.ts` の `normalizeTaskBoundariesV5` である。

判定は「意味理解なのでAIへ戻す」。親タイトル衝突を理由に独立作業へ分割する処理は、schema不足を隠す処理にも該当する。

根拠は、task title、context label、root component labelを比較し、「共通文脈か独立作業か」を後段で決め、taskを改名または複数taskへ分割しているためである。ID重複回避自体は機械的だが、分割を行うかという前提判断が意味的である。

Phase 2でAIがtask境界と共有contextを明示できる契約を確認し、Phase 3で自動改名・自動分割を削除する。validatorは曖昧または矛盾した構造を拒否するだけにする。

### planning windowのsource text再解釈

対象は `weeklyPlanningPlanningWindowCanonicalContractV5.ts`、normalizer内の `DIRECT_PLANNING_WINDOWS_V5`、`directPlanningWindowExpectation`、`planningWindowConformanceErrors` である。

判定は「意味理解なのでAIへ戻す」。

根拠は、`sourceText` またはユーザー文から「今日・明日・明後日・今週・来週」を再抽出し、AIが返したkind/valueを上書きまたは不一致として拒否しているためである。NFKCや空白除去だけなら機械的だが、自然言語句からcanonical valueを選ぶ部分は意味理解である。

Phase 3ではsource text再解釈と直接発話再検査を削除する。残してよいのは、AIが返したkind/valueがschemaの列挙値に含まれるか、kindとvalueの組合せが形式上妥当かの検証だけである。

### duplicate workload正規化

対象は `weeklyPlanningDuplicateWorkloadNormalizationV5.ts` の `normalizeExactDuplicateWorkloadPlacementV5` である。

判定は「意味を変えない機械的検証・変換なので残す」。

根拠は、同一localIdかつcanonical JSONが完全一致するworkloadがtask直下とcomponent配下へ二重配置された場合だけ、task直下の完全一致コピーを除去しているためである。作業名やユーザー文を読まず、数量・単位・役割を推定し直さない。

ただし維持条件として、部分一致、同義語、label類似、数量換算、異なるlocalIdの統合へ拡張してはいけない。完全一致でなくなった時点でfail closedとする。

### repair prompt生成

対象は `weeklyPlanningSemanticNormalizerV5.ts` の `repairDirectivesForErrors` と `createRepairMessages` である。

判定は二分する。

validation errorを列挙し、最大1回だけAIへ修正を依頼し、再失敗時にrejectする制御は「意味を変えない機械的検証・変換なので残す」。

一方、direct work coverage、task boundary、planning windowの自然言語再解釈から生成したerror、`missingEvidence`、source meaningを前提にした修正指示は「意味理解なのでAIへ戻す」であり削除対象である。repair promptはschema・参照・数値範囲・安全性のエラーだけを伝え、後段で選んだ別の意味をAIへ強制してはいけない。

### canonicalizerとvalidatorの参照制約

対象はsemantic validator、canonicalizer lifecycle、canonical correction application、pending question binding、Fact Graph適用である。

判定は原則として「意味を変えない機械的検証・変換なので残す」。

残してよいのは、schema parse、必須項目、列挙値、数値範囲、localId一意性、参照先存在、参照種別、publicId、owner、revision、pending questionのtarget一致、Fact Graph lifecycle、duplicate turn、stale state、二重承認・二重保存の拒否である。

ただしvalidatorまたはcanonicalizerがtitle、sourceText、自然言語label、数量表現を比較して対象を選び直す箇所は同じ禁止対象である。Phase 3着手前に、参照解決関数を「AIが指定したIDを検証する処理」と「文字列から対象IDを推測する処理」に分けて再監査する。

## Phase 0一覧

削除予定は、contextual short-answer独自文書生成、creation authorization独自文書生成、direct work coverage再抽出、task boundary自動改名・自動分割、planning window source text再解釈、これらに由来するrepair directiveである。

schema修正後に削除するものは、既存workloadへの所要時間短答を再構築する処理、pending question回答を既存task shellへ再構築する処理、task境界を後段分割で補う処理である。

維持予定は、完全一致duplicate workload除去、schema・型・範囲・参照・revision検証、最大1回のAI repair、fail closed、Fact Graph lifecycle、安全制御である。

## Phase 2へ渡す未解決事項

所要時間factがtaskだけでなくworkloadまたはcomponentを正式に参照できるかを確定する必要がある。

短答が既存task全体を再生成せず、pending questionのtarget publicIdと回答値だけを表現できるschemaを決める必要がある。

作成承認、訂正、削除、置換をplanningIntent、decision、correctionのどこで表現するかを一意にする必要がある。

AIが返したtask境界を後段が変更せずに済むよう、共有contextと独立taskの契約をprompt・schema・validatorで整合させる必要がある。

## 実装禁止コメントの配置方針

productionコード上では、自然言語解釈helper側に「P0 freeze中であり拡張禁止、Phase 3削除対象」と明記する。また、完全一致duplicate正規化側には「この処理だけが許される理由」と「意味的統合へ拡張しない条件」を明記する。

このコメントは詳細仕様の代替ではない。判断根拠の正本はP0タスクと本監査文書であり、コードコメントから両方を参照できる状態にする。

## 検証状況

本変更はPhase 0・Phase 1の分類と設計コメントの固定だけを対象とする。production挙動は変更していない。

GitHub上の内容監査のみであり、typecheck、Vitest、production build、実API evalは実行していない。コード削除とschema変更はPhase 2以降で別途行う。
