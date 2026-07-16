import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceExact(content, before, after, label) {
  if (!content.includes(before)) {
    throw new Error(`Missing replacement target: ${label}`);
  }
  return content.replace(before, after);
}

{
  const path = 'src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts';
  let content = read(path);

  content = replaceExact(
    content,
`function hasOneWeekDuration(text: string): boolean {
  return /(?:一|1)\\s*週間|7\\s*日間?/.test(normalizeIntakeText(text));
}
`,
`function hasOneWeekDuration(text: string): boolean {
  return /(?:一|1)\\s*週間|7\\s*日間?/.test(normalizeIntakeText(text));
}

function hasPlanningRequestSignal(text: string): boolean {
  const normalizedText = normalizeIntakeText(text);
  return /(?:予定|計画|スケジュール)/.test(normalizedText)
    && /(?:立て|作|組|決め|したい|お願い)/.test(normalizedText);
}

function isSummerVacationNegated(text: string): boolean {
  return /夏休み\\s*(?:ではなく|じゃなく|でなく|ではない|じゃない)/.test(
    normalizeIntakeText(text),
  );
}

function hasSummerVacationPlanningRangeIntent(text: string): boolean {
  const normalizedText = normalizeIntakeText(text);
  return !isSummerVacationNegated(normalizedText)
    && hasPlanningRequestSignal(normalizedText)
    && /夏休み(?:の(?:(?:一|1)\\s*週間|予定|計画|スケジュール)|中|期間|に|で|から)/.test(
      normalizedText,
    );
}

function isBareSummerVacationRangeAnswer(text: string): boolean {
  return /^夏休み(?:の(?:一|1)\\s*週間)?(?:です|でお願いします)?$/.test(
    normalizeIntakeText(text).trim(),
  );
}
`,
    'planning range intent helpers',
  );

  content = replaceExact(
    content,
`function parseWeekdayStart(text: string): number | undefined {
  const match = normalizeIntakeText(text).match(/(?:^|[^0-9])([月火水木金土日])(?:曜(?:日)?)?\\s*から/);
  return match ? WEEKDAY_INDEX[match[1]] : undefined;
}
`,
`function parseWeekdayStart(text: string): number | undefined {
  const normalizedText = normalizeIntakeText(text);
  const withoutExplicitMonthDays = normalizedText.replace(
    /\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日/g,
    '',
  );
  const match = withoutExplicitMonthDays.match(/([月火水木金土日])(?:曜(?:日)?)?\\s*から/);
  return match ? WEEKDAY_INDEX[match[1]] : undefined;
}
`,
    'month-day and weekday token separation',
  );

  content = replaceExact(
    content,
`function parsePendingPlanningRange(
  text: string,
  context: WeeklyPlanningIntakeContext,
): NormalizedSetPendingPlanningRangeCommand | undefined {
  const normalizedText = normalizeIntakeText(text);

  if (/夏休み/.test(normalizedText)) {
    const durationDays = hasOneWeekDuration(normalizedText) ? 7 : undefined;
`,
`function parsePendingPlanningRange(
  text: string,
  context: WeeklyPlanningIntakeContext,
  options?: { allowBareNamedFuturePeriodAnswer?: boolean },
): NormalizedSetPendingPlanningRangeCommand | undefined {
  const normalizedText = normalizeIntakeText(text);
  const acceptsSummerVacation = hasSummerVacationPlanningRangeIntent(normalizedText)
    || (options?.allowBareNamedFuturePeriodAnswer === true
      && isBareSummerVacationRangeAnswer(normalizedText));

  if (acceptsSummerVacation) {
    const durationDays = hasOneWeekDuration(normalizedText) ? 7 : undefined;
`,
    'contextual summer vacation pending range',
  );

  content = replaceExact(
    content,
`  if (pending) {
    const durationDays = hasOneWeekDuration(normalizedText) ? 7 : pending.durationDays;
    const explicitDate = parseExplicitDate(normalizedText, context);
    const explicitDateAllowed = Boolean(
      explicitDate
      && (pending.scope.kind !== 'next_week'
        || (pending.scope.startDate
          && pending.scope.endDate
          && explicitDate >= pending.scope.startDate
          && explicitDate <= pending.scope.endDate)),
    );
    const weekdayIndex = parseWeekdayStart(normalizedText);
    const startDate = explicitDateAllowed
      ? explicitDate
      : weekdayIndex === undefined
        ? undefined
        : resolveWeekdayInScope(weekdayIndex, pending.scope);
    return startDate && durationDays
      ? rangeFromStartDate({
          startDate,
          durationDays,
          sourceText: text,
        })
      : undefined;
  }
`,
`  if (pending) {
    const durationDays = hasOneWeekDuration(normalizedText) ? 7 : pending.durationDays;
    const explicitDate = parseExplicitDate(normalizedText, context);

    if (explicitDate) {
      const explicitDateAllowed = pending.scope.kind !== 'next_week'
        || Boolean(
          pending.scope.startDate
          && pending.scope.endDate
          && explicitDate >= pending.scope.startDate
          && explicitDate <= pending.scope.endDate,
        );
      return explicitDateAllowed && durationDays
        ? rangeFromStartDate({
            startDate: explicitDate,
            durationDays,
            sourceText: text,
          })
        : undefined;
    }

    const weekdayIndex = parseWeekdayStart(normalizedText);
    const startDate = weekdayIndex === undefined
      ? undefined
      : resolveWeekdayInScope(weekdayIndex, pending.scope);
    return startDate && durationDays
      ? rangeFromStartDate({
          startDate,
          durationDays,
          sourceText: text,
        })
      : undefined;
  }
`,
    'do not reinterpret explicit dates as weekdays',
  );

  content = replaceExact(
    content,
`export function parseSetPendingPlanningRangeCommand(
  text: string,
  context: WeeklyPlanningIntakeContext,
): NormalizedSetPendingPlanningRangeCommand | undefined {
  const range = parseWeeklyPlanningRange(text, context);
  return range ? undefined : parsePendingPlanningRange(text, context);
}
`,
`export function parseSetPendingPlanningRangeCommand(
  text: string,
  context: WeeklyPlanningIntakeContext,
  options?: { allowBareNamedFuturePeriodAnswer?: boolean },
): NormalizedSetPendingPlanningRangeCommand | undefined {
  const range = parseWeeklyPlanningRange(text, context);
  return range ? undefined : parsePendingPlanningRange(text, context, options);
}
`,
    'pending range parser options',
  );

  write(path, content);
}

