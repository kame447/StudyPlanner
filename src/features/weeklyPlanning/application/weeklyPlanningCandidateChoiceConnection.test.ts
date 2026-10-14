import { validateWeeklyPlanningFactGraphValueV5 } from '../semantic/weeklyPlanningFactGraphValidatorV5';
import { boundC5PresentedQuestion, captureC5Question } from './c5LocalSelection/basis';
import { bindWeeklyPlanningQuestionPresentation } from '../intake/weeklyPlanningQuestionPresentation';
import { weeklyPlanningTurnOutcomeLifecycle } from './weeklyPlanningTurnOutcomeLifecycle';
import { PlannerDataReadAuthority, type PlannerDataAvailability } from '../../../domain/plannerDataReadAuthority';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { createWeeklyPlanningCandidateChoiceOptions } from './weeklyPlanningCandidateChoiceConnection';
import { WEEKLY_PLANNING_C5_CHOICE_CALIBRATION, validateWeeklyPlanningCandidateChoiceConfiguration } from './weeklyPlanningCandidateChoiceCalibration';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../trace/weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from '../trace/weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from '../trace/weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from '../trace/weeklyPlanningTraceTypes';
import { takeWeeklyPlanningStableV5DebugTrace, resetWeeklyPlanningStableV5DebugTraceForTest } from '../trace/weeklyPlanningStableV5DebugTrace';
import type { SemanticCensusEvent } from '../../../../shared/semanticTurnCensus';
import type { WeeklyPlanningCandidateChoiceServices } from './weeklyPlanningCandidateChoiceConnection';
import * as aiConfig from '../../../lib/aiConfig';
import * as firebaseClient from '../../../lib/firebaseClient';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { recoverC5ControlledTurn, readC5RuntimeGraph } from './c5LocalSelection/controlledCommit';
import { c5ControllerHarness, OWNER, WEEK, resolution } from './c5LocalSelection/controller.testUtils';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { submitWeeklyPlanningApplicationTurn, type WeeklyPlanningTurnApplicationServices } from './weeklyPlanningTurnApplication';
import { weeklyPlanningTurnRuntimeGateway } from './weeklyPlanningTurnRuntimeGateway';
import { weeklyPlanningTurnStagingLifecycle } from './weeklyPlanningTurnSideEffects';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest, hydrateWeeklyPlanningStableV5RuntimeSession } from './weeklyPlanningStableV5RuntimeSession';
import { loadWeeklyPlanningStableV5PersistedSession, getWeeklyPlanningStableV5SessionStorageKeyForTest } from './weeklyPlanningStableV5SessionStorage';
import { createReadyPlannerDataAvailability } from '../testUtils/plannerDataAvailabilityTest';
import { submitWeeklyPlanningControlledTurn } from '../weeklyPlanningTurnController';

