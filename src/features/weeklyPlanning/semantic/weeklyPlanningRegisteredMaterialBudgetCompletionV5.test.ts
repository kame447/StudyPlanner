import { describe, expect, it } from 'vitest';
import { REGISTERED_MATERIAL_BUDGET_CAPTURE as capture } from '../testUtils/weeklyPlanningRegisteredMaterialBudgetCaptureFixture';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticTypesV5';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import {
  addRegisteredMaterialBudgetCompletionV5,
  applyValidatedRegisteredMaterialBudgetCompletionV5,
  parseRegisteredMaterialBudgetCompletionV5,
  registeredMaterialBudgetAccountsForAllOmissionsV5,
  registeredMaterialBudgetAuditFormatV5,
  registeredMaterialBudgetAuditLabelsV5,
  type RegisteredMaterialBudgetCompletionV5,
} from './weeklyPlanningRegisteredMaterialBudgetCompletionV5';

const document = (): WeeklyPlanningSemanticDocumentV5 => JSON.parse(JSON.stringify(capture.initialDocument));
const state = () => ({ tasks: [], components: [], workloads: [], registeredMaterials: [
  { materialId: 'fixture-material-1', name: '合成研究メモ', aliases: ['合成メモ'] },
  { materialId: 'fixture-material-2', name: '合成演習帳', aliases: [] },
] });
const completion = (): RegisteredMaterialBudgetCompletionV5 => ({
  timeBudgets: [{ kind: 'registered_material_timebox', omissionIndex: 0, materialLabel: '合成研究メモ',
    amount: 2, unitCode: 'hour', valueText: '2', minutes: 120, precision: 'exact', sourceText: '合成研究メモを2時間進めたい' }],
  otherMissingFactIndexes: [],
});
const audit = (change: object = {}) => {
  const value = { ...capture.audit, ...completion(), ...change };
  return JSON.stringify({ ...value, timeBudgets: value.timeBudgets.map(budget => {
    const { minutes: _minutes, ...raw } = budget;
    return raw;
  }) });
};
function add(change: Partial<Parameters<typeof addRegisteredMaterialBudgetCompletionV5>[0]> = {}) {
  return addRegisteredMaterialBudgetCompletionV5({ document: document(), completion: completion(),
    currentUserText: capture.initialUserText, publicStateSummary: state(), ...change });
}

