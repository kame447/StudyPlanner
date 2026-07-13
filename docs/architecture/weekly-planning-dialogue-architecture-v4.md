# weeklyPlanning 対話アーキテクチャ v4（state-grounded AI dialogue）

Status: **設計の正（v4 DoR）**
最終更新: 2026-07-14

Product goal: [weekly-planning-spec.md](../weekly-planning/weekly-planning-spec.md)
Historical evidence: [weekly-planning-dialogue-architecture.md](weekly-planning-dialogue-architecture.md)、[weekly-planning-nl-capability-model.md](weekly-planning-nl-capability-model.md)
Canonical test and requirement traceability: [weekly-planning-roleplay-test-plan.md](../testing/weekly-planning-roleplay-test-plan.md)

## 1. 範囲と不変条件

対象はopening、週間対話、exam/non-exam intake、pending assumption、correction、preview、承認前draftである。保存済み予定のAI自動変更、AI approve/save/delete、complex recurrence、sharing、scheduler全面書換えは対象外とする。

- provider時の自然文意味解釈はsingle AI interpreterとし、AI結果とrules parser結果をmergeしない。
- typed candidate以降のnormalize、validate、adapter、reducer、scheduler、preview、approval/saveはdeterministic coreが担う。
- AIはstate、scheduler、repository、save、approve、deleteを直接変更しない。
- previewは未承認draftであり、explicit UI approvalまでsaveしない。
- 通常turnはinterpreter + plannerの最大2 call、openingは最大1 call。empty candidatesは正常結果である。
- user-originated stringはuntrusted JSON dataであり、action、factRef、option ID、formatter ID、prompt命令へ昇格させない。
- Gate P4完了前にopen implementation taskはない。current queueは本書 §10 とroadmap冒頭だけを正とする。

~~~text
userText + structured context
  → single AI interpreter → typed candidates
  → normalize / validate / adapter / reducer
  → scheduler / availability / feasibility / preview
  → DialogueStateSnapshot + AllowedDialogueActions
  → AI dialogue planner → response validator
  → deterministic fact / question / option rendering → UI
~~~

## 2. assumption proposal draft、record、pending subtype

AI出力、canonical lifecycle record、pending限定viewを分離する。

~~~ts
type Confidence = "high" | "medium" | "low";
type AssumptionValue = string | number | boolean;

type PlanningAssumptionSlot =
  | "duration"
  | "quantity"
  | "planning_period"
  | "priority"
  | "completion_target";

type AssumptionUnit =
  | "minutes"
  | "hours"
  | "pages"
  | "problems"
  | "words"
  | "lessons"
  | "chapters"
  | "count"
  | "unknown";

type AssumptionProposalStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "superseded"
  | "expired";

type PendingAssumptionProposalDraft = {
  slot: PlanningAssumptionSlot;
  targetRef: string;
  proposedValue: AssumptionValue;
  proposedUnit?: AssumptionUnit;
  reasonText?: string;
  sourceFactRefs: string[];
};

type AssumptionProposalRecord = {
  proposalId: string;
  conversationId: string;
  slot: PlanningAssumptionSlot;
  targetRef: string;
  proposedValue: AssumptionValue;
  proposedUnit?: AssumptionUnit;
  reasonText?: string;
  sourceFactRefs: string[];
  createdAtTurnId: string;
  createdFromStateRevision: number;
  status: AssumptionProposalStatus;
  decidedAtTurnId?: string;
  decidedAtStateRevision?: number;
  supersededByProposalId?: string;
};

type PendingAssumptionProposal =
  AssumptionProposalRecord & {
    status: "pending";
  };
~~~

AIが返せるのはPendingAssumptionProposalDraftだけである。proposalId、conversationId、turnId、revision、statusはdeterministic coreが発行し、private/unknown/stale sourceや別user/conversationのsourceはcanonical化しない。

DA0aの責務はdraft validation、canonical status=pending record生成、session-local state保持、後続DA0へproposalRefを渡せる状態までである。DA0aはwork item、candidate generation、preview block、scheduler、表示、save、approvalを扱わない。

lifecycle transitionはDA1bが所有する。

~~~text
pending → accepted | rejected | superseded | expired
~~~

status変更時も元recordを履歴から失わない。modifyは旧recordをsupersededにし、supersededByProposalIdで新しいpending recordへ結ぶ。rejected/expired/superseded recordを暗黙にpendingへ戻さない。

## 3. DA0 bridge、snapshot、feasibility

DA0で初めてpending proposalをwork itemとpreviewへ接続する。