vi.hoisted(() => {
  for (const name of ['VITE_CLOUDFLARE_AI_PROXY_URL', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID']) vi.stubEnv(name, '');
});
let restore: () => void;
let memory: ReturnType<typeof createMemoryStorageHarness>;
let schemas: string[];
beforeEach(() => {
  vi.useFakeTimers({toFake:['Date']}); vi.setSystemTime('2026-10-06T08:00:00.000Z');
  memory=createMemoryStorageHarness(); restore = installWeeklyPlanningTestStorage(memory.storage);
  resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5DebugTraceForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest(); schemas = [];
  vi.stubEnv('VITE_AI_PROVIDER', 'openai'); vi.stubEnv('VITE_AI_BASE_URL', 'https://luna.fixture.test/v1');
  vi.stubEnv('VITE_AI_MODEL', 'fixture'); vi.stubEnv('VITE_AI_API_KEY', 'fixture');
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(String(init?.body)); const schema = body.response_format?.json_schema?.name ?? '';
    schemas.push(schema);
    const text = body.messages.at(-1)?.content ?? '';
    let content: unknown;
    if (schema.includes('weekly_planning_semantic')) content = {
      schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'discuss', planningWindow: null,
      tasks: [{ localId: 'answer', existingPublicId: 'task-a', category: 'study', title: '教材a', study: { purpose: 'self_study', contextLabel: null, components: [] },
        workloads: [{ localId: 'quantity', quantityRole: 'target', amount: 1, unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '1問' }],
        effortEstimates: [{ localId: 'effort', targetLocalId: 'quantity', kind: 'duration_per_unit', minutes: 7, unitCode: 'problem', precision: 'exact', sourceText: '1問7分' }],
        temporalConstraints: [], recurrence: [], sourceText: '教材aは1問7分' }],
      relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [],
    };
    else if (schema === 'weekly_planning_stable_v5_dialogue_response') {
      const prompt = JSON.parse(text); const decision = prompt.applicationDecision;
      content = { actionId: prompt.actionId, actionKind: decision.actionKind, questionCode: decision.questionCode,
        groundingAcknowledgement: null, text: `内容を確認してください。${(decision.requiredLabels ?? []).join(' ')}${decision.previewPromotionControlLabel ?? ''}` };
    } else throw new Error(`Unexpected semantic dispatch ${schema}`);
    return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  }));
});
afterEach(() => { setWeeklyPlanningTraceRepositoryForTests(undefined); resetWeeklyPlanningStableV5TraceRuntimeForTest(); restore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

async function run(mode: 'accepted' | 'none' | 'low' | 'failure' | 'off' | 'unconfigured' | 'worker_off', extras: Partial<WeeklyPlanningCandidateChoiceServices> = {}, presented = true, prepare?: (h: ReturnType<typeof c5ControllerHarness>) => void, shape: 'question' | 'preview' = 'question', availabilityOverride?: PlannerDataAvailability, liveProjection: (()=>boolean) | null = ()=>true, outcomeLifecycleOverride?: WeeklyPlanningTurnApplicationServices['outcomeLifecycle']) {
  const fetchStart=(fetch as ReturnType<typeof vi.fn>).mock.calls.length;
  const h = c5ControllerHarness();
  h.graph.planningWindows.push({ id: 'fixture-window', kind: 'absolute', value: '2026-10-05/2026-10-11', start: WEEK, end: '2026-10-11',
    source: { conversationId: h.conversationId, turnId: 'seed', semanticLocalId: 'window', sourceText: 'fixture window', origin: 'user' }, createdRevision: 1 });
  h.graph.factLifecycles.push({ factId: 'fixture-window', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null });
  if(shape==='preview') {
    h.graph.tasks=h.graph.tasks.filter(task=>task.id==='task-a');
    h.graph.workloads=h.graph.workloads.filter(work=>work.taskId==='task-a');
    h.graph.effortEstimates=h.graph.effortEstimates.filter(estimate=>estimate.taskId==='task-a');
    const ids=new Set([...h.graph.tasks,...h.graph.workloads,...h.graph.effortEstimates,...h.graph.planningWindows].map(fact=>fact.id));
    h.graph.factLifecycles=h.graph.factLifecycles.filter(fact=>ids.has(fact.factId));
  }
  // Rehydrate this fixture input before presentation; all expected effects below are independent assertions.
  hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER, weekStartDate: WEEK, conversationId: h.conversationId, graph: h.graph });
  if (presented) await h.present();
  if(shape==='preview') h.replaceState({...h.getState(),intakeState:{...(h.getState().intakeState??createInitialPlanningIntakeState()),draftGenerationIntent:'user_authorized'}});
  prepare?.(h);
  const choice = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (mode === 'worker_off') return Response.json({status:'unavailable',reason:'purpose_off'});
    if (mode === 'failure') throw new TypeError('injected Choice failure');
    const request = JSON.parse(String(init?.body)).decisionContext.request;
    const selected = request.menu.options.find((entry: any) => entry.kind === 'leaf' && entry.candidate.id === 'estimate-7').id;
    const optionId = mode === 'none' ? 'none' : selected;
    return Response.json({ status: 'evaluated', catalogVersion: 'complete-candidate-choice-2026-10-13-v2', nodeId: request.menu.nodeId, requestId: request.requestId, selectionEpoch: request.selectionEpoch,
      candidateSetHash: request.candidateSetHash, optionId,
      probabilities: request.menu.options.map((entry: any) => ({ optionId: entry.id,
        probability: mode === 'low' ? entry.id === selected ? 0.6 : 0.2 : entry.id === optionId ? 0.96 : 0.02 })),
      conditionChange: 0, independentMeaning: 0 });
  });
  const services = {
    submitControlledTurn: submitWeeklyPlanningControlledTurn, runtimeGateway: weeklyPlanningTurnRuntimeGateway,
    stagingLifecycle: weeklyPlanningTurnStagingLifecycle, outcomeLifecycle: outcomeLifecycleOverride ?? { committed() {}, discarded() {}, failed() {} },
    candidateChoice: {
      configuration: mode === 'unconfigured' ? null : {
        domain: 'c5_effort', mode: mode === 'off' ? 'off' : 'canary', choicePolicy: h.options.policy,
        semanticPolicy: { calibrationEvidenceId: 'scripted-not-calibrated', maximumConditionChange: 0.01, maximumIndependentMeaning: 0.01 },
        maximumChildrenPerMenu: 2, maximumDecisions: 1,
      },
      proxyUrl: 'https://choice.fixture.test', getToken: async () => 'scripted-auth', transport: choice, ...extras,
    },
  } as WeeklyPlanningTurnApplicationServices;
  const text = '教材aは1問7分です。';
  const result = await submitWeeklyPlanningApplicationTurn({ session: h.session, userId: OWNER, ownerId: OWNER,
    plannerDataAvailability: availabilityOverride ?? createReadyPlannerDataAvailability(OWNER),
    ...(liveProjection?{isPlannerDataSnapshotCurrent:liveProjection}:{}),userText: text, selectedDate: WEEK,
    plans: [], scheduleTemplates: [], getState: h.getState, dispatch: h.dispatch }, services);
  console.info("J2 entry observation", {mode, schemas});
  return { h, choice, result, text, services, requests: (fetch as ReturnType<typeof vi.fn>).mock.calls.slice(fetchStart).map(call => JSON.parse(String(call[1]?.body))) };
}

it('actual application entry accepts Choice with zero semantic Luna and real question continuation plus durable consumption', async () => {
  const { h, choice, result } = await run('accepted');
  expect(result.accepted).toBe(true); expect(choice).toHaveBeenCalledTimes(1);
  expect(schemas.filter(name => name.includes('weekly_planning_semantic'))).toEqual([]);
  const saved = loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK })!;
  expect(resolution(saved.graph, 'work-a')).toMatchObject({ ambiguous: false, estimatedMinutes: 70 });
  expect(saved.planningState.intakeState!.c5SelectionLedger!.consumed).toHaveLength(1);
  expect(h.getState().intakeState!.lastQuestionContext?.targetSlot).not.toBe('stable_v5:ambiguous_effort_estimate');
});

it.each(['none', 'low', 'failure'] as const)('actual application entry preserves whole text and calls semantic Luna exactly once after %s', async mode => {
  const { choice, result, text } = await run(mode);
  expect(result.accepted).toBe(true); expect(choice).toHaveBeenCalledTimes(1);
  expect(schemas.filter(name => name.includes('weekly_planning_semantic'))).toHaveLength(1);
  const request = (fetch as ReturnType<typeof vi.fn>).mock.calls.map(call => JSON.parse(String(call[1]?.body)))
    .find(body => body.response_format?.json_schema?.name?.includes('weekly_planning_semantic'));
  expect(JSON.stringify(request)).toContain(text);
});

it.each(['off', 'unconfigured'] as const)('actual application entry has no Choice transport and retains the baseline on %s', async mode => {
  const { choice, result } = await run(mode);
  expect(result.accepted).toBe(true); expect(choice).not.toHaveBeenCalled();
  expect(schemas.filter(name => name.includes('weekly_planning_semantic'))).toHaveLength(1);
});


