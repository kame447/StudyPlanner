import { describe, expect, it } from 'vitest';
import {
  normalizeCopiedUserContextDeltaV5,
} from './weeklyPlanningCopiedUserContextNormalizationV5';

function normalize(document: Record<string, unknown>) {
  return normalizeCopiedUserContextDeltaV5({
    rawResponse: JSON.stringify(document),
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
  it('collapses a stored concern copied onto an existing component using typed state only', () => {
    const result = normalize({
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
              sourceText: '数学を中心に',
            }],
          }],
        },
      }],
      userContextFacts: [],
    });

    const document = JSON.parse(result.rawResponse) as any;
    expect(document.tasks[0].study.components[0].durableContextSignals).toEqual([]);
    expect(result.repairs).toEqual([
      'copied-component-concern-removed:0:0:0:数学',
    ]);
  });

  it('treats an exact repeated concern as an idempotent typed-state duplicate', () => {
    const result = normalize({
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
    });

    const document = JSON.parse(result.rawResponse) as any;
    expect(document.tasks[0].study.components[0].durableContextSignals).toEqual([]);
    expect(result.repairs).toEqual([
      'copied-component-concern-removed:0:0:0:数学',
    ]);
  });

  it('keeps a genuinely changed concern value as a new structured delta', () => {
    const result = normalize({
      tasks: [{
        localId: 'task-local',
        existingPublicId: 'task-public',
        study: {
          components: [{
            localId: 'component-local',
            existingPublicId: 'component-public',
            label: '数学',
            durableContextSignals: [{
              localId: 'changed-concern',
              kind: 'concern',
              value: '前よりかなり不安',
              sourceText: '数学は前よりかなり不安です',
            }],
          }],
        },
      }],
      userContextFacts: [],
    });

    const document = JSON.parse(result.rawResponse) as any;
    expect(document.tasks[0].study.components[0].durableContextSignals).toHaveLength(1);
    expect(result.repairs).toEqual([]);
  });

  it('does not classify a repeated goal event as copied from raw conversation evidence', () => {
    const result = normalize({
      tasks: [],
      userContextFacts: [{
        localId: 'event-current',
        kind: 'goal_event',
        label: '共通テスト模試',
        value: null,
        dateExpression: 'custom:2週間後',
        sourceText: '2週間後に共通テスト模試がある',
      }],
    });

    const document = JSON.parse(result.rawResponse) as any;
    expect(document.userContextFacts).toHaveLength(1);
    expect(result.repairs).toEqual([]);
  });
});
