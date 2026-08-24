import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content, 'utf8');
}

function replaceOnce(path, before, after) {
  const source = read(path);
  const index = source.indexOf(before);
  if (index < 0) {
    throw new Error(`Expected patch anchor not found in ${path}: ${before.slice(0, 120)}`);
  }
  if (source.indexOf(before, index + before.length) >= 0) {
    throw new Error(`Patch anchor is not unique in ${path}: ${before.slice(0, 120)}`);
  }
  write(path, source.slice(0, index) + after + source.slice(index + before.length));
}

function insertBeforeLast(path, marker, insertion) {
  const source = read(path);
  const index = source.lastIndexOf(marker);
  if (index < 0) {
    throw new Error(`Final marker not found in ${path}`);
  }
  write(path, source.slice(0, index) + insertion + source.slice(index));
}

// Domain schema: optional for persisted backward compatibility; all new drafts write it explicitly.
replaceOnce(
  'src/types/domain.ts',
  `export interface MonthEvent {\n  id: string;\n  userId: string;\n  date: string;\n  title: string;`,
  `export interface MonthEvent {\n  id: string;\n  userId: string;\n  date: string;\n  endDate?: string;\n  title: string;`,
);
replaceOnce(
  'src/types/domain.ts',
  `export interface MonthEventDraft {\n  userId: string;\n  date: string;\n  title: string;`,
  `export interface MonthEventDraft {\n  userId: string;\n  date: string;\n  endDate?: string;\n  title: string;`,
);

// Draft creation/conversion always materializes endDate so newly saved data is explicit.
replaceOnce(
  'src/domain/planner.ts',
  `export function createEmptyMonthEventDraft(\n  userId: string,\n  date: string,\n): MonthEventDraft {\n  return {\n    userId,\n    date,\n    title: '',`,
  `export function createEmptyMonthEventDraft(\n  userId: string,\n  date: string,\n): MonthEventDraft {\n  return {\n    userId,\n    date,\n    endDate: date,\n    title: '',`,
);
replaceOnce(
  'src/domain/planner.ts',
  `  return {\n    userId: event.userId,\n    date: event.date,\n    title: event.title,`,
  `  return {\n    userId: event.userId,\n    date: event.date,\n    endDate: event.endDate ?? event.date,\n    title: event.title,`,
);

