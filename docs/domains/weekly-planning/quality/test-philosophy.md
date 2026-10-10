# 週間計画 AI テスト方針

Status: canonical
Updated: 2026-10-08

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


## Generated-test oracle and guarantee-transfer contract

property-based testingは固定回帰・実接続・実モデル評価の全面的な代替ではない。少数の有限条件は全列挙し、値・構造の広がりは生成し、非同期の順序は小さい独立モデルと制御した完了順で検査する。「網羅」は列挙した集合、状態、深さ、制御した境界の範囲に限って表明する。

安全性だけでなく、現行契約が保証する正の前進性を検査する。配置可能性を構成上保証した入力では必要な予定が作られ、受理されるべき操作では期待状態が変化する。空出力、全拒否、常時pending、全データ削除で通るpropertyを十分な保証としない。任意の部分配置での時間保存と、単純な実行可能族での配置成立は分ける。heuristic schedulerへ一般的な最適性を新規に要求しない。

oracleはproductionの戻り値から受理可否を逆算したり、production validatorで通った入力だけを正例にしたりしない。独立した小さい仕様表・参照モデル・入力構成から期待結果を定める。round-trip一致だけでは両側が同じ誤変換をする故障を見逃すため、元入力の意味の保存も直接検査する。expected stateや副作用の期待値を共有helperへ隠してproductionと同時に書き換えない。

preview/承認/保存/restoreはoperation identityとrevisionを保った列で検査する。durable commitとack受信、表示更新と永続化、同一operationのretryと新しいユーザー操作を区別する。owner切替、取消、stale preview、応答消失、途中失敗、ledger喪失を含む。一方、client-runtimeのread authorityやbackendの複数client保証を週間計画の別モデルで再定義しない。

既知の反例と有限の重要分岐を必須examplesまたは明示列挙で残し、固定seedの短い検査と記録可能な探索runを併用する。空配列、preconditionによる大量skip、実行されない分岐で試行数だけを満たさない。成功/拒否、境界値、same/different identity、commit前後など必要な探索クラスが実際に通った証拠を残す。

反例の再現にはseed/pathだけでなく、必要なcommandsのreplayPath、操作列、制御した非同期境界、Git内容、installed dependency identity、実行環境を記録する。未記録の最新版ライブラリに置き換えて同じseedだけを再実行しても同一証拠とは扱わない。秘密情報や実ユーザーの会話をartifactへ無条件に残さない。

テストの統合・削除前に、旧契約、実production入口、検証境界、移管先、残す代表例、代表故障を対応付ける。元実装で成功し、空出力/no-op/owner fence欠落/二重保存など対象の故障で失敗することを確認する。新検査のgreenだけでは保証移管は完了しない。件数や行数の削減自体を完了条件にしない。

raw Japaneseの言い換えを意味等価だと自動認定しない。typed documentの安全性と実Jev/Lunaの意味評価を分け、既存のgold/holdout/予算境界を維持する。ブラウザの入力・focus・touch・module load、Worker/Firestore、trace/outbox/size/privacyなど、その境界を実際に通る検査も残す。

実行頻度と最終full verificationは[AGENTS.md](../../../../AGENTS.md#verification-cadence)を正とし、時間だけの省略規則や全リポジトリmutationの常時実行を追加しない。導入済みのfast-checkとlocked Vitest/Stryker構成を先に活用し、実測した費用と故障検出能力で予算を決める。

この方針の観測根拠は[2026-10-08監査](../../../archive/audits/20261008-property-based-test-audit.md)、現在の移行作業は[Issue #382](https://github.com/kame447/StudyPlanner/issues/382)を参照する。文書の追加は生成的検査の移行完了やproduction保証の拡大を意味しない。
