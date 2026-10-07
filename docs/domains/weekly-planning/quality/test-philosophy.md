# 週間計画 AI テスト方針

Status: canonical
Updated: 2026-10-07

References:
- [Human Grounding Policy](../policies/human-grounding.md)
- [Learning Consultation and Advice Contract](../spec/learning-consultation-and-advice.md)
- [Scheduling Policy](../policies/scheduling.md)
- [Adaptive Memory Policy](../policies/adaptive-memory.md)
- [Current Contract](../architecture/current-contract-v5.md)
- [Regression scenario catalog](regression-scenarios.md)
- [Real API evaluation policy](real-api-eval-policy.md)

## Deterministic tests

AIの自然な日本語や一つのsemantic phrasingをuniversal oracleとしない。自動化するのは正誤を決定論的に定義できるcontract。

- schema/evidence/reference validity
- binding/Fact Graph lifecycle/revision/idempotency
- quantity/progress derivation and convergence
- task decomposition / atomicity
- pending target/question necessity
- repair agenda / defer / reopen boundary
- proposal lifecycle/acceptance scope
- current-week/durable promotion boundary
- authoritative availability / not-before / scheduling distribution
- hard temporal bound resolution / target applicability / scheduler-input compilation
- reserve/slack behavior when the resulting horizon is exactly seven days
- readiness/scheduler
- preview/approval/save
- persistence/recovery/trace
- security/request/prompt budget

raw Japanese fixtureをdeterministic production codeが意味再解釈するtestを追加しない。

会話の自然さ（Issue #488）は完成済み日本語の一文一致では検査しない。検査するのは契約である: rendererへ渡るtyped communication context（goal・question purpose code・status reason・disclosure・flag）、説明要求がplanning mutationを持たないことだけでsemantic failureにならないこと、通常turnとsemantic failureのrecoveryがrendererを通ること、renderer出力が内部の仕組みの語彙（ユーザー発話・計画データに無いもの）を含むと拒否されること、emergency文言がどのgoal/flagの組合せでも内部語彙を含まず質問を保持すること、そしてsource scan（TypeScript ASTの文字列literalのみ）で週間計画の本番fileにある日本語literalがすべて分類済みであり、interaction decision moduleには日本語literalが無いこと（`weeklyPlanningAssistantProse.contract.test.ts`）。自然な日本語としての良し悪しはGemini/人手の評価対象であり、deterministic testの正解文にしない。

会話interaction（Issue #488）はscripted provider（transportだけを差し替え、controller/runtime/validator/renderer/reducerは本番のまま）でturn全体を通すscenario suiteで守る: pending question→説明→同じ質問の再提示、aside/resumeによるbinding、semantic/provider失敗後のstate保持と同一質問の再提示、reload/chat A→B→A、stale/double submit、mixed turn、不正出力のsentinel非漏洩、act/outcomeが承認・保存・authorizationに影響しないこと。シナリオはregression-scenarios.mdのDIALOGUE-007〜010が正本。typed actは「欠落または誤りでもnon-mutatingに劣化する」ことをdeterministicに検証し、modelがactを正しく出す精度はreal-API gateの責務とする。

会話architecture switch（`legacy_v5` / `interaction_v1`）は「ラベルではなくarchitectureが変わる」ことをdual-mode testで守る: 同一fixture・同一scripted providerで両modeを通し、provider schema/prompt、retry/dispatch数、失敗presentation、aside後のbinding、mode pinning（reload/chat A→B→A/旧checkpoint→legacy）、preference変更が新規会話だけに効くこと、測定のdispatch数が実provider呼び出し数と一致することを検証する。legacyの忠実性は記憶ではなく`git archive ee07697e`で得たpre-#488 treeをoracleとし、schema/prompt/binding/rendererのhash固定（`weeklyPlanningConversationArchitectureOracle.test.ts`）と、同一scenarioのdifferential replay（call列・request hash・message・state・freshnessの一致）で確認する。意図したshared boundaryの変更でoracle hashを更新するときは、両architectureに適用されることを確認してから更新する。測定はobservation専用であり、評価UI/測定値でsemantic挙動を分岐させるtestを書かない。

## Planned Issue #246 deterministic contract