write(
  'src/lib/monthEvents.ts',
  `import { addDays, parseTimeToMinutes, minutesFromTime } from './date';\nimport type { MonthEvent, MonthEventRepeat } from '../types/domain';\n\nexport const MONTH_EVENT_REPEAT_OPTIONS: Array<{\n  value: MonthEventRepeat;\n  label: string;\n}> = [\n  { value: 'none', label: '繰り返しなし' },\n  { value: 'daily', label: '毎日' },\n  { value: 'weekly', label: '毎週' },\n  { value: 'monthly', label: '毎月' },\n  { value: 'yearly', label: '毎年' },\n];\n\nfunction toDate(dateString: string): Date {\n  return new Date(\`${'${dateString}'}T00:00:00\`);\n}\n\nfunction isSameOrAfterDate(targetDate: string, baseDate: string): boolean {\n  return targetDate.localeCompare(baseDate) >= 0;\n}\n\nfunction calendarDayNumber(dateString: string): number {\n  const [year, month, day] = dateString.split('-').map(Number);\n  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);\n}\n\nexport function getMonthEventEndDate(\n  event: Pick<MonthEvent, 'date' | 'endDate'>,\n): string {\n  const candidate = event.endDate?.trim();\n  return candidate && candidate.localeCompare(event.date) >= 0\n    ? candidate\n    : event.date;\n}\n\nfunction getMonthEventSpanDays(\n  event: Pick<MonthEvent, 'date' | 'endDate'>,\n): number {\n  return Math.max(\n    0,\n    calendarDayNumber(getMonthEventEndDate(event)) - calendarDayNumber(event.date),\n  );\n}\n\nfunction isMonthEventOccurrenceStartDate(\n  event: MonthEvent,\n  targetDate: string,\n): boolean {\n  if (!isSameOrAfterDate(targetDate, event.date)) {\n    return false;\n  }\n\n  if (event.repeat !== 'none' && event.repeatUntil && targetDate.localeCompare(event.repeatUntil) > 0) {\n    return false;\n  }\n\n  if (event.excludedDates.includes(targetDate)) {\n    return false;\n  }\n\n  if (event.repeat === 'none') {\n    return event.date === targetDate;\n  }\n\n  const eventDate = toDate(event.date);\n  const date = toDate(targetDate);\n\n  if (event.repeat === 'daily') {\n    return true;\n  }\n\n  if (event.repeat === 'weekly') {\n    return eventDate.getDay() === date.getDay();\n  }\n\n  if (event.repeat === 'monthly') {\n    return eventDate.getDate() === date.getDate();\n  }\n\n  return (\n    eventDate.getMonth() === date.getMonth() &&\n    eventDate.getDate() === date.getDate()\n  );\n}\n\nexport function getMonthEventOccurrenceStartDate(\n  event: MonthEvent,\n  targetDate: string,\n): string | null {\n  if (!isSameOrAfterDate(targetDate, event.date)) {\n    return null;\n  }\n\n  const spanDays = getMonthEventSpanDays(event);\n\n  for (let offset = 0; offset <= spanDays; offset += 1) {\n    const candidateDate = addDays(targetDate, -offset);\n\n    if (candidateDate.localeCompare(event.date) < 0) {\n      break;\n    }\n\n    if (\n      isMonthEventOccurrenceStartDate(event, candidateDate) &&\n      targetDate.localeCompare(addDays(candidateDate, spanDays)) <= 0\n    ) {\n      return candidateDate;\n    }\n  }\n\n  return null;\n}\n\nexport function getMonthEventRepeatLabel(repeat: MonthEventRepeat): string {\n  return (\n    MONTH_EVENT_REPEAT_OPTIONS.find((option) => option.value === repeat)?.label ??\n    '繰り返しなし'\n  );\n}\n\nexport function doesMonthEventOccurOnDate(\n  event: MonthEvent,\n  targetDate: string,\n): boolean {\n  return getMonthEventOccurrenceStartDate(event, targetDate) !== null;\n}\n\nexport function getPreviousMonthEventOccurrenceDate(\n  event: MonthEvent,\n  targetDate: string,\n): string | null {\n  const currentOccurrenceStart = getMonthEventOccurrenceStartDate(event, targetDate);\n  let candidateDate = addDays(currentOccurrenceStart ?? targetDate, -1);\n\n  while (candidateDate.localeCompare(event.date) >= 0) {\n    if (isMonthEventOccurrenceStartDate(event, candidateDate)) {\n      return candidateDate;\n    }\n\n    candidateDate = addDays(candidateDate, -1);\n  }\n\n  return null;\n}\n\nexport function sortMonthEvents(events: MonthEvent[]): MonthEvent[] {\n  return [...events].sort((left, right) => {\n    if (left.date === right.date) {\n      return minutesFromTime(left.startTime) - minutesFromTime(right.startTime);\n    }\n\n    return left.date.localeCompare(right.date);\n  });\n}\n\nexport function formatMonthEventTimeRange(\n  event: Pick<MonthEvent, 'startTime' | 'endTime'>,\n) {\n  return \`${'${event.startTime}'}-${'${event.endTime}'}\`;\n}\n\nexport function formatMonthEventTimeRangeForDate(\n  event: MonthEvent,\n  targetDate: string,\n): string {\n  const occurrenceStart = getMonthEventOccurrenceStartDate(event, targetDate);\n\n  if (!occurrenceStart) {\n    return formatMonthEventTimeRange(event);\n  }\n\n  const spanDays = getMonthEventSpanDays(event);\n  if (spanDays === 0) {\n    return formatMonthEventTimeRange(event);\n  }\n\n  const allDay =\n    event.startTime === '00:00' &&\n    (event.endTime === '24:00' || event.endTime === '23:59' || event.endTime === '00:00');\n  if (allDay) {\n    return '終日';\n  }\n\n  const occurrenceEnd = addDays(occurrenceStart, spanDays);\n  if (targetDate === occurrenceStart) {\n    return \`${'${event.startTime}'}〜\`;\n  }\n  if (targetDate === occurrenceEnd) {\n    return \`〜${'${event.endTime}'}\`;\n  }\n  return '終日';\n}\n\nexport function formatMonthEventDuration(\n  event: Pick<MonthEvent, 'date' | 'endDate' | 'startTime' | 'endTime'>,\n) {\n  const spanMinutes = getMonthEventSpanDays(event) * 24 * 60;\n  return (\n    spanMinutes +\n    parseTimeToMinutes(event.endTime, 'end') -\n    parseTimeToMinutes(event.startTime, 'start')\n  );\n}\n`,
);

