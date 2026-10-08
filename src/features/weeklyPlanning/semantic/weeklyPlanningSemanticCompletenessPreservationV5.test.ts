import { describe, expect, it } from 'vitest';
import { conditionDocument, conditionSetupDocument } from '../testUtils/weeklyPlanningConditionPropagationFixture';
import { coverageDocument, COVERAGE_USER_TEXT } from '../testUtils/weeklyPlanningSemanticEvidenceCoverageFixture';
import { validateWeeklyPlanningSemanticResponseV5 as validate } from './weeklyPlanningSemanticResponseValidationV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningSemanticCompletenessPreservationV5 as preserve } from './weeklyPlanningSemanticCompletenessPreservationV5';

function bound() {
  const doc = conditionSetupDocument() as unknown as WeeklyPlanningSemanticDocumentV5;
  doc.planningWindow = null;
  doc.tasks.forEach((task, i) => {
    task.existingPublicId = `accepted-${i}`; task.workloads = [];
    task.effortEstimates = [{ localId: `cap-${i}`, targetLocalId: task.localId, kind: 'session_duration', minutes: 60, unitCode: 'session', precision: 'approximate', sourceText: 'split' }];
    task.recurrence = [{ localId: `count-${i}`, targetLocalId: task.localId, kind: 'custom', count: 2, days: [], sourceText: 'split' }];
  });
  return doc;
}
const check = (initialDocument: WeeklyPlanningSemanticDocumentV5, retryDocument: WeeklyPlanningSemanticDocumentV5, userText = '') => preserve({ initialDocument, retryDocument, userText });

