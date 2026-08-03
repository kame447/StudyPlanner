import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  createGroundedCreationAuthorizationDocumentV5,
} from './weeklyPlanningCreationAuthorizationV5';
import {
  createWeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';

describe('Stable V5 creation authorization grounding', () => {
  it.each([
    'この条件で予定を作って',
    'その内容で仮予定を作成してください',
    'これでスケジュールを組んでほしい',
    'この設定のまま予定作成をお願いします',
  ])('recognizes pure authorization across surface forms: %s', (userText) => {
    expect(createGroundedCreationAuthorizationDocumentV5(userText)).toMatchObject({
      planningIntent: 'create_plan',
      planningWindow: null,
      tasks: [],
      relations: [],
      uncertainties: [],
      corrections: [],
    });
  });

  it.each([
    'この条件で明日の予定を作って',
    'この内容で英語を2時間追加して予定を作って',
    '条件を変えて予定を作って',
    'それでお願いします',
  ])('leaves authorization mixed with new meaning on the normal semantic path: %s', (userText) => {
    expect(createGroundedCreationAuthorizationDocumentV5(userText)).toBeNull();
  });

  it('ignores a copied malformed provider document for pure authorization', async () => {
    const copiedStateWithDuplicateWorkload = JSON.stringify({
      schemaVersion: 'weekly-planning-semantic-v5',
      planningIntent: 'create_plan',
      planningWindow: {
        localId: 'window-1',
        kind: 'relative_day',
        value: 'tomorrow',
        start: null,
        end: null,
        sourceText: '明日',
      },
      tasks: [{
        localId: 'task-1',
        category: 'study',
        title: '問題集',
        study: {
          purpose: 'practice',
          contextLabel: null,
          components: [{
            localId: 'component-1',
            parentLocalId: null,
            role: 'material',
            label: '問題集',
            workloads: [{
              localId: 'workload-1',
              quantityRole: 'target',
              amount: 10,
              unitCode: 'problem',
              unitLabel: '問',
              rangeStart: null,
              rangeEnd: null,
              perOccurrence: false,
              periodExpression: null,
              sourceText: '問題集を10問',
            }],
            sourceText: '問題集',
          }],
        },
        workloads: [{
          localId: 'workload-1',
          quantityRole: 'target',
          amount: 10,
          unitCode: 'problem',
          unitLabel: '問',
          rangeStart: null,
          rangeEnd: null,
          perOccurrence: false,
          periodExpression: null,
          sourceText: '問題集を10問',
        }],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        sourceText: '問題集を10問',
      }],
      relations: [],
      availabilityDeclarations: [],
      constraintSourceRequests: [],
      uncertainties: [],
      corrections: [],
      decisions: [],
    });
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => copiedStateWithDuplicateWorkload),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: 'この条件で予定を作って',
      publicStateSummary: {
        graphRevision: 2,
        tasks: [{ publicId: 'task-1', title: '問題集' }],
      },
    });

    expect(result).toMatchObject({
      status: 'accepted',
      document: {
        planningIntent: 'create_plan',
        planningWindow: null,
        tasks: [],
      },
      diagnostics: {
        attemptCount: 1,
        repairAttempted: false,
        validationErrors: [],
        algorithmicRepairs: [
          'creation-authorization-grounded-from-user-text',
        ],
      },
    });
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);

    const request = vi.mocked(client.createChatCompletion).mock.calls[0][0];
    const system = request.messages[0]?.content ?? '';
    expect(system).not.toContain('without repeating accepted facts');
    expect(system).not.toContain('Do not copy accepted tasks');
  });
});