~~~ts
type GenericWeeklyWorkItem = {
  taskRef: string;
  title: string;
  subject?: string;
  quantity?: {
    amount: number;
    unit: AssumptionUnit;
  };
  durationMinutes?: number;
  assumptionProposalRef?: string;
  priority?: number;
  sourceFactRefs: string[];
  eligibility:
    | "eligible"
    | "eligible_with_pending_assumption"
    | "missing_information"
    | "unsupported"
    | "rejected";
};
~~~

validator規則:

- eligibility=eligible_with_pending_assumptionではassumptionProposalRef必須。
- proposalRefは同じuser/conversationのstatus=pending recordを指す。
- proposal targetRefとwork item taskRefが一致し、source revisionが現在も有効である。
- accepted/rejected/superseded/expired proposalをpending assumptionとして使用しない。
- eligibility=eligibleではassumptionProposalRefを要求しない。
- eligibility=rejectedのitemをpreview candidateへ渡さない。
- invalid item一件で他の明確なitemを失わない。

pending assumptionを使うpreviewはその事実を表示し、hard applyしない。DA0はkeyboard、approval、migration、scheduler全面改修を扱わない。

~~~ts
type AskedTopicRecord = {
  topicId: string;
  askedAtTurnId: string;
  askedAtStateRevision: number;
  status: "asked" | "answered" | "superseded" | "expired";
};

type ActiveQuestion = {
  questionId: string;
  topicId: string;
  askedAtTurnId: string;
  askedAtStateRevision: number;
  allowedAnswerKinds: string[];
};

type FeasibilityClassification =
  | "feasible"
  | "partially_feasible"
  | "infeasible"
  | "unknown";

type FeasibilitySummary = {
  classification: FeasibilityClassification;
  requiredMinutes: number;
  availableMinutes: number;
  scheduledMinutes: number;
  unscheduledMinutes: number;
  unscheduledTaskRefs: string[];
  bottleneckFactRefs: string[];
  conflictFactRefs: string[];
  deterministicOptionIds: string[];
  previewEligibility:
    | "eligible"
    | "eligible_with_pending_assumption"
    | "blocked"
    | "unsupported";
};
~~~

DialogueStateSnapshotはconversationId、stateRevision、acceptedFacts、rejectedCommands、AssumptionProposalRecord履歴、pendingAssumptionProposals、correctionHistory、planningRange、existingEvents、feasibility、preview、allowedQuestionTopics、askedTopicHistory、activeQuestion、lastResolvedQuestionId、recentHistoryを持つ。

allowedQuestionTopicsは今聞いてよいtopic、askedTopicHistoryは質問履歴、activeQuestionは回答待ち質問である。answered済みtopicを理由なく再質問せず、revision変更だけでは再質問しない。activeQuestionへの短答をinterpreter groundingに使う。

## 4. action、response grounding、formatter

### 4.1 AI responseの唯一の情報源

AI出力で使用fact、question topic、optionを表す正はresponsePartsだけである。factRefsやquestionTopicsを別フィールドで二重申告させない。

~~~ts
type DialogueActionKind =
  | "acknowledge"
  | "summarize_and_ask"
  | "confirm_reference"
  | "propose_assumption"
  | "explain_feasibility"
  | "offer_preview"
  | "answer_clarification"
  | "explain_capability_gap"
  | "fallback";

type PublicFactField =
  | "title"
  | "subject"
  | "date"
  | "weekday"
  | "startTime"
  | "endTime"
  | "durationMinutes"
  | "requiredMinutes"
  | "availableMinutes"
  | "scheduledMinutes"
  | "unscheduledMinutes"
  | "planningRange"
  | "previewBlockCount";

type PublicFactFormatterId =
  | "plain"
  | "date_ja"
  | "weekday_ja"
  | "time_hm"
  | "duration_minutes"
  | "duration_hours_minutes"
  | "planning_range_ja"
  | "count_ja";

type DialogueTextPurpose =
  | "acknowledgement"
  | "transition"
  | "empathy"
  | "instruction"
  | "closing";

type DialogueTextPart = {
  kind: "text";
  purpose: DialogueTextPurpose;
  text: string;
};

type DialogueResponsePart =
  | DialogueTextPart
  | {
      kind: "fact";
      factRef: string;
      field: PublicFactField;
      formatterId?: PublicFactFormatterId;
    }
  | {
      kind: "question";
      topicId: string;
      optionIds?: string[];
    }
  | {
      kind: "option";
      optionId: string;
    };