describe('typed completeness retention', () => {
  it('accepts added facts and equivalent wire ids, source quotes and duration unit labels', () => {
    const initial = bound(); const retry = structuredClone(initial);
    retry.tasks.forEach((task, i) => {
      task.localId = `renamed-${i}`; task.sourceText = 'different quote';
      task.effortEstimates[0].localId = `new-cap-${i}`;
      task.effortEstimates[0].targetLocalId = task.localId;
      task.effortEstimates[0].unitCode = null;
      task.recurrence[0].localId = `new-count-${i}`;
      task.recurrence[0].targetLocalId = task.localId;
      task.temporalConstraints.push({ localId: `night-${i}`, targetLocalId: task.localId, kind: 'preferred_window', constraintLevel: 'soft', dateExpression: null, namedTimePeriod: 'night', startTime: null, endTime: null, precision: 'exact', sourceText: 'night' });
    });
    expect(check(initial, retry)).toEqual([]);
  });

  it.each(['effort', 'recurrence', 'task_count', 'changed_value', 'cross_owner'] as const)('rejects %s loss despite a valid replacement', kind => {
    const initial = bound(); const retry = structuredClone(initial);
    if (kind === 'effort') retry.tasks[0].effortEstimates = [];
    if (kind === 'recurrence') retry.tasks[0].recurrence = [];
    if (kind === 'task_count') retry.tasks.pop();
    if (kind === 'changed_value') retry.tasks[0].effortEstimates[0].minutes = 90;
    if (kind === 'cross_owner') { retry.tasks[1].effortEstimates.push({ ...retry.tasks[0].effortEstimates[0], localId: 'other-copy' }); retry.tasks[0].effortEstimates = []; }
    expect(check(initial, retry).length).toBeGreaterThan(0);
  });

  it('preserves equal-valued recurrence multiplicity rather than reducing it to a set', () => {
    const initial = bound(); initial.tasks[0].recurrence.push({ ...initial.tasks[0].recurrence[0], localId: 'extra-count' });
    const retry = structuredClone(initial); retry.tasks[0].recurrence.pop();
    expect(check(initial, retry).length).toBeGreaterThan(0);
  });

  it('allows the observed component-to-task workload move with the same quantity', () => {
    expect(check(coverageDocument(false), coverageDocument(true), COVERAGE_USER_TEXT)).toEqual([]);
  });

  it.each(['component_dropped', 'label_changed', 'category_flipped', 'component_role_changed'] as const)('rejects first-turn identity loss: %s', kind => {
    const initial = coverageDocument(false); const retry = structuredClone(initial);
    const task = retry.tasks[0]; const component = task.study!.components[0];
    if (kind === 'component_dropped') { task.workloads.push(...component.workloads); task.study!.components = []; }
    if (kind === 'label_changed') component.label = '別の問題集';
    if (kind === 'category_flipped') task.category = 'non_study';
    if (kind === 'component_role_changed') component.role = 'section';
    expect(check(initial, retry, COVERAGE_USER_TEXT).length).toBeGreaterThan(0);
  });

  it('preserves component multiplicity instead of treating equal material identities as a set', () => {
    const initial = coverageDocument(false);
    initial.tasks[0].study!.components.push({ ...structuredClone(initial.tasks[0].study!.components[0]), localId: 'duplicate-material', workloads: [] });
    const retry = structuredClone(initial); retry.tasks[0].study!.components.pop();
    expect(check(initial, retry, COVERAGE_USER_TEXT).length).toBeGreaterThan(0);
  });

  it('keeps normalized component identity and its control target under wire-id/label-format changes', () => {
    const initial = coverageDocument(false); const task = initial.tasks[0]; task.existingPublicId = 'accepted-owner';
    task.study!.components[0].label = 'Ｆｏｃｕｓ  Gold';
    initial.uncertainties = [{ localId: 'identity', targetLocalId: 'component-1', field: 'material_identity', reason: 'not confirmed', sourceText: 'quote' }];
    const retry = structuredClone(initial); const component = retry.tasks[0].study!.components[0];
    component.localId = 'renamed-material'; component.label = 'Focus Gold';
    retry.uncertainties[0].targetLocalId = component.localId;
    expect(check(initial, retry)).toEqual([]);
  });

  it.each(['component', 'category'] as const)('does not move equal global %s facts between bound owners', kind => {
    const initial = bound();
    initial.tasks.forEach(task => { task.study = { purpose: 'unknown', activityKind: 'unknown', contextLabel: null, components: [] }; });
    if (kind === 'component') {
      initial.tasks[0].study!.components.push({ ...coverageDocument(false).tasks[0].study!.components[0], workloads: [] });
    } else initial.tasks[1].category = 'non_study';
    const retry = structuredClone(initial);
    if (kind === 'component') { retry.tasks[1].study!.components = retry.tasks[0].study!.components; retry.tasks[0].study!.components = []; }
    else { retry.tasks[0].category = 'non_study'; retry.tasks[1].category = 'study'; }
    expect(check(initial, retry)).toEqual(['completeness-preservation:bound_task_facts_lost']);
  });

  it('allows purpose, activity kind and decomposition refinement outside the declared retention floor', () => {
    const initial = coverageDocument(false); const retry = structuredClone(initial);
    retry.tasks[0].study!.purpose = 'unknown'; retry.tasks[0].study!.activityKind = 'other';
    retry.tasks[0].decompositionStatus = 'needs_breakdown';
    expect(check(initial, retry, COVERAGE_USER_TEXT)).toEqual([]);
  });

  it.each(['amount', 'role', 'unit', 'range', 'drop', 'window'])('rejects first-turn %s loss', kind => {
    const initial = coverageDocument(false); const retry = coverageDocument(true);
    if (kind === 'amount') retry.tasks[0].workloads[0].amount = 200;
    if (kind === 'role') retry.tasks[0].workloads[0].quantityRole = 'scope_total';
    if (kind === 'unit') retry.tasks[0].workloads[0].unitCode = 'chapter';
    if (kind === 'range') retry.tasks[0].workloads[0].rangeStart = '1';
    if (kind === 'drop') retry.tasks[0].workloads = [];
    if (kind === 'window') retry.planningWindow = null;
    expect(check(initial, retry, COVERAGE_USER_TEXT).length).toBeGreaterThan(0);
  });

  it('does not associate equal-valued unbound work with another source span', () => {
    const doc = conditionSetupDocument() as unknown as WeeklyPlanningSemanticDocumentV5;
    const text = 'first source / second source';
    doc.tasks.forEach((task, i) => { task.sourceText = i ? 'second source' : 'first source'; task.workloads[0].amount = 20; task.workloads[0].unitCode = 'page'; });
    const retry = structuredClone(doc); retry.tasks[0].workloads = []; retry.tasks[1].workloads.push({ ...retry.tasks[1].workloads[0], localId: 'another' });
    expect(check(doc, retry, text).length).toBeGreaterThan(0);
  });

  it('does not infer a task association from source overlap without typed containment', () => {
    const initial = coverageDocument(false); const retry = coverageDocument(true); retry.tasks[0].workloads[0].amount = 10;
    expect(check(initial, retry, COVERAGE_USER_TEXT).length).toBeGreaterThan(0);
  });

  it('lets an initially empty candidate gain tasks without inventing initial facts', () => {
    expect(check(conditionDocument() as unknown as WeeklyPlanningSemanticDocumentV5, coverageDocument(true), COVERAGE_USER_TEXT)).toEqual([]);
  });
  it.each(['uncertainty', 'correction', 'decision', 'relation'] as const)('keeps typed %s control meaning', kind => {
    const initial = bound();
    initial.tasks[0].workloads = (conditionSetupDocument() as unknown as WeeklyPlanningSemanticDocumentV5).tasks[0].workloads;
    initial.uncertainties = [{ localId: 'material-question', targetLocalId: initial.tasks[0].localId, field: 'material_identity', reason: 'not identified', sourceText: 'typed question' }];
    initial.corrections = [{ localId: 'fix-amount', target: { kind: 'workload', publicId: 'accepted-old-30', localId: null, mention: null }, operation: 'replace', replacementLocalId: initial.tasks[0].workloads[0].localId, sourceText: '20' }];
    initial.decisions = [{ localId: 'adopt', target: { kind: 'proposal', publicId: 'proposal-1', localId: null, mention: null }, decision: 'accept', sourceText: 'typed decision' }];
    initial.relations = [{ localId: 'order', kind: 'before', fromLocalId: initial.tasks[0].localId, toLocalId: initial.tasks[1].localId, sourceText: 'typed order' }];
    const retry = structuredClone(initial);
    if (kind === 'uncertainty') retry.uncertainties = [];
    if (kind === 'correction') retry.corrections = [];
    if (kind === 'decision') retry.decisions = [];
    if (kind === 'relation') retry.relations = [];
    expect(check(initial, retry).length).toBeGreaterThan(0);
    expect(check(initial, structuredClone(initial))).toEqual([]);
  });

  it('retains control targets under renamed task and replacement local ids', () => {
    const initial = bound();
    initial.tasks[0].workloads = (conditionSetupDocument() as unknown as WeeklyPlanningSemanticDocumentV5).tasks[0].workloads;
    initial.uncertainties = [{ localId: 'material-question', targetLocalId: initial.tasks[0].localId, field: 'material_identity', reason: 'not identified', sourceText: 'typed question' }];
    initial.corrections = [{ localId: 'fix-amount', target: { kind: 'workload', publicId: 'accepted-old-30', localId: null, mention: null }, operation: 'replace', replacementLocalId: initial.tasks[0].workloads[0].localId, sourceText: '20' }];
    initial.relations = [{ localId: 'order', kind: 'before', fromLocalId: initial.tasks[0].localId, toLocalId: initial.tasks[1].localId, sourceText: 'typed order' }];
    const retry = structuredClone(initial);
    retry.tasks[0].localId = 'renamed-owner'; retry.tasks[0].workloads[0].localId = 'renamed-amount';
    for (const fact of [...retry.tasks[0].effortEstimates, ...retry.tasks[0].temporalConstraints, ...retry.tasks[0].recurrence]) {
      if (fact.targetLocalId === initial.tasks[0].localId) fact.targetLocalId = 'renamed-owner';
      else if (fact.targetLocalId === initial.tasks[0].workloads[0].localId) fact.targetLocalId = 'renamed-amount';
    }
    retry.uncertainties[0].targetLocalId = 'renamed-owner'; retry.corrections[0].replacementLocalId = 'renamed-amount'; retry.relations[0].fromLocalId = 'renamed-owner';
    expect(check(initial, retry)).toEqual([]);
    retry.relations[0].fromLocalId = retry.tasks[1].localId; retry.relations[0].toLocalId = 'renamed-owner';
    expect(check(initial, retry).length).toBeGreaterThan(0);
  });

});

