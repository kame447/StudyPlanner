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
    expect(app).not.toContain('executeInterruptibleWeeklyDraftApproval');
    expect(app).not.toContain('validateWeeklyPreviewApproval');
    expect(app).not.toContain('serializeWeeklyApprovalLedger');
    expect(app).not.toContain('weeklyPlanningPendingTurn=');
    expect(app).not.toContain('onSubmitWeeklyPlanningTurn=');
  });

  it('owns the manual quick-entry boundary in the dedicated connector component', () => {
    const connector = source('../../../components/WeeklyPlanningQuickEntryModal.tsx');

    expect(connector).toContain('data-quick-entry-manual-only="true"');
    expect(connector).toContain('weeklyPlanningPendingTurn={undefined}');
    expect(connector).toContain('weeklyPlanningPendingApproval={undefined}');
    expect(connector).not.toContain('weeklyPlanningPendingTurn={state.pendingTurn}');
    expect(connector).toContain('onSubmitWeeklyPlanningTurn={application.submitTurn}');
    expect(connector).toContain('onApproveWeeklyDraftBlocks={application.approveDraftBlocks}');
  });

  it('keeps the hook as a composition root and delegates turn orchestration', () => {
    const application = source('./useWeeklyPlanningApplication.ts');
    const turnApplication = source('./weeklyPlanningTurnApplication.ts');
    const sessionLifecycle = source('./weeklyPlanningSessionLifecycle.ts');
    const approval = source('./weeklyPlanningApprovalApplication.ts');

    expect(application).toContain('submitWeeklyPlanningApplicationTurn');
    expect(application).not.toContain('submitWeeklyPlanningControlledTurn');
    expect(turnApplication).toContain('submitWeeklyPlanningControlledTurn');
    expect(application).toContain('synchronizeWeeklyPlanningApplicationSession');
    expect(sessionLifecycle).toContain('resetWeeklyPlanningControlledSession');
    expect(application).toContain('approveWeeklyPlanningDraftBlocks');
    expect(approval).toContain('executeInterruptibleWeeklyDraftApproval');
    expect(approval).toContain('validateWeeklyPreviewApproval');
  });
});
