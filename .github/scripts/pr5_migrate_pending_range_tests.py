from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count == 0 and new in text:
        return
    if count != 1:
        raise RuntimeError(
            f'{path}: expected one match, found {count}: {old[:120]!r}'
        )
    file.write_text(text.replace(old, new))


replace_once(
    'src/features/weeklyPlanning/__tests__/weeklyPlanningIntakeEdgeCases.test.ts',
    "scope: { kind: 'next_week', label: '来週', startDate: '2026-07-13' },",
    "scope: {\n            kind: 'next_week',\n            label: '来週',\n            windowStartDate: '2026-07-13',\n            windowEndDate: '2026-07-19',\n          },",
)

foundation = 'src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts'
replace_once(
    foundation,
    "  it.each([\n    ['Friday', '2026-07-10T15:30:00', '2026-07-13', '2026-07-19'],\n    ['Sunday', '2026-07-12T15:30:00', '2026-07-13', '2026-07-19'],\n    ['Monday', '2026-07-13T15:30:00', '2026-07-20', '2026-07-26'],\n  ])('normalizes a next_week pending command from the current date at the %s boundary', (",
    "  it.each([\n    ['Friday current time', '2026-07-10T15:30:00', '2020-01-06', '2020-01-12'],\n    ['Sunday current time', '2026-07-12T15:30:00', '2020-01-06', '2020-01-12'],\n    ['Monday current time', '2026-07-13T15:30:00', '2020-01-06', '2020-01-12'],\n  ])('normalizes a next_week pending command from selectedDate at the %s boundary', (",
)
replace_once(
    foundation,
    "        startDate: expectedStartDate,\n        endDate: expectedEndDate,",
    "        windowStartDate: expectedStartDate,\n        windowEndDate: expectedEndDate,",
)
replace_once(
    foundation,
    "{ scope: { kind: 'next_week', label: 'next week', startDate: 'not-a-date' }, sourceText: 'next week' },\n      'invalid-date',",
    "{ scope: { kind: 'next_week', label: 'next week', windowStartDate: 'not-a-date', windowEndDate: '2026-07-19' }, sourceText: 'next week' },\n      'invalid-command-shape',",
)
replace_once(
    foundation,
    "expect(prompt).toContain('pendingPlanningRange.startDate');",
    "expect(prompt).toContain('pending.planningStartDate');",
)
replace_once(
    foundation,
    "expect(prompt).toContain('concrete ISO date inside that pending window');",
    "expect(prompt).toContain('selected start date satisfies the pending window');",
)
replace_once(
    foundation,
    "expect(prompt).toContain('the application computes the next_week window');",
    "expect(prompt).toContain('planning next_week window from context.selectedDate');",
)

slots = 'src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.test.ts'
replace_once(
    slots,
    "  'planning_start_date',\n  'tasks_or_goals',",
    "  'planning_start_date',\n  'planning_duration',\n  'tasks_or_goals',",
)
replace_once(
    slots,
    "      'planning_start_date',\n      'tasks_or_goals',",
    "      'planning_start_date',\n      'planning_duration',\n      'tasks_or_goals',",
)
replace_once(
    slots,
    "      planning_start_date: 'assumable',\n      tasks_or_goals: 'blocking',",
    "      planning_start_date: 'assumable',\n      planning_duration: 'assumable',\n      tasks_or_goals: 'blocking',",
)

pipeline = 'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts'
replace_once(
    pipeline,
    "scope: { kind: 'next_week', label: '来週', startDate: '2026-07-13' },",
    "scope: {\n        kind: 'next_week',\n        label: '来週',\n        windowStartDate: '2026-07-13',\n        windowEndDate: '2026-07-19',\n      },",
)
replace_once(
    pipeline,
    "        startDate: '2026-07-13',\n        endDate: '2026-07-19',",
    "        windowStartDate: '2026-07-13',\n        windowEndDate: '2026-07-19',",
)
replace_once(
    pipeline,
    "      expect(params.stateSummary.pendingPlanningRange).toEqual({\n        label: '来週',\n        startDate: '2026-07-13',\n        endDate: '2026-07-19',\n      });",
    "      expect(params.stateSummary.pendingPlanningRange).toEqual({\n        kind: 'next_week',\n        label: '来週',\n        windowStartDate: '2026-07-13',\n        windowEndDate: '2026-07-19',\n        planningStartDate: undefined,\n        durationDays: 7,\n      });",
)
old_confirmation = """  it('keeps explicit AI ranges in confirmation without applying over pending scope', async () => {
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: pendingScopeState(),
      userText: '開始日は別に指定したいです',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
      interpreter: fakeInterpreter([planningRangeCandidate('explicit')]),
    });
"""
new_confirmation = """  it('keeps explicit AI ranges in confirmation without applying over pending scope', async () => {
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: pendingScopeState(),
      userText: '開始日は別に指定したいです',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
      interpreter: fakeInterpreter([{
        command: {
          type: 'set_planning_range',
          range: {
            startDateTime: '2026-07-15T00:00:00',
            endDateTime: '2026-07-19T24:00:00',
            sourceText: '来週の水曜日から日曜日',
            confidence: 'explicit',
          },
          sourceText: '来週の水曜日から日曜日',
          confidence: 'high',
        },
        origin: 'ai_interpreter',
        needsConfirmation: true,
      }]),
    });
"""
replace_once(pipeline, old_confirmation, new_confirmation)
