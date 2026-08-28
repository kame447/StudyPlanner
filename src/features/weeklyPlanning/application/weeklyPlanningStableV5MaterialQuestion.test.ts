import { afterEach, describe, expect, it } from 'vitest';
import type { StudyMaterial } from '../../../types/domain';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import {
  resetWeeklyPlanningRegisteredMaterialRuntimeForTestV5,
  setWeeklyPlanningRegisteredMaterialRuntimeV5,
} from '../semantic/weeklyPlanningRegisteredMaterialContextV5';
import { renderStableV5RuntimeQuestion } from './weeklyPlanningStableV5RuntimeQuestions';

const OWNER = 'owner-1';

function graph(): WeeklyPlanningFactGraphV5 {
  const empty = createEmptyWeeklyPlanningFactGraphV5();
  return {
    ...empty,
    revision: 1,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '数学IA・IIBC 基礎問題精講',
      source: {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        semanticLocalId: 'task-1',
        sourceText: '基礎問題精講を一周したい',
        origin: 'user',
      },
      createdRevision: 1,
    }],
    components: [{
      id: 'component-material',
      taskId: 'task-1',
      parentComponentId: null,
      role: 'material',
      label: '基礎問題精講',
      source: {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        semanticLocalId: 'component-material',
        sourceText: '基礎問題精講',
        origin: 'user',
      },
      createdRevision: 1,
    }],
    uncertainties: [{
      id: 'uncertainty-1',
      targetFactId: 'task-1',
      field: 'work_breakdown',
      reason: '教材の量が未確定',
      source: {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        semanticLocalId: 'uncertainty-1',
        sourceText: '基礎問題精講を一周したい',
        origin: 'user',
      },
      createdRevision: 1,
    }],
    factLifecycles: [
      {
        factId: 'task-1',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: 'component-material',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: 'uncertainty-1',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
    ],
  };
}

function material(overrides: Partial<StudyMaterial> = {}): StudyMaterial {
  return {
    id: 'material-1',
    userId: OWNER,
    name: '基礎問題精講',
    subjectId: 'subject-math',
    subjectName: '数学',
    progressUnit: 'page',
    totalUnits: 300,
    currentUnit: 120,
    status: 'active',
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => resetWeeklyPlanningRegisteredMaterialRuntimeForTestV5());

describe('Stable V5 material questions', () => {
  it('reuses registered total/current instead of asking the user for known values', () => {
    setWeeklyPlanningRegisteredMaterialRuntimeV5({ ownerId: OWNER, materials: [material()] });

    const message = renderStableV5RuntimeQuestion(
      graph(),
      {
        domain: 'semantic_uncertainty',
        code: 'semantic_uncertainty',
        factId: 'uncertainty-1',
        details: {},
      },
      OWNER,
    );

    expect(message).toContain('全300ページ');
    expect(message).toContain('現在120ページ');
    expect(message).not.toContain('ざっくり');
    expect(message).not.toContain('何ページくらい');
  });

  it('asks a concrete count-and-progress question when the material is not registered', () => {
    const message = renderStableV5RuntimeQuestion(
      graph(),
      {
        domain: 'semantic_uncertainty',
        code: 'semantic_uncertainty',
        factId: 'uncertainty-1',
        details: {},
      },
      OWNER,
    );

    expect(message).toContain('何ページくらい');
    expect(message).toContain('問題数');
    expect(message).toContain('今どこまで');
    expect(message).not.toContain('ざっくり');
    expect(message).not.toContain('100%');
  });
});
