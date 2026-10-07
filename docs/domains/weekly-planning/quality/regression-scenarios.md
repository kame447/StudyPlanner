# Weekly Planning Regression Scenarios

Status: canonical scenario catalog
Updated: 2026-08-27

Parent: [test-philosophy.md](test-philosophy.md)
Contract: [../architecture/current-contract-v5.md](../architecture/current-contract-v5.md)
Scheduling: [../policies/scheduling.md](../policies/scheduling.md)

## Purpose

この文書は、historical V4 roleplay/task/auditに埋もれていたversion非依存の回帰条件をcurrent contractへ移管する。

古い型名、parser名、branch名、固定日本語は再利用しない。各scenarioはcurrent Stable V5のmachine state / typed contract / observable product behaviorとして検証する。

## 1. Scheduling safety

### SCHED-001: seventh-day reserve

7日horizonでは、hard constraintがreserve利用を要求しない通常ケースで、最初の6日をnormal placementとして優先し、7日目をreserveとして保持する。

Evidence owner:
- `src/features/weeklyPlanning/semantic/weeklyPlanningStableV5DistributionPolicy.test.ts`

### SCHED-002: balanced normal-day load

normal daysの一日へ不必要に集中させず、current distribution policyのtarget load / soft-cap behaviorに従う。

soft cap定数の変更自体は許可するが、意図せず「一番空いている日に全量を詰める」回帰を起こさない。

### SCHED-003: not-before

request-timeより前へ新しいfuture plan blockを置かない。

calendarの選択日を過去へ動かしても、このhard lower boundを回避しない。

### SCHED-004: authoritative busy source

existing StudyPlanner plans / timetable / accepted hard unavailable intervalと重複しない。

required source load failureをempty sourceとして扱わない。

### SCHED-005: life constraint integrity

accepted sleep/life/buffer constraintは、そのtyped scopeでavailabilityを実際に狭める。

sleep endを自動的にstudy-available startとみなさない。

### SCHED-006: atomic work integrity

`atomic` work itemをscheduler都合で分割しない。splittableとtypedに確定したworkのみmechanical chunkingを許可する。

### SCHED-007: hard temporal bounds may extend the fallback horizon

明示的なplanning windowがなくても、単純なper-occurrence recurrenceに適用されるactive hard `deadline` / `latest_end`等がdefault 7日より先にある場合、そのhard endまで計画可能期間を切り捨てない。

future hard `earliest_start`がある場合も、開始日だけを見て利用可能なdefault spanを消失させない。soft、removed、superseded、無関係targetのconstraintを理由にhorizonを拡張しない。

Representative evidence owner:
- `src/features/weeklyPlanning/application/weeklyPlanningTemporalContext.test.ts`

### SCHED-008: temporal bounds are target-scoped and compiled once

accepted active temporal factsはscheduler-facing compilationでabsolute hard date bounds / preferred placementsへ解決し、ordinary movable workとrecurring workのeligible datesへ適用する。

同一taskに属するcomponentはtask-level boundを継承できるが、component固有boundはsibling componentへ漏らさない。removed/superseded constraintやsoft preferenceをhard boundとして復活させない。downstream placementは同じdeadline / earliest-start / latest-end / preferred-window意味をraw Fact Graphから独立再解釈しない。

Representative evidence owners:
- `src/features/weeklyPlanning/application/weeklyPlanningTemporalContext.test.ts`
- `src/features/weeklyPlanning/semantic/weeklyPlanningStableV5WorkItemPlacement.ts`
- temporal-constraint compilation tests introduced with PR #204

## 2. Quantity / progress

### PROG-001: target and progress are distinct

`scope_total=20`, `completed=12`から`remaining=8`を導出できても、「今回8全部をやる」とは自動決定しない。明示`target=4`なら、今回のscheduler workはtarget semanticsに従う。

### PROG-002: bounded progress convergence

同じactive factsなら、`scope_total → completed`と`completed → scope_total`の入力順に関係なく同じremainingへ収束する。

### PROG-003: correction invalidates derivation

progress basisを訂正した場合、以前のtotal/completedから導出されたstale remainingをactiveなtruthとして残さない。

### PROG-004: open-ended work has no fabricated total

総量が存在しない/分からないworkへ、割合計算や分配の都合だけで架空のscope totalを作らない。