it('joins accepted Choice and none fallback in one invocation-local census without leaking candidates or application identity', async () => {
  for (const mode of ['accepted', 'none'] as const) {
    vi.spyOn(aiConfig, 'getCloudflareAiProxyUrl').mockReturnValue('https://luna.fixture.test/v1');
    vi.spyOn(aiConfig, 'usesCloudflareOpenAiProxy').mockReturnValue(true);
    vi.spyOn(firebaseClient, 'getFirebaseAuth').mockReturnValue({currentUser:{getIdToken:async()=> 'scripted-auth'}} as never);
    const events: SemanticCensusEvent[] = [];
    const { choice, requests, result } = await run(mode, { census: {enabled:true,sink:{async write(event) {events.push(event);}}} });
    expect(result.accepted).toBe(true);
    expect(events.map(event => event.kind)).toEqual(['start','closure']);
    const closure=events[1]; if (closure.kind!=='closure') throw new Error('missing closure');
    expect(closure.integrity).toBe('complete'); expect(closure.requestIds).toHaveLength(mode==='accepted'?1:2);
    const choiceJoin=JSON.parse(String(choice.mock.calls[0][1]?.body)).semanticCensus;
    expect(choiceJoin).toMatchObject({turnId:closure.turnId,requestId:closure.requestIds[0],stage:'focused'});
    if(mode==='none') expect(requests.find(body=>body.response_format?.json_schema?.name?.includes('weekly_planning_semantic')).semanticCensus)
      .toMatchObject({turnId:closure.turnId,requestId:closure.requestIds[1],stage:'initial'});
    for(const privateValue of ['教材','private-source-','candidateSetHash','estimate-7',OWNER,'scripted-auth']) expect(JSON.stringify(events)).not.toContain(privateValue);
  }
});

it('probes a configured off Worker once only on an eligible turn, then retains the full ordinary fallback', async () => {
  const eligible=await run('worker_off'); expect(eligible.choice).toHaveBeenCalledTimes(1); expect(eligible.result.accepted).toBe(true);
  const noneligible=await run('worker_off',{},false); expect(noneligible.choice).not.toHaveBeenCalled(); expect(noneligible.result.accepted).toBe(true);
});

it('preserves the same serialized Luna request on client off and no configuration', async () => {
  const off=await run('off'); const absent=await run('unconfigured');
  const semantic=(requests: any[])=>requests.filter(body=>body.response_format?.json_schema?.name?.includes('weekly_planning_semantic'));
  const left=JSON.stringify(semantic(off.requests)); const right=JSON.stringify(semantic(absent.requests));
  expect(left).toBe(right);
});

it('excludes C5 authority and historical sources from events generated by the actual production continuation', async () => {
  const {h}=await run('accepted'); const begins=h.actions.filter(entry=>entry.type==='begin_turn'); const action=begins[begins.length-1]!;
  if(action.type!=='begin_turn')throw new Error('missing turn');
  const events=takeWeeklyPlanningStableV5DebugTrace(action.pending.requestId); const bytes=JSON.stringify(events);
  expect(bytes).toContain('runtime_scheduler_dialogue_evaluated'); expect(bytes).toContain('durableConsumption');
  for(const secret of ['private-source-','payloadSerialization','selectionKey','candidateSetHash','estimate-7','estimate-5','scripted-auth'])expect(bytes).not.toContain(secret);
});


it('persists actual production C5 continuation through append failure/outbox/reload/Worker with exclusion and truncation', async () => {
    const {h}=await run('accepted'); const begins=h.actions.filter(action=>action.type==='begin_turn'); const pending=begins[begins.length-1];
    if(pending.type!=='begin_turn')throw new Error('missing actual turn');
    const requestId=pending.pending.requestId;
    const actualEvents = takeWeeklyPlanningStableV5DebugTrace(requestId);
    expect(JSON.stringify(actualEvents)).toContain('durableConsumption');
    expect(JSON.stringify(actualEvents)).toContain('"candidateCount":2');
    // Snapshot/source provenance/ledger enable mutation or contain private original text. They
    // are deliberately omitted at emission. The bounded route/count/durable outcome is the alternative.
    const emitted = JSON.stringify(actualEvents);
    for (const secret of ['private-source-', 'payloadSerialization', 'selectionKey', 'candidateSetHash', 'estimate-7']) expect(emitted).not.toContain(secret);
    const future = 'future-c5-unknown-sentinel';
    const huge = `HEAD-${'大'.repeat(80_000)}-TAIL`;
    recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'semantic_canonicalization_evaluated', data: {
      branch: 'c5_local_selection', result: { status: 'accepted' },
      adoptedOperations: [{ kind: 'local_candidate_selection', candidateCount: 2, durableConsumption: true,
        futureField: future, futureLargeField: huge }],
    } });
    const events = [...actualEvents, ...takeWeeklyPlanningStableV5DebugTrace(requestId)];
    const writes: { session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }[] = [];
    let fail = true;
    const repository: WeeklyPlanningTraceRepository = {
      async upsertSession() {}, async appendEntries(p) { if (fail) { fail = false; throw new Error('injected append'); } writes.push(structuredClone(p)); },
      async listSessions() { return []; }, async listSessionsForAdmin() { return []; }, async archiveSessionForAdmin() {},
      async getSession() { return null; }, async listEntries() { return []; },
    };
    setWeeklyPlanningTraceRepositoryForTests(repository);
    const input = { userId: OWNER, conversationId: h.conversationId, requestId, userText: '教材aは1問7分です',
      assistantMessage: '選択を反映しました。', responseSource: 'deterministic_fallback' as const,
      outcome: 'question', previewCount: 0, debugTraceEvents: events };
    await recordWeeklyPlanningStableV5TurnTrace(input);
    expect(writes).toHaveLength(0);
    const queued = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: h.conversationId });
    expect(queued).toHaveLength(1); expect(JSON.stringify(queued)).toContain(future);
    for (const secret of ['private-source-', 'payloadSerialization', 'selectionKey', 'candidateSetHash', 'estimate-7']) expect(JSON.stringify(queued)).not.toContain(secret);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ ...input, requestId: `${h.conversationId}:request:3`, debugTraceEvents: [] });
    expect(writes).toHaveLength(2); expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: h.conversationId })).toEqual([]);
    const entry = writes[0].entries[0]; const raw = JSON.stringify(entry);
    expect(raw).toContain('c5_local_selection'); expect(raw).toContain('durableConsumption'); expect(raw).toContain('"candidateCount":2'); expect(raw).toContain(future);
    expect(raw).not.toContain(huge); expect(raw).toMatch(/trace truncated|truncation|traceTruncated/);
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite({ session: writes[0].session as unknown as Record<string, unknown>,
      entries: writes[0].entries as unknown as Record<string, unknown>[] },
      { token: `wpt_${'f'.repeat(43)}`, epoch: '105' },
      { sessionId: 'weekly-trace-623e4567-e89b-52d3-a456-426614174000', logicalConversationId: h.conversationId }, '2026-10-05T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1); expect(JSON.stringify(prepared.entries[0])).toContain(future);
    expect(JSON.stringify(prepared.entries[0])).toContain('durableConsumption');
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
});


