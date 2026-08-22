# Stable V5 semantic state handoff 七視点監査

Status: complete / structural repair required before merge
Date: 2026-07-31
Branch: `agent/stable-v5-tomorrow-dialogue-consistency`
PR: #107

## 1. 監査対象

次の経路を、表示文面だけでなく状態遷移と永続化境界まで通して監査した。

```text
user utterance
→ Stable V5 semantic normalizer
→ semantic validation / repair
→ contextual answer binding
→ lifecycle canonicalizer / Fact Graph V5
→ generic scheduler input
→ deterministic dialogue decision
→ AI dialogue renderer
→ application commit / trace persistence
```

発端となった会話は次である。

```text
ユーザー: 明日の予定立てたいです
アプリ: どの期間の予定を立てましょうか？
ユーザー: 明日の予定
アプリ: いつからいつまでの予定を作るか教えてください。
ユーザー: 明日
アプリ: 明日1日分の予定ですね。では、明日の予定を作ります。
```

## 2. 結論

`明日`の欠落自体は一つのsemantic omissionであるが、同種の不具合が繰り返される主因は構造にある。

根本原因は、AIが抽出した現在turnの意味と、アプリが保持する既存Fact Graph上の未確定項目を結ぶmachine-readable contractが不足していることである。

特に次の2点はBLOCKERである。

1. 直前の質問種別を`lastQuestionContext`ではなく、AI rendererが生成した日本語文面の部分一致から逆推定している。
2. 短答を既存Factへの回答として表現するschemaがなく、仮のtask/workloadを生成して質問code別binderで結び直している。

したがって、既知の発話ごとに正規表現と回帰fixtureを追加するだけでは不十分である。

## 3. 七視点結果

### 3.1 AI意味抽出・coverage

判定: MAJOR

strict JSON schemaは型、enum、local referenceを検証できるが、発話中の重要情報をAIが落としたことは一般に検出できない。PR #107のplanningWindow conformanceは今回の症状には有効だが、個別語句だけを増やす設計にしてはならない。

必要条件:

- user evidenceをsemantic fact、uncertainty、correctionのいずれかへ対応付けるcoverage contract
- omissionとunsupported inventionを区別したdiagnostic
- repairは一度だけ、deterministic parserによるstate書換えは行わない

### 3.2 会話状態・短答の対象

判定: BLOCKER

`PlanningIntakeState.lastQuestionContext`は存在するが、Stable V5 semantic pipelineはそれを直接利用せず、`lastAssistantMessage.includes(...)`で`missing_effort_estimate`と`quantity_role_unresolved`を推定している。

AI rendererが自然に言い換えるほど、この文字列依存は壊れやすくなる。次turnは表示文面ではなく、question code、target fact、graph revisionを持つpending questionを参照しなければならない。

### 3.3 Semantic document・Fact Graph更新

判定: BLOCKER

現在のsemantic documentは新規task/factの表現には適しているが、既存Factのfieldに対する短答を直接表現できない。通常canonicalizerはdocument内のfactをappendし、既存Factの置換はplanningWindowと一部contextual answerで個別実装されている。

当面の修正ではpending questionが指定するexact target factへ回答を適用する。中期的には`newFacts`、`answers`、`corrections`を分離したturn deltaとgeneric lifecycle applierが必要である。

### 3.4 Scheduler・dialogue policy

判定: GOOD with boundary dependency

schedulerはFact Graphからblocking issueを生成し、dialogue policyはissue codeとfactIdを保持して決定する。このdeterministic coreは維持する。

問題は、そのtyped decisionが次turnまで保持されず、renderer textから再構成されていた点である。

### 3.5 AI renderer

判定: MAJOR

現在のrenderer responseは`actionId`と`text`だけで、question actionが別の質問内容または未実行の作成宣言へ変化し得る。

必要条件:

- rendererは`actionKind`と`questionCode`をechoする
- core decisionとの不一致はfallback
- 次turnのsemantic bindingはrenderer textを参照しない
- 自然な説明と質問文面の自由度は維持する

### 3.6 request・session・trace

判定: MAJOR / separate open work

同一runtime内のstaged Graph、revision、stale discardは存在するが、entrypoint全体のrequest ownershipとcross-tab authorityはIssue #43の範囲が残る。traceのsame-conversation session分裂はIssue #89で継続中である。

今回のsemantic state handoff修正はこれらを隠蔽せず、pending question、semantic repair、renderer contract mismatchをturn diagnosticへ残す。

### 3.7 Test strategy

判定: MAJOR

既知発話のfixtureは多いが、次の構造的不変条件が不足している。

- rendererの言い換えに関係なく同じpending questionへ回答が結合される
- unresolved factが複数あってもtarget factを取り違えない
- pending questionなしの短答を勝手に既存Factへ適用しない
- question actionのidentityをrendererが変更できない
- initial append失敗後のoutbox retryでも上記diagnosticが残る

## 4. 今回PRで修正する範囲

1. `lastAssistantMessage`によるquestion code推定を廃止する。
2. previous `lastQuestionContext`、blocking issue、graph revisionからmachine-readable pending questionを構成する。
3. semantic normalizerとpipelineへpending questionを渡す。
4. contextual answerをexact target factへ適用する。
5. renderer responseへ`actionKind`と`questionCode`を追加し、core decisionとの一致を検証する。
6. `明日`のplanningWindow omission repairを維持する。
7. multi-turn、multiple unresolved targets、renderer paraphrase、trace/outboxの回帰を追加する。

## 5. 今回PRで完了扱いにしない範囲

- generic `SemanticTurnDelta`全体
- correction/remove/uncertainty resolutionの完全なgeneric lifecycle applier
-全semantic fieldを対象にしたcoverage registry
- cross-tab/server-authoritative request sequence
- Issue #89のproduction verification

これらは現行taskへ統合し、完了済みとして扱わない。

## 6. Merge gate

- [ ] pending questionがrenderer text非依存になる
- [ ] exact target fact binding testがgreen
- [ ] renderer action contract testがgreen
- [ ] planningWindow omission repair testがgreen
- [ ] trace/outbox persistence contractがgreen
- [ ] full testがgreen
- [ ] typecheckがgreen
- [ ] production buildがgreen
- [ ] root task inventoryとroadmapが2026-07-31版へ同期される

監査時点の利用者実行結果は、build成功・full test 1件失敗である。失敗fixtureはquestion actionに対して非質問の説明文を成功期待しており、新しいaction contractと不整合であるため修正対象とする。