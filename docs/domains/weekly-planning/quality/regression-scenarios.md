# Weekly Planning Regression Scenarios

Status: canonical scenario catalog
Updated: 2026-10-08

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

### SCHED-009: clock representation preserves accepted constraints

task/component/plan-wideの希望を同じtyped日付・時刻としてcompileし、片側だけのclock、named period、日付境界をまたぐhard availabilityを消失させない。soft availableはhard空き時間を増やさず順位だけに作用する。未解決の希望はquestionとなり、期間・request-time・busy interval・deadlineの境界は保つ。作業量がまだ無い場合も既知のnamed periodを解決不能とせず、unknown/custom date・time・levelは引き続き質問する。non-recurringなplan-wide weekday soft preferenceがaccepted期間外になる場合はdate-scopeを一度確認し、回答後に配置できる。期間内なら質問せず、反復や基準日を暗黙変更しない。

Evidence owners:
- `src/features/weeklyPlanning/weeklyPlanningTemporalPreferenceRepresentations.integration.test.ts`
- `src/features/weeklyPlanning/weeklyPlanningTemporalRepairRealE2E.integration.test.ts`
- `src/features/weeklyPlanning/trace/weeklyPlanningTemporalRepairTracePersistence.integration.test.ts`

### SCHED-010: estimate and allocated time have one typed explanation

量×ペースの見積もりと確保時間を区別し、policyの余裕/切り上げをtyped内訳とUIへ渡す。session分割後の合計でも二重加算しない。intrinsic durationには見積もり余裕を付けず、内訳が無い過去データから理由を発明しない。

Evidence owners:
- `src/features/weeklyPlanning/semantic/weeklyPlanningAllocationBreakdown.test.ts`
- `src/features/weeklyPlanning/semantic/weeklyPlanningAllocationPreview.integration.test.ts`
- `src/components/WeeklyPlanningAllocationSummary.test.tsx`
- `src/features/weeklyPlanning/weeklyPlanningAllocationPersistence.integration.test.ts`

### SCHED-011: split siblings prefer distinct eligible days without weakening safety

同一task/component/workloadのsessionは希望scope内の未使用日を優先し、安全な別日が無い場合だけ同日へ戻る。土日scopeなら土曜/日曜へ分けられ、無制約の7日scopeでは6+1 reserve方針を維持する。hard bounds・busy interval・daily capacityを破らず、別workloadへのscope leakや架空のfree timeを作らない。interactionのsemantic instructionは分割を総量の置換にせず、session_duration/countへ分離し、両方/全部の希望を各対象へ表す。prompt budgetの限定増分とlegacy非変更も検査する。

Evidence owners:
- `src/features/weeklyPlanning/weeklyPlanningSplitSessionDistinctDays.integration.test.ts`
- `src/features/weeklyPlanning/semantic/weeklyPlanningSplitSessionDistinctDaysV5.test.ts`
- `src/features/weeklyPlanning/trace/weeklyPlanningSplitSessionDistinctDaysTracePersistence.integration.test.ts`
- `src/features/weeklyPlanning/semantic/weeklyPlanningSemanticPromptBudget.test.ts`

### SCHED-012: content-unit caps preserve true cost and whole units

正の整数amountを持つcountable content units（整数customを含む）の明示session lengthを日別分配/余裕より先に扱い、必要な整数単位session数と正しい範囲を保つ。各sliceは自分の補正後コスト以上、可能な場合は上限以下とし、全量/基準見積もり/実余裕を一致させる。1単位が上限を超える場合は分数化せず`not_satisfied`とsession source refを保つ。40p×3/cap60、20p×3/cap60、31p×3/cap31、3p×10/cap22、5問×29/cap60を検査し、word/lesson/chapter/section/exam_year/customへも適用し、mock_exam atomic・分数custom・session/hour/minuteの専用経路・chunk上限fallbackを検査する。分割できなくても適用するsession factを保ち、実block長の超過をnot_evaluatedで隠さない。

Evidence owners:
- `src/features/weeklyPlanning/semantic/weeklyPlanningContentSessionCapV5.test.ts`
- `src/features/weeklyPlanning/weeklyPlanningSplitSessionDistinctDays.integration.test.ts`
- `src/features/weeklyPlanning/trace/weeklyPlanningConditionPropagationTracePersistence.integration.test.ts`

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

