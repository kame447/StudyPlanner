import { describe, expect, it } from 'vitest';
import {
  projectUserPlanningContextScopeV2,
  selectUserPlanningContextPromptRecordsV2,
} from './userPlanningContextPromptSelectionV2';
import type { UserPlanningContextRecordV1 } from './userPlanningContextTypes';

function record(
  id: string,
  kind: UserPlanningContextRecordV1['kind'],
  label: string,
  status: UserPlanningContextRecordV1['status'] = 'active',
): UserPlanningContextRecordV1 {
  return {
    id,
    ownerId: 'owner-1',
    kind,
    label,
    value: kind === 'concern' ? '苦手' : '内容',
    dateExpression: null,
    observedDate: '2026-08-29',
    resolvedDate: null,
    sourceText: `${label}について覚える`,
    sourceConversationId: 'conversation-1',
    sourceTurnId: `turn-${id}`,
    recordedAt: `2026-08-29T00:00:${id.padStart(2, '0')}.000Z`,
    status,
    origin: 'user_confirmed',
  };
}

describe('user planning context prompt selection v2', () => {
  it('projects compatibility kinds into user-facing scope classes without raw-text routing', () => {
    expect(projectUserPlanningContextScopeV2(record('1', 'study_goal', '第一志望'))).toEqual({
      type: 'global',
      key: null,
    });
    expect(projectUserPlanningContextScopeV2(record('2', 'concern', '数学'))).toEqual({
      type: 'subject',
      key: '数学',
    });
    expect(projectUserPlanningContextScopeV2(record('3', 'learning_preference', '暗記'))).toEqual({
      type: 'activity_kind',
      key: '暗記',
    });
  });

  it('keeps core context, prioritizes exact structured scope matches, and does not send every active record', () => {
    const records = [
      record('1', 'study_goal', '第一志望'),
      record('2', 'concern', '数学'),
      record('3', 'concern', '英語'),
      ...Array.from({ length: 12 }, (_, index) =>
        record(String(index + 4), 'concern', `分野${index + 1}`)),
      record('99', 'concern', '削除済み', 'revoked'),
    ];

    const selected = selectUserPlanningContextPromptRecordsV2({
      records,
      relevantScopeKeys: ['数学'],
    });

    expect(selected[0]).toMatchObject({
      id: '1',
      relevanceTier: 'core',
      scope: { type: 'global', key: null },
    });
    expect(selected.some((item) => item.id === '2')).toBe(true);
    expect(selected.find((item) => item.id === '2')).toMatchObject({
      relevanceTier: 'relevant',
      scope: { type: 'subject', key: '数学' },
    });
    expect(selected.some((item) => item.id === '99')).toBe(false);
    expect(selected.length).toBeLessThan(records.filter((item) => item.status === 'active').length);
  });
});