### PROG-005: zero completed history does not block planning

完了済みworkが0件、または過去実績が存在しないことだけを理由に週間計画を拒否しない。

必要なscope / target / effort / availabilityが揃っていれば、未着手からでもplanning/scheduler pathへ進める。

Historical evidence came from the old zero-progress draft regression, but current validation should target Stable V5 work compilation/readiness rather than the old intake adapter shape.

## 3. Dialogue / grounding

### DIALOGUE-001: known information is not re-requested

existing plans / accepted facts等のauthoritative known contextがある場合、同じ情報を最初から入力させず、必要な追加・差分だけを尋ねる。

### DIALOGUE-002: repair blocking issue first

hard ambiguity、required effort、authorization等のblocking issueは、その先のdecisionに必要な時点でrepairする。

### DIALOGUE-003: pass over low-impact uncertainty

low-impact uncertaintyが残っていてもsafeに進められる場合はdeferできる。deferred issueはmachine stateから消さず、影響を持つ境界より前にreopenする。

Current example owner:
- `src/features/weeklyPlanning/application/weeklyPlanningStableV5RepairAgendaIntegration.test.ts`

### DIALOGUE-004: proposal is not acceptance

application/assistantがproposalを提示しただけではaccepted stateへ入れない。userのaccept/modify/rejectをsemantic layerで解釈し、applicationがlifecycleを確定する。

### DIALOGUE-005: ambiguous reference fails safe

referentが一意でない状態で、特定task/sourceへ勝手にhard bindしない。raw-text keyword guardで参照解決を代替しない。

### DIALOGUE-006: current-week acceptance does not become durable memory

`今回は夜で`等のweek/session local acceptanceを、`今後も夜が好き`というdurable preferenceへ暗黙昇格させない。

### DIALOGUE-007: explanation is non-mutating and re-presents the same question

pending questionの意味・理由を尋ねるturnはFact Graph/stateを変えず、同じquestionを明示的に再提示し（bindingも新しいmessageへ）、次の短い回答はそのquestionへbindする。無駄なcompleteness retryを起こさない。rendererには`explain_question`のgoalとquestion purpose code（必要なら後で必要になるlaterNeeds）が渡り、まず理由に答えてから同じ質問を一度だけ聞く。work-breakdown質問の下でも、planning contentを持たない説明はtarget taskの再記述を求められずに成功する（2026-10-07の実測失敗の回帰）。

Current example owners:
- `src/features/weeklyPlanning/weeklyPlanningConversationInteraction.integration.test.ts`
- `src/features/weeklyPlanning/weeklyPlanningConversationNaturalness.integration.test.ts`

### DIALOGUE-008: aside never re-arms the old question; resume re-presents first

topic shift/asideは保留中のquestionを保持するが再提示・再bindしない。後続の短い返答は古いquestionへbindせず、resumeは対象のquestionを再提示してから短い返答がbindされる。resumeの対象は既存のactive task/componentだけで、repair policyがdeferしたissueを前倒ししない。

Current example owners:
- `src/features/weeklyPlanning/weeklyPlanningConversationInteraction.integration.test.ts`
- `src/features/weeklyPlanning/application/weeklyPlanningInteractionDecision.test.ts`
- `tests/e2e/weekly-conversation-interaction.spec.mjs`

### DIALOGUE-009: a failed turn retains state and re-presents only the same fresh typed question

semantic/provider failureはaccepted graph・preview・machine stateを変えない。直前のquestionがfreshでapplicationが型付きtextを持つ場合だけ同じquestionを再提示して再bindし、そうでなければ何も提示・bindしない（fail closed）。raw validator/provider payloadをuserへ出さない。semantic failureはtyped `clarify_turn`としてrendererが書き、provider failureはrendererを呼ばず短いemergency文言で再送を頼む。どちらもアプリ内部の処理を説明しない。

Current example owners:
- `src/features/weeklyPlanning/weeklyPlanningConversationInteraction.integration.test.ts`
- `src/features/weeklyPlanning/application/weeklyPlanningConversationRecovery.test.ts`

### DIALOGUE-010: short answers and proposal decisions bind only to the one fresh presented target

短い回答とproposalへのaccept/rejectは、freshなpresentationを持つ唯一のquestion/proposalにだけbindする。stale/unbound/malformed/conflictはfocused shortcutを使わず安全側へ戻り、未提示のpending proposalは決定されない。