learning consultation runtimeが実装された場合、少なくとも次はdeterministic regressionで保護する。

- consultation advice生成だけでaccepted planning Fact Graphをmutationしない
- advice表示だけでpreview / saveへ進まない
- assistant clarificationとuser consultationを同じmachine stateへ潰さない
- AdviceProposal lifecycleをexplicit identity/revisionで管理する
- explicit semantic acceptanceなしにplanning promotionしない
- reject / supersede / stale adviceをapplyしない
- ambiguous advice referenceはfail safeする
- item/option scopeを誤bindingしない
- repeated adoption / retry / reloadでduplicate planning effectを作らない
- deterministic calculation resultをanswer modelがauthorityとして上書きしない
- Bookshelf等のsource factsをconsultationの都合でFact GraphやMemoryへ複製しない
- current-plan adoptionだけでdurable memoryを増やさない
- `今後も`等のdurable meaningが明示された場合だけ別memory candidateになり得る
- required context source failureをempty contextとして扱わない
- provider/validation failure時にaccepted stateを壊さない
- partial streaming outputをvalid adviceとしてcommitしない
- stored/retrieved untrusted textをinstructionとして扱わない

これらはIssue #246 implementation前のproduct requirementであり、runtime未実装の間は「current production regression pass済み」とはみなさない。実装PRでproduction evidence ownerへ対応付けた後に [regression-scenarios.md](regression-scenarios.md) のcurrent guaranteeへ昇格する。

## Regression scenario ownership

Version非依存の主要scenarioは [regression-scenarios.md](regression-scenarios.md) をcurrent catalogとする。

Historical V4 roleplay、closed task、auditが重要なfailure caseを持っていても、その文書をcurrent test planへ戻さない。現在も必要なinvariantだけをscenario catalogへ抽出し、current Stable V5 code/testへ対応付ける。

特に次を「古い実装詳細」と誤認して落とさない。

- resulting planning horizonが7日間の場合のcurrent reserve/slack behavior
- accepted hard temporal boundをdefault 7日で切り捨てず、task/component scopeを越えて漏らさないこと
- request-timeより前へ配置しないこと
- existing plans/timetable/life hard constraintsを空き時間にしないこと
- progress / remaining / current targetの分離
- atomic work integrity
- blocking repairとlow-impact deferの分離
- stale preview / pending proposal / approval idempotency
- current-week acceptanceとdurable memoryの分離

Issue #246の未実装scenarioは [Learning Consultation and Advice Contract](../spec/learning-consultation-and-advice.md) がimplementation acceptance matrixを所有する。current catalogへ先にコピーしない。

## Property / metamorphic tests

入力例の一点一致だけでなく、domain invariantが変形後も成立することを検査する。

適用例:

- bounded progressの入力順序を入れ替えても同じactive factsなら同じremainingへ収束する
- irrelevant factを追加しても独立なhard constraintが変化しない
- derivation/projectionがsource inputを暗黙mutateしない
- preference/annotationを追加してもhard availabilityが拡大しない
- retry/reloadで同一operationがduplicate semantic/save effectを作らない

Issue #246 implementation後は次もproperty候補とする。

- irrelevant context itemを追加しても、独立なadvice identity/lifecycleが変化しない
- same advice adoption operationのretry回数を増やしてもplanning effectは1回に収束する
- advice generation時点のsource revisionが変わればstale判定が単調に安全側へ働き、古いadviceが新しいtruthへ自動昇格しない
- durable scope表現を除去したvariantではmemory promotionが起きない

ただし、会話turnすべてが可換だとは仮定しない。correction、revision、明示的なtemporal/lifecycle orderingは各contractに従う。

## Renderer / advice answer

完成済み日本語全文ではなく、typed action identity、grounded context、no invented fact/decision/authorization、未了承proposalをacceptedと話さないことを検査する。

applicationがdeferしたuncertaintyをrendererが勝手にblocking questionへ戻したり、未解決stateを解決済みと話したりしないことも確認する。

Issue #246のanswer pathでは、さらに次を見る。