it.each(['short_invalid', 'dense_invalid', 'short_valid'] as const)('accounts for the spent central repair ledger (%s)', async scenario => {
  const { WeeklyPlanningSemanticNormalizerRunV5 } = await import('./weeklyPlanningSemanticNormalizerRunV5');
  const { tryWeeklyPlanningDenseTurnCompletenessRetryV5 } = await import('./weeklyPlanningSemanticDenseTurnCompletenessV5');
  const { markWeeklyPlanningSemanticRepairConsumedV5, weeklyPlanningSemanticRepairConsumedV5 } = await import('./weeklyPlanningSemanticRepairLedgerV5');
  const initial = coverageDocument(false);
  const retry = coverageDocument(true); if (scenario !== 'short_valid') retry.tasks[0].workloads[0].amount = -1;
  const calls: string[] = [];
  const run = new WeeklyPlanningSemanticNormalizerRunV5({ async createChatCompletion(request) {
    const name = request.responseFormat?.type === 'json_schema' ? request.responseFormat.json_schema.name : 'unknown';
    calls.push(name);
    return name === 'weekly_planning_dense_turn_completeness_audit_v5'
      ? JSON.stringify({ decision: 'incomplete', missingFacts: ['effort estimate'] }) : JSON.stringify(retry);
  } }, { userText: scenario === 'dense_invalid' ? COVERAGE_USER_TEXT.repeat(20) : COVERAGE_USER_TEXT, conversationArchitecture: 'interaction_v1' });
  markWeeklyPlanningSemanticRepairConsumedV5(run);
  const result = await tryWeeklyPlanningDenseTurnCompletenessRetryV5({ run, baseMessages: [], initialResponse: JSON.stringify(initial), initialDocument: initial, semanticRepairConsumed: () => weeklyPlanningSemanticRepairConsumedV5(run) });
  expect(result?.status).toBe('accepted');
  expect(result?.document).toEqual(scenario === 'short_valid' ? retry : initial);
  expect(result?.diagnostics.repairAttempted).toBe(true);
  expect((result as typeof result & { completenessAbstention: { reason: string } })?.completenessAbstention).toEqual(scenario === 'short_valid' ? undefined : { reason: 'repair_budget_consumed' });
  expect(calls).toEqual(['weekly_planning_dense_turn_completeness_audit_v5', 'weekly_planning_semantic_document_v5']);
});