type DialogueResponsePlan = {
  action: DialogueActionKind;
  responseParts: DialogueResponsePart[];
  assumptionProposalDraft?: PendingAssumptionProposalDraft;
  previewOffer?: {
    previewId: string;
    stateRevision: number;
  };
};

type ValidatedDialogueResponsePart = Readonly<DialogueResponsePart>;

type ValidatedDialogueResponsePlan = {
  action: DialogueActionKind;
  responseParts: ValidatedDialogueResponsePart[];
  usedFactRefs: string[];
  usedQuestionTopicIds: string[];
  usedOptionIds: string[];
  assumptionProposalDraft?: PendingAssumptionProposalDraft;
  previewOffer?: {
    previewId: string;
    stateRevision: number;
  };
};

type AllowedDialogueAction = {
  action: DialogueActionKind;
  allowedQuestionTopicIds: string[];
  allowedOptionIds: string[];
  allowedFactFields: PublicFactField[];
  previewOfferAllowed: boolean;
  assumptionProposalAllowed: boolean;
};

type AllowedDialogueActions = {
  stateRevision: number;
  actions: AllowedDialogueAction[];
};

type DialoguePlannerResultEnvelope = {
  conversationId: string;
  turnId: string;
  requestId: string;
  inputStateRevision: number;
  outputStateRevision: number;
  responsePlan: DialogueResponsePlan;
};
~~~

validatorはresponsePartsを順に検証してusedFactRefs、usedQuestionTopicIds、usedOptionIdsを導出し、順序を保って重複除去する。question part内のoptionIdsと独立option partの両方をusedOptionIdsへ含める。allow-list照合が全件成功した場合だけValidatedDialogueResponsePlanを生成する。一件でもinvalidならresponse全体をrejectし、partial responseを描画しない。

### 4.2 formatter registry

formatter registryとfield互換表のownerはDA1である。任意string formatterを認めない。

| field | allowed formatter |
| --- | --- |
| title、subject | plain |
| date | date_ja |
| weekday | weekday_ja |
| startTime、endTime | time_hm |
| durationMinutes、requiredMinutes、availableMinutes、scheduledMinutes、unscheduledMinutes | duration_minutes、duration_hours_minutes |
| planningRange | planning_range_ja |
| previewBlockCount | count_ja |

formatter省略時もregistryがfieldごとのdefaultを決める。date + date_ja、startTime + time_hmはvalid。title + duration_minutes、requiredMinutes + planning_range_jaはresponse全体rejectである。

### 4.3 free text validator

text partは事実値の運搬路にしない。DA1はMAX_DIALOGUE_TEXT_PART_CODE_POINTSを実装前に固定し、初期安全契約では120 code points以下とする。変更はDA3c評価を根拠に別taskで行う。

- ASCII/全角数字、数量として使われる漢数字を含むtextは原則rejectする。
- 時刻形式、日付形式、期間、件数、required/available/scheduled/unscheduledの数値説明をrejectする。
- snapshotに存在するtask title、event title、material名の完全一致をrejectする。
- 事実を示す文はfact partへ分解する。
- HTML、script、実行可能なmarkdown commandとして扱わず、escaped plain textで描画する。
- textからstate、fact、actionを再抽出しない。
- 「一つ確認します」のような数表現が必要ならdeterministic phraseまたはquestion partから描画する。AI free textでは許可しない。

通常経路の数値・日時・タイトル・期間はfact partだけからdeterministicに描画する。制限緩和はDA3cの会話品質評価後に別taskで判断する。

### 4.4 action validator

| action | 必須 | 禁止 |
| --- | --- | --- |
| acknowledge | allowed responseParts | save/approve |
| summarize_and_ask | allowed question part | answered topicの理由なし再質問 |
| confirm_reference | public fact part | 空sourceの利用中断定 |
| propose_assumption | draft/sourceFactRefs | canonical ID/status、hard apply |
| explain_feasibility | deterministic facts/options | AI再計算、任意option |
| offer_preview | previewId、revision一致、stale=false | save/approve、blocker中のeligible |
| answer_clarification | target topic/fact | accepted commandの破棄 |
| explain_capability_gap | capability fact | unsupported preview |
| fallback | deterministic partsのみ | proposal、preview、private diagnostic、extra call |

## 5. assumption decisionとcorrection

### 5.1 AssumptionDecisionCommand

