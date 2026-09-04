import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('weekly planning application boundary', () => {
  it('keeps turn and approval implementation details out of App', () => {
    const app = source('../../../App.tsx');

    expect(app).toContain('useWeeklyPlanningApplication');
    expect(app).toContain('AiPlanningView');
    expect(app).toContain('QuickEntryModal');
    expect(app).not.toContain('WeeklyPlanningQuickEntryModal');
    expect(app).not.toContain('submitWeeklyPlanningControlledTurn');
    expect(app).not.toContain('executeWeeklyDraftApproval');
    expect(app).not.toContain('executeInterruptibleWeeklyDraftApproval');
    expect(app).not.toContain('validateWeeklyPreviewApproval');
    expect(app).not.toContain('serializeWeeklyApprovalLedger');
    expect(app).not.toContain('weeklyPlanningPendingTurn=');
    expect(app).not.toContain('onSubmitWeeklyPlanningTurn=');
  });

  it('keeps generic quick entry free of weekly planning ownership', () => {
    const quickEntry = source('../../../components/QuickEntryModal.tsx');

    expect(quickEntry).not.toContain('NaturalLanguageAssistant');
    expect(quickEntry).not.toContain('weeklyPlanning');
    expect(quickEntry).not.toContain('WeeklyPlanDraftBlock');
    expect(quickEntry).not.toContain('WeeklyPlanningMessage');
    expect(quickEntry).not.toContain('onSubmitWeeklyPlanningTurn');
    expect(quickEntry).not.toContain('onApproveWeeklyDraftBlocks');
    expect(quickEntry).not.toContain('AI入力');
  });

  it('owns the weekly planning UI through AiPlanningView', () => {
    const aiPlanningView = source('../../../components/AiPlanningView.tsx');
    const aiPlanningLegacy = source('../../../components/AiPlanningViewLegacy.tsx');

    expect(aiPlanningView).toContain('WeeklyPlanningApplication');
    expect(aiPlanningView).toContain('application.cancelTurn');
    expect(aiPlanningView).toContain('application.approveDraftBlocks');
    expect(aiPlanningView).toContain('application.removePreviewCandidate');
    expect(aiPlanningLegacy).toContain('application.submitTurn');
    expect(aiPlanningLegacy).toContain('application.loadConversationSnapshot');
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