write(
  'src/lib/monthEventEditor.ts',
  `import { createMonthEventDraftFromEvent } from '../domain/planner';\nimport { minutesBetween } from './date';\nimport {\n  getMonthEventOccurrenceStartDate,\n  getPreviousMonthEventOccurrenceDate,\n} from './monthEvents';\nimport type { MonthEvent, MonthEventDraft } from '../types/domain';\n\nexport type MonthEventDeleteScope = 'single' | 'future';\n\nexport type MonthEventDeleteMutation =\n  | { type: 'delete'; monthEvent: MonthEvent }\n  | { type: 'save'; draft: MonthEventDraft; targetMonthEventId: string };\n\nexport function sanitizeMonthEventDraft(draft: MonthEventDraft): MonthEventDraft {\n  const checklist = draft.checklist\n    .map((item) => ({\n      ...item,\n      text: item.text.trim(),\n    }))\n    .filter((item) => item.text.length > 0);\n  const locationTags = draft.locationTags\n    .map((tag) => tag.trim())\n    .filter((tag, index, array) => tag.length > 0 && array.indexOf(tag) === index);\n  const repeatUntil =\n    draft.repeat === 'none' ||\n    !draft.repeatUntil ||\n    draft.repeatUntil.localeCompare(draft.date) < 0\n      ? null\n      : draft.repeatUntil;\n  const excludedDates =\n    draft.repeat === 'none'\n      ? []\n      : [...new Set(draft.excludedDates)]\n          .filter((date) => date.localeCompare(draft.date) >= 0)\n          .sort((left, right) => left.localeCompare(right));\n\n  return {\n    ...draft,\n    endDate: draft.endDate?.trim() || draft.date,\n    title: draft.title.trim(),\n    repeatUntil,\n    excludedDates,\n    url: draft.url.trim(),\n    memo: draft.memo.trim(),\n    checklist,\n    locationTags,\n  };\n}\n\nexport function validateMonthEventDraft(draft: MonthEventDraft): string | null {\n  if (!draft.title) {\n    return 'タイトルを入れてください。';\n  }\n\n  const endDate = draft.endDate ?? draft.date;\n  if (endDate.localeCompare(draft.date) < 0) {\n    return '終了日は開始日以降にしてください。';\n  }\n\n  if (endDate === draft.date && minutesBetween(draft.startTime, draft.endTime) <= 0) {\n    return '終了時刻は開始時刻より後にしてください。';\n  }\n\n  return null;\n}\n\nexport function resolveMonthEventDeleteMutation(\n  monthEvent: MonthEvent,\n  occurrenceDate: string,\n  scope: MonthEventDeleteScope,\n): MonthEventDeleteMutation {\n  const baseDraft = createMonthEventDraftFromEvent(monthEvent);\n  const occurrenceStartDate =\n    getMonthEventOccurrenceStartDate(monthEvent, occurrenceDate) ?? occurrenceDate;\n\n  if (scope === 'single') {\n    return {\n      type: 'save',\n      targetMonthEventId: monthEvent.id,\n      draft: sanitizeMonthEventDraft({\n        ...baseDraft,\n        excludedDates: [...baseDraft.excludedDates, occurrenceStartDate],\n      }),\n    };\n  }\n\n  const previousOccurrenceDate = getPreviousMonthEventOccurrenceDate(\n    monthEvent,\n    occurrenceStartDate,\n  );\n\n  if (!previousOccurrenceDate) {\n    return {\n      type: 'delete',\n      monthEvent,\n    };\n  }\n\n  return {\n    type: 'save',\n    targetMonthEventId: monthEvent.id,\n    draft: sanitizeMonthEventDraft({\n      ...baseDraft,\n      repeatUntil: previousOccurrenceDate,\n      excludedDates: baseDraft.excludedDates.filter(\n        (date) => date.localeCompare(previousOccurrenceDate) <= 0,\n      ),\n    }),\n  };\n}\n`,
);

