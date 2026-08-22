# 週間計画 AI意味理解責務 Phase 2・Phase 3 七視点事後監査

Status: implementation complete / CI verification in progress
Date: 2026-08-03
Parent task: `docs/ai/tasks/20260803-weekly-planning-ai-semantic-ownership-reset.md`
Upstream design: `docs/ai/design/20260803-weekly-planning-semantic-ownership-phase2-design.md`
Branch: `agent/weekly-ai-conversation-eval`
PR: #109

## 監査対象

Stable V5 semantic normalizer、semantic validator、contextual short-answer、creation authorization、direct work coverage、task boundary、planning window canonicalization、duplicate workload normalization、および関連する単体・統合テストを対象とする。

今回の目的は、会話テストを通すための語句patchを増やすことではない。AIを唯一の意味理解担当へ戻し、後段をschema・参照・安全性の検証へ限定したうえで、Fact Graph、readiness、scheduler、previewへ意味を失わず渡すことである。

## 思想照合

実装前後でP0正本を再確認した。自然言語、短答、訂正、承認、数量役割、相対日付、task境界の意味理解はAIが担当する。決定論的処理は、AIが選んだ値とexact IDを検証し、Fact Graphへ原子的に適用する。provider failureまたはvalidation failure時に日本語parserへfallbackしない。repairは最大1回とし、再失敗時はfail closedとする。

今回の実装はこの原則を変更していない。

## 七視点監査

### 1. 利用者対話

短答や作成承認を特定の日本語表現だけで受理する経路を停止した。利用者の表現が変わっても、AIが現在発話、recent conversation、machine pending question、公開Fact Graph状態を読んで意味文書を返す。

この変更により、定型表現の辞書を増やす方向ではなく、AIへ必要な文脈と正確な対象を渡す方向へ責務が固定された。

### 2. 意味schema

`SemanticEffortEstimateV5.targetLocalId` の既存表現力を利用し、taskとcomponentに加えて、同一task内のworkloadをexact localIdで参照できるようvalidator境界を修正した。

これにより「英語40問に3時間」のような意味を、40問workloadと、そのworkloadを対象にするtotal durationとしてAIが直接表現できる。後段がユーザー文から40問と3時間を再抽出して結び直す必要はない。

### 3. validator・canonicalizer

公開validatorは既存の広い構造検証を維持しつつ、workload-target effortの誤拒否だけを限定解除するwrapperとした。対象候補は同一task内に実在するexact workload localIdだけであり、title、sourceText、数量、単位、文字列類似から選び直さない。

planning windowはAIが返したkind/valueの列挙値だけを検証し、sourceTextの「今日」「明日」「来週」等から値を上書きしない。task boundaryもAI文書を自動改名・自動分割しない。

### 4. Fact Graph・状態遷移

今回の変更はFact Graph適用、revision、rollback、pending question binding、stale preview、二重承認、二重保存の安全制御を変更していない。

AIが返した意味文書は既存canonicalizerとapplication pipelineへ渡される。exact IDの不一致や参照消失時は推測せず拒否するという既存方針を維持する。

### 5. 内部プラン生成

AIは「何を、どれだけ、どの期間・条件で行うか」をsemantic documentとして表現する。readiness判定とschedulerはFact Graphから安全な時間配置を計算し、previewを生成する。

AIへ自由文の最終スケジュールを直接保存させる設計には変更していない。意味理解をAIへ寄せることと、配置・競合回避・保存を決定論的に行うことを分離している。

### 6. 永続化・観測

semantic provider request、raw response、validation result、repair request、repair response、final decisionのtrace stageを維持した。raw responseからaccepted documentへのalgorithmic repairは、完全一致duplicate workload除去だけが許可される。

短答、承認、task分割、相対日付、作業coverageによる意味的置換をalgorithmic repairとして行う経路は停止した。

### 7. テスト・運用

特定scenarioの文言だけではなく、短答、承認、作業名・数量・単位、task境界、相対日付を変えたケースで、後段が意味を再解釈しないことを固定した。

architecture testでは、creation authorizationとcontextual answerがユーザー文だけから生成されないこと、direct workを再抽出しないこと、taskを分割しないこと、相対日付をsourceTextから上書きしないこと、workload-target effortが受理されることを検証する。

## 実装結果

semantic normalizerは、AI request、schema・参照・列挙値検証、最大1回のAI repair、fail closedという単純経路へ変更した。

停止したproduction意味処理は次のとおりである。

contextual short-answerの独自semantic document生成、creation authorizationの語句判定、direct work coverageのユーザー文再抽出、task boundaryの自動改名・自動分割、planning windowのsourceText再解釈、これらに由来するsemantic repair directiveである。

維持した決定論的処理は、既存schema validation、exact reference validation、canonical enum validation、同一localIdかつcanonical JSON完全一致のduplicate workload除去、最大1回のrepair、Fact Graph lifecycleと安全制御である。

## 設計上の妥当性

今回の修正は、AIが失敗した際に別のparserで成功扱いにする構造を削除しているため、短期的には以前のscenario固有補正より厳しくなる。これは意図した変更である。

AIが意味を返せない場合は、raw response、prompt context、schema表現力、validator誤拒否、ID binding、Fact Graph適用の順で原因を調べる。新しい日本語regexや語句辞書を追加しない。

## 残存リスク

既存の大規模test suiteには、削除対象だった後段意味補正を正しい挙動として期待する古いテストが残る可能性がある。その場合、失敗内容を一件ずつ確認し、思想変更に伴う期待値更新か、本当の回帰かを区別する。

workload-target effortのvalidatorは既存validator coreをwrapperで限定補正している。将来schema validatorを整理する際は、workloadを正式参照対象としてcoreへ統合し、wrapperの例外処理を解消する必要がある。

実API会話では、AIがpending question targetとworkload-target effortを安定して生成できるかを確認する必要がある。失敗しても後段parserは戻さない。

## 検証状況

最新HEADに対するTypeScript checksは成功した。

全Vitest、production build、diff check、実API会話、semantic schema evalは本書作成時点で未確定である。確定後に結果を追記し、未実行項目を成功済みとして扱わない。