it('actual application blocks a new Luna mutation while its durable C5 outcome is unknown and recovers once', async () => {
  let unreadable=false;
  const {h,result,services,choice}=await run('accepted',{},true,()=>{
    vi.spyOn(memory.storage,'setItem').mockImplementation((key,value)=>{memory.values.set(key,value);unreadable=true;throw new Error('injected write-then-throw');});
    vi.spyOn(memory.storage,'getItem').mockImplementation(key=>{if(unreadable)throw new Error('injected unreadable');return memory.values.get(key)??null;});
  });
  expect(result).toMatchObject({accepted:false,recoveryRequired:true});
  const state=JSON.stringify(h.getState()); const graph=JSON.stringify(readC5RuntimeGraph(OWNER,h.conversationId));
  const second=await submitWeeklyPlanningApplicationTurn({session:h.session,userId:OWNER,ownerId:OWNER,
    plannerDataAvailability:createReadyPlannerDataAvailability(OWNER),isPlannerDataSnapshotCurrent:()=>true,userText:'別の意味の入力',selectedDate:WEEK,
    plans:[],scheduleTemplates:[],getState:h.getState,dispatch:h.dispatch},services);
  expect(second).toMatchObject({accepted:false,recoveryRequired:true}); expect(choice).toHaveBeenCalledTimes(1);
  expect(schemas.filter(schema=>schema.includes('weekly_planning_semantic'))).toEqual([]);
  expect(JSON.stringify(h.getState())).toBe(state); expect(JSON.stringify(readC5RuntimeGraph(OWNER,h.conversationId))).toBe(graph);
  unreadable=false; expect(recoverC5ControlledTurn(OWNER,h.conversationId).accepted).toBe(true);
  expect(loadWeeklyPlanningStableV5PersistedSession({ownerId:OWNER,weekStartDate:WEEK})!.planningState.intakeState!.c5SelectionLedger!.consumed).toHaveLength(1);
});

it('actual authenticated client rechecks source access after token await and never exposes stale candidates', async () => {
  let revoke!:()=>void;
  const {choice}=await run('accepted',{getToken:async()=>{revoke(); return 'scripted-auth';}},true,h=>{revoke=()=>{h.session.ownerId='revoked-owner';};});
  expect(choice).not.toHaveBeenCalled();
});


it('never inherits an unapproved domain policy when the shared Choice purpose is enabled', async()=>{
  const {choice,result}=await run('accepted',{configuration:{domain:'d5_numeric',mode:'canary'} as never});
  expect(choice).not.toHaveBeenCalled(); expect(result.accepted).toBe(true);
  expect(schemas.filter(schema=>schema.includes('weekly_planning_semantic'))).toHaveLength(1);
});


it('connects actual C5 application/client/Worker to bounded Jev state and complete leaf criteria without private authority', async()=>{
  // Load the Worker in its runtime test boundary, keeping Worker ambient types out of the app compilation.
  // Its implementation is independently typechecked with generated Worker runtime types by verify.
  const {JEV_MODEL}=await vi.importActual<{JEV_MODEL:{responses:readonly string[]}}>('../../../../workers/ai-proxy/src/decision/decisionPolicy');
  const {default:worker}=await vi.importActual<{default:{fetch(request:Request,env:unknown):Promise<Response>}}>('../../../../workers/ai-proxy/src/worker');
  const ordinary=fetch; const bodies: any[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
    if(String(url).includes('identitytoolkit')) return Response.json({users:[{localId:OWNER,emailVerified:true}]});
    if(String(url).endsWith('/api/alpha/decisions')) {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({model:JEV_MODEL.responses[0],answers:{candidate:{type:'choice',choice:'leaf:1',confidence:0.96,
        probabilities:{'leaf:0':0.02,'leaf:1':0.96,none:0.02}},condition_change:{type:'noul',noul:0},independent_meaning:{type:'noul',noul:0}}});
    }
    return ordinary(url,init);
  }));
  const {result}=await run('accepted',{transport:async(url,init)=>worker.fetch(new Request(String(url),{...init,
    headers:{...Object.fromEntries(new Headers(init?.headers)),Origin:'https://app.test'}}),{
      OPENAI_API_KEY:'fixture-openai',OPENROUTER_API_KEY:'fixture-jev',FIREBASE_WEB_API_KEY:'fixture-project',ALLOWED_ORIGIN:'https://app.test',
      JEV_MODE:'canary',JEV_CANARY_PERCENT:'100',JEV_CANDIDATE_CHOICE_MODE:'canary',JEV_CANDIDATE_CHOICE_CANARY_PERCENT:'100',
      AI_QUOTA:{getByName:()=>({checkAndConsume:async()=>({allowed:true,retryAfterSeconds:1})})},
    } as never)});
  expect(result.accepted).toBe(true); expect(bodies).toHaveLength(1);
  expect(bodies[0].state.context.question.code).toBe('ambiguous_effort_estimate');
  const leaves=Object.entries(bodies[0].questions.candidate.criteria).filter(([id])=>id.startsWith('leaf:')).map(([,value])=>JSON.parse(String(value)));
  expect(leaves.map(leaf=>leaf.tuple.minutes)).toEqual([5,7]); expect(leaves[1].tuple).toMatchObject({measurement:'duration_per_unit',targetFactId:'work-a'});
  for(const privateValue of ['private-source-','payloadSerialization','selectionKey','candidateSetHash',OWNER,'scripted-auth'])expect(JSON.stringify(bodies)).not.toContain(privateValue);
  expect(schemas.filter(schema=>schema.includes('weekly_planning_semantic'))).toEqual([]);
});