// Month editor UI: independent start/end dates and same-day-only end-time restriction.
replaceOnce(
  'src/components/MonthEventDialog.tsx',
  `  formatMonthEventTimeRange,\n  getMonthEventRepeatLabel,`,
  `  formatMonthEventTimeRangeForDate,\n  getMonthEventRepeatLabel,`,
);
replaceOnce(
  'src/components/MonthEventDialog.tsx',
  `  const activeDate = openDate;\n  const startMinutes = parseTimeToMinutes(draft.startTime, 'start');\n  const datetimeButtonDate = formatMonthEventDateButton(draft.date);`,
  `  const activeDate = openDate;\n  const startMinutes = parseTimeToMinutes(draft.startTime, 'start');\n  const resolvedEndDate = draft.endDate ?? draft.date;\n  const startDateButtonLabel = formatMonthEventDateButton(draft.date);\n  const endDateButtonLabel = formatMonthEventDateButton(resolvedEndDate);\n  const isSameDayRange = resolvedEndDate === draft.date;`,
);
replaceOnce(
  'src/components/MonthEventDialog.tsx',
  `  function updateStartTime(nextStartTime: string) {\n    setDraft((current) => {\n      const nextStartMinutes = parseTimeToMinutes(nextStartTime, 'start');\n      const nextEndTime = editingEventId\n        ? calculateShiftedEndTimeForEdit(\n            nextStartMinutes,\n            calculateTimeRangeDurationMinutes(current.startTime, current.endTime),\n          )\n        : calculateAutoEndTimeForCreate(nextStartMinutes);\n\n      return {\n        ...current,\n        startTime: nextStartTime,\n        endTime: nextEndTime,\n      };\n    });\n  }`,
  `  function updateStartTime(nextStartTime: string) {\n    setDraft((current) => {\n      const currentEndDate = current.endDate ?? current.date;\n      if (currentEndDate !== current.date) {\n        return {\n          ...current,\n          startTime: nextStartTime,\n        };\n      }\n\n      const nextStartMinutes = parseTimeToMinutes(nextStartTime, 'start');\n      const nextEndTime = editingEventId\n        ? calculateShiftedEndTimeForEdit(\n            nextStartMinutes,\n            calculateTimeRangeDurationMinutes(current.startTime, current.endTime),\n          )\n        : calculateAutoEndTimeForCreate(nextStartMinutes);\n\n      return {\n        ...current,\n        startTime: nextStartTime,\n        endTime: nextEndTime,\n      };\n    });\n  }`,
);
replaceOnce(
  'src/components/MonthEventDialog.tsx',
  `  function updateEndTime(nextEndTime: string) {\n    setDraft((current) => ({\n      ...current,\n      endTime: nextEndTime,\n    }));\n  }\n\n  async function handleSave()`,
  `  function updateEndTime(nextEndTime: string) {\n    setDraft((current) => ({\n      ...current,\n      endTime: nextEndTime,\n    }));\n  }\n\n  function updateEventDate(\n    target: 'start' | 'end' | null,\n    nextDate: string,\n  ) {\n    if (!target) {\n      return;\n    }\n\n    setDraft((current) => {\n      const currentEndDate = current.endDate ?? current.date;\n\n      if (target === 'end') {\n        const nextEndTime =\n          nextDate === current.date &&\n          parseTimeToMinutes(current.endTime, 'end') <=\n            parseTimeToMinutes(current.startTime, 'start')\n            ? calculateAutoEndTimeForCreate(\n                parseTimeToMinutes(current.startTime, 'start'),\n              )\n            : current.endTime;\n\n        return {\n          ...current,\n          endDate: nextDate,\n          endTime: nextEndTime,\n        };\n      }\n\n      const nextEndDate =\n        currentEndDate.localeCompare(nextDate) < 0 ? nextDate : currentEndDate;\n      const nextEndTime =\n        nextEndDate === nextDate &&\n        parseTimeToMinutes(current.endTime, 'end') <=\n          parseTimeToMinutes(current.startTime, 'start')\n          ? calculateAutoEndTimeForCreate(\n              parseTimeToMinutes(current.startTime, 'start'),\n            )\n          : current.endTime;\n\n      return {\n        ...current,\n        date: nextDate,\n        endDate: nextEndDate,\n        endTime: nextEndTime,\n      };\n    });\n  }\n\n  async function handleSave()`,
);
replaceOnce(
  'src/components/MonthEventDialog.tsx',
  `                  {datetimeButtonDate}\n                </button>\n                <TimeWheelPicker\n                  value={draft.startTime}`,
  `                  {startDateButtonLabel}\n                </button>\n                <TimeWheelPicker\n                  value={draft.startTime}`,
);
replaceOnce(
  'src/components/MonthEventDialog.tsx',
  `                  {datetimeButtonDate}\n                </button>\n                <TimeWheelPicker\n                  value={draft.endTime}`,
  `                  {endDateButtonLabel}\n                </button>\n                <TimeWheelPicker\n                  value={draft.endTime}`,
);
replaceOnce(
  'src/components/MonthEventDialog.tsx',
  `                  minMinutes={Math.min(startMinutes + 1, MINUTES_PER_DAY)}\n                  onChange={updateEndTime}`,
  `                  minMinutes={\n                    isSameDayRange\n                      ? Math.min(startMinutes + 1, MINUTES_PER_DAY)\n                      : 0\n                  }\n                  onChange={updateEndTime}`,
);
replaceOnce(
  'src/components/MonthEventDialog.tsx',
  `{formatMonthEventTimeRange(monthEvent)}\n                        {monthEvent.repeat !== 'none'`,
  `{formatMonthEventTimeRangeForDate(monthEvent, activeDate)}\n                        {monthEvent.repeat !== 'none'`,
);
replaceOnce(
  'src/components/MonthEventDialog.tsx',
  `      <DayCalendarDialog\n        open={datePickerTarget !== null}\n        selectedDate={draft.date}\n        onSelectDate={(nextDate) =>\n          setDraft((current) => ({\n            ...current,\n            date: nextDate,\n          }))\n        }\n        onClose={() => setDatePickerTarget(null)}\n      />`,
  `      <DayCalendarDialog\n        open={datePickerTarget !== null}\n        selectedDate={datePickerTarget === 'end' ? resolvedEndDate : draft.date}\n        onSelectDate={(nextDate) => updateEventDate(datePickerTarget, nextDate)}\n        onClose={() => setDatePickerTarget(null)}\n      />`,
);