- grounded contextに存在しないユーザー事実を発明しない
- model-only knowledgeを最新書誌やユーザー固有事実として断定しない
- deterministic numeric resultを改変しない
- assumptions / uncertaintyが必要なcaseで隠さない
- unaccepted adviceを「決定した方針」として話さない
- stale adviceを「そのまま予定にします」と表現しない

## Real API / human review

model behaviorが関係する経路はturn-by-turnでsemantic output、accepted delta、Fact Graph、repair agenda、application decision、renderer、scheduler/previewを必要に応じて読む。

Issue #246では、consultation route、context selection、structured advice、assumptions/evidence、AdviceProposal lifecycle、adoption reference、promotion delta、memory scopeもturn-by-turnで確認する。

代表conversation:

```text
「数学の点数を上げたいけど、どの参考書をいつまでに仕上げればいい？」
「英語が苦手なんだけど何から始めればいい？」
「この参考書難しいけど変えた方がいい？」
「金フレ終わったら次何やる？」
「なんでそれがおすすめ？」
「じゃあそれで予定組んで」
「教材はそれで、期限は11月末にして」
「2つ目の案で」
「やっぱさっきの案なし」
「今後もそのやり方にしたい」
「このままで間に合う？ 無理なら少し増やして」
```

明確な意味誤認、context leak、誤binding、未共有heuristic、未了承proposal適用、memory scope leak、off-topic injected responseがあればそのturnで停止する。

Issue #246では追加で次をstop conditionとする。

- consultationを通常slot-fillingへ誤routing
- userが採用していないadviceからpreview生成
- modelがBookshelf / schedule / goalのauthoritative contextを捏造
- ambiguous / stale adviceのsilent promotion
- advice生成だけでdurable memoryへ書き込み

## Browser / E2E gate for Issue #246

runtime実装後は少なくとも次を確認する。

- consultation → answerではpreviewが出ない
- consultation → acceptでnormal planning previewへ接続する
- consultation → modify → accept
- consultation → reject
- multi-optionがある場合、選んだoptionだけがpromotionされる
- reload / resumeで同一advice identityが維持される
- stale adviceが安全に再確認される
- provider failure時にaccepted stateが維持される
- desktop / mobile双方でconversationとpromotion操作が成立する

## Failure ownership

- semantic meaning / consultation route error → semantic schema/context/prompt
- representation-only error → deterministic conversion/schema
- validation error → validator
- identity/lifecycle error → binding/Fact GraphまたはAdviceProposal application owner
- proposal/question/repair priority error → deterministic application policy
- advice grounding/context selection error → consultation application/context boundary
- answer reasoning/wording-only error → answer purpose / renderer context
- stale/adoption/promotion error → consultation lifecycle / promotion boundary
- availability/placement/distribution error → scheduler
- scope/persistence error → promotion/storage boundary
- harness/env error → harness/environment

症状を隠すためraw user text regex、特定日本語専用prompt rule、弱いassertionを追加しない。

## Gate

実行頻度と最終証拠の正本は [AGENTS.md の Verification cadence](../../../../AGENTS.md#verification-cadence)。以下は作業区切り・最終確認の検証順序であり、各編集や各commitで全件を繰り返す指示ではない。実装途中は変更したcontractのfocused regressionと必要な型検査を使い、統合ownerが最終内容のfull verificationを担当する。

週間計画では、承認・保存・復元、shared Fact Graph/schema、provenance/認証、trace永続化、共有clock/mock/fixtureやruntime/runner設定の変更を局所テストだけで完了扱いにしない。既存のtrace persistence gate、実API/人手評価が必要な意味判断の境界、browser検査を維持する。

```text
targeted regression
→ relevant property/metamorphic checks
→ npm run verify (fresh app/Worker typechecks + full tests + build)
→ Browser Regression / E2E when relevant
→ Real API + human review when model behavior is relevant
→ exact diff / current HEAD review
```

Issue #246では実装前に [Learning Consultation and Advice Contract](../spec/learning-consultation-and-advice.md) のpre-implementation gateを先に満たす。

Security/adversarial evaluationではdirect/stored injection、provenance、durable poisoning、Unicode/delimiter、nonsense/no-op、numerical abuse、authorization boundaryをattack surfaceとして扱う。consultation導入後はretrieved material/context injection、advice-to-action escalation、stale proposal replayもattack surfaceへ含める。