it('continues an already authorized C5 turn to a real preview without granting save authority or calling semantic Luna',async()=>{
  const {result,h}=await run('accepted',{},true,undefined,'preview');
  expect(result.accepted).toBe(true); expect(result.draftCandidates.length).toBeGreaterThan(0);
  // Existing allocation policy adds planning margin; the selected factual estimate stays 70.
  expect(resolution(loadWeeklyPlanningStableV5PersistedSession({ownerId:OWNER,weekStartDate:WEEK})!.graph,'work-a').estimatedMinutes).toBe(70);
  expect(result.draftCandidates.reduce((minutes,candidate)=>minutes+candidate.durationMinutes,0)).toBe(90);
  expect(result.draftCandidates.every(candidate=>candidate.approvalStatus==='unapproved')).toBe(true);
  expect(schemas.filter(schema=>schema.includes('weekly_planning_semantic'))).toEqual([]);
  expect(h.getState().intakeState!.draftGenerationIntent).toBe('user_authorized');
  expect(h.getState().intakeState!.shouldSavePlan).toBe(false);
});


it('closes semantic census before waiting for the renderer',async()=>{
  const events: SemanticCensusEvent[]=[]; const ordinary=fetch;
  let enter!:()=>void; let release!:()=>void;
  const entered=new Promise<void>(resolve=>{enter=resolve;}); const barrier=new Promise<void>(resolve=>{release=resolve;});
  vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
    const body=JSON.parse(String(init?.body));
    if(body.response_format?.json_schema?.name==='weekly_planning_stable_v5_dialogue_response'){enter();await barrier;}
    return ordinary(url,init);
  }));
  const pending=run('accepted',{census:{enabled:true,sink:{async write(event){events.push(event);}}}});
  await entered; expect(events.map(event=>event.kind)).toEqual(['start','closure']);
  if(events[0].kind!=='start')throw new Error('missing start');
  expect(events[0].metadata.questionCode).toBe('ambiguous_effort_estimate');
  const closure=structuredClone(events[1]);
  vi.setSystemTime('2026-10-06T08:01:00.000Z'); release(); await pending;
  expect(events[1]).toEqual(closure); expect(events).toHaveLength(2);
});


const calibrationFixture=()=>({domain:'c5_effort',mode:'canary',choicePolicy:{id:'fixture',calibrationEvidenceId:'scripted-only',
  rules:[{menuKind:'leaves',optionCount:3,depth:0,minimumTopProbability:0.9,minimumMargin:0.8}]},
  semanticPolicy:{calibrationEvidenceId:'scripted-only',maximumConditionChange:0.01,maximumIndependentMeaning:0.01},
  maximumChildrenPerMenu:2,maximumDecisions:1});
it('uses a source-managed null calibration and ignores the obsolete dashboard/build environment',()=>{
  expect(WEEKLY_PLANNING_C5_CHOICE_CALIBRATION).toBeNull();
  vi.stubEnv('VITE_JEV_CANDIDATE_CHOICE_CONFIGURATION',JSON.stringify(calibrationFixture()));
  expect(createWeeklyPlanningCandidateChoiceOptions({sourceAccess:()=> 'allowed',continueSelectedTurn:async()=>{throw new Error('must stay inert');}})).toBeUndefined();
});
it('strict calibration accepts a detached valid artifact, never caller mutations',()=>{
  const input=calibrationFixture();const result=validateWeeklyPlanningCandidateChoiceConfiguration(input)!;
  expect(result).toEqual(input);expect(result).not.toBe(input); input.choicePolicy.rules[0].minimumTopProbability=0;
  expect(result.choicePolicy.rules[0].minimumTopProbability).toBe(0.9);
});
it.each([
  ['extra root',(v:any)=>{v.provider='hostile';}], ['missing mode',(v:any)=>{delete v.mode;}],
  ['unknown domain',(v:any)=>{v.domain='d5_numeric';}], ['object mode',(v:any)=>{v.mode={toString:()=> 'canary'};}],
  ['invalid children',(v:any)=>{v.maximumChildrenPerMenu=255;}], ['fractional budget',(v:any)=>{v.maximumDecisions=1.5;}],
  ['zero budget',(v:any)=>{v.maximumDecisions=0;}], ['oversize budget',(v:any)=>{v.maximumDecisions=17;}],
  ['missing semantic',(v:any)=>{delete v.semanticPolicy;}], ['extra semantic',(v:any)=>{v.semanticPolicy.provider='hostile';}],
  ['empty semantic evidence',(v:any)=>{v.semanticPolicy.calibrationEvidenceId=' ';}], ['NaN semantic threshold',(v:any)=>{v.semanticPolicy.maximumConditionChange=NaN;}],
  ['negative semantic threshold',(v:any)=>{v.semanticPolicy.maximumIndependentMeaning=-0.1;}], ['too large semantic threshold',(v:any)=>{v.semanticPolicy.maximumConditionChange=1.1;}],
  ['unknown choice field',(v:any)=>{v.choicePolicy.unsafe=true;}], ['empty choice evidence',(v:any)=>{v.choicePolicy.calibrationEvidenceId='';}],
  ['no menu calibration',(v:any)=>{v.choicePolicy.rules=[];}], ['duplicate menu',(v:any)=>{v.choicePolicy.rules.push({...v.choicePolicy.rules[0]});}],
  ['unknown rule field',(v:any)=>{v.choicePolicy.rules[0].unsafe=true;}], ['object menu kind',(v:any)=>{v.choicePolicy.rules[0].menuKind={toString:()=> 'leaves'};}],
  ['one option',(v:any)=>{v.choicePolicy.rules[0].optionCount=1;}], ['depth overflow',(v:any)=>{v.choicePolicy.rules[0].depth=17;}],
  ['infinite probability',(v:any)=>{v.choicePolicy.rules[0].minimumTopProbability=Infinity;}], ['wrong margin type',(v:any)=>{v.choicePolicy.rules[0].minimumMargin='0.8';}],
] as const)('keeps malformed calibration inert: %s',(_name,mutate)=>{
  const value=calibrationFixture();mutate(value);
  expect(validateWeeklyPlanningCandidateChoiceConfiguration(value)).toBeUndefined();
  expect(createWeeklyPlanningCandidateChoiceOptions({services:{configuration:value},sourceAccess:()=> 'allowed',continueSelectedTurn:async()=>{throw new Error('must stay inert');}})).toBeUndefined();
});


