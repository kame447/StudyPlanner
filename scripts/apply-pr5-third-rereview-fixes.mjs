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

function replaceAllExact(content, before, after, expectedCount, label) {
  const count = content.split(before).length - 1;
  if (count !== expectedCount) {
    throw new Error(`Unexpected replacement count for ${label}: ${count}`);
  }
  return content.split(before).join(after);
}

{
  const path = 'src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts';
  let content = read(path);
  content = replaceExact(
    content,
`  const normalizedText = normalizeIntakeText(text);
  if (!hasOneWeekDuration(normalizedText) && !/来週.*(?:計画|予定|スケジュール)/.test(normalizedText)) {
    return undefined;
  }

  if (/夏休み/.test(normalizedText)) {
    const durationDays = hasOneWeekDuration(normalizedText) ? 7 : undefined;
    return {
      type: 'set_pending_planning_range',
      pending: {
        scope: { kind: 'named_future_period', label: '夏休み' },
        ...(durationDays ? { durationDays } : {}),
        sourceText: text,
      },
      sourceText: text,
      confidence: 'high',
    };
  }
`,
`  const normalizedText = normalizeIntakeText(text);

  if (/夏休み/.test(normalizedText)) {
    const durationDays = hasOneWeekDuration(normalizedText) ? 7 : undefined;
    return {
      type: 'set_pending_planning_range',
      pending: {
        scope: { kind: 'named_future_period', label: '夏休み' },
        ...(durationDays ? { durationDays } : {}),
        sourceText: text,
      },
      sourceText: text,
      confidence: 'high',
    };
  }

  if (!hasOneWeekDuration(normalizedText) && !/来週.*(?:計画|予定|スケジュール)/.test(normalizedText)) {
    return undefined;
  }
`,
    'allow duration-less named future periods',
  );
  content = replaceExact(
    content,
`  if (pending) {
    const durationDays = hasOneWeekDuration(normalizedText) ? 7 : pending.durationDays;
    const explicitDate = parseExplicitDate(normalizedText, context);
    const weekdayIndex = parseWeekdayStart(normalizedText);
    const startDate = explicitDate ?? (weekdayIndex === undefined
      ? undefined
      : resolveWeekdayInScope(weekdayIndex, pending.scope));
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
    'enforce pending next-week bounds for explicit dates',
  );
  write(path, content);
}

{
  const path = 'src/features/weeklyPlanning/weeklyPlanningStorage.ts';
  let content = read(path);
  content = replaceExact(
    content,
`const PREVIEW_ELIGIBILITY = new Set([
  'eligible', 'blocked_pending_assumption', 'blocked_stale', 'blocked_invalid', 'unsupported',
]);
`,
`const PREVIEW_ELIGIBILITY = new Set([
  'eligible', 'blocked_pending_assumption', 'blocked_stale', 'blocked_invalid', 'unsupported',
]);
const PLANNING_OPPORTUNITY_TAGS = new Set([
  'before_meal', 'after_meal', 'after_school', 'after_work', 'after_commute',
  'before_sleep', 'after_rest', 'long_contiguous_window', 'short_transition_window',
  'low_activation', 'high_continuity',
]);
`,
    'closed planning opportunity tag vocabulary',
  );
  content = replaceExact(
    content,
`function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}
`,
`function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isPlanningOpportunityTagArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((item) => typeof item === 'string' && PLANNING_OPPORTUNITY_TAGS.has(item));
}
`,
    'planning opportunity tag validator',
  );
  content = replaceAllExact(
    content,
`    && isStringArray(value.opportunityTags)
`,
`    && isPlanningOpportunityTagArray(value.opportunityTags)
`,
    2,
    'apply closed opportunity tag validation',
  );
  write(path, content);
}

{
  const path = 'src/features/weeklyPlanning/intake/weeklyPlanningPendingRangeCommandContract.test.ts';
  let content = read(path);
  content = replaceExact(
    content,
`  it('uses a date and duration supplied together to resolve an unresolved named future period', () => {
    const resolved = parseSetPlanningRangeCommand(
      '8月1日から一週間',
      { selectedDate: '2026-07-16', currentDateTime: '2026-07-16T12:00:00' },
      {
        scope: { kind: 'named_future_period', label: '夏休み' },
        sourceText: '夏休みに計画を立てたい',
      },
    );
    expect(resolved?.range).toMatchObject({
      startDateTime: '2026-08-01T00:00:00',
      endDateTime: '2026-08-07T24:00:00',
      calendarDayCount: 7,
    });
  });