// Month cells display the correct boundary label for each date in a span.
replaceOnce(
  'src/components/MonthGridPanel.tsx',
  `import { formatMonthEventTimeRange } from '../lib/monthEvents';`,
  `import { formatMonthEventTimeRangeForDate } from '../lib/monthEvents';`,
);
replaceOnce(
  'src/components/MonthGridPanel.tsx',
  `title={\`${'${formatMonthEventTimeRange(monthEvent)}'} ${'${monthEvent.title}'}\`}`,
  `title={\`${'${formatMonthEventTimeRangeForDate(monthEvent, cell.date)}'} ${'${monthEvent.title}'}\`}`,
);
replaceOnce(
  'src/components/MonthGridPanel.tsx',
  `{formatMonthEventTimeRange(monthEvent)} {monthEvent.title}`,
  `{formatMonthEventTimeRangeForDate(monthEvent, cell.date)} {monthEvent.title}`,
);

replaceOnce(
  'src/components/MonthDaySheet.tsx',
  `import { doesMonthEventOccurOnDate, sortMonthEvents } from '../lib/monthEvents';`,
  `import {\n  doesMonthEventOccurOnDate,\n  formatMonthEventTimeRangeForDate,\n  sortMonthEvents,\n} from '../lib/monthEvents';`,
);
replaceOnce(
  'src/components/MonthDaySheet.tsx',
  `function isAllDay(event: MonthEvent): boolean {\n  return event.startTime === '00:00' && (event.endTime === '24:00' || event.endTime === '23:59');\n}\n\n`,
  ``,
);
replaceOnce(
  'src/components/MonthDaySheet.tsx',
  `                <span className="month-day-sheet-time">\n                  {isAllDay(event) ? (\n                    <strong>終日</strong>\n                  ) : (\n                    <>\n                      <strong>{event.startTime}</strong>\n                      <small>{event.endTime}</small>\n                    </>\n                  )}\n                </span>`,
  `                <span className="month-day-sheet-time">\n                  <strong>\n                    {formatMonthEventTimeRangeForDate(event, renderedDate)}\n                  </strong>\n                </span>`,
);

