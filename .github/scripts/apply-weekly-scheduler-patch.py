from pathlib import Path

path = Path('src/features/weeklyPlanning/semantic/weeklyPlanningStableV5PreviewScheduler.ts')
text = path.read_text()

marker = "function sessionChunks(item: GenericPlanningWorkItem): number[] {"
helper = """function hardAvailableWindowsByDate(params: {\n  input: GenericSchedulerInput;\n  dates: string[];\n}): Map<string, PlacementWindow[]> {\n  const dateSet = new Set(params.dates);\n  const result = new Map<string, PlacementWindow[]>();\n  params.input.availabilityWindows\n    .filter((window) =>\n      window.constraintLevel === 'hard'\n      && window.kind === 'available'\n      && window.start.date === window.end.date\n      && dateSet.has(window.start.date))\n    .forEach((window) => {\n      const start = minutesFromTime(window.start.time);\n      const end = minutesFromTime(window.end.time);\n      if (end <= start) return;\n      result.set(window.start.date, [\n        ...(result.get(window.start.date) ?? []),\n        { start, end },\n      ]);\n    });\n  for (const [date, windows] of result) {\n    result.set(date, windows.sort((left, right) => left.start - right.start));\n  }\n  return result;\n}\n\n"""
assert marker in text
text = text.replace(marker, helper + marker, 1)

old = """function findPreferredSlot(params: {\n  placements: PreferredPlacement[];\n  duration: number;\n  windowsByDate: Map<string, PlacementWindow[]>;\n  busy: MinuteInterval[];\n  breakMinutes: number;\n}): MinuteInterval | null {\n  for (const placement of params.placements) {\n    const slot = findSlot({\n      dates: placement.dates,\n      duration: params.duration,\n      windowsByDate: params.windowsByDate,\n      busy: params.busy,\n      breakMinutes: params.breakMinutes,\n      overrideWindow: placement.window,\n    });\n    if (slot) return slot;\n  }\n  return null;\n}"""
new = """function intersectPlacementWindows(\n  bases: readonly PlacementWindow[],\n  preferred: PlacementWindow,\n): PlacementWindow[] {\n  return bases.flatMap((base) => {\n    const start = Math.max(base.start, preferred.start);\n    const end = Math.min(base.end, preferred.end);\n    return end > start ? [{ start, end }] : [];\n  });\n}\n\nfunction findPreferredSlot(params: {\n  placements: PreferredPlacement[];\n  duration: number;\n  windowsByDate: Map<string, PlacementWindow[]>;\n  hardAvailableByDate: Map<string, PlacementWindow[]>;\n  busy: MinuteInterval[];\n  breakMinutes: number;\n}): MinuteInterval | null {\n  for (const placement of params.placements) {\n    for (const date of placement.dates) {\n      const hardAvailable = params.hardAvailableByDate.get(date);\n      const windows = placement.window\n        ? hardAvailable\n          ? intersectPlacementWindows(hardAvailable, placement.window)\n          : [placement.window]\n        : hardAvailable ?? params.windowsByDate.get(date) ?? [];\n      const slot = findSlot({\n        dates: [date],\n        duration: params.duration,\n        windowsByDate: new Map([[date, windows]]),\n        busy: params.busy,\n        breakMinutes: params.breakMinutes,\n      });\n      if (slot) return slot;\n    }\n  }\n  return null;\n}"""
assert old in text
text = text.replace(old, new, 1)

old = """  const windowsByDate = placementWindowsByDate({\n    input: params.input,\n    dates,\n    dayStartTime: params.dayStartTime ?? DEFAULT_DAY_START,\n    dayEndTime: params.dayEndTime ?? DEFAULT_DAY_END,\n  });\n  const candidates: WeeklyDraftCandidate[] = [];"""
new = """  const windowsByDate = placementWindowsByDate({\n    input: params.input,\n    dates,\n    dayStartTime: params.dayStartTime ?? DEFAULT_DAY_START,\n    dayEndTime: params.dayEndTime ?? DEFAULT_DAY_END,\n  });\n  const hardAvailableByDate = hardAvailableWindowsByDate({\n    input: params.input,\n    dates,\n  });\n  const candidates: WeeklyDraftCandidate[] = [];"""
assert old in text
text = text.replace(old, new, 1)

old = """            windowsByDate,\n            busy,\n            breakMinutes,"""
new = """            windowsByDate,\n            hardAvailableByDate,\n            busy,\n            breakMinutes,"""
assert old in text
text = text.replace(old, new, 1)
path.write_text(text)

test = Path('src/features/weeklyPlanning/semantic/weeklyPlanningStableV5PreviewScheduler.test.ts')
text = test.read_text()
insert = '''

  it('lets an explicit preferred night window outrank the default daytime heuristic', () => {
    const preferredGraph: WeeklyPlanningFactGraphV5 = {
      ...graph(),
      revision: 2,
      temporalConstraints: [{
        id: 'preferred-night-1',
        taskId: 'task-1',
        targetFactId: 'task-1',
        kind: 'preferred_window',
        constraintLevel: 'soft',
        dateExpression: 'weekday:tuesday',
        namedTimePeriod: 'night',
        startTime: null,
        endTime: null,
        precision: 'unspecified',
        source: {
          conversationId: 'conversation-1',
          turnId: 'turn-2',
          semanticLocalId: 'preferred-local-1',
          sourceText: '火曜の夜にして',
          origin: 'user',
        },
        createdRevision: 2,
      }],
      factLifecycles: [{
        factId: 'preferred-night-1',
        status: 'active',
        createdRevision: 2,
        terminalRevision: null,
        supersededByFactId: null,
      }],
    };
    const item = workItem({
      estimatedMinutes: 180,
      splitPolicy: 'unknown',
      quantity: {
        amount: 50,
        unitCode: 'page',
        unitLabel: 'ページ',
        ordinalRange: { start: 1, end: 50 },
        actualRange: null,
      },
    });
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput({
        graphRevision: 2,
        horizon: {
          startDate: '2026-08-17',
          endDate: '2026-08-23',
          timeZone: 'Asia/Tokyo',
          planningWindowFactIds: [],
        },
        movableWorkItems: [item],
      }),
      graph: preferredGraph,
    });

    expect(result.status).toBe('ready');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      date: '2026-08-18',
      startTime: '21:00',
      endTime: '24:00',
      durationMinutes: 180,
    });
  });
'''
anchor = '\n});\n'
assert text.endswith(anchor)
text = text[:-len(anchor)] + insert + anchor
test.write_text(text)