pending questionの意味・理由を尋ねるturnはFact Graph/stateを変えず、同じquestionを明示的に再提示し（bindingも新しいmessageへ）、次の短い回答はそのquestionへbindする。無駄なcompleteness retryを起こさない。rendererには`explain_question`のgoalとquestion purpose code（必要なら後で必要になるlaterNeeds）が渡り、まず理由に答えてから同じ質問を一度だけ聞く。work-breakdown質問の下でも、planning contentを持たない説明はtarget taskの再記述を求められずに成功する（2026-10-07の実測失敗の回帰）。新しい詳細と説明要求が同じmessageにあるmixed turnでは、詳細は通常どおり取り込まれてcurrent-turn groundingとして先にACKされ、その詳細で別の質問が先になる場合でも、説明対象の質問がまだ開いていて（未回答・未defer）freshなら提示し続けて説明する。stale/未提示の質問への説明要求は通常turnとして扱い、その質問を説明済みにはしない。同じturnで取り消した内容は`removedThisTurn`として渡り、先に受け止められる。質問を出すべき返答（askQuestion）に質問が無ければ採用せず（1回repair後fallback）、質問を提示済みとしてbindしない。短い回答の専用経路は、相談・質問の理由・話題転換を含む発話を一般解釈へ回し、actを落とさない。

Current example owners:
- `src/features/weeklyPlanning/weeklyPlanningConversationInteraction.integration.test.ts`
- `src/features/weeklyPlanning/weeklyPlanningConversationNaturalness.integration.test.ts`
- `src/features/weeklyPlanning/application/weeklyPlanningInteractionDecision.test.ts`

### DIALOGUE-008: aside never re-arms the old question; resume re-presents first

topic shift/asideは保留中のquestionを保持するが再提示・再bindしない。後続の短い返答は古いquestionへbindせず、resumeは対象のquestionを再提示してから短い返答がbindされる。resumeの対象は既存のactive task/componentだけで、repair policyがdeferしたissueを前倒ししない。

Current example owners:
- `src/features/weeklyPlanning/weeklyPlanningConversationInteraction.integration.test.ts`
- `src/features/weeklyPlanning/application/weeklyPlanningInteractionDecision.test.ts`
- `tests/e2e/weekly-conversation-interaction.spec.mjs`

### DIALOGUE-009: a failed turn retains state and re-presents only the same fresh typed question

semantic/provider failureはaccepted graph・preview・machine stateを変えない。provider failureで質問を再提示するときは、その質問だけを一つの依頼として聞く（再送依頼と並べない）。turn中で直近のprovider dispatchが失敗した後はrendererを呼ばず（outage gate）、rendererの1回repairが失敗してもturnは失敗せずfallbackで終わる。直前のquestionがfreshでapplicationが型付きtextを持つ場合だけ同じquestionを再提示して再bindし、そうでなければ何も提示・bindしない（fail closed）。raw validator/provider payloadをuserへ出さない。semantic failureはtyped `clarify_turn`としてrendererが書き、provider failureはrendererを呼ばず短いemergency文言で再送を頼む。どちらもアプリ内部の処理を説明しない。

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

interaction architectureの通常turn（質問・説明・寄り道・再開・status・preview・semantic failureのrecovery）はrendererがtyped communication contextから書く。deterministic codeは何を伝えるか（goal・purpose code・status reason・disclosure）だけを持ち、説明の文章templateを持たない。renderer出力がユーザー発話・計画データに無い内部の仕組みの語彙を含む、またはapplication所有のpreview disclosureを落とすと拒否され（1回repair後fallback）、会話部分は内部語彙の無い短いemergency文言へ戻る。application所有の未配置作業・未達/未検証条件の説明は通常/緊急応答に添えられる固定文であり、emergencyだけが固定日本語という契約ではない。emergency文言はrouting/applicationの文を入力に取らない（statusはtyped reasonから言う）。仮予定候補に入りきらなかった作業はapplicationが返答の横に自分の一文で伝え、返答側が全体を外された作業名を出すと拒否する（「含めた」と偽れない）。内部語彙の例外はユーザーの発話と計画の表示ラベルだけで、データのkey・enum値は例外にならず、snake_caseのコードは常に内部語彙。週間計画の本番fileにある日本語literalはsource scanで分類済みでなければならず、表示されうる固定文はrenderer出力の検査と同じ内部語彙listでも検査する。

