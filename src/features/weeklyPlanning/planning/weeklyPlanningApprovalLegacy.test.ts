import { describe, expect, it } from 'vitest';
import type { WeeklyPlanDraftBlock } from '../types';
import { validateWeeklyPreviewApproval } from './weeklyPlanningApproval';

function legacyBlock(id: string): WeeklyPlanDraftBlock {
  return {
    id,
    userId: 'user-1',
    date: '2026-07-14',
    startTime: '10:00',
    endTime: '11:00',
    title: '数学 2025',
    subject: '数学',
    type: 'study',
    label: '数学',
    source: 'ai',
    status: 'draft',
    userEdited: false,
    createdAt: '2026-07-14T00:00:00Z',
    updatedAt: '2026-07-14T00:00:00Z',
  };
}

describe('weeklyPlanningApproval legacy compatibility', () => {
  it('allows homogeneous unsaved legacy exam blocks for the same user', () => {
    const result = validateWeeklyPreviewApproval({
      blocks: [legacyBlock('legacy-1'), legacyBlock('legacy-2')],
      currentStateRevision: 0,
      userId: 'user-1',
      proposalRecords: [],
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.metadata.previewId).toMatch(/^legacy-weekly-preview:/);
      expect(result.metadata.approvalEligibility).toBe('eligible');
    }
  });

  it('rejects mixed-user legacy blocks', () => {
    const other = { ...legacyBlock('legacy-2'), userId: 'user-2' };
    const result = validateWeeklyPreviewApproval({
      blocks: [legacyBlock('legacy-1'), other],
      currentStateRevision: 0,
      userId: 'user-1',
      proposalRecords: [],
    });
    expect(result.allowed).toBe(false);
  });
});