~~~ts
type AssumptionDecisionCommand =
  | {
      type: "accept_assumption";
      proposalId: string;
      expectedStateRevision: number;
      confidence: Confidence;
      sourceText: string;
    }
  | {
      type: "reject_assumption";
      proposalId: string;
      expectedStateRevision: number;
      confidence: Confidence;
      sourceText: string;
    }
  | {
      type: "modify_assumption";
      proposalId: string;
      replacementValue: AssumptionValue;
      replacementUnit?: AssumptionUnit;
      expectedStateRevision: number;
      confidence: Confidence;
      sourceText: string;
    };
~~~

accept/rejectにreplacementValueを付けず、modifyではreplacementValue必須とする。unknown ID、non-pendingへの重複decision、revision mismatch、別user/conversation/targetはそのdecisionだけrejectする。一件の失敗で同turnの別の明確なcommandを破棄しない。

### 5.2 CorrectionTargetとtyped replacement

現行コードではvalidator後commandもParsedWeeklyPlanningCommandとして返る。correction replacementはその既存unionからstate mutationでないbegin/request_clarificationを除外し、accepted bucketを通ったものだけを使う。

~~~ts
type CorrectionTarget =
  | {
      kind: "fact";
      factId: string;
    }
  | {
      kind: "proposal";
      proposalId: string;
    }
  | {
      kind: "command";
      commandId: string;
    }
  | {
      kind: "task";
      taskRef: string;
    }
  | {
      kind: "event";
      eventRef: string;
    }
  | {
      kind: "slot";
      slot: PlanningAssumptionSlot;
    };

type ValidatedCorrectionReplacement = Exclude<
  ParsedWeeklyPlanningCommand,
  {
    type: "begin_weekly_planning" | "request_clarification";
  }
>;

type CorrectionOperation = "replace" | "remove" | "supersede" | "restore";

type CorrectionEnvelopeBase = {
  correctionId: string;
  target: CorrectionTarget;
  sourceText: string;
  confidence: Confidence;
  expectedStateRevision: number;
};

type CorrectionEnvelope =
  | (
      CorrectionEnvelopeBase & {
        operation: "replace";
        replacementCommand: ValidatedCorrectionReplacement;
      }
    )
  | (
      CorrectionEnvelopeBase & {
        operation: "remove" | "supersede" | "restore";
        replacementCommand?: never;
      }
    );
~~~

targetは型上ちょうど一種類であり、空targetと複数targetを禁止する。replacement candidateは既存validateInterpretedCandidates相当を通し、acceptedだけをatomic apply候補にする。acceptedWithConfirmationは確認完了まで適用しない。

一つのCorrectionEnvelope内部はatomicである。同turnの複数Envelopeは独立評価し、accepted correctionとrejected correctionが共存できる。unknown/private/stale/別user target、revision/source mismatchはそのEnvelopeだけreject/clarificationとし、元factを破壊しない。restoreは復元可能なsuperseded targetだけ、remove/supersede/restoreはreplacement禁止。accepted decision/correctionはstateRevisionを進め、previewをstaleにし、必要なscheduler/feasibilityを再計算する。

## 6. relative range、request、stale、fallback

### 6.1 relative planning range

selected dateとtimezoneをdeterministic contextとして相対日付を解決する。一意解決できる「来週」はaccepted planning rangeにし、planning periodを再質問しない。2026-07-12選択時の「来週」は2026-07-13〜2026-07-19である。「その辺の週」のように一意でない表現だけclarificationへ倒す。

明示range correctionはold rangeをsupersededにし、新rangeをacceptedにする。他のgoal、priority、proposal recordを失わず、previewをstale化してfeasibilityを再計算する。

### 6.2 request envelope

~~~ts
type DialogueTurnEnvelope = {
  conversationId: string;
  turnId: string;
  requestId: string;
  inputStateRevision: number;
  userText: string;
  createdAt: string;
};
~~~

一conversation一active requestとする。

### 6.3 StaleAsyncResult

~~~ts
type StaleAsyncResultReason =
  | "request_id_mismatch"
  | "turn_id_mismatch"
  | "conversation_id_mismatch"
  | "state_revision_mismatch"
  | "cancelled"
  | "mode_reset"
  | "unmounted";

type StaleAsyncResult = {
  kind: "stale_async_result";
  reason: StaleAsyncResultReason;
  conversationId: string;
  turnId: string;
  requestId: string;
  inputStateRevision: number;
};

type StalePreviewApprovalAttempt = {
  kind: "stale_preview_approval_attempt";
  previewId: string;
  previewStateRevision: number;
  currentStateRevision: number;
  previewStale: true;
};
~~~

StaleAsyncResultは無言でdiscardし、state、history、status、previewへ反映せず、その結果由来のfallbackも表示しない。