// Parent R17 / WhiteMendeleev3728: exact typed-target swap repro.
it('retains which workload a typed pace targets within one task',()=>{
 const before=coverageDocument(true);const task=before.tasks[0];
 task.workloads.push({...structuredClone(task.workloads[0]),localId:'second-work',amount:40,sourceText:'40ページ'});
 task.effortEstimates.push({...structuredClone(task.effortEstimates[0]),localId:'second-rate',targetLocalId:'second-work',minutes:5,sourceText:'1ページ5分'});
 const userText=COVERAGE_USER_TEXT+'。別の範囲は40ページ、1ページ5分';
 const after=structuredClone(before);const es=after.tasks[0].effortEstimates;
 [es[0].targetLocalId,es[1].targetLocalId]=[es[1].targetLocalId,es[0].targetLocalId];
 for(const document of [before,after]) expect(validate(JSON.stringify(document),{currentUserText:userText,conversationArchitecture:'interaction_v1'}).errors).toEqual([]);
 console.log('TARGET_SWAP',before.tasks[0].effortEstimates,after.tasks[0].effortEstimates,preserve({initialDocument:before,retryDocument:after,userText}));
 expect(preserve({initialDocument:before,retryDocument:after,userText}).length).toBeGreaterThan(0);
});

it('retains a workload-targeted pace when wire ids and workload containers change', () => {
  const before = coverageDocument(true); const task = before.tasks[0];
  task.effortEstimates[0].targetLocalId = task.workloads[0].localId;
  const after = structuredClone(before); const retry = after.tasks[0];
  retry.study!.components[0].workloads = retry.workloads; retry.workloads = [];
  retry.localId = 'new-owner'; retry.study!.components[0].localId = 'new-material';
  const workload = retry.study!.components[0].workloads[0]; workload.localId = 'new-work';
  retry.effortEstimates[0].localId = 'new-rate'; retry.effortEstimates[0].targetLocalId = workload.localId;
  retry.temporalConstraints.forEach(constraint => { constraint.targetLocalId = retry.localId; });
  expect(check(before, after, COVERAGE_USER_TEXT)).toEqual([]);
});