`,
`  it('keeps a duration-less named future period from the initial utterance and resolves it later', () => {
    const context = {
      selectedDate: '2026-07-16',
      currentDateTime: '2026-07-16T12:00:00',
    };
    const pending = parseSetPendingPlanningRangeCommand(
      '夏休みに計画を立てたい',
      context,
    );
    expect(pending?.pending).toEqual({
      scope: { kind: 'named_future_period', label: '夏休み' },
      sourceText: '夏休みに計画を立てたい',
    });

    const resolved = parseSetPlanningRangeCommand(
      '8月1日から一週間',
      context,
      pending?.pending,
    );
    expect(resolved?.range).toMatchObject({
      startDateTime: '2026-08-01T00:00:00',
      endDateTime: '2026-08-07T24:00:00',
      calendarDayCount: 7,
    });
  });

  it('does not resolve a next-week pending range with an explicit date outside its window', () => {
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
    'initial named future and next-week out-of-window parser tests',
  );
  write(path, content);
}

{
  const path = 'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts';
  let content = read(path);
  const insertion = `

  it('keeps a duration-less named future period from the first turn and resolves it on the next turn', () => {
    const pending = runTurn(undefined, '夏休みに計画を立てたい');
    expect(pending.state.pendingPlanningRange).toEqual({
      scope: { kind: 'named_future_period', label: '夏休み' },
      sourceText: '夏休みに計画を立てたい',
    });
    expect(pending.state.missing).not.toContain('planning_period');

    const resolved = runTurn(pending.state, '8月1日から一週間');
    expect(resolved.state.pendingPlanningRange).toBeUndefined();
    expect(resolved.state.range).toMatchObject({
      startDateTime: '2026-08-01T00:00:00',
      endDateTime: '2026-08-07T24:00:00',
      calendarDayCount: 7,
      confidence: 'explicit',
    });
  });

  it('keeps the next-week pending range when a deterministic absolute date is outside the window', () => {
    const pending = runTurn(undefined, '来週の予定を立てたい');
    expect(pending.state.pendingPlanningRange?.scope).toMatchObject({
      kind: 'next_week',
      startDate: '2026-06-29',
      endDate: '2026-07-05',
    });

    const unresolved = runTurn(pending.state, '8月1日から一週間');
    expect(unresolved.state.range).toBeUndefined();
    expect(unresolved.state.pendingPlanningRange).toEqual(pending.state.pendingPlanningRange);
    expect(unresolved.state.missing).toContain('planning_start_date');
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
`  it('rejects a behavior-aware preview with an unknown planning opportunity tag', () => {
    const candidate = behaviorAwarePreviewCandidate();
    storeV2({
      ...createInitialPlanningState(WEEK_START),
      revision: 9,
      mode: 'draft_created',
      previewCandidates: [{
        ...candidate,
        behaviorMetadata: {
          ...candidate.behaviorMetadata,
          opportunityTags: ['not_a_planning_opportunity'],
        },
      }],
    });

    expectRejectedSession();
  });

  it('round-trips a valid behavior-aware preview with its conversation and intake state', () => {
`,
    'unknown opportunity tag storage regression',
  );
  content = replaceExact(
    content,
`    const state = {
      ...createInitialPlanningState(WEEK_START),
      revision: 2,
      intakeState,
      pendingTurn: {
`,
`    const messages = [{
      id: 'persisted-message',
      role: 'assistant' as const,
      content: '保存済みの会話です。',
      createdAt: NOW,
    }];
    const state = {
      ...createInitialPlanningState(WEEK_START),
      revision: 2,
      messages,
      intakeState,
      pendingTurn: {
`,
    'include persisted messages in temporary ownership fixture',
  );
  content = replaceExact(
    content,
`    expect(loaded.revision).toBe(2);
    expect(loaded.intakeState?.sourceTurns).toEqual(['保存済みturn']);
`,
`    expect(loaded.revision).toBe(2);
    expect(loaded.messages).toEqual(messages);
    expect(loaded.intakeState?.sourceTurns).toEqual(['保存済みturn']);
`,
    'assert messages survive temporary ownership sanitization',
  );
  write(path, content);
}

{
  const path = 'src/features/weeklyPlanning/weeklyPlanningPreviewSessionLifecycle.test.tsx';
  let content = read(path);
  content = replaceExact(
    content,
`  useImperativeHandle,
  useState,
`,
`  useImperativeHandle,
  useRef,
  useState,
`,
    'import useRef for UI submission tracking',
  );
  content = replaceExact(
    content,
`interface SessionOwnerHandle {
  submit(text: string): Promise<void>;
  setModalOpen(open: boolean): void;
  getState(): PlanningState;
}
`,
`interface SessionOwnerHandle {
  setModalOpen(open: boolean): void;
  getState(): PlanningState;
  getSubmission(): Promise<void> | undefined;
}
`,
    'session owner handle exposes UI-started submission',
  );
  content = replaceExact(
    content,
`  const [modalOpen, setModalOpen] = useState(true);
  const {
`,
`  const [modalOpen, setModalOpen] = useState(true);
  const submissionRef = useRef<Promise<void>>();
  const {
`,
    'track UI-started submission promise',
  );
  content = replaceExact(
    content,
`  useImperativeHandle(ref, () => ({
    submit,
    setModalOpen,
    getState: getPlanningState,
  }));
`,
`  useImperativeHandle(ref, () => ({
    setModalOpen,
    getState: getPlanningState,
    getSubmission: () => submissionRef.current,
  }));
`,
    'expose UI-started submission promise',
  );
  content = replaceExact(
    content,
`      onSubmitWeeklyPlanningTurn={async (text) => {
        await submit(text);
        const latest = getPlanningState();
`,
`      onSubmitWeeklyPlanningTurn={async (text) => {
        const submission = submit(text);
        submissionRef.current = submission;
        await submission;
        const latest = getPlanningState();
`,
    'record submission invoked through component callback',
  );
  content = replaceExact(
    content,
`    let submission!: Promise<void>;
    await act(async () => {
      submission = ownerRef.current!.submit('レポートを1時間進めたい');
      await Promise.resolve();
    });
    expect(ownerRef.current!.getState().pendingTurn).toBeDefined();
`,
`    await act(async () => {
      const weeklyPlanningButton = renderer.root.findAllByType('button').find(
        (button) => button.children.join('') === '週間計画',
      );
      expect(weeklyPlanningButton).toBeDefined();
      weeklyPlanningButton!.props.onClick();
    });
    const textarea = renderer.root.findByType('textarea');
    act(() => textarea.props.onChange({ target: { value: 'レポートを1時間進めたい' } }));
    await act(async () => {
      const sendButton = renderer.root.findAllByType('button').find(
        (button) => button.children.join('') === '送信',
      );
      expect(sendButton).toBeDefined();
      sendButton!.props.onClick();
      await Promise.resolve();
    });
    const submission = ownerRef.current!.getSubmission();
    expect(submission).toBeDefined();
    expect(ownerRef.current!.getState().pendingTurn).toBeDefined();
`,
    'drive turn submission through rendered UI',
  );
  content = replaceExact(
    content,
`       await submission;
`,
`       await submission!;
`,
    'await UI-started submission',
  );
  content = replaceExact(
    content,
`    expect(rendered).toContain('レポート作成');
    expect(rendered).toContain('この内容で仮予定にする');
`,
`    expect(rendered).toContain('レポートを1時間進めたい');
    expect(rendered).toContain('仮予定を作成しました。');
    expect(rendered).toContain('レポート作成');
    expect(rendered).toContain('この内容で仮予定にする');
`,
    'assert conversation and preview after remount',
  );
  write(path, content);
}