// Unit regressions.
replaceOnce(
  'src/lib/monthEventEditor.test.ts',
  `    date: '2026-08-10',\n    title: '  模試  ',`,
  `    date: '2026-08-10',\n    endDate: '2026-08-10',\n    title: '  模試  ',`,
);
replaceOnce(
  'src/lib/monthEventEditor.test.ts',
  `    expect(validateMonthEventDraft(createDraft({ startTime: '10:00', endTime: '10:00' }))).toBe(\n      '終了時刻は開始時刻より後にしてください。',\n    );\n    expect(validateMonthEventDraft(createDraft())).toBeNull();`,
  `    expect(validateMonthEventDraft(createDraft({ startTime: '10:00', endTime: '10:00' }))).toBe(\n      '終了時刻は開始時刻より後にしてください。',\n    );\n    expect(\n      validateMonthEventDraft(\n        createDraft({\n          endDate: '2026-08-12',\n          startTime: '23:00',\n          endTime: '01:00',\n        }),\n      ),\n    ).toBeNull();\n    expect(validateMonthEventDraft(createDraft({ endDate: '2026-08-09' }))).toBe(\n      '終了日は開始日以降にしてください。',\n    );\n    expect(validateMonthEventDraft(createDraft())).toBeNull();`,
);
insertBeforeLast(
  'src/lib/monthEventEditor.test.ts',
  `});\n`,
  `\n  it('deletes a multi-day recurring occurrence by its anchor date', () => {\n    const result = resolveMonthEventDeleteMutation(\n      createEvent({\n        date: '2026-08-10',\n        endDate: '2026-08-12',\n        repeat: 'weekly',\n        excludedDates: [],\n      }),\n      '2026-08-11',\n      'single',\n    );\n\n    expect(result).toMatchObject({\n      type: 'save',\n      draft: { excludedDates: ['2026-08-10'] },\n    });\n  });\n`,
);