it('retains a component-targeted pace under normalized label and wire-id changes', () => {
  const before = coverageDocument(true); const task = before.tasks[0]; task.existingPublicId = 'accepted-owner';
  const component = task.study!.components[0]; component.label = 'Ｆｏｃｕｓ  Gold';
  task.effortEstimates[0].targetLocalId = component.localId;
  const after = structuredClone(before); const retry = after.tasks[0].study!.components[0];
  retry.localId = 'renamed-material'; retry.label = 'Focus Gold';
  after.tasks[0].effortEstimates[0].targetLocalId = retry.localId;
  expect(check(before, after)).toEqual([]);
});

it('rejects swapping component-targeted paces between distinct materials with equal quantities', () => {
  const before = coverageDocument(true); const task = before.tasks[0]; task.existingPublicId = 'accepted-owner';
  const component = task.study!.components[0];
  task.study!.components.push({ ...structuredClone(component), localId: 'second-material', label: '別の教材' });
  task.effortEstimates[0].targetLocalId = component.localId;
  task.effortEstimates.push({ ...structuredClone(task.effortEstimates[0]), localId: 'second-rate', targetLocalId: 'second-material', minutes: 5 });
  const after = structuredClone(before); const [first, second] = after.tasks[0].effortEstimates;
  [first.targetLocalId, second.targetLocalId] = [second.targetLocalId, first.targetLocalId];
  expect(check(before, after).length).toBeGreaterThan(0);
});

it('retains the material owner of equal-valued workload-targeted paces', () => {
  const before = coverageDocument(true); const task = before.tasks[0];
  const material = task.study!.components[0];
  material.workloads = task.workloads; task.workloads = [];
  task.study!.components.push({ ...structuredClone(material), localId: 'other-material', label: '別の問題集', sourceText: '別の問題集',
    workloads: [{ ...structuredClone(material.workloads[0]), localId: 'other-work', sourceText: '別の問題集は20ページ' }] });
  task.effortEstimates[0].targetLocalId = material.workloads[0].localId;
  task.effortEstimates.push({ ...structuredClone(task.effortEstimates[0]), localId: 'other-rate', targetLocalId: 'other-work', minutes: 5, sourceText: '1ページ5分' });
  const userText = `${COVERAGE_USER_TEXT}。別の問題集は20ページ、1ページ5分`;
  const after = structuredClone(before); const [first, second] = after.tasks[0].effortEstimates;
  [first.targetLocalId, second.targetLocalId] = [second.targetLocalId, first.targetLocalId];
  for (const document of [before, after]) expect(validate(JSON.stringify(document), {
    currentUserText: userText, conversationArchitecture: 'interaction_v1',
  }).errors).toEqual([]);
  expect(check(before, after, userText).length).toBeGreaterThan(0);
});

// Parent R19: probe21 synthetic typed-target boundary, strict negative/control oracle.
const TEXT = '英単語100語と長文2題、長文は夜にやりたい、1語1分';
function doc(target: 'w1' | 'w2', kind: 'temporal' | 'recurrence' | 'effort'): WeeklyPlanningSemanticDocumentV5 {
  const w = (localId: string, amount: number, unitCode: string, unitLabel: string, sourceText: string) => ({ localId, quantityRole: 'target', amount, unitCode, unitLabel,
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText });
  return { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan', planningWindow: null, relations: [], availabilityDeclarations: [],
    constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [], conversationActs: [],
    tasks: [{ localId: 't', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: '英語', study: null, sourceText: TEXT,
      workloads: [w('w1', 100, 'custom', '語', '英単語100語'), w('w2', 2, 'custom', '題', '長文2題')],
      effortEstimates: kind === 'effort' ? [{ localId: 'e', targetLocalId: target, kind: 'duration_per_unit', minutes: 1, unitCode: 'custom', precision: 'approximate', sourceText: '1語1分' }] : [],
      temporalConstraints: kind === 'temporal' ? [{ localId: 'night', targetLocalId: target, kind: 'preferred_window', constraintLevel: 'soft', dateExpression: null,
        namedTimePeriod: 'night', startTime: null, endTime: null, precision: 'approximate', sourceText: '長文は夜にやりたい' }] : [],
      recurrence: kind === 'recurrence' ? [{ localId: 'r', targetLocalId: target, kind: 'custom', count: 2, days: [], sourceText: '長文2題' }] : [],
      durableContextSignals: [] }],
  } as unknown as WeeklyPlanningSemanticDocumentV5;
}
describe('critic probe 21: D(b) v4 target swap within one task', () => {
  it.each(['effort', 'temporal', 'recurrence'] as const)('%s moved from w2 to w1', (kind) => {
    const errors = preserve({ userText: TEXT, initialDocument: doc('w2', kind), retryDocument: doc('w1', kind) });
    const control = preserve({ userText: TEXT, initialDocument: doc('w2', kind), retryDocument: doc('w2', kind) });
    console.log('PROBE21', kind, JSON.stringify({ swapErrors: errors, controlErrors: control }));
    expect(errors).toEqual(['completeness-preservation:typed_facts_lost']);
    expect(control).toEqual([]);
  });
});