it('validates the same one-read detached calibration snapshot returned to the consumer',()=>{
  const input=calibrationFixture();let reads=0;
  Object.defineProperty(input,'maximumDecisions',{enumerable:true,get:()=>++reads===1?1:1000});
  expect(validateWeeklyPlanningCandidateChoiceConfiguration(input)?.maximumDecisions).toBe(1);expect(reads).toBe(1);
  expect(validateWeeklyPlanningCandidateChoiceConfiguration({...calibrationFixture(),maximumDecisions:1000})).toBeUndefined();
  expect(validateWeeklyPlanningCandidateChoiceConfiguration({...calibrationFixture(),maximumDecisions:1})?.maximumDecisions).toBe(1);
});


it('retains the actual projection lease through authentication and prevents expired candidate exposure or consume',async()=>{
  const authority=new PlannerDataReadAuthority();const load=authority.begin(OWNER,'2026-10-06T08:00:00.000Z');
  const ready=authority.succeed(load.token,'2026-10-06T08:00:00.001Z')!;const lease=authority.captureProjectionLease()!;
  expect(authority.isProjectionUsable(lease)).toBe(true);
  const {choice,h}=await run('accepted',{getToken:async()=>{
    authority.requireActualMaterialReconciliation(authority.captureOwnerScope()!,'2026-10-06T08:00:00.002Z');
    expect(ready.status).toBe('ready');expect(authority.read().status).toBe('stale');return 'scripted-auth';
  }},true,undefined,'question',ready,()=>authority.isProjectionUsable(lease));
  expect(choice).not.toHaveBeenCalled();
  expect(loadWeeklyPlanningStableV5PersistedSession({ownerId:OWNER,weekStartDate:WEEK})!.planningState.intakeState!.c5SelectionLedger!.consumed).toHaveLength(0);
  expect(resolution(readC5RuntimeGraph(OWNER,h.conversationId),'work-a').ambiguous).toBe(true);
});
it('legacy application callers without a live projection gate remain Choice-inert',async()=>{
  const {choice,result}=await run('accepted',{},true,undefined,'question',undefined,null);
  expect(choice).not.toHaveBeenCalled();expect(result.accepted).toBe(true);
  expect(schemas.filter(schema=>schema.includes('weekly_planning_semantic'))).toHaveLength(1);
});


it.each(['ai','deterministic_fallback'] as const)('actual presenting commit creates its own C5 identity and the answer uses semantic Luna0: %s',async source=>{
  const ordinary=fetch;let semanticSends=0;
  vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
    const body=JSON.parse(String(init?.body));const schema=body.response_format?.json_schema?.name;
    if(schema?.includes('weekly_planning_semantic')) {semanticSends++;
      return Response.json({choices:[{message:{content:JSON.stringify({schemaVersion:'weekly-planning-semantic-v5',planningIntent:'discuss',planningWindow:null,
        tasks:[],relations:[],availabilityDeclarations:[],constraintSourceRequests:[],userContextFacts:[],uncertainties:[],corrections:[],decisions:[]})}}]});
    }
    if(source==='deterministic_fallback')throw new Error('scripted renderer failure');
    return ordinary(url,init);
  }));
  // Seed accepted graph evidence, then let the real normalizer/planner/renderer/controller present the question.
  // No h.present, actionId patching, injected continuation or frozen question payload.
  const {h,result,services,choice}=await run('accepted',{},false,undefined,'preview',undefined,()=>true,weeklyPlanningTurnOutcomeLifecycle);
  expect(result.accepted).toBe(true);expect(semanticSends).toBe(1);expect(choice).not.toHaveBeenCalled();
  const question=h.getState().intakeState!.lastQuestionContext!;
  expect(question.targetSlot).toBe('stable_v5:ambiguous_effort_estimate');expect(question.presentation!.content.responseSource).toBe(source);
  expect.soft(question.actionId).toMatch(/^c5-question:/);expect.soft(question.c5).toBeDefined();expect.soft(question.c5?.question.id).toBe(question.actionId);
  const saved=loadWeeklyPlanningStableV5PersistedSession({ownerId:OWNER,weekStartDate:WEEK})!;
  expect(JSON.parse(memory.values.get(getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER,WEEK))!).requiredCapabilities).toEqual(['c5-bound-presentation-v1']);
  expect.soft(saved.planningState.intakeState!.lastQuestionContext!.c5).toBeDefined();expect.soft(saved.planningState.intakeState!.lastQuestionContext!.c5?.question.id).toBe(question.actionId);
  const response=await submitWeeklyPlanningApplicationTurn({session:h.session,userId:OWNER,ownerId:OWNER,
    plannerDataAvailability:createReadyPlannerDataAvailability(OWNER),isPlannerDataSnapshotCurrent:()=>true,
    userText:'教材aは1問7分です。',selectedDate:WEEK,plans:[],scheduleTemplates:[],getState:h.getState,dispatch:h.dispatch},services);
  expect.soft(response.accepted).toBe(true);expect.soft(choice).toHaveBeenCalledTimes(1);expect.soft(semanticSends).toBe(1);
  const committed=loadWeeklyPlanningStableV5PersistedSession({ownerId:OWNER,weekStartDate:WEEK})!;
  expect.soft(resolution(committed.graph,'work-a').estimatedMinutes).toBe(70);expect.soft(committed.planningState.intakeState!.c5SelectionLedger?.consumed ?? []).toHaveLength(1);
});