{
  const path = 'src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts';
  let content = read(path);
  content = replaceExact(
    content,
`  } else {
    const pendingPlanningRangeCommand = parseSetPendingPlanningRangeCommand(userText, context);
    if (pendingPlanningRangeCommand) setupCommands.push(pendingPlanningRangeCommand);
  }
`,
`  } else {
    const allowBareNamedFuturePeriodAnswer = Boolean(
      previousState?.missing.includes('planning_period')
      || previousState?.missing.includes('planning_start_date'),
    );
    const pendingPlanningRangeCommand = parseSetPendingPlanningRangeCommand(
      userText,
      context,
      { allowBareNamedFuturePeriodAnswer },
    );
    if (pendingPlanningRangeCommand) setupCommands.push(pendingPlanningRangeCommand);
  }
`,
    'pass planning range answer context',
  );
  write(path, content);
}

{
  const path = 'src/features/weeklyPlanning/intake/weeklyPlanningPendingRangeCommandContract.test.ts';
  let content = read(path);

  content = replaceExact(
    content,
`  it('does not resolve a next-week pending range with an explicit date outside its window', () => {
    const context = {
      selectedDate: '2026-06-26',
      currentDateTime: '2026-06-26T12:00:00',
    };
    const pending = parseSetPendingPlanningRangeCommand(
      '来週の予定を立てたい',
      context,
    );
    expect(pending?.pending.scope).toMatchObject({
      kind: 'next_week',
      startDate: '2026-06-29',
      endDate: '2026-07-05',
    });

    const resolved = parseSetPlanningRangeCommand(
      '8月1日から一週間',
      context,
      pending?.pending,
    );
    expect(resolved).toBeUndefined();
  });
`,
`  it.each([
    '8月1日から一週間',
    '8月1 日から一週間',
    '９月１０ 日から一週間',
  ])('does not reinterpret an out-of-window explicit date as a weekday: %s', (text) => {
    const context = {
      selectedDate: '2026-06-26',
      currentDateTime: '2026-06-26T12:00:00',
    };
    const pending = parseSetPendingPlanningRangeCommand(
      '来週の予定を立てたい',
      context,
    );
    expect(pending?.pending.scope).toMatchObject({
      kind: 'next_week',
      startDate: '2026-06-29',
      endDate: '2026-07-05',
    });

    const resolved = parseSetPlanningRangeCommand(text, context, pending?.pending);
    expect(resolved).toBeUndefined();
  });

  it.each([
    ['日曜から', '2026-07-05T00:00:00'],
    ['日曜日から', '2026-07-05T00:00:00'],
    ['月曜から', '2026-06-29T00:00:00'],
  ])('continues to resolve a real weekday answer: %s', (text, startDateTime) => {
    const context = {
      selectedDate: '2026-06-26',
      currentDateTime: '2026-06-26T12:00:00',
    };
    const pending = parseSetPendingPlanningRangeCommand('来週の予定を立てたい', context);
    const resolved = parseSetPlanningRangeCommand(text, context, pending?.pending);
    expect(resolved?.range.startDateTime).toBe(startDateTime);
  });

  it('does not treat a summer-vacation task mention as a planning range', () => {
    expect(parseSetPendingPlanningRangeCommand(
      '夏休みの宿題は数学ワーク10ページです',
      { selectedDate: '2026-06-26' },
    )).toBeUndefined();
  });

  it('prefers next week when summer vacation is explicitly negated', () => {
    const pending = parseSetPendingPlanningRangeCommand(
      '夏休みではなく来週の計画を立てたい',
      { selectedDate: '2026-06-26' },
    );
    expect(pending?.pending.scope).toMatchObject({
      kind: 'next_week',
      startDate: '2026-06-29',
      endDate: '2026-07-05',
    });
  });

  it('accepts a bare summer-vacation answer only when the caller expects a range answer', () => {
    const context = { selectedDate: '2026-06-26' };
    expect(parseSetPendingPlanningRangeCommand('夏休み', context)).toBeUndefined();
    expect(parseSetPendingPlanningRangeCommand(
      '夏休み',
      context,
      { allowBareNamedFuturePeriodAnswer: true },
    )?.pending).toEqual({
      scope: { kind: 'named_future_period', label: '夏休み' },
      sourceText: '夏休み',
    });
  });
`,
    'generalized month-day, weekday, and summer vacation parser tests',
  );

  write(path, content);
}

