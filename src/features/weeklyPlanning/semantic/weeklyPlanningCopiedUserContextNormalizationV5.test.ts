import { describe, expect, it } from 'vitest';
import {
  normalizeCopiedUserContextDeltaV5,
} from './weeklyPlanningCopiedUserContextNormalizationV5';

function normalize(params: {
  userText: string;
  document: Record<string, unknown>;
}) {
  return normalizeCopiedUserContextDeltaV5({
    rawResponse: JSON.stringify(params.document),
    userText: params.userText,
    publicStateSummary: {
      userPlanningContext: [
        {
          id: 'concern-math',
          kind: 'concern',
          label: '数学',
          value: '結構まずい',
          dateExpression: null,
        },
        {
          id: 'event-mock',
          kind: 'goal_event',
          label: '共通テスト模試',
          value: null,
          dateExpression: 'custom:2週間後',
        },
      ],
    },
  });
}

describe('Stable V5 copied user context normalization', () => {
  it('removes an ungrounded stored concern copied onto an existing component', () => {
    const result = normalize({
      userText: '模試の方は数学を中心に、毎日2時間くらい取れたらと思ってます。',
      document: {
        tasks: [{
          localId: 'task-local',
          existingPublicId: 'task-public',
          study: {
            components: [{
              localId: 'component-local',
              existingPublicId: 'component-public',
              label: '数学',
              durableContextSignals: [{
                localId: 'copied-concern',
                kind: 'concern',
                value: '結構まずい',
                sourceText: '数学が結構まずい',
              }],
            }],
          },
        }],
        userContextFacts: [],
      },
    });

    const document = JSON.parse(result.rawResponse) as any;
    expect(document.tasks[0].study.components[0].durableContextSignals).toEqual([]);
    expect(result.repairs).toEqual([
      'copied-component-concern-removed:0:0:0:数学',
    ]);
  });

  it('keeps a concern when the current user explicitly repeats it', () => {
    const result = normalize({
      userText: '数学が結構まずいので、今週も数学を中心にしたいです。',
      document: {
        tasks: [{
          localId: 'task-local',
          existingPublicId: 'task-public',
          study: {
            components: [{
              localId: 'component-local',
              existingPublicId: 'component-public',
              label: '数学',
              durableContextSignals: [{
                localId: 'current-concern',
                kind: 'concern',
                value: '結構まずい',
                sourceText: '数学が結構まずい',
              }],
            }],
          },
        }],
        userContextFacts: [],
      },
    });

    const document = JSON.parse(result.rawResponse) as any;
    expect(document.tasks[0].study.components[0].durableContextSignals).toHaveLength(1);
    expect(result.repairs).toEqual([]);
  });

  it('removes an ungrounded stored goal event copied into a later turn', () => {
    const result = normalize({
      userText: '今週は数学を毎日2時間やりたいです。',
      document: {
        tasks: [],
        userContextFacts: [{
          localId: 'copied-event',
          kind: 'goal_event',
          label: '共通テスト模試',
          value: null,
          dateExpression: 'custom:2週間後',
          sourceText: '2週間後に共通テスト模試がある',
        }],
      },
    });

    const document = JSON.parse(result.rawResponse) as any;
    expect(document.userContextFacts).toEqual([]);
    expect(result.repairs).toEqual([
      'copied-user-context-fact-removed:0:goal_event:共通テスト模試',
    ]);
  });
});