describe('independent material/workload associations', () => {
function fixture(equalAmounts=false){
 const before=coverageDocument(true);const task=before.tasks[0];
 const first=structuredClone(task.workloads[0]);const second={...structuredClone(first),localId:'second-work',amount:equalAmounts?20:40,sourceText:equalAmounts?'別の20ページ':'40ページ'};
 task.effortEstimates.push({...structuredClone(task.effortEstimates[0]),localId:'second-rate',targetLocalId:'second-work',minutes:5,sourceText:'1ページ5分'});
 if(equalAmounts){task.workloads=[];task.study!.components[0].workloads=[first];task.study!.components.push({...structuredClone(task.study!.components[0]),localId:'second-material',label:'別の合成演習帳',sourceText:'別の合成演習帳',workloads:[second]});}
 else task.workloads.push(second);
 const userText=COVERAGE_USER_TEXT+'。別の合成演習帳は別の20ページ、40ページ、1ページ5分';
 return {before,userText};
}
function valid(doc:WeeklyPlanningSemanticDocumentV5,userText:string){expect(validate(JSON.stringify(doc),{currentUserText:userText,conversationArchitecture:'interaction_v1'}).errors).toEqual([]);}
it.each([false,true])('rejects swapping rates between distinct typed workloads (equal amounts, different materials=%s)',equalAmounts=>{
 const {before,userText}=fixture(equalAmounts);const after=structuredClone(before);const e=after.tasks[0].effortEstimates;
 [e[0].targetLocalId,e[1].targetLocalId]=[e[1].targetLocalId,e[0].targetLocalId];valid(before,userText);valid(after,userText);
 expect(preserve({initialDocument:before,retryDocument:after,userText}).length).toBeGreaterThan(0);
});
it('accepts renamed wire IDs while preserving all workload-rate associations',()=>{
 const {before,userText}=fixture();
 const ids=new Map<string,string>();JSON.stringify(before,(key,value)=>{if(key==='localId'&&typeof value==='string')ids.set(value,`renamed-${value}`);return value;});
 const after=JSON.parse(JSON.stringify(before,(key,value)=>['localId','targetLocalId','parentLocalId'].includes(key)&&typeof value==='string'?ids.get(value)??value:value)) as WeeklyPlanningSemanticDocumentV5;
 valid(before,userText);valid(after,userText);expect(preserve({initialDocument:before,retryDocument:after,userText})).toEqual([]);
});
it('accepts moving the unchanged workload with a retained pace between component and task containers',()=>{
 const before=coverageDocument(true);const task=before.tasks[0];task.study!.components[0].workloads=task.workloads;task.workloads=[];
 const after=structuredClone(before);after.tasks[0].workloads=after.tasks[0].study!.components[0].workloads;after.tasks[0].study!.components[0].workloads=[];
 valid(before,COVERAGE_USER_TEXT);valid(after,COVERAGE_USER_TEXT);
 expect(preserve({initialDocument:before,retryDocument:after,userText:COVERAGE_USER_TEXT})).toEqual([]);
});

});