Current example owners:
- `src/features/weeklyPlanning/weeklyPlanningAssistantProse.contract.test.ts`
- `src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5DialogueInteractionValidation.test.ts`
- `src/features/weeklyPlanning/dialogue/weeklyPlanningInteractionFallbackText.test.ts`
- `src/features/weeklyPlanning/weeklyPlanningInteractionRendererFallback.test.ts`
- `tests/e2e/weekly-conversation-interaction.spec.mjs`

### DIALOGUE-015: bounded consultation uses accepted-plan evidence without adoption

planning changeの無い相談は、previewが無ければasideとしてquestionを再bindしない。mixed turnは有効なplanning deltaを保持する。rendererは受理済み計画の実scheduler結果・missing detail・daily upper limitから条件付きの助言をするが、未採用の土日案等を検証済みとしない。保持した旧previewはfreshなfeasibilityの根拠にならず、相談だけでapproval/saveや新しいauthorizationを与えない。strict feasibilityClaim metadataのnone/fits/does_not_fitをtyped evidenceへ照合し、不一致は専用理由で一度repairする。

Evidence owners:
- `src/features/weeklyPlanning/application/weeklyPlanningConsultationCommunication.test.ts`
- `src/features/weeklyPlanning/weeklyPlanningConversationInteraction.integration.test.ts`
- `src/features/weeklyPlanning/trace/weeklyPlanningConversationInteractionTracePersistence.integration.test.ts`

### DIALOGUE-016: independent details do not resolve a required question

interactionでは必須教材の質問中に努力量を答えても、その量は受理しつつ教材の不確実性を未解決として保持し、previewへ進めない。解決は同じtargetの同じdimensionの新しい情報に限定する。未知のfree-form fieldにもtask shell・rate・session・clock budget・過去のreplay・sibling情報を解決根拠にしない。正式な構造/教材回答やknown work-breakdownのtime budgetはその契約で進める。

Evidence owners:
- `src/features/weeklyPlanning/weeklyPlanningRequiredClarification.integration.test.ts`
- `src/features/weeklyPlanning/semantic/weeklyPlanningSemanticUncertaintyResolutionV5.test.ts`
- `src/features/weeklyPlanning/trace/weeklyPlanningRequiredClarificationTracePersistence.integration.test.ts`

### DIALOGUE-017: acknowledgement is limited to accepted facts

interactionのrenderer instructionはtyped acceptedFactsだけを受け止める。ユーザーが書いても未受理の時刻・日・量は質問できるが、受領済みの条件として繰り返さない。prompt/typed contextとlegacyとの差分を検査し、実modelがinstructionに従う精度はreal-API/人手gateで評価する。previewCountは一つのpreview内のcandidate block数であり、別々のpreview/代案の数として話さない。allocation内訳がある場合は、見積もり・余裕の説明を会話で重ねない（0分も同じ）。

Evidence owners:
- `src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5DialoguePrompt.test.ts`
- `src/features/weeklyPlanning/weeklyPlanningConversationArchitectureSwitch.integration.test.ts`

### DIALOGUE-018: coverage audit is bounded and does not infer omitted meaning

interactionでは、leaf citationの未引用runが8 code points以上で少なくとも一つのleafが引用済み、かつ破棄するtyped projectionでtarget/remaining workの努力量不足が見込まれる場合だけ、既存AI completeness auditを使う。character class・keyword・tokenizationで不足内容を決めない。完全な応答・時間予算・empty coverageはこの追加経路へ進まず、auditの不正出力/接続失敗/予算不足は元の有効documentを保持する。

Evidence owners:
- `src/features/weeklyPlanning/weeklyPlanningSemanticEvidenceCoverage.integration.test.ts`
- `src/features/weeklyPlanning/semantic/weeklyPlanningSemanticEvidenceCoverageV5.test.ts`
- `src/features/weeklyPlanning/trace/weeklyPlanningSemanticEvidenceCoverageTracePersistence.integration.test.ts`

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

### PREVIEW-007: corrections and added scheduling facts invalidate the old basis

教材名を省略した数量訂正と期限を同時に受理し、既存速度を保って同じ作業へ結び付ける。interactionでは既存速度の正確な再掲を新しいevidenceにしない。日付の追加確認中も数量訂正に先立つ旧案を消し、続く具体日付を訂正後の同じ作業へ結び付ける。既存作業の配置根拠となる追加条件でも失効し、新しい作業だけの追加では部分previewを保持できる。renderer失敗・reload・double-submit・chat切替でgraphとpreviewのauthorityを分離させない。不正な訂正はgraphを保ち、その未受理の量を現在の候補として説明しない。

