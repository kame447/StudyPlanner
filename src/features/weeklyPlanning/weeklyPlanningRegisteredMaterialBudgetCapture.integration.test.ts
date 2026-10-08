import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createScriptedConversation,
  installScriptedWeeklyPlanningProvider,
  resetScriptedConversationRuntime,
} from './testUtils/weeklyPlanningScriptedConversationHarness';
import { createWeeklyPlanningSemanticNormalizerV5 } from './semantic/weeklyPlanningSemanticNormalizerV5';
import { WeeklyPlanningSemanticNormalizerRunV5 } from './semantic/weeklyPlanningSemanticNormalizerRunV5';
import { tryWeeklyPlanningDenseTurnCompletenessRetryV5 } from './semantic/weeklyPlanningSemanticDenseTurnCompletenessV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './semantic/weeklyPlanningSemanticTypesV5';
import {
  REGISTERED_MATERIAL_BUDGET_CAPTURE as capture,
  REGISTERED_MATERIAL_BUDGET_MATERIALS as materials,
} from './testUtils/weeklyPlanningRegisteredMaterialBudgetCaptureFixture';

type Json = Record<string, unknown>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const typedAudit = (mixed = false) => ({ ...clone(capture.audit),
  ...(mixed ? { missingFacts: [...capture.audit.missingFacts, 'a separate omitted proposition'] } : {}),
  timeBudgets: [{ kind: 'registered_material_timebox', omissionIndex: 0, materialLabel: '合成研究メモ',
    amount: 2, unitCode: 'hour', valueText: '2', precision: 'exact', sourceText: '合成研究メモを2時間進めたい' }],
  otherMissingFactIndexes: mixed ? [1] : [],
});
const summary = () => ({ tasks: [], components: [], workloads: [], registeredMaterials:
  materials.map(material => ({ materialId: material.id, name: material.name, aliases: [] })) });

function timeTask(minutes: number | null): Json {
  return {
    ...clone(capture.splitDocument.tasks[1]),
    localId: 'task-note',
    existingPublicId: materials[0].id,
    sourceText: minutes === null ? '合成研究メモを進めたい' : '合成研究メモを2時間進めたい',
    effortEstimates: minutes === null ? [] : [{
      localId: 'note-budget', targetLocalId: 'task-note', kind: 'total_duration',
      minutes, unitCode: null, precision: 'approximate', sourceText: '2時間進めたい',
    }],
  };
}

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider> | undefined;
beforeEach(resetScriptedConversationRuntime);
afterEach(() => {
  provider?.restore();
  provider = undefined;
  resetScriptedConversationRuntime();
});

