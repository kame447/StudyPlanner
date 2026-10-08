// Collect the real lazy runtime before timing behavior; the assertions keep the default 5 s limit.
import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it } from 'vitest';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime } from './testUtils/weeklyPlanningScriptedConversationHarness';
import { COVERAGE_USER_TEXT, coverageDocument, coverageRendererReply } from './testUtils/weeklyPlanningSemanticEvidenceCoverageFixture';
import { validateWeeklyPlanningSemanticResponseV5 } from './semantic/weeklyPlanningSemanticResponseValidationV5';

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

describe('first-turn completeness retains its valid initial meaning', () => {
  it.each(['additive', 'drops_workload', 'drops_uncertainty', 'retains_uncertainty', 'drops_component', 'changes_material', 'changes_category'] as const)('keeps the initial explicit page target under %s', async scenario => {
    const initial = coverageDocument(false);
    const reread = coverageDocument(true);
    const userText = scenario === 'changes_material' ? `${COVERAGE_USER_TEXT}。別の問題集も気になります` : COVERAGE_USER_TEXT;
    if (scenario === 'drops_component') reread.tasks[0].study!.components = [];
    if (scenario === 'changes_material') {
      reread.tasks[0].study!.components[0].label = '別の問題集';
      reread.tasks[0].study!.components[0].sourceText = '別の問題集';
    }
    if (scenario === 'changes_category') {
      // A schema-valid non-study task cannot retain a study component container.
      reread.tasks[0].category = 'non_study'; reread.tasks[0].study = null;
    }
    if (scenario === 'drops_uncertainty' || scenario === 'retains_uncertainty') {
      initial.uncertainties = [{ localId: 'material-identity', targetLocalId: 'component-1', field: 'material_identity', reason: 'material is not confirmed', sourceText: 'アルゴリズムイントロダクション' }];
      if (scenario === 'retains_uncertainty') reread.uncertainties = structuredClone(initial.uncertainties);
    }
    if (scenario === 'drops_workload') {
      // The reread supplies the requested rate and time preference, but loses the known page target.
      for (const task of reread.tasks) {
        task.workloads = [];
        for (const component of task.study?.components ?? []) component.workloads = [];
        for (const estimate of task.effortEstimates) estimate.targetLocalId = 'component-1';
      }
    }
    const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(reread), {
      currentUserText: userText, conversationArchitecture: 'interaction_v1',
    });
    expect(validation.errors).toEqual([]);
    expect(validation.document).not.toBeNull();
    let genericCalls = 0;
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return coverageRendererReply(call);
      if (call.schemaName === 'weekly_planning_dense_turn_completeness_audit_v5') return JSON.stringify({
        decision: 'incomplete', missingFacts: ['the stated per-page effort and weekday preference'],
      });
      if (call.kind === 'semantic_generic') return JSON.stringify(genericCalls++ === 0 ? initial : reread);
      throw new Error(`Unexpected request: ${call.schemaName}`);
    }, { completenessAudit: 'scripted' });
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    const turn = await conversation.submit(userText);
    expect(turn.result?.failure).toBeUndefined();
    expect(genericCalls).toBe(2);
    expect(turn.debugTrace.some(event => event.stage === 'semantic_validation_result'
      && (event.data as { attempt?: string; accepted?: boolean }).attempt === (scenario === 'additive' || scenario === 'retains_uncertainty' ? 'dense_completeness_retry' : 'completeness_floor:initial_facts_not_preserved') && (event.data as { accepted?: boolean }).accepted === true)).toBe(true);
    expect(conversation.graph()?.workloads).toContainEqual(expect.objectContaining({ amount: 20, unitCode: 'page' }));
    if (scenario === 'drops_uncertainty' || scenario === 'retains_uncertainty') {
      expect(conversation.graph()?.uncertainties).toContainEqual(expect.objectContaining({ field: 'material_identity' }));
      expect(turn.result!.draftCandidates).toEqual([]);
      expect(conversation.getState().intakeState?.lastQuestionContext?.targetSlot).toBe('stable_v5:semantic_uncertainty');
    }
    expect(conversation.graph()?.tasks[0].category).toBe('study');
    expect(conversation.graph()?.components).toContainEqual(expect.objectContaining({ role: 'material', label: 'アルゴリズムイントロダクション' }));
    if (scenario === 'additive') {
      expect(turn.result!.draftCandidates.length).toBeGreaterThan(0);
      expect(conversation.graph()?.effortEstimates).toContainEqual(expect.objectContaining({ kind: 'duration_per_unit', minutes: 3 }));
    }
  });
});