write(
  'src/lib/monthEvents.test.ts',
  `import { describe, expect, it } from 'vitest';\nimport {\n  doesMonthEventOccurOnDate,\n  formatMonthEventDuration,\n  formatMonthEventTimeRangeForDate,\n  getMonthEventOccurrenceStartDate,\n  getPreviousMonthEventOccurrenceDate,\n} from './monthEvents';\nimport type { MonthEvent } from '../types/domain';\n\nfunction createEvent(overrides: Partial<MonthEvent> = {}): MonthEvent {\n  return {\n    id: 'event-1',\n    userId: 'user-1',\n    date: '2026-08-26',\n    title: '合宿',\n    startTime: '09:00',\n    endTime: '10:00',\n    repeat: 'none',\n    repeatUntil: null,\n    excludedDates: [],\n    url: '',\n    memo: '',\n    checklist: [],\n    locationTags: [],\n    createdAt: '2026-08-01T00:00:00.000Z',\n    updatedAt: '2026-08-01T00:00:00.000Z',\n    ...overrides,\n  };\n}\n\ndescribe('month event multi-day ranges', () => {\n  it('keeps legacy events without endDate on their original single day', () => {\n    const event = createEvent();\n    expect(doesMonthEventOccurOnDate(event, '2026-08-26')).toBe(true);\n    expect(doesMonthEventOccurOnDate(event, '2026-08-27')).toBe(false);\n  });\n\n  it('projects a non-repeating event across every date in its inclusive range', () => {\n    const event = createEvent({ endDate: '2026-08-28' });\n    expect(doesMonthEventOccurOnDate(event, '2026-08-25')).toBe(false);\n    expect(doesMonthEventOccurOnDate(event, '2026-08-26')).toBe(true);\n    expect(doesMonthEventOccurOnDate(event, '2026-08-27')).toBe(true);\n    expect(doesMonthEventOccurOnDate(event, '2026-08-28')).toBe(true);\n    expect(doesMonthEventOccurOnDate(event, '2026-08-29')).toBe(false);\n    expect(formatMonthEventTimeRangeForDate(event, '2026-08-26')).toBe('09:00〜');\n    expect(formatMonthEventTimeRangeForDate(event, '2026-08-27')).toBe('終日');\n    expect(formatMonthEventTimeRangeForDate(event, '2026-08-28')).toBe('〜10:00');\n  });\n\n  it('supports overnight ranges whose end clock time is earlier than the start clock time', () => {\n    const event = createEvent({\n      endDate: '2026-08-27',\n      startTime: '23:00',\n      endTime: '01:00',\n    });\n    expect(formatMonthEventDuration(event)).toBe(120);\n  });\n\n  it('repeats the whole date span from each recurrence anchor', () => {\n    const event = createEvent({\n      date: '2026-08-24',\n      endDate: '2026-08-26',\n      repeat: 'weekly',\n      repeatUntil: '2026-08-31',\n    });\n    expect(getMonthEventOccurrenceStartDate(event, '2026-08-25')).toBe('2026-08-24');\n    expect(getMonthEventOccurrenceStartDate(event, '2026-09-01')).toBe('2026-08-31');\n    expect(getMonthEventOccurrenceStartDate(event, '2026-09-02')).toBe('2026-08-31');\n    expect(doesMonthEventOccurOnDate(event, '2026-09-03')).toBe(false);\n  });\n\n  it('excludes a recurring multi-day occurrence by its start-date anchor', () => {\n    const event = createEvent({\n      date: '2026-08-24',\n      endDate: '2026-08-26',\n      repeat: 'weekly',\n      excludedDates: ['2026-08-31'],\n    });\n    expect(doesMonthEventOccurOnDate(event, '2026-08-31')).toBe(false);\n    expect(doesMonthEventOccurOnDate(event, '2026-09-01')).toBe(false);\n    expect(doesMonthEventOccurOnDate(event, '2026-09-02')).toBe(false);\n  });\n\n  it('finds the previous recurrence anchor when the selected date is inside a span', () => {\n    const event = createEvent({\n      date: '2026-08-10',\n      endDate: '2026-08-12',\n      repeat: 'weekly',\n    });\n    expect(getPreviousMonthEventOccurrenceDate(event, '2026-08-18')).toBe('2026-08-10');\n  });\n});\n`,
);