describe('typed registered-material time-budget completion', () => {
  it('adds only the missing time task and validates the merged document through the full boundary', () => {
    const before = document();
    const result = add({ document: before });
    expect(result.acceptedOmissionIndexes).toEqual([0]);
    expect(result.document.tasks).toHaveLength(2);
    expect(result.document.tasks[0]).toBe(before.tasks[0]);
    expect(before.tasks).toHaveLength(1);
    expect(result.document.tasks[1]).toMatchObject({
      title: '合成研究メモ', existingPublicId: null, decompositionStatus: 'atomic', workloads: [],
      study: { purpose: 'unknown', activityKind: 'unknown', components: [] },
      effortEstimates: [{ kind: 'total_duration', minutes: 120, precision: 'exact' }],
    });
    expect(validateWeeklyPlanningSemanticResponseV5(JSON.stringify(result.document), {
      currentUserText: capture.initialUserText, publicStateSummary: state(), conversationArchitecture: 'interaction_v1',
    }).errors).toEqual([]);
  });

  it('keeps scope ambiguous when the audit has no typed budget, without reading the missingFacts prose', () => {
    expect(parseRegisteredMaterialBudgetCompletionV5(JSON.stringify(capture.audit), 1)).toBeNull();
    const c = { timeBudgets: [], otherMissingFactIndexes: [0] };
    const before = document();
    expect(add({ document: before, completion: c }).document).toBe(before);
    expect(registeredMaterialBudgetAccountsForAllOmissionsV5(c, [])).toBe(false);
  });

  it('discards a merge rejected by the full existing boundary and never asks AI to repair it', () => {
    const before = document(); before.uncertainties.push({ localId: 'bad', targetLocalId: 'absent',
      field: 'material_identity', reason: 'unknown', sourceText: '合成研究メモ' });
    const result = applyValidatedRegisteredMaterialBudgetCompletionV5({ document: before, completion: completion(),
      input: { currentUserText: capture.initialUserText, publicStateSummary: state(), conversationArchitecture: 'interaction_v1' } });
    expect(result.document).toBe(before);
    expect(result.acceptedOmissionIndexes).toEqual([]);
    expect(result.decisions).toEqual([expect.objectContaining({ outcome: 'dropped', reason: 'validation' })]);
  });

  it('leaves legacy document bytes unchanged even if typed timebox data is supplied', () => {
    const before = document(); const bytes = JSON.stringify(before);
    const result = applyValidatedRegisteredMaterialBudgetCompletionV5({ document: before, completion: completion(),
      input: { currentUserText: capture.initialUserText, publicStateSummary: state(), conversationArchitecture: 'legacy_v5' } });
    expect(result.document).toBe(before);
    expect(JSON.stringify(result.document)).toBe(bytes);
    expect(result.decisions).toEqual([]);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])('rejects invalid minute budget %s', minutes => {
    const c = completion(); c.timeBudgets[0].minutes = minutes;
    c.timeBudgets[0].amount = minutes; c.timeBudgets[0].unitCode = 'minute';
    c.timeBudgets[0].valueText = String(minutes);
    expect(parseRegisteredMaterialBudgetCompletionV5(audit(c), 1)).toBeNull();
    expect(add({ completion: c }).acceptedOmissionIndexes).toEqual([]);
  });

  it.each(['', '   ', '\u200b\u200d', '。！？'])('rejects empty normalized source or label %j', value => {
    const c = completion(); c.timeBudgets[0].sourceText = value;
    expect(parseRegisteredMaterialBudgetCompletionV5(audit(c), 1)).toBeNull();
    c.timeBudgets[0].sourceText = '合成研究メモを2時間進めたい'; c.timeBudgets[0].materialLabel = value;
    expect(parseRegisteredMaterialBudgetCompletionV5(audit(c), 1)).toBeNull();
  });

  it('requires literal current-turn evidence tying the registered label to its budget source', () => {
    expect(add({ currentUserText: '合成演習帳を20ページ読む' }).acceptedOmissionIndexes).toEqual([]);
    const c = completion(); c.timeBudgets[0].sourceText = '合成研究メモを3時間進めたい';
    expect(add({ completion: c }).acceptedOmissionIndexes).toEqual([]);
    c.timeBudgets[0].sourceText = '2時間';
    expect(add({ completion: c }).acceptedOmissionIndexes).toEqual([]);
  });

  it('does not consult another owner or resolve duplicate registered labels', () => {
    expect(add({ publicStateSummary: { registeredMaterials: [] } }).acceptedOmissionIndexes).toEqual([]);
    const s = state(); s.registeredMaterials.push({ materialId: 'fixture-material-other', name: '合成研究メモ', aliases: [] });
    expect(add({ publicStateSummary: s }).acceptedOmissionIndexes).toEqual([]);
    expect(registeredMaterialBudgetAuditLabelsV5(s)).not.toContain('合成研究メモ');
  });

  it('drops a partial-label task whose literal source span already covers the timebox', () => {
    const before = document(); before.tasks[0] = { ...before.tasks[0], title: '研究メモを進める', sourceText: '合成研究メモを2時間進めたい' };
    expect(add({ document: before }).document).toBe(before);
    expect(add({ document: before }).acceptedOmissionIndexes).toEqual([]);
  });

  it('checks active committed facts even when a public summary omitted them', () => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    graph.tasks = [{ id: 'accepted-note', category: 'study', title: '合成研究メモ', createdRevision: 1,
      source: { conversationId: 'c', turnId: 't', semanticLocalId: 'note', sourceText: '合成研究メモ', origin: 'user' } }];
    graph.factLifecycles = [{ factId: 'accepted-note', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null }];
    expect(add({ committedGraph: graph }).acceptedOmissionIndexes).toEqual([]);
    graph.factLifecycles[0] = { ...graph.factLifecycles[0], status: 'removed', terminalRevision: 2 };
    expect(add({ committedGraph: graph }).acceptedOmissionIndexes).toEqual([0]);
  });

  it('validates the own numeric evidence and converts only the typed minute/hour unit', () => {
    const c = completion();
    expect(parseRegisteredMaterialBudgetCompletionV5(audit(), 1)?.timeBudgets[0].minutes).toBe(120);
    c.timeBudgets[0].amount = 120;
    expect(parseRegisteredMaterialBudgetCompletionV5(audit(c), 1)).toBeNull();
    c.timeBudgets[0].amount = 2; c.timeBudgets[0].valueText = '20';
    expect(parseRegisteredMaterialBudgetCompletionV5(audit(c), 1)).toBeNull();
    c.timeBudgets[0].valueText = '2'; c.timeBudgets[0].unitCode = 'minute';
    expect(parseRegisteredMaterialBudgetCompletionV5(audit(c), 1)?.timeBudgets[0].minutes).toBe(2);
  });

  it('rejects a numeric subtoken and an unregistered label without inventing a new scope', () => {
    const c = completion(); c.timeBudgets[0].sourceText = '合成研究メモを12時間進めたい';
    expect(parseRegisteredMaterialBudgetCompletionV5(audit(c), 1)).toBeNull();
    c.timeBudgets[0].sourceText = '未登録メモを2時間進めたい'; c.timeBudgets[0].materialLabel = '未登録メモ';
    expect(add({ completion: c, currentUserText: '来週、未登録メモを2時間進めたい' }).decisions).toEqual([
      expect.objectContaining({ outcome: 'dropped', reason: 'ambiguous_material' }),
    ]);
  });

  it('rejects an overlong numeric citation even when it has a valid positive numeric value', () => {
    const c = completion(); c.timeBudgets[0].valueText = `${'0'.repeat(40)}2`;
    c.timeBudgets[0].sourceText = `合成研究メモを${c.timeBudgets[0].valueText}時間進めたい`;
    expect(parseRegisteredMaterialBudgetCompletionV5(audit(c), 1)).toBeNull();
  });

  it('does not invent a second task for an existing title, bookshelf binding, or material component', () => {
    for (const task of [
      { ...document().tasks[0], title: '合成研究メモ' },
      { ...document().tasks[0], existingPublicId: 'fixture-material-1' },
      { ...document().tasks[0], study: { purpose: 'unknown' as const, contextLabel: null, components: [{
        localId: 'material', parentLocalId: null, role: 'material' as const, label: '合成メモ', workloads: [], sourceText: '合成メモ',
      }] } },
    ]) {
      const before = { ...document(), tasks: [task] };
      expect(add({ document: before }).document).toBe(before);
      expect(add({ document: before }).acceptedOmissionIndexes).toEqual([]);
    }
    expect(add({ publicStateSummary: { ...state(), tasks: [{ publicId: 'accepted-note', title: '合成研究メモ' }] } }).acceptedOmissionIndexes).toEqual([]);
  });

  it('drops competing complements for the same material even when they use different exact aliases', () => {
    const c = completion(); c.timeBudgets.push({ ...c.timeBudgets[0], omissionIndex: 1, materialLabel: '合成メモ', sourceText: '合成メモを2時間進めたい' });
    expect(add({ completion: c, currentUserText: `${capture.initialUserText}。合成メモを2時間進めたい` }).acceptedOmissionIndexes).toEqual([]);
  });

  it('preserves discuss/correction decisions rather than manufacturing planning work', () => {
    const before = { ...document(), planningIntent: 'discuss' as const };
    expect(add({ document: before }).document).toBe(before);
  });

  it('does not collide with existing local ids', () => {
    const before = document(); before.tasks[0].localId = 'registered-budget-task-0';
    const added = add({ document: before }).document.tasks[1];
    expect(added.localId).not.toBe(before.tasks[0].localId);
    expect(added.effortEstimates[0].targetLocalId).toBe(added.localId);
  });
});