StalePreviewApprovalAttemptはユーザー操作へのdeterministic rejectionである。saveとapproval operation開始を拒否し、「現在条件と一致せず、そのまま保存できないため、最新条件で再計算または最新案の確認が必要」という意味を表示する。AI callは行わない。両者を同じstale処理にしない。

### 6.4 fallback

- Interpreter failure: provider unavailable/exception/timeout/parse/schema。state適用前でturn-wide rules fallback。追加AI callなし。empty candidatesはfailureでない。
- Dialogue planner failure: invalid action/ref/field/topic/option/formatter/preview、planner exception/timeout。accepted stateを保持し、rules semantic parserを再実行せずdeterministic renderer fallback。追加AI callなし。
- StaleAsyncResult/cancelled: silent discard。ユーザー向けfailure/fallbackを返さない。
- StalePreviewApprovalAttempt: deterministic user-facing rejection。fallbackではない。

会話/request/proposalはsession-local、既存draft block localStorageは維持し、reloadで自動再実行しない。

## 7. approval ledgerとidempotency

~~~ts
type WeeklyDraftApprovalItemStatus =
  | "pending"
  | "saving"
  | "saved"
  | "failed"
  | "skipped_duplicate";

type WeeklyDraftApprovalItem = {
  sourceDraftBlockId: string;
  status: WeeklyDraftApprovalItemStatus;
  savedPlanId?: string;
  attemptCount: number;
  lastErrorCode?: string;
  updatedAt: string;
};

type WeeklyDraftApprovalOperation = {
  approvalOperationId: string;
  userId: string;
  previewId: string;
  previewStateRevision: number;
  startedAt: string;
  completedAt?: string;
  status: "pending" | "partially_saved" | "completed" | "failed";
  items: WeeklyDraftApprovalItem[];
};

type ApprovedPlanSource = {
  sourceType: "weekly_draft";
  sourceDraftBlockId: string;
  approvalOperationId: string;
};
~~~

idempotency keyはuserId + sourceDraftBlockIdである。approvalOperationIdは監査/batch metadataでありkeyに含めない。別operation IDでも同じuser/source blockから二件目を保存しない。itemごとにpartial failure/retry/crashを扱い、operation statusはitemsから導出可能にする。AIはoperationを作成・開始しない。

StalePreviewApprovalAttemptはledger作成前に拒否する。

## 8. DA2 interaction ownership

DA2はopening once、double submit、button + keyboard重複、active request、reset、history clear、unmount、stale/cancel、IME、keyboard binding、multiline、focus restore、Tab orderのownerである。

IME中に送信しない、multiline入力、button/keyboardの同一turn重複抑止、focus restore、Tab順はstrict contractとする。Enter、Shift+Enter、Ctrl/Meta+Enterの最終割当はDA2実装時に決定し、決定前のroleplayで特定bindingをstrictにしない。

## 9. testとtraceability

strict contractはaction、responseParts、derived used refs/topics/options、field/formatter compatibility、state/revision/request/turn、proposal lifecycle、decision/correction union、preview/stale、fallback、approval ledger、duplicateを検証する。自然文はgolden text完全一致ではなく、敬体、簡潔、no re-ask、仮定/事実の区別、内部slot非表示、次入力の明確さをrubric評価する。

P1〜P7 caseとRequirement ID単位の正は[roleplay test plan](../testing/weekly-planning-roleplay-test-plan.md)である。各taskのRequirement IDs、Dependencies、Entry/Exit、roleplay参照は同表と同期する。

## 10. current queue

Gate P4完了前にopen implementation taskはない。

| 順 | item | status | dependency |
| --- | --- | --- | --- |
| 0 | Gate P4 | active verification gate | src差分の所有者確認 |
| 1 | DA0a assumption proposal foundation | blocked — Gate P4 verification後 | Gate P4 |
| 2 | DA0 non-exam preview bridge | blocked — Gate P4とDA0aの後 | Gate P4、DA0a |
| 3 | DA1 dialogue action/response contract | queued | DA0 |
| 4 | DA1b assumption decision and correction contract | queued | DA1 |
| 5 | Draft approval idempotency | queued | DA1b |
| 6 | DA2 state-grounded dialogue orchestrator | queued | approval |
| 7 | DA3a relative constraint domain | queued | DA2 |
| 8 | DA3b feasibility consultation | queued | DA3a |
| 9 | DA3c conversation evaluation | queued | DA3b |

旧D1〜D7、P4〜P9、T6、v3 stageはhistorical/supersededでありcurrent queueへ戻さない。
