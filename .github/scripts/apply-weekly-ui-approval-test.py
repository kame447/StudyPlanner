from pathlib import Path

path = Path('src/components/NaturalLanguageAssistant.weeklyPlanningControls.test.tsx')
text = path.read_text()
text = text.replace(
    "import { NaturalLanguageAssistant } from './NaturalLanguageAssistant';\n",
    "import { createWeeklyPlanningTestDraftBlock } from '../features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';\nimport { NaturalLanguageAssistant } from './NaturalLanguageAssistant';\n",
    1,
)
insert = r'''

  it('promotes the visible Stable V5 preview through the explicit UI control', () => {
    const onCreateWeeklyDraftBlocks = vi.fn();
    const preview = [{
      stableKey: 'stable-v5:8:math:0',
      date: '2026-08-18',
      startTime: '21:00',
      endTime: '24:00',
      durationMinutes: 180,
      title: '数学のワーク 50ページ',
      field: '数学のワーク',
      year: 0,
      estimatedMinutes: 180,
      source: 'weekly_exam_prep' as const,
      approvalStatus: 'unapproved' as const,
      workItemKey: 'math-work',
    }];
    const { renderer } = renderAssistant({
      weeklyPlanningPreviewCandidates: preview,
      onCreateWeeklyDraftBlocks,
    });
    const promoteButton = renderer.root.findAllByType('button').find(
      (button) => button.children.join('') === 'この内容で仮予定にする',
    );

    expect(promoteButton).toBeDefined();
    act(() => promoteButton?.props.onClick());
    expect(onCreateWeeklyDraftBlocks).toHaveBeenCalledTimes(1);
    expect(onCreateWeeklyDraftBlocks.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        date: '2026-08-18',
        startTime: '21:00',
        endTime: '24:00',
        title: '数学のワーク 50ページ',
        status: 'draft',
      }),
    ]);
  });

  it('routes explicit draft approval to the application approval boundary', async () => {
    const onApproveWeeklyDraftBlocks = vi.fn(async () => undefined);
    const draft = createWeeklyPlanningTestDraftBlock({
      id: 'math-draft',
      overrides: {
        date: '2026-08-18',
        startTime: '21:00',
        endTime: '24:00',
        title: '数学のワーク 50ページ',
      },
    });
    const { renderer } = renderAssistant({
      weeklyDraftBlocks: [draft],
      onApproveWeeklyDraftBlocks,
    });
    const approveButton = renderer.root.findAllByType('button').find(
      (button) => button.children.join('') === '一括承認して保存',
    );

    expect(approveButton).toBeDefined();
    await act(async () => {
      approveButton?.props.onClick();
      await Promise.resolve();
    });
    expect(onApproveWeeklyDraftBlocks).toHaveBeenCalledTimes(1);
  });
'''
anchor = "\n  it('connects clear conversation and explicit cancellation as separate operations', () => {"
assert anchor in text
text = text.replace(anchor, insert + anchor, 1)
path.write_text(text)