describe('independent control target associations', () => {
function fixture(equalAmounts=false){
 const before=coverageDocument(true);const task=before.tasks[0];
 const first=structuredClone(task.workloads[0]);const second={...structuredClone(first),localId:'second-work',amount:equalAmounts?20:40,sourceText:equalAmounts?'別の20ページ':'40ページ'};
 task.effortEstimates.push({...structuredClone(task.effortEstimates[0]),localId:'second-rate',targetLocalId:'second-work',minutes:5,sourceText:'1ページ5分'});
 if(equalAmounts){task.workloads=[];task.study!.components[0].workloads=[first];task.study!.components.push({...structuredClone(task.study!.components[0]),localId:'second-material',label:'別の合成演習帳',sourceText:'別の合成演習帳',workloads:[second]});}
 else task.workloads.push(second);
 const userText=COVERAGE_USER_TEXT+'。別の合成演習帳は別の20ページ、40ページ、1ページ5分';
 return {before,userText};
}
function valid(doc:WeeklyPlanningSemanticDocumentV5,userText:string){expect(validate(JSON.stringify(doc),{currentUserText:userText,conversationArchitecture:'interaction_v1'}).errors).toEqual([]);}
it('keeps an uncertainty on its original equal-sized workload under the named material',()=>{
 const {before,userText}=fixture(true);before.uncertainties=[{localId:'quantity-query',targetLocalId:'second-work',field:'quantity_role',reason:'quantity role unconfirmed',sourceText:'別の20ページ'}];
 const after=structuredClone(before);after.uncertainties[0].targetLocalId=before.tasks[0].study!.components[0].workloads[0].localId;
 valid(before,userText);valid(after,userText);expect(preserve({initialDocument:before,retryDocument:before,userText})).toEqual([]);
 expect(preserve({initialDocument:before,retryDocument:after,userText}).length).toBeGreaterThan(0);
});
it('accepts renamed uncertainty and target wire IDs when the typed target is unchanged',()=>{
 const {before,userText}=fixture(true);before.uncertainties=[{localId:'quantity-query',targetLocalId:'second-work',field:'quantity_role',reason:'quantity role unconfirmed',sourceText:'別の20ページ'}];
 const ids=new Map<string,string>();JSON.stringify(before,(key,value)=>{if(key==='localId'&&typeof value==='string')ids.set(value,`renamed-${value}`);return value;});
 const after=JSON.parse(JSON.stringify(before,(key,value)=>['localId','targetLocalId','parentLocalId'].includes(key)&&typeof value==='string'?ids.get(value)??value:value)) as WeeklyPlanningSemanticDocumentV5;
 valid(before,userText);valid(after,userText);expect(preserve({initialDocument:before,retryDocument:after,userText})).toEqual([]);
});

});

it.each(['reparented', 'wire_rename'] as const)('preserves known component parent targets: %s', mode => {
  const before = coverageDocument(false); const task = before.tasks[0];
  const first = task.study!.components[0];
  task.study!.components.push({ ...structuredClone(first), localId: 'other-parent', label: '別の問題集', workloads: [], sourceText: '別の問題集' });
  task.study!.components.push({ ...structuredClone(first), localId: 'section', parentLocalId: first.localId,
    role: 'section', label: '第1章', workloads: first.workloads, sourceText: '第1章' });
  first.workloads = [];
  const userText = `${COVERAGE_USER_TEXT}。別の問題集と第1章`;
  const after = structuredClone(before);
  if (mode === 'reparented') after.tasks[0].study!.components[2].parentLocalId = 'other-parent';
  else { after.tasks[0].study!.components[0].localId = 'renamed-parent'; after.tasks[0].study!.components[2].parentLocalId = 'renamed-parent'; }
  for (const document of [before, after]) expect(validate(JSON.stringify(document), {
    currentUserText: userText, conversationArchitecture: 'interaction_v1',
  }).errors).toEqual([]);
  expect(check(before, after, userText)).toEqual(mode === 'reparented' ? ['completeness-preservation:typed_facts_lost'] : []);
});

it('uses the same duration-unit and weekday-set meaning when a control targets a retained fact', () => {
  const before = bound();
  before.uncertainties = [{ localId: 'effort-query', targetLocalId: before.tasks[0].effortEstimates[0].localId,
    field: 'effort', reason: 'unconfirmed', sourceText: 'split' },
    { localId: 'recurrence-query', targetLocalId: before.tasks[0].recurrence[0].localId,
      field: 'recurrence', reason: 'unconfirmed', sourceText: 'split' }];
  before.tasks[0].recurrence[0].days = ['monday', 'friday'];
  const after = structuredClone(before); after.tasks[0].effortEstimates[0].unitCode = null;
  after.tasks[0].recurrence[0].days.reverse();
  expect(check(before, after)).toEqual([]);
});