insertBeforeLast(
  'src/lib/monthViewProjection.test.ts',
  `});\n`,
  `\n  it('projects one multi-day month event into each covered calendar cell', () => {\n    const multiDay = {\n      ...createMonthEvent('multi-day', '09:00'),\n      endDate: '2026-08-16',\n    };\n    const projection = buildMonthPanelProjection({\n      monthDate: '2026-08-01',\n      plans: [],\n      actuals: [],\n      monthEvents: [multiDay],\n    });\n\n    for (const date of ['2026-08-14', '2026-08-15', '2026-08-16']) {\n      expect(\n        projection.cells.find((cell) => cell.date === date)?.monthEvents.map((event) => event.id),\n      ).toContain('multi-day');\n    }\n    expect(\n      projection.cells.find((cell) => cell.date === '2026-08-17')?.monthEvents.map((event) => event.id),\n    ).not.toContain('multi-day');\n  });\n`,
);

replaceOnce(
  'tests/e2e/mobile-overlay-stability.spec.mjs',
  `    localStorage.setItem('studyplanner.actuals', '[]');\n    localStorage.setItem('studyplanner.todos.v1', '[]');`,
  `    localStorage.setItem('studyplanner.actuals', '[]');\n    localStorage.setItem('studyplanner.monthEvents', '[]');\n    localStorage.setItem('studyplanner.todos.v1', '[]');`,
);
insertBeforeLast(
  'tests/e2e/mobile-overlay-stability.spec.mjs',
  `});\n`,
  `\n  test('month event supports independent start and end dates and spans every covered day', async ({ page }) => {\n    await seedMobileOverlayState(page);\n    await openSchedule(page);\n\n    const grid = page.getByRole('grid', { name: '月間カレンダー' });\n    const cellForDay = (day) =>\n      grid.locator('[role="gridcell"]').filter({\n        has: page.locator('.month-date-number').filter({\n          hasText: new RegExp(\`^${'${day}'}$\`),\n        }),\n      }).first();\n\n    const startCell = cellForDay(10);\n    await expect(startCell).toBeVisible();\n    await startCell.focus();\n    await page.keyboard.press('Enter');\n\n    const editorOverlay = page.locator('.month-event-modal-overlay');\n    const editor = editorOverlay.locator('.month-event-modal');\n    await expect(editor).toBeVisible();\n    await editor.getByLabel('タイトル').fill('複数日イベント');\n\n    const startDateButton = editor.getByRole('button', { name: '開始日' });\n    const endDateButton = editor.getByRole('button', { name: '終了日' });\n    await expect(startDateButton).toContainText('10日');\n    await expect(endDateButton).toContainText('10日');\n\n    await endDateButton.click();\n    const picker = editorOverlay.locator(':scope > .date-picker-overlay');\n    const endDay = picker\n      .locator('.mini-calendar-day:not(.is-outside)')\n      .filter({ hasText: /^12$/ })\n      .first();\n    await expect(endDay).toBeVisible();\n    await endDay.click();\n\n    await expect(startDateButton).toContainText('10日');\n    await expect(endDateButton).toContainText('12日');\n    await editor.getByRole('button', { name: '保存' }).click();\n\n    await expect.poll(() =>\n      page.evaluate(() => {\n        const items = JSON.parse(localStorage.getItem('studyplanner.monthEvents') ?? '[]');\n        const event = items.find((item) => item.title === '複数日イベント');\n        return event\n          ? {\n              startDay: Number(event.date.slice(-2)),\n              endDay: Number((event.endDate ?? event.date).slice(-2)),\n            }\n          : null;\n      }),\n    ).toEqual({ startDay: 10, endDay: 12 });\n\n    await expect(cellForDay(10)).toContainText('複数日イベント');\n    await expect(cellForDay(11)).toContainText('複数日イベント');\n    await expect(cellForDay(12)).toContainText('複数日イベント');\n    await expect(cellForDay(13)).not.toContainText('複数日イベント');\n  });\n`,
);

console.log('Applied multi-day MonthEvent range patch.');