it.each(['grounding','repair_notice','preview_control'] as const)('keeps a machine-bound mixed presentation Choice-ineligible: %s',async kind=>{
  const {choice}=await run('accepted',{},true,h=>{
    const state=h.getState();const context=state.intakeState!.lastQuestionContext!;const old=context.presentation!;
    const content={...old.content,responseSource:'ai' as const,...(kind==='grounding'?{groundingContext:{proposed:1,contested:0}}:kind==='repair_notice'?{selfRepairNotice:true}:{previewPromotionControl:true})};
    const bound=bindWeeklyPlanningQuestionPresentation({state:state.intakeState!,content,turnId:old.turnId,assistantMessageId:old.assistantMessageId,
      planningStateRevision:old.planningStateRevision,graphRevision:old.graphRevision});
    const next=captureC5Question({state:bound,graph:readC5RuntimeGraph(OWNER,h.conversationId),ownerId:OWNER,conversationId:h.conversationId,messages:state.messages});
    expect(next.lastQuestionContext!.c5).toBeUndefined();h.replaceState({...state,intakeState:next});
  });
  expect(choice).not.toHaveBeenCalled();expect(schemas.filter(schema=>schema.includes('weekly_planning_semantic'))).toHaveLength(1);
});
it('does not manufacture identity or a candidate snapshot for a legacy state when reading or answering it',async()=>{
  const {choice}=await run('accepted',{},true,h=>{
    const state=h.getState();const {actionId:_id,c5:_snapshot,...old}=state.intakeState!.lastQuestionContext!;
    h.replaceState({...state,intakeState:{...state.intakeState!,lastQuestionContext:old}});
    expect(h.getState().intakeState!.lastQuestionContext!.actionId).toBeUndefined();
  });
  expect(choice).not.toHaveBeenCalled();expect(schemas.filter(schema=>schema.includes('weekly_planning_semantic'))).toHaveLength(1);
});


it.each(['wrong_target','whole_workload','second_question'] as const)('carries the exact bound AI presentation to the actual Worker/provider and fully falls back on none: %s',async variant=>{
  const shown=variant==='wrong_target'?'教材bの1問あたりは何分ですか。':variant==='whole_workload'?'教材aの全量は何分ですか。':'教材aは1問何分ですか。別の教材の量も追加しますか。';
  const original=fetch;const upstream: any[]=[];
  const {JEV_MODEL}=await vi.importActual<{JEV_MODEL:{responses:readonly string[]}}>('../../../../workers/ai-proxy/src/decision/decisionPolicy');
  const {default:worker}=await vi.importActual<{default:{fetch(request:Request,env:unknown):Promise<Response>}}>('../../../../workers/ai-proxy/src/worker');
  vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
    if(String(url).includes('identitytoolkit'))return Response.json({users:[{localId:OWNER,emailVerified:true}]});
    if(String(url).endsWith('/api/alpha/decisions')){upstream.push(JSON.parse(String(init?.body)));return Response.json({model:JEV_MODEL.responses[0],answers:{candidate:{type:'choice',choice:'none',confidence:0.96,
      probabilities:{'leaf:0':0.02,'leaf:1':0.02,none:0.96}},condition_change:{type:'noul',noul:0.9},independent_meaning:{type:'noul',noul:0.9}}});}
    return original(url,init);
  }));
  const {result,requests,h}=await run('accepted',{transport:async(url,init)=>worker.fetch(new Request(String(url),{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),Origin:'https://app.test'}}),{
    OPENAI_API_KEY:'fixture-openai',OPENROUTER_API_KEY:'fixture-jev',FIREBASE_WEB_API_KEY:'fixture-project',ALLOWED_ORIGIN:'https://app.test',JEV_MODE:'canary',JEV_CANARY_PERCENT:'100',JEV_CANDIDATE_CHOICE_MODE:'canary',JEV_CANDIDATE_CHOICE_CANARY_PERCENT:'100',
    AI_QUOTA:{getByName:()=>({checkAndConsume:async()=>({allowed:true,retryAfterSeconds:1})})}} as never)},true,h=>{
    const state=h.getState();const old=state.intakeState!.lastQuestionContext!;const presentation=old.presentation!;
    const messages=state.messages.map(message=>message.id===presentation.assistantMessageId?{...message,content:shown}:message);
    const bound=bindWeeklyPlanningQuestionPresentation({state:{...state.intakeState!,questions:[shown]},content:{...presentation.content,responseSource:'ai'},turnId:presentation.turnId,assistantMessageId:presentation.assistantMessageId,planningStateRevision:presentation.planningStateRevision,graphRevision:presentation.graphRevision});
    const next=captureC5Question({state:bound,graph:readC5RuntimeGraph(OWNER,h.conversationId),ownerId:OWNER,conversationId:h.conversationId,messages});
    expect(next.lastQuestionContext!.c5).toBeDefined();h.replaceState({...state,messages,intakeState:next});
  });
  expect(result.accepted).toBe(true);expect(upstream).toHaveLength(1);expect(upstream[0].state.context.presentedQuestion).toBe(shown);
  expect(upstream[0].questions.candidate.instructions).toContain('presentedQuestion');
  expect(requests.filter(body=>body.response_format?.json_schema?.name?.includes('weekly_planning_semantic'))).toHaveLength(1);
  expect(JSON.stringify(requests)).toContain('教材aは1問7分です。');
  expect(h.getState().intakeState!.c5SelectionLedger!.consumed).toEqual([]);
});

it.each(['off','shadow','canary'] as const)('old strict Worker reader rejects the new context field before mode=%s and entry falls back once',async mode=>{
  let calls=0;
  const {result,requests}=await run('accepted',{transport:async(_url,init)=>{
    calls++;const context=JSON.parse(String(init?.body)).decisionContext.request.context;
    // Old v1 reader's exact context key set precedes mode selection. This scripted
    // response tests the actual new client/application fallback, not old model behavior.
    expect(Object.keys(context)).toContain('presentedQuestion');expect(mode).toBeTruthy();
    return Response.json({error:'invalid_context'},{status:400});
  }});
  expect(result.accepted).toBe(true);expect(calls).toBe(1);
  expect(requests.filter(body=>body.response_format?.json_schema?.name?.includes('weekly_planning_semantic'))).toHaveLength(1);
});