it('retains the two original pace targets when a completeness reread swaps them', async () => {
  const initial = coverageDocument(true); const task = initial.tasks[0];
  task.effortEstimates[0].targetLocalId = task.workloads[0].localId;
  task.workloads.push({ ...structuredClone(task.workloads[0]), localId: 'second-work', amount: 40, sourceText: '40ページ' });
  task.effortEstimates.push({ ...structuredClone(task.effortEstimates[0]), localId: 'second-rate', targetLocalId: 'second-work', minutes: 5, sourceText: '1ページ5分' });
  initial.tasks.push({ localId: 'review-task', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: '単語の復習',
    study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [] },
    workloads: [{ ...structuredClone(task.workloads[0]), localId: 'review-amount', amount: 10, sourceText: '10ページ' }],
    effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: '単語の復習を10ページ進めたい' });
  const userText = `${COVERAGE_USER_TEXT}。別の範囲は40ページ、1ページ5分。単語の復習を10ページ進めたい。金曜の夜がいい`;
  const reread = structuredClone(initial); const [first, second] = reread.tasks[0].effortEstimates;
  [first.targetLocalId, second.targetLocalId] = [second.targetLocalId, first.targetLocalId];
  for (const document of [initial, reread]) expect(validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), {
    currentUserText: userText, conversationArchitecture: 'interaction_v1',
  }).errors).toEqual([]);
  let genericCalls = 0;
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return coverageRendererReply(call);
    if (call.schemaName === 'weekly_planning_dense_turn_completeness_audit_v5') return JSON.stringify({
      decision: 'incomplete', missingFacts: ['a separate timing preference'],
    });
    if (call.kind === 'semantic_generic') return JSON.stringify(genericCalls++ === 0 ? initial : reread);
    throw new Error(`Unexpected request: ${call.schemaName}`);
  }, { completenessAudit: 'scripted' });
  const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
  const turn = await conversation.submit(userText);
  expect(turn.result?.failure).toBeUndefined();
  expect(genericCalls).toBe(2);
  expect(turn.debugTrace).toContainEqual(expect.objectContaining({ stage: 'semantic_validation_result',
    data: expect.objectContaining({ attempt: 'completeness_floor:initial_facts_not_preserved', accepted: true }) }));
  const graph = conversation.graph()!;
  for (const [amount, minutes] of [[20, 3], [40, 5]]) {
    const workload = graph.workloads.find(candidate => candidate.amount === amount)!;
    expect(graph.effortEstimates).toContainEqual(expect.objectContaining({ kind: 'duration_per_unit',
      targetFactId: workload.id, minutes }));
  }
  expect(turn.debugTrace.filter(event => event.stage === 'semantic_repair_prepared')).toEqual([]);
});

describe('independent target ownership through the controller', () => {
const validate = validateWeeklyPlanningSemanticResponseV5;
it.each(['pace','temporal','recurrence'] as const)('retains the original typed %s association through the real controller',async kind=>{
 const initial=coverageDocument(true);const t=initial.tasks[0];const first=structuredClone(t.workloads[0]);
 const second={...structuredClone(first),localId:'other-work',sourceText:'別の20ページ'};
 t.workloads=[];t.study!.components[0].workloads=[first];
 t.study!.components.push({...structuredClone(t.study!.components[0]),localId:'other-material',label:'別の合成教材',sourceText:'別の合成教材',workloads:[second]});
 t.effortEstimates[0].targetLocalId=first.localId;
 t.effortEstimates.push({...structuredClone(t.effortEstimates[0]),localId:'other-pace',targetLocalId:second.localId,minutes:5,sourceText:'1ページ5分'});
 if(kind==='temporal')t.temporalConstraints.push({localId:'other-night',targetLocalId:'other-material',kind:'preferred_window',constraintLevel:'soft',dateExpression:null,namedTimePeriod:'night',startTime:null,endTime:null,precision:'approximate',sourceText:'別の合成教材は夜に'});
 if(kind==='recurrence')t.recurrence.push({localId:'other-twice',targetLocalId:'other-work',kind:'times_per_week',count:2,days:[],sourceText:'週2回'});
 initial.tasks.push({localId:'review-task',existingPublicId:null,decompositionStatus:'atomic',category:'study',title:'単語の復習',study:{purpose:'self_study',activityKind:'reading',contextLabel:null,components:[]},workloads:[{...structuredClone(first),localId:'review-work',amount:10,sourceText:'10ページ'}],effortEstimates:[],temporalConstraints:[],recurrence:[],durableContextSignals:[],sourceText:'単語の復習を10ページ進めたい'});
 const userText=COVERAGE_USER_TEXT+'。別の合成教材の別の20ページは1ページ5分。別の合成教材は夜に、週2回。単語の復習を10ページ進めたい。金曜の夜がいい';
 const retry=structuredClone(initial);const rt=retry.tasks[0];
 if(kind==='pace')[rt.effortEstimates[0].targetLocalId,rt.effortEstimates[1].targetLocalId]=[rt.effortEstimates[1].targetLocalId,rt.effortEstimates[0].targetLocalId];
 if(kind==='temporal')rt.temporalConstraints[rt.temporalConstraints.length-1].targetLocalId=rt.study!.components[0].localId;
 if(kind==='recurrence')rt.recurrence[rt.recurrence.length-1].targetLocalId=first.localId;
 for(const doc of [initial,retry])expect(validate(JSON.stringify(doc),{currentUserText:userText,conversationArchitecture:'interaction_v1'}).errors).toEqual([]);
 let generic=0;provider=installScriptedWeeklyPlanningProvider(call=>{
  if(call.kind==='renderer')return coverageRendererReply(call);
  if(call.schemaName==='weekly_planning_dense_turn_completeness_audit_v5')return JSON.stringify({decision:'incomplete',missingFacts:['a separate timing preference']});
  if(call.kind==='semantic_generic')return JSON.stringify(generic++===0?initial:retry);
  throw Error('unexpected '+call.schemaName);
 },{completenessAudit:'scripted'});
 const conversation=createScriptedConversation({provider,architecture:'interaction_v1'});const turn=await conversation.submit(userText);
 expect(turn.result?.failure).toBeUndefined();expect(generic).toBe(2);
 expect(turn.calls.filter(call=>call.kind!=='renderer').map(call=>call.schemaName)).toEqual(['weekly_planning_semantic_document_v5','weekly_planning_dense_turn_completeness_audit_v5','weekly_planning_semantic_document_v5']);
 const graph=conversation.graph()!;const other=graph.components.find(c=>c.label==='別の合成教材')!;
 const otherWork=graph.workloads.find(w=>w.componentId===other.id)!;
 if(kind==='pace')expect(graph.effortEstimates).toContainEqual(expect.objectContaining({targetFactId:otherWork.id,kind:'duration_per_unit',minutes:5}));
 if(kind==='temporal')expect(graph.temporalConstraints).toContainEqual(expect.objectContaining({targetFactId:other.id,namedTimePeriod:'night'}));
 if(kind==='recurrence')expect(graph.recurrences).toContainEqual(expect.objectContaining({targetFactId:other.id,count:2}));
 expect(turn.debugTrace).toContainEqual(expect.objectContaining({stage:'semantic_validation_result',data:expect.objectContaining({attempt:'completeness_floor:initial_facts_not_preserved',accepted:true})}));
 expect(turn.debugTrace.filter(e=>e.stage==='semantic_repair_prepared')).toEqual([]);
});

});