Current example owners:
- `src/features/weeklyPlanning/application/weeklyPlanningStableV5SemanticContext.test.ts`
- `src/features/weeklyPlanning/application/weeklyPlanningStableV5LearningStrategyProposal.test.ts`
- `src/features/weeklyPlanning/weeklyPlanningConversationInteraction.integration.test.ts`

### DIALOGUE-011: the architecture switch changes the architecture, not a label

同一fixtureで`legacy_v5`は(a)provider schema/promptに`conversationActs`を持たず、(b)pending question下の説明でhistorical completeness retryを行い、(c)semantic失敗で固定の汎用質問文を出し、(d)aside後も質問がrebindされ短い返答がbindされ、`interaction_v1`は(a)〜(d)がtyped act/outcome/recoveryで置き換わる。mode（pin）はreload・chat A→B→A・旧checkpoint（legacy）で保たれ、preference/build defaultの変更は新規会話にだけ効き、評価gateが無効な本番UIにはselectorも評価stripも出ない。どちらのmodeでもFact Graph validation/provenance・revision/idempotency・scheduler/preview・保存承認・owner/chat隔離は同一。

Current example owners:
- `src/features/weeklyPlanning/weeklyPlanningConversationArchitectureOracle.test.ts`
- `src/features/weeklyPlanning/weeklyPlanningConversationArchitectureSwitch.integration.test.ts`
- `src/features/weeklyPlanning/weeklyPlanningConversationArchitecture.test.ts`
- `tests/e2e/weekly-architecture-switch.spec.mjs`

### DIALOGUE-012: turn measurement is shared and observation-only

各turnについてarchitecture・request/turn id・admission→commit/failureのms・provider dispatch数（semantic/renderer、poolをenforceしないlegacyも数える）・outcome/result kind・failure code・pending questionの提示/再提示が両modeで同じ手段で記録され、dispatch数はscripted harnessの実provider呼び出し数と一致する。記録はmemory内のみで、planning truth・外部telemetry・user textを含まず、挙動へ戻らない。

Current example owners:
- `src/features/weeklyPlanning/application/weeklyPlanningTurnMeasurement.test.ts`
- `src/features/weeklyPlanning/weeklyPlanningConversationArchitectureSwitch.integration.test.ts`

### DIALOGUE-013: a valid conversation act survives an unusable planning delta, never the reverse

同じresponseのplanning deltaとconversation actは独立に検証する。act側の問題（未知kind・余分なkey・未知topic）はplanning errorにならず、そのactだけdrop（fail closed）またはtopic無しへ劣化する。planning deltaが1回のrepair後も使えない場合、有効なself-sufficient act（説明・寄り道・再開・相談）だけでturnを空deltaのnon-mutating turnとして続け、却下されたplanning内容は一切適用しない（含まれていた場合はrendererへ取り込めなかった旨のflagを渡す）。`answer_pending_question`だけでは続けない。actはauthorization・preview・approval・saveを与えない。2回目のsemantic model呼び出しはしない。legacyではactは未知keyのまま。

Current example owners:
- `src/features/weeklyPlanning/semantic/weeklyPlanningSemanticConversationOnlyTurnV5.test.ts`
- `src/features/weeklyPlanning/semantic/weeklyPlanningConversationActsV5.test.ts`
- `src/features/weeklyPlanning/weeklyPlanningConversationNaturalness.integration.test.ts`

### DIALOGUE-014: ordinary replies are renderer-written and never describe the app's internals

interaction architectureの通常turn（質問・説明・寄り道・再開・status・preview・semantic failureのrecovery）はrendererがtyped communication contextから書く。deterministic codeは何を伝えるか（goal・purpose code・status reason・disclosure）だけを持ち、説明の文章templateを持たない。renderer出力がユーザー発話・計画データに無い内部の仕組みの語彙を含む、またはapplication所有のpreview disclosureを落とすと拒否され（1回repair後fallback）、表示されるのは内部語彙の無い短いemergency文言だけ。週間計画の本番fileにある日本語literalはsource scanで分類済みでなければならない。