describe('audit omission accounting and legacy-format isolation', () => {
  it('skips reread only after every typed omission was accepted', () => {
    const c = parseRegisteredMaterialBudgetCompletionV5(audit(), 1)!;
    expect(registeredMaterialBudgetAccountsForAllOmissionsV5(c, [0])).toBe(true);
    expect(registeredMaterialBudgetAccountsForAllOmissionsV5(c, [])).toBe(false);
    const mixed = parseRegisteredMaterialBudgetCompletionV5(audit({ missingFacts: ['time task', 'timing'], otherMissingFactIndexes: [1] }), 2)!;
    expect(registeredMaterialBudgetAccountsForAllOmissionsV5(mixed, [0])).toBe(false);
  });

  it.each([
    { otherMissingFactIndexes: [0] },
    { timeBudgets: [] },
    { otherMissingFactIndexes: [2] },
    { otherMissingFactIndexes: [0.5] },
    { timeBudgets: [{ ...completion().timeBudgets[0], kind: 'session_duration' }] },
    { timeBudgets: [{ ...completion().timeBudgets[0], progress: 7 }] },
  ])('rejects ambiguous, incomplete, or unsupported typed accounting %j', change => {
    expect(parseRegisteredMaterialBudgetCompletionV5(audit(change), 1)).toBeNull();
  });

  it('leaves the original audit schema untouched when building the interaction schema', () => {
    const base = { type: 'json_schema' as const, json_schema: { name: 'audit', strict: true,
      schema: { type: 'object', additionalProperties: false, required: ['decision', 'missingFacts'], properties: { decision: {}, missingFacts: {} } } } };
    const bytes = JSON.stringify(base);
    const next = registeredMaterialBudgetAuditFormatV5(base);
    expect(JSON.stringify(base)).toBe(bytes);
    expect(next.json_schema.schema.required).toEqual(['decision', 'missingFacts', 'timeBudgets', 'otherMissingFactIndexes']);
  });
});
