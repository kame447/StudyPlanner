import { describe, expect, it } from 'vitest';

import { normalizeCopiedUserContextDeltaV5 } from './weeklyPlanningCopiedUserContextNormalizationV5';

describe('normalizeCopiedUserContextDeltaV5 copied planning window', () => {
  it('drops only an ungrounded planning window copied from accepted state', () => {
    const tasks = [
      { localId: 'task-math', title: '数学のワーク', sourceText: '数学のワーク' },
      { localId: 'task-english', title: '英語のレポート', sourceText: '英語のレポート' },
    ];
    const rawResponse = JSON.stringify({
      planningWindow: {
        localId: 'window-1',
        kind: 'relative_week',
        value: 'next_week',
        start: null,
        end: null,
        sourceText: '来週の勉強予定',
      },
      tasks,
      userContextFacts: [],
    });

    const result = normalizeCopiedUserContextDeltaV5({
      rawResponse,
      userText: '数学のワークと英語のレポートを進めたいです。',
      publicStateSummary: {
        planningWindows: [
          {
            publicId: 'accepted-window',
            kind: 'relative_week',
            value: 'next_week',
            start: null,
            end: null,
          },
        ],
        userPlanningContext: [],
      },
    });

    expect(JSON.parse(result.rawResponse)).toEqual({
      planningWindow: null,
      tasks,
      userContextFacts: [],
    });
    expect(result.repairs).toEqual(['copied-planning-window-removed']);
  });

  it('keeps a planning window when the current turn itself states it', () => {
    const planningWindow = {
      localId: 'window-1',
      kind: 'relative_week',
      value: 'next_week',
      start: null,
      end: null,
      sourceText: '来週',
    };
    const rawResponse = JSON.stringify({
      planningWindow,
      tasks: [],
      userContextFacts: [],
    });

    const result = normalizeCopiedUserContextDeltaV5({
      rawResponse,
      userText: '来週は数学を進めたいです。',
      publicStateSummary: {
        planningWindows: [
          {
            publicId: 'accepted-window',
            kind: 'relative_week',
            value: 'next_week',
            start: null,
            end: null,
          },
        ],
        userPlanningContext: [],
      },
    });

    expect(result.rawResponse).toBe(rawResponse);
    expect(result.repairs).toEqual([]);
  });

  it('does not remove an ungrounded window that differs from accepted state', () => {
    const rawResponse = JSON.stringify({
      planningWindow: {
        localId: 'window-1',
        kind: 'relative_week',
        value: 'this_week',
        start: null,
        end: null,
        sourceText: '今週',
      },
      tasks: [],
      userContextFacts: [],
    });

    const result = normalizeCopiedUserContextDeltaV5({
      rawResponse,
      userText: '数学を進めたいです。',
      publicStateSummary: {
        planningWindows: [
          {
            publicId: 'accepted-window',
            kind: 'relative_week',
            value: 'next_week',
            start: null,
            end: null,
          },
        ],
        userPlanningContext: [],
      },
    });

    expect(result.rawResponse).toBe(rawResponse);
    expect(result.repairs).toEqual([]);
  });
});