Current example owners:
- `src/features/weeklyPlanning/weeklyPlanningAssistantProse.contract.test.ts`
- `src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5DialogueInteractionValidation.test.ts`
- `src/features/weeklyPlanning/dialogue/weeklyPlanningInteractionFallbackText.test.ts`
- `src/features/weeklyPlanning/weeklyPlanningInteractionRendererFallback.test.ts`
- `tests/e2e/weekly-conversation-interaction.spec.mjs`

## 4. Preview / approval

### PREVIEW-001: no premature preview

blocking readinessが未解決、必要authorizationがない、またはpreviewを安全に生成できないstateではpreviewを生成しない。

### PREVIEW-002: stale preview rejection

preview生成後にaccepted semantic state / source revisionが変わった場合、古いpreviewをそのままsaveしない。

### PREVIEW-003: pending proposal is not saved truth

未了承proposal、previewに影響する未解決assumption、必要なdeferred repairを保存済みPlanへsilent applyしない。

### PREVIEW-004: approval idempotency

同じpreview/itemへのretry、response loss、multi-client approvalでduplicate Planを作らず、同じoperation/item identityへ収束する。

### PREVIEW-005: individual pre-approval removal

ユーザーは承認前の仮予定を1件ずつ除外できる。除外操作は正しいcandidate/block identityだけへ作用し、別の仮予定や保存済み予定を消さない。

この能力はhistorical MVPで基本操作として実装済みだった。current application facadeにも`removePreviewCandidate` / `removeDraftBlock`が存在するが、2026-08-23監査時点のdedicated `AiPlanningView`週プレビューには個別削除UIが確認できない。

したがってこれはcurrent UI regression candidateとしてIssue #52の専用画面分離完了条件で検証する。

### PREVIEW-006: bulk discard / approval remain coherent

個別除外を実装・移行しても、一括破棄/再調整と明示承認のboundaryを壊さない。preview candidateとpromoted draftのどちらを操作しているかをUI/applicationで一貫させる。

## 5. Lifecycle / state integrity

### STATE-001: rejected semantic turn preserves accepted state

provider/normalization/canonicalization failureが、以前のaccepted Graphを部分的に壊さない。

### STATE-002: no-op does not create semantic mutation

意味上の変更がないturnで、不必要なFact/revision/derived mutationを作らない。

### STATE-003: proposal/correction lifecycle is explicit

correction、supersession、proposal resolutionを単なる上書きやrenderer textから推測せず、explicit machine lifecycleとして扱う。

### STATE-004: derivation does not mutate source input

projection/derivationは入力stateを暗黙破壊せず、同じaccepted basisから再計算可能である。

## 6. Invariance properties

### INV-001: order independence where domain facts commute

入力順だけで最終accepted truthが変わるべきでないdomainでは、同じfactsの順序違いが同じ結果へ収束する。

すべての会話turnが可換という意味ではない。訂正、明示的な時間順依存、lifecycle operationはそのcontractに従う。

### INV-002: irrelevant-fact independence

対象decisionと独立なfactを追加しただけで、既存hard constraintやquantity truthが変化しない。

### INV-003: annotation does not create availability

preference/annotation/profile scoreは、hard available spaceを新設・拡大しない。

## 7. Scenario requiring explicit current-contract verification

### AUDIT-001: mixed turn partial acceptance

Historical contracts contained an important expectation:

```text
one utterance
├─ independently valid new fact
└─ another ambiguous/clarification-requiring contribution
```

Ideally, an unrelated valid contribution should not be forgotten merely because another part needs clarification. However, current Stable V5 canonical commit is atomic at the document/commit boundary, and this audit has not yet proven a universal candidate-level partial-acceptance guarantee for every mixed turn.

Therefore this item is not declared as a blanket current invariant yet.

Required audit:

1. verify current focused side-contribution/contextual-answer tests and production path;
2. define which mixed contributions may be accepted atomically together and which must fail the whole turn;
3. if current behavior drops independently valid contributions unnecessarily, track a current Issue/work item;
4. do not implement partial acceptance with raw Japanese regex/keyword routing.

This section remains visible so the principle is not lost merely because its historical implementation task was superseded.

## Archive relationship

Historical sources remain under `docs/archive/weekly-planning/` and `docs/archive/work/` as evidence. They are not current test instructions.

If a historical scenario is still valuable, extract its invariant here and point current automated tests at the current Stable V5 owner. Do not move the whole old test plan back into current documentation.
