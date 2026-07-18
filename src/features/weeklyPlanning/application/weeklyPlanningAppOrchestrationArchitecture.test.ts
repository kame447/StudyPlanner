import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('weekly planning application boundary', () => {
  it('keeps turn and approval implementation details out of App', () => {
    const app = source('../../../App.tsx');

    expect(app).toContain('useWeeklyPlanningApplication');
    expect(app).toContain('WeeklyPlanningQuickEntryModal');
    expect(app).not.toContain('submitWeeklyPlanningControlledTurn');
    expect(app).not.toContain('executeWeeklyDraftApproval');
    expect(app).not.toContain('validateWeeklyPreviewApproval');
    expect(app).not.toContain('serializeWeeklyApprovalLedger');
    expect(app).not.toContain('weeklyPlanningPendingTurn=');
    expect(app).not.toContain('onSubmitWeeklyPlanningTurn=');
  });

  it('owns quick-entry wiring in the dedicated connector component', () => {
    const connector = source('../../../components/WeeklyPlanningQuickEntryModal.tsx');

    expect(connector).toContain('weeklyPlanningPendingTurn={state.pendingTurn}');
    expect(connector).toContain('onSubmitWeeklyPlanningTurn={application.submitTurn}');
    expect(connector).toContain('onApproveWeeklyDraftBlocks={application.approveDraftBlocks}');
  });

  it('owns turn control and approval orchestration in the application layer', () => {
    const application = source('./useWeeklyPlanningApplication.ts');
    const approval = source('./weeklyPlanningApprovalApplication.ts');

    expect(application).toContain('submitWeeklyPlanningControlledTurn');
    expect(application).toContain('approveWeeklyPlanningDraftBlocks');
    expect(approval).toContain('executeWeeklyDraftApproval');
    expect(approval).toContain('validateWeeklyPreviewApproval');
  });
});