describe('independent material workload ownership before pace', () => {
const validate = validateWeeklyPlanningSemanticResponseV5;
it.each([false,true])('retains20/40page material scopes before any rate answer (swapped=%s)',async swapped=>{
 const initial=coverageDocument(true);const t=initial.tasks[0];const one=structuredClone(t.workloads[0]);
 t.workloads=[];t.effortEstimates=[];t.study!.components[0].workloads=[one];
 t.study!.components.push({...structuredClone(t.study!.components[0]),localId:'second-material',label:'別の合成教材',sourceText:'別の合成教材',workloads:[{...structuredClone(one),localId:'second-work',amount:40,sourceText:'40ページ'}]});
 const userText=COVERAGE_USER_TEXT+'。別の合成教材は40ページ読みたい';const retry=structuredClone(initial);const components=retry.tasks[0].study!.components;
 if(swapped)[components[0].workloads,components[1].workloads]=[components[1].workloads,components[0].workloads];
 for(const d of [initial,retry])expect(validate(JSON.stringify(d),{currentUserText:userText,conversationArchitecture:'interaction_v1'}).errors).toEqual([]);
 let generic=0;provider=installScriptedWeeklyPlanningProvider(call=>{
 if(call.kind==='renderer')return coverageRendererReply(call);
 if(call.schemaName==='weekly_planning_dense_turn_completeness_audit_v5')return JSON.stringify({decision:'incomplete',missingFacts:['a separate timing preference']});
 if(call.kind==='semantic_generic')return JSON.stringify(generic++===0?initial:retry);
 throw Error('unexpected '+call.schemaName);
 },{completenessAudit:'scripted'});
 const c=createScriptedConversation({provider,architecture:'interaction_v1'});const turn=await c.submit(userText);
 expect(turn.result?.failure).toBeUndefined();expect(generic).toBe(2);
 expect(turn.calls.filter(call=>call.kind!=='renderer').map(call=>call.schemaName)).toEqual(['weekly_planning_semantic_document_v5','weekly_planning_dense_turn_completeness_audit_v5','weekly_planning_semantic_document_v5']);
 const graph=c.graph()!;const material=graph.components.find(component=>component.label==='別の合成教材')!;
 expect(graph.workloads.filter(w=>w.componentId===material.id).map(w=>w.amount)).toEqual([40]);
 if(swapped)expect(turn.debugTrace).toContainEqual(expect.objectContaining({stage:'semantic_validation_result',data:expect.objectContaining({attempt:'completeness_floor:initial_facts_not_preserved',accepted:true})}));
});

});