describe('registered material: captured omitted budget and content-scope boundary', () => {
  it('retains the omitted 2h task when the captured initial and reread documents both contain only the page task', async () => {
    let genericCalls = 0;
    const calls: string[] = [];
    const result = await createWeeklyPlanningSemanticNormalizerV5({
      async createChatCompletion(input) {
        const name = input.responseFormat?.json_schema.name ?? '';
        calls.push(name);
        if (name === 'weekly_planning_dense_turn_completeness_audit_v5') return JSON.stringify(typedAudit());
        genericCalls += 1;
        return JSON.stringify(genericCalls === 1 ? capture.initialDocument : capture.rereadDocument);
      },
    }).normalize({
      userText: capture.initialUserText, conversationArchitecture: 'interaction_v1',
      publicStateSummary: summary(),
    });
    expect(result.status).toBe('accepted');
    const note = result.document?.tasks.find(task => task.title === '合成研究メモ');
    expect(note?.effortEstimates).toEqual([expect.objectContaining({ kind: 'total_duration', minutes: 120 })]);
    expect(note?.workloads).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(result.diagnostics.repairAttempted).toBe(false);
  });

  it('keeps the legacy audit request and schema unchanged and ignores the typed completion', async () => {
    const doc: Json = clone(capture.initialDocument) as unknown as Json;
    delete doc.conversationActs;
    (doc.tasks as Json[])[0].existingPublicId = null;
    let calls = 0;
    let auditSystem = '';
    let required: unknown;
    const result = await createWeeklyPlanningSemanticNormalizerV5({ async createChatCompletion(input) {
      calls += 1;
      if (input.responseFormat?.json_schema.name === 'weekly_planning_dense_turn_completeness_audit_v5') {
        auditSystem = input.messages[0].content;
        required = input.responseFormat.json_schema.schema.required;
        return JSON.stringify(typedAudit());
      }
      return JSON.stringify(doc);
    } }).normalize({ userText: Array(20).fill(capture.initialUserText).join('。'),
      conversationArchitecture: 'legacy_v5', publicStateSummary: summary() });
    expect(result.status).toBe('accepted');
    expect(result.document?.tasks.map(task => task.title)).toEqual(['合成演習帳']);
    expect(calls).toBe(3);
    expect(required).toEqual(['decision', 'missingFacts']);
    expect(auditSystem.split('\n')[0]).toBe('Audit semantic coverage only. Do not schedule, repair, rewrite, or add meaning.');
    expect(auditSystem).not.toContain('registered_material_timebox');
  });

  it('keeps the spent repair flag when the audit adds a timebox without another repair', async () => {
    const doc = clone(capture.initialDocument) as unknown as WeeklyPlanningSemanticDocumentV5;
    doc.tasks[0].existingPublicId = null;
    let calls = 0;
    const run = new WeeklyPlanningSemanticNormalizerRunV5({ async createChatCompletion(input) {
      calls += 1;
      if (input.responseFormat?.json_schema.name !== 'weekly_planning_dense_turn_completeness_audit_v5') throw new Error('Unexpected extra repair');
      return JSON.stringify(typedAudit());
    } }, { userText: capture.initialUserText, conversationArchitecture: 'interaction_v1', publicStateSummary: summary() });
    const result = await tryWeeklyPlanningDenseTurnCompletenessRetryV5({
      run, baseMessages: [], initialResponse: JSON.stringify(doc), initialDocument: doc, semanticRepairConsumed: () => true,
    });
    expect(result?.status).toBe('accepted');
    expect(result?.document?.tasks[1].effortEstimates[0].minutes).toBe(120);
    expect(result?.diagnostics.repairAttempted).toBe(true);
    expect(calls).toBe(1);
  });

  it('keeps the exact page task and typed audit budget through the captured pace turn', async () => {
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return 'fixture renderer unavailable';
      if (call.schemaName === 'weekly_planning_dense_turn_completeness_audit_v5') return JSON.stringify(typedAudit());
      if (call.kind === 'semantic_focused_contextual') return JSON.stringify(capture.paceAnswer);
      if (call.kind === 'semantic_generic') return JSON.stringify(capture.initialDocument);
      throw new Error(`Unexpected provider schema ${call.schemaName}`);
    }, { completenessAudit: 'scripted' });
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', studyMaterials: materials });
    const first = await conversation.submit(capture.initialUserText);
    expect(first.result?.failure).toBeUndefined();
    expect(first.calls.map(call => call.schemaName)).toEqual([
      'weekly_planning_semantic_document_v5', 'weekly_planning_dense_turn_completeness_audit_v5', 'weekly_planning_stable_v5_dialogue_response',
    ]);
    const second = await conversation.submit(capture.paceUserText);
    expect(second.result?.failure).toBeUndefined();
    expect(second.calls.map(call => call.kind)).toEqual(['semantic_focused_contextual', 'renderer']);
    expect(conversation.getState().intakeState?.status).toBe('draft_ready');
    const graph = conversation.graph()!;
    expect(graph.workloads).toEqual([expect.objectContaining({ amount: 20, unitCode: 'page' })]);
    expect(graph.effortEstimates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'total_duration', minutes: 120, source: expect.objectContaining({ origin: 'user' }) }),
      expect.objectContaining({ kind: 'duration_per_unit', minutes: 3 }),
    ]));
    expect((conversation.getState().previewCandidates ?? []).filter(candidate => candidate.title.includes('合成研究メモ'))
      .reduce((sum, candidate) => sum + candidate.durationMinutes, 0)).toBe(120);
  });

  it.each(['missing', 'supplied', 'repair', 'invalid_repair'] as const)(
    'retains normalizer precedence and one repair when another omission requires a reread: %s', async mode => {
      let index = 0;
      const repairedDoc: Json = { ...clone(capture.rereadDocument) };
      const rereadDoc: Json = mode === 'supplied'
        ? { ...clone(capture.rereadDocument), tasks: [...clone(capture.rereadDocument.tasks), timeTask(120)] }
        : repairedDoc;
      const replies = [JSON.stringify(capture.initialDocument), JSON.stringify(typedAudit(true)),
        mode === 'repair' || mode === 'invalid_repair' ? 'invalid json' : JSON.stringify(rereadDoc),
        mode === 'invalid_repair' ? 'invalid json' : JSON.stringify(repairedDoc)];
      const result = await createWeeklyPlanningSemanticNormalizerV5({ async createChatCompletion() {
        const reply = replies[index++]; if (reply === undefined) throw new Error('Unexpected extra repair'); return reply;
      } }).normalize({ userText: capture.initialUserText, conversationArchitecture: 'interaction_v1', publicStateSummary: summary() });
      const repair = mode === 'repair' || mode === 'invalid_repair';
      expect(index).toBe(repair ? 4 : 3);
      expect(result.diagnostics.repairAttempted).toBe(repair);
      if (mode === 'invalid_repair') {
        expect(result.document).toBeNull();
      } else {
        expect(result.status).toBe('accepted');
        const notes = result.document?.tasks.filter(task => task.title === '合成研究メモ');
        expect(notes).toHaveLength(1);
        expect(notes?.[0].effortEstimates).toEqual([expect.objectContaining({ minutes: 120 })]);
        expect(result.document?.tasks[0].workloads).toEqual(capture.initialDocument.tasks[0].workloads);
        if (mode === 'supplied') expect(notes?.[0].localId).toBe('task-note');
      }
    },
  );

  it.each([false, true])('applies retention before complement when a reread loses the captured page work (repair=%s)', async repair => {
    const lossy = { ...clone(capture.initialDocument), tasks: [timeTask(120)] };
    const responses = [JSON.stringify(capture.initialDocument), JSON.stringify(typedAudit(true)),
      repair ? 'invalid json' : JSON.stringify(lossy), JSON.stringify(lossy)];
    let count = 0;
    const result = await createWeeklyPlanningSemanticNormalizerV5({ async createChatCompletion() {
      const response = responses[count++]; if (response === undefined) throw new Error('Unexpected second repair'); return response;
    } }).normalize({ userText: capture.initialUserText, conversationArchitecture: 'interaction_v1', publicStateSummary: summary() });
    expect(count).toBe(repair ? 4 : 3);
    expect(result.diagnostics.repairAttempted).toBe(repair);
    expect(result).toMatchObject({ status: 'accepted', completenessAbstention: { reason: 'initial_facts_not_preserved' } });
    expect(result.document?.tasks[0].workloads).toEqual(capture.initialDocument.tasks[0].workloads);
    expect(result.document?.tasks.filter(task => task.title === '合成研究メモ')).toHaveLength(1);
    expect(result.document?.tasks[1].effortEstimates[0].minutes).toBe(120);
  });

  it.each(['component_dropped', 'label_changed', 'category_flipped', 'container_move_control'] as const)(
    'keeps material identity before the additive budget: %s', async mode => {
      const initial = clone(capture.initialDocument) as unknown as WeeklyPlanningSemanticDocumentV5;
      const task = initial.tasks[0]; task.existingPublicId = null;
      task.study!.components = [{ localId: 'page-material', existingPublicId: null, parentLocalId: null,
        role: 'material', label: '合成演習帳', workloads: task.workloads, durableContextSignals: [], sourceText: '合成演習帳' }];
      task.workloads = [];
      const reread = clone(initial); const changed = reread.tasks[0];
      changed.workloads = changed.study!.components[0].workloads;
      changed.study!.components[0].workloads = [];
      if (mode === 'component_dropped') changed.study!.components = [];
      if (mode === 'label_changed') { changed.study!.components[0].label = '合成研究メモ'; changed.study!.components[0].sourceText = '合成研究メモ'; }
      if (mode === 'category_flipped') { changed.category = 'non_study'; changed.study = null; }
      const responses = [JSON.stringify(initial), JSON.stringify(typedAudit(true)), JSON.stringify(reread)];
      let count = 0;
      const result = await createWeeklyPlanningSemanticNormalizerV5({ async createChatCompletion() {
        const response = responses[count++]; if (response === undefined) throw new Error('Unexpected repair'); return response;
      } }).normalize({ userText: capture.initialUserText, conversationArchitecture: 'interaction_v1', publicStateSummary: summary() });
      expect(count).toBe(3);
      expect(result.status).toBe('accepted');
      expect(result.diagnostics.repairAttempted).toBe(false);
      expect(result.completenessAbstention).toEqual(mode === 'container_move_control' ? undefined : { reason: 'initial_facts_not_preserved' });
      expect(result.document?.tasks[0]).toMatchObject({ category: 'study', study: { components: [expect.objectContaining({ role: 'material', label: '合成演習帳' })] } });
      const pageTask = result.document!.tasks[0];
      expect([...pageTask.workloads, ...pageTask.study!.components.flatMap(component => component.workloads)])
        .toEqual(initial.tasks[0].study!.components[0].workloads);
      expect(result.document?.tasks.filter(candidate => candidate.title === '合成研究メモ')).toHaveLength(1);
      expect(result.document?.tasks[1].effortEstimates[0].minutes).toBe(120);
    },
  );

  it('a valid task-level 2h interpretation is sufficient despite seven remaining registered sections', async () => {
    const doc: Json = { ...clone(capture.initialDocument), tasks: [timeTask(120)] };
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return 'fixture renderer unavailable';
      if (call.kind === 'semantic_generic') return JSON.stringify(doc);
      throw new Error(`Unexpected provider schema ${call.schemaName}`);
    });
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', studyMaterials: materials });
    const turn = await conversation.submit('来週、合成研究メモを2時間進めたい');
    expect(turn.result?.failure).toBeUndefined();
    expect(conversation.getState().intakeState?.status).toBe('draft_ready');
    expect(conversation.graph()?.effortEstimates).toEqual([expect.objectContaining({ minutes: 120 })]);
    // No material-content count is manufactured from the registered remaining units.
    expect(conversation.graph()?.workloads).toEqual([]);
    expect((conversation.getState().previewCandidates ?? []).reduce((sum, candidate) => sum + candidate.durationMinutes, 0)).toBe(120);
  });

  it('an ambiguous registered-material request without a time budget still asks for work scope', async () => {
    const doc: Json = { ...clone(capture.initialDocument), tasks: [timeTask(null)] };
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return 'fixture renderer unavailable';
      if (call.kind === 'semantic_generic') return JSON.stringify(doc);
      throw new Error(`Unexpected provider schema ${call.schemaName}`);
    });
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', studyMaterials: materials });
    const turn = await conversation.submit('来週、合成研究メモを進めたい');
    expect(turn.result?.failure).toBeUndefined();
    const state = conversation.getState().intakeState;
    expect(state?.status).toBe('revision_pending');
    expect(state?.status === 'revision_pending' ? state.lastQuestionContext?.targetSlot : null).toBe('stable_v5:missing_schedulable_work');
    expect(conversation.getState().previewCandidates ?? []).toEqual([]);
    expect(conversation.graph()?.effortEstimates).toEqual([]);
  });
});