{
  const path = 'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts';
  let content = read(path);
  const insertion = `

  it('keeps an existing resolved range when a later task mentions summer vacation', () => {
    const ranged = runTurn(undefined, '今日から一週間の計画を立てたい');
    expect(ranged.state.range).toBeDefined();
    expect(ranged.state.pendingPlanningRange).toBeUndefined();

    const taskTurn = runTurn(ranged.state, '夏休みの宿題は数学ワーク10ページです');
    expect(taskTurn.state.range).toEqual(ranged.state.range);
    expect(taskTurn.state.pendingPlanningRange).toBeUndefined();
    expect(taskTurn.state.missing).not.toContain('planning_start_date');
  });

  it('keeps next week instead of a negated summer-vacation period', () => {
    const result = runTurn(undefined, '夏休みではなく来週の計画を立てたい');
    expect(result.state.pendingPlanningRange?.scope).toMatchObject({
      kind: 'next_week',
      startDate: '2026-06-29',
      endDate: '2026-07-05',
    });
  });
`;
  const finalClose = content.lastIndexOf('\n});');
  if (finalClose < 0) throw new Error('Missing final pipeline describe close');
  content = content.slice(0, finalClose) + insertion + content.slice(finalClose);
  write(path, content);
}

{
  const path = 'src/features/weeklyPlanning/weeklyPlanningStorageValidation.test.ts';
  let content = read(path);
  content = replaceExact(
    content,
`  it('round-trips a valid behavior-aware preview with its conversation and intake state', () => {
`,
`  it('rejects a promoted draft with an unknown planning opportunity tag', () => {
    const candidate = behaviorAwarePreviewCandidate();
    storeV2({
      ...createInitialPlanningState(WEEK_START),
      revision: 10,
      mode: 'awaiting_approval',
      draftBlocks: [{
        ...validDraftBlock(),
        behaviorMetadata: {
          ...candidate.behaviorMetadata,
          opportunityTags: ['not_a_planning_opportunity'],
          compatibility: {
            workItemSemantic: 'behavior_aware_task',
            schedulerInputSource: 'exam_prep_request',
            candidateSource: 'weekly_exam_prep',
          },
          previewMetadata: {
            previewId: 'preview-1',
            conversationId: 'conversation-1',
            stateRevision: 3,
            assumptionDependencies: [],
            approvalEligibility: 'eligible',
            stale: false,
            authorizedUserId: USER_ID,
          },
        },
      }],
    });

    expectRejectedSession();
  });

  it('round-trips a valid behavior-aware preview with its conversation and intake state', () => {
`,
    'promoted draft unknown opportunity tag test',
  );
  write(path, content);
}