Evidence owners:
- `src/features/weeklyPlanning/weeklyPlanningCorrectionRealE2E.integration.test.ts`
- `src/features/weeklyPlanning/weeklyPlanningPreviewAuthorityAdversarial.integration.test.ts`
- `src/features/weeklyPlanning/evals/weeklyPlanningPreviewCorrectionLifecycle.integration.test.ts`

### PREVIEW-008: reply claims follow actual preview evidence

希望時間帯や1回の長さを受理したことと、表示候補がそれを満たすことを区別する。soft availableを含む各taskに適用される希望時間帯のunionで実候補を評価する。未達/未検証条件はapplicationが通常/緊急応答の横へ表示し、rendererの時間帯達成claimは文単位のexact task label scopeで検査する。未達taskがあっても満たした別taskの文や値を繰り返さないneutral accepted-fact ACKは許可し、未検証claimは専用理由で一度repairしてからfallbackする。新しいpreviewが無いときの配置claimを拒否し、変更なしclaimはpreview_unchangedに限定する。task固有の希望・量・session訂正は別作業へ漏れない。

Evidence owners:
- `src/features/weeklyPlanning/weeklyPlanningMultiTaskLaterConstraints.integration.test.ts`
- `src/features/weeklyPlanning/weeklyPlanningClaimRepair.integration.test.ts`
- `src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5DialogueInteractionValidation.test.ts`
- `src/features/weeklyPlanning/trace/weeklyPlanningConditionPropagationTracePersistence.integration.test.ts`

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

## 8. Real UI A–G campaign regression

実UIで発見したscenarioを、provider transportだけを差し替えた本番controller/runtimeとdesktop/390px browserで再現する。自然な日本語の一文一致ではなく、accepted state、実際の候補枠、未承認、architecture pin、dispatch計測を検査する。scripted providerの成功を実modelの意味解釈精度やGemini/人手品質の証拠にはしない。

| Scenario | Contract to assert |
| --- | --- |
| A 完全入力と希望時刻 | 来週のhorizonと20時以降のtyped希望を保持し、時刻表/busy枠を避ける。解決不能な希望は質問する |
| B 質問理由と努力量の回答 | 説明でgraphを変えず、努力量の回答は対象へbindする。未解決の必須教材質問を解消済みとして扱わない（DIALOGUE-016） |
| C 数量訂正と期限 | 30→20、既存速度、具体日付を同じ作業へ伝播し、旧候補・誤った変更なしclaimを残さない |
| D 複数作業と後続条件 | 作業を保ち、plan-wide/task-onlyの希望とsession変更をそのscopeへ適用する。容量不足時の旧案は失効する |
| E 相談と再開 | 受理済み計画のread-only助言、未採用の代案、questionのaside/resumeを分離する |
| F 曖昧依頼と時間予算 | 量のない作業の明示total timeをschedulable time budgetとして扱い、架空の総量やscope質問loopを作らない |
| G 期限と除外時間 | deadlineとunavailableを同時に守り、repairで別の事実や除外時間を捨てない |

Evidence owners:
- `src/features/weeklyPlanning/weeklyPlanningRealE2ECampaign.integration.test.ts`
- `src/features/weeklyPlanning/testUtils/weeklyPlanningRealE2ECampaignFixture.ts`
- `src/features/weeklyPlanning/weeklyPlanningTimeBudgetBreakdownLoop.integration.test.ts`（Fの夜/60分session/教材未確定を含むmulti-turn回帰）
- `tests/e2e/weekly-real-scenarios.spec.mjs`（専用configでdesktop/mobileを実行）

基礎的なA–G replayに加え、各修正のadversarial scenarioは上の専用suiteで検査する。現時点の統合/実測状態は[work record](../work/20261007-issue488-conversation-interaction.md#real-e2e-blocker-campaign-2026-10-0708)を参照する。

## Archive relationship

Historical sources remain under `docs/archive/weekly-planning/` and `docs/archive/work/` as evidence. They are not current test instructions.

If a historical scenario is still valuable, extract its invariant here and point current automated tests at the current Stable V5 owner. Do not move the whole old test plan back into current documentation.