it.each(['missing','duplicate','wrong_role','overflow'] as const)('requires exactly one bounded assistant message before exposure: %s',async mode=>{
  const {choice}=await run('accepted',{},true,h=>{
    const state=h.getState();const old=state.intakeState!.lastQuestionContext!;const id=old.presentation!.assistantMessageId;
    const messages=mode==='missing'?state.messages.filter(message=>message.id!==id):mode==='duplicate'?[...state.messages,state.messages.filter(message=>message.id===id)[0]]:
      state.messages.map(message=>message.id===id?{...message,...(mode==='wrong_role'?{role:'user' as const}:{content:'大'.repeat(1334)})}:message);
    h.replaceState({...state,messages});
  });
  expect(choice).not.toHaveBeenCalled();
});
it('keeps the UTF8 boundary exact without truncation and checks message identity',()=>{
  const question={id:'q',code:'ambiguous_effort_estimate',presentingTurnId:'turn',presentingMessageId:'message',presentationRevision:1};
  const text='大'.repeat(1333)+'x';expect(new TextEncoder().encode(text).length).toBe(4000);
  expect(boundC5PresentedQuestion(question,[{id:'message',role:'assistant',content:text,createdAt:'now'}])?.text).toBe(text);
  expect(boundC5PresentedQuestion(question,[{id:'message',role:'assistant',content:text+'x',createdAt:'now'}])).toBeNull();
  expect(boundC5PresentedQuestion(question,[{id:'other',role:'assistant',content:text,createdAt:'now'}])).toBeNull();
});


it.each(['auth','provider','renderer'] as const)('keeps live projection validity through the %s await boundary',async phase=>{
  const authority=new PlannerDataReadAuthority();const load=authority.begin(OWNER,'2026-10-06T08:00:00.000Z');const ready=authority.succeed(load.token,'2026-10-06T08:00:00.001Z')!;const lease=authority.captureProjectionLease()!;
  const revoke=()=>authority.requireActualMaterialReconciliation(authority.captureOwnerScope()!,'2026-10-06T08:00:00.002Z');
  const original=fetch;
  if(phase==='renderer')vi.stubGlobal('fetch',vi.fn(async(url,init)=>{const body=JSON.parse(String(init?.body));if(body.response_format?.json_schema?.name==='weekly_planning_stable_v5_dialogue_response')revoke();return original(url,init);}));
  const extras: {getToken?: WeeklyPlanningCandidateChoiceServices['getToken'];transport?: typeof fetch}={getToken:async()=>{if(phase==='auth')revoke();return 'scripted-auth';}};
  let sends=0;
  if(phase==='provider')extras.transport=async(_url,init)=>{sends++;const r=JSON.parse(String(init?.body)).decisionContext.request;const selected=r.menu.options.find((entry:any)=>entry.kind==='leaf'&&entry.candidate.id==='estimate-7').id;revoke();return Response.json({status:'evaluated',catalogVersion:'complete-candidate-choice-2026-10-13-v2',nodeId:r.menu.nodeId,requestId:r.requestId,selectionEpoch:r.selectionEpoch,candidateSetHash:r.candidateSetHash,optionId:selected,probabilities:r.menu.options.map((entry:any)=>({optionId:entry.id,probability:entry.id===selected?0.96:0.02})),conditionChange:0,independentMeaning:0});};
  const {h,choice}=await run('accepted',extras,true,undefined,'question',ready,()=>authority.isProjectionUsable(lease));
  expect(authority.isProjectionUsable(lease)).toBe(false);
  if(phase==='auth')expect(choice).not.toHaveBeenCalled();if(phase==='provider')expect(sends).toBe(1);
  expect(loadWeeklyPlanningStableV5PersistedSession({ownerId:OWNER,weekStartDate:WEEK})!.planningState.intakeState!.c5SelectionLedger!.consumed).toEqual([]);
  expect(resolution(readC5RuntimeGraph(OWNER,h.conversationId),'work-a').ambiguous).toBe(true);
});

function prepareAncestorQuestion(h: ReturnType<typeof c5ControllerHarness>) {
  const graph = structuredClone(readC5RuntimeGraph(OWNER, h.conversationId));
  graph.components = [
    { id: 'material-parent', taskId: 'task-a', parentComponentId: null, role: 'material', label: '海辺の観察帳', source: graph.tasks[0].source, createdRevision: 1 },
    { id: 'chapter-child', taskId: 'task-a', parentComponentId: 'material-parent', role: 'chapter', label: '図版A', source: graph.tasks[0].source, createdRevision: 1 },
  ];
  graph.workloads[0].componentId = 'chapter-child';
  graph.factLifecycles.push(...graph.components.map(fact => ({ factId: fact.id, status: 'active' as const,
    createdRevision: 1, terminalRevision: null, supersededByFactId: null })));
  expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toEqual([]);
  hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER, weekStartDate: WEEK, conversationId: h.conversationId, graph });
  const state = h.getState();
  h.replaceState({ ...state, intakeState: captureC5Question({ state: state.intakeState!, graph,
    ownerId: OWNER, conversationId: h.conversationId, messages: state.messages }) });
}
it('actual entry carries the complete ancestor labels to Choice without private ancestor sources', async () => {
  const { choice, h } = await run('accepted', {}, true, prepareAncestorQuestion);
  expect(choice).toHaveBeenCalledTimes(1);
  const request = JSON.parse(String(choice.mock.calls[0][1]?.body));
  expect(request.decisionContext.request.context.scope.componentChain).toEqual([
    { role: 'material', label: '海辺の観察帳' }, { role: 'chapter', label: '図版A' },
  ]);
  expect(JSON.stringify(request)).not.toContain('private-source-');
  expect(h.getState().intakeState!.c5SelectionLedger!.consumed).toHaveLength(1);
});
it('actual entry refuses a parent meaning changed during auth before sending or consuming Choice', async () => {
  let harness: ReturnType<typeof c5ControllerHarness>;
  const { choice, h } = await run('accepted', { getToken: async () => {
    const graph = structuredClone(readC5RuntimeGraph(OWNER, harness.conversationId));
    graph.components[0].label = '山地の観察帳';
    expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toEqual([]);
    hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER, weekStartDate: WEEK, conversationId: harness.conversationId, graph });
    return 'scripted-auth';
  } }, true, current => { harness = current; prepareAncestorQuestion(current); });
  expect.soft(choice).not.toHaveBeenCalled();
  expect.soft(h.getState().intakeState!.c5SelectionLedger!.consumed).toEqual([]);
  expect(schemas.filter(name => name.includes('weekly_planning_semantic'))).toHaveLength(1);
});
