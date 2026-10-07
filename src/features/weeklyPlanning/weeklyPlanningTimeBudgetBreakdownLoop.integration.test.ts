import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './application/weeklyPlanningStableV5RuntimeSession';
import {
  createScriptedConversation,
  installScriptedWeeklyPlanningProvider,
  resetScriptedConversationRuntime,
  type ScriptedConversation,
  type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';
import type { WeeklyPlanningConversationArchitecture } from './weeklyPlanningConversationArchitecture';
import type { StudyMaterial } from '../../types/domain';

/*
 * Real-UI scenario F (2026-10-07): a vague research request whose only quantity is a stated
 * time budget never reached a preview. Replayed over the production controller, runtime,
 * validators and scheduler with a scripted transport. The measured question sequence
 * (progress → 「残り7セクションを全部／一部？」 repeated) is reproduced exactly when the
 * semantic layer types 「合計2時間」 as the task's total_duration cost: before the fix the
 * task had no schedulable work, so the registered-material scope question re-armed forever.
 */

type Json = Record<string, unknown>;
type TaskParams = Parameters<typeof researchTask>[0];

const T1 = '来週は卒研を進めたい。できれば夜';
const T2 = '合計2時間くらい';
const T3 = '卒業研究ノートです。進み具合は特に気にしなくて大丈夫';
const T4 = '一部で大丈夫。1回1時間くらいで';
const T5 = '一部にします';
const T6 = 'セクション数は決めてないので、合計2時間でお任せします';
const MEASURED = [T1, T2, T3, T4, T5, T6];

/** 「卒業研究ノート」 on the measured bookshelf: 7 of 12 sections remain. */
const NOTE: StudyMaterial = {
  id: 'material-note',
  userId: 'issue488-owner',
  name: '卒業研究ノート',
  subjectId: 'subject-research',
  subjectName: '卒業研究',
  paceEnabled: true,
  progressUnit: 'section',
  totalUnits: 12,
  currentUnit: 5,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

/** `legacy_v5` keeps the pre-#488 schema, which has no conversation acts. */
let documentArchitecture: WeeklyPlanningConversationArchitecture = 'interaction_v1';

function emptyDocument(overrides: Json = {}): Json {
  const { conversationActs: _acts, ...legacy } = emptyInteractionDocument(overrides);
  return documentArchitecture === 'legacy_v5' ? legacy : emptyInteractionDocument(overrides);
}

function emptyInteractionDocument(overrides: Json): Json {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
    conversationActs: [],
    ...overrides,
  };
}

function basePayload(call: ScriptedProviderCall): Json {
  const firstUser = call.messages.find((message) => message.role === 'user');
  try {
    return JSON.parse(firstUser?.content ?? '{}') as Json;
  } catch {
    return {};
  }
}

function summaryTaskId(call: ScriptedProviderCall): string | null {
  const summary = basePayload(call).publicStateSummary as Json | undefined;
  const id = ((summary?.tasks ?? []) as Json[])[0]?.publicId;
  return typeof id === 'string' ? id : null;
}

function noteComponent(): Json {
  return {
    localId: 'c-note', existingPublicId: null, parentLocalId: null, role: 'material', label: '卒業研究ノート',
    workloads: [], durableContextSignals: [], sourceText: '卒業研究ノート',
  };
}

function totalDuration(minutes: number, sourceText: string): Json {
  return { localId: 'e-total', targetLocalId: 't-research', kind: 'total_duration', minutes, unitCode: null, precision: 'approximate', sourceText };
}

function sessionDuration(minutes: number, sourceText: string): Json {
  return { localId: 'e-session', targetLocalId: 't-research', kind: 'session_duration', minutes, unitCode: null, precision: 'approximate', sourceText };
}

function researchTask(params: {
  existingPublicId: string | null;
  sourceText: string;
  components?: Json[];
  workloads?: Json[];
  effortEstimates?: Json[];
}): Json {
  return {
    localId: 't-research',
    existingPublicId: params.existingPublicId,
    decompositionStatus: params.existingPublicId ? 'atomic' : 'needs_breakdown',
    category: 'study',
    title: '卒研',
    study: { purpose: 'self_study', activityKind: 'other', contextLabel: null, components: params.components ?? [] },
    workloads: params.workloads ?? [],
    effortEstimates: params.effortEstimates ?? [],
    temporalConstraints: [],
    recurrence: [],
    durableContextSignals: [],
    sourceText: params.sourceText,
  };
}

function firstTurnDocument(): Json {
  return emptyDocument({
    planningIntent: 'create_plan',
    planningWindow: { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
    tasks: [researchTask({ existingPublicId: null, sourceText: '卒研を進めたい' })],
  });
}

function restate(taskId: string, sourceText: string, extra: Partial<TaskParams> = {}): Json {
  return emptyDocument({ tasks: [researchTask({ existingPublicId: taskId, sourceText, ...extra })] });
}

/**
 * The measured semantic typing: the time budget is the task's total_duration cost, the
 * material is a component without quantity, 「1回1時間」 is a session duration, and the
 * declining answers restate the task without new facts.
 */
function measuredSemantic(userText: string, taskId: string | null): Json {
  if (userText === T1 || taskId === null) return firstTurnDocument();
  if (userText === T2) return restate(taskId, '合計2時間くらい', { effortEstimates: [totalDuration(120, '合計2時間くらい')] });
  if (userText === T3) return restate(taskId, '卒業研究ノートです', { components: [noteComponent()] });
  if (userText === T4) return restate(taskId, '1回1時間くらいで', { effortEstimates: [sessionDuration(60, '1回1時間くらいで')] });
  if (userText === T5) return restate(taskId, '一部にします');
  return restate(taskId, '合計2時間でお任せします');
}

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let semantic: (userText: string, taskId: string | null) => Json = measuredSemantic;

beforeEach(() => {
  resetScriptedConversationRuntime();
  semantic = measuredSemantic;
  provider = installScriptedWeeklyPlanningProvider((call) => {
    if (call.kind === 'renderer') return 'renderer unavailable in fixture';
    if (call.kind === 'semantic_focused_contextual') {
      return JSON.stringify({
        decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null,
      });
    }
    if (call.kind === 'semantic_generic') {
      return JSON.stringify(semantic(String(basePayload(call).userText ?? ''), summaryTaskId(call)));
    }
    return JSON.stringify(emptyDocument());
  });
});

afterEach(() => {
  provider.restore();
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
});

function blockMinutes(conversation: ScriptedConversation): number[] {
  return (conversation.getState().previewCandidates ?? []).map((candidate) => candidate.durationMinutes);
}

function askedSlot(conversation: ScriptedConversation): string | null {
  const state = conversation.getState().intakeState;
  return state?.status === 'revision_pending' ? state.lastQuestionContext?.targetSlot ?? null : null;
}

async function run(
  texts: readonly string[],
  architecture: WeeklyPlanningConversationArchitecture = 'interaction_v1',
) {
  documentArchitecture = architecture;
  const conversation = createScriptedConversation({ provider, architecture, studyMaterials: [NOTE] });
  const slots: Array<string | null> = [];
  const statuses: Array<string | undefined> = [];
  for (const text of texts) {
    const turn = await conversation.submit(text);
    expect(turn.result?.failure).toBeUndefined();
    slots.push(askedSlot(conversation));
    statuses.push(conversation.getState().intakeState?.status);
  }
  return { conversation, slots, statuses };
}

describe('scenario F: a stated time budget is schedulable work (shared fix, both architectures)', () => {
  it.each(['interaction_v1', 'legacy_v5'] as const)(
    '%s: previews once the budget is stated and never asks for a content quantity again',
    async (architecture) => {
      const { conversation, slots, statuses } = await run(MEASURED, architecture);
      // Turn 1 still asks what the vague 「卒研」 work is; that question is legitimate once.
      expect(slots[0]).toBe('stable_v5:semantic_uncertainty');
      // From the stated budget on, the plan exists and no turn re-asks for a quantity.
      expect(statuses.slice(1)).toEqual(Array(5).fill('draft_ready'));
      expect(slots.slice(1)).toEqual(Array(5).fill(null));
      // Exactly the user's 2 hours. Nothing invented. (How 「1回1時間」 splits the block is
      // the separate shared session-size propagation fix, not asserted here.)
      expect(blockMinutes(conversation).reduce((sum, value) => sum + value, 0)).toBe(120);
    },
  );

  it('asks the registered-material scope once when the material comes first, then previews on the budget', async () => {
    semantic = (userText, taskId) => {
      if (taskId === null) return firstTurnDocument();
      if (userText === T3) return restate(taskId, '卒業研究ノートです', { components: [noteComponent()] });
      if (userText === T2) return restate(taskId, '合計2時間くらい', { effortEstimates: [totalDuration(120, '合計2時間くらい')] });
      return restate(taskId, 'お任せします');
    };
    const { conversation, slots, statuses } = await run([T1, T3, T2, 'お任せします']);
    expect(slots[1]).toBe('stable_v5:missing_schedulable_work');
    expect(statuses.slice(2)).toEqual(['draft_ready', 'draft_ready']);
    expect(blockMinutes(conversation).reduce((sum, value) => sum + value, 0)).toBe(120);
  });

  it('a content quantity given later takes over: the budget becomes its cost, not extra work', async () => {
    semantic = (userText, taskId) => {
      if (taskId === null) return firstTurnDocument();
      if (userText === T2) return restate(taskId, '合計2時間くらい', { effortEstimates: [totalDuration(120, '合計2時間くらい')] });
      return restate(taskId, '3セクション進める', {
        components: [{
          ...noteComponent(),
          workloads: [{
            localId: 'wl-sections', quantityRole: 'target', amount: 3, unitCode: 'section', unitLabel: 'セクション',
            rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '3セクション',
          }],
        }],
      });
    };
    const { conversation, statuses } = await run([T1, T2, '卒業研究ノートを3セクション進める']);
    expect(statuses.slice(1)).toEqual(['draft_ready', 'draft_ready']);
    // Only the 3 sections are scheduled, costed by the stated 2 hours (rounded per section by
    // the existing allocation step); the budget is never scheduled on top of them.
    const candidates = conversation.getState().previewCandidates ?? [];
    expect(candidates.map((candidate) => candidate.title)).toEqual(['卒業研究ノート 3セクション']);
    expect(blockMinutes(conversation).reduce((sum, value) => sum + value, 0)).toBeLessThan(240);
  });

  it('property: after a single positive time budget, no turn re-presents a quantity question', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        budgetMinutes: fc.integer({ min: 4, max: 12 }).map((quarterHours) => quarterHours * 15),
        materialFirst: fc.boolean(),
        sessionMinutes: fc.option(fc.constantFrom(30, 45, 60), { nil: null }),
        decliningTurns: fc.integer({ min: 1, max: 4 }),
      }),
      async ({ budgetMinutes, materialFirst, sessionMinutes, decliningTurns }) => {
        resetScriptedConversationRuntime();
        const budgetText = `合計${budgetMinutes}分くらい`;
        const sessionText = sessionMinutes ? `1回${sessionMinutes}分で` : null;
        semantic = (userText, taskId) => {
          if (taskId === null) return firstTurnDocument();
          if (userText === budgetText) return restate(taskId, budgetText, { effortEstimates: [totalDuration(budgetMinutes, budgetText)] });
          if (userText === T3) return restate(taskId, '卒業研究ノートです', { components: [noteComponent()] });
          if (sessionText && userText === sessionText) {
            return restate(taskId, sessionText, { effortEstimates: [sessionDuration(sessionMinutes!, sessionText)] });
          }
          return restate(taskId, 'お任せします');
        };
        const afterBudget = [
          ...(sessionText ? [sessionText] : []),
          ...Array.from({ length: decliningTurns }, () => 'お任せします'),
        ];
        const texts = materialFirst
          ? [T1, T3, budgetText, ...afterBudget]
          : [T1, budgetText, T3, ...afterBudget];
        const budgetIndex = texts.indexOf(budgetText);
        const { conversation, slots, statuses } = await run(texts);
        expect(slots.slice(budgetIndex)).toEqual(Array(texts.length - budgetIndex).fill(null));
        expect(statuses.slice(budgetIndex).every((status) => status === 'draft_ready')).toBe(true);
        expect(blockMinutes(conversation).reduce((sum, value) => sum + value, 0)).toBe(budgetMinutes);
      },
    ), { numRuns: 25 });
  });
});
