import { minutesBetween } from './date';
import type {
  PlanDraft,
  RecurrenceWeekday,
  ScheduleTemplate,
} from '../types/domain';

export interface TimetableImportCandidate {
  id: string;
  sourceId: string;
  templates: ScheduleTemplate[];
  title: string;
  subject: string;
  type: ScheduleTemplate['type'];
  weekday: RecurrenceWeekday;
  termId: string;
  startTime: string;
  endTime: string;
  periodLabel: string;
  classroom: string;
  memo: string;
  isGrouped: boolean;
}

interface TimetableImportCandidateInput {
  templates: ScheduleTemplate[];
  date: string;
  weekday: RecurrenceWeekday;
  termId: string;
}

function getTemplateTermId(template: ScheduleTemplate): string {
  return template.termId || 'default';
}

function getNormalizedTitle(template: ScheduleTemplate): string {
  return template.title.trim();
}

function getPeriodNumber(template: ScheduleTemplate): number | null {
  return typeof template.periodNumber === 'number' && Number.isFinite(template.periodNumber)
    ? template.periodNumber
    : null;
}

function compareTemplatesForImport(
  left: ScheduleTemplate,
  right: ScheduleTemplate,
): number {
  const leftPeriod = getPeriodNumber(left);
  const rightPeriod = getPeriodNumber(right);

  if (leftPeriod !== null && rightPeriod !== null && leftPeriod !== rightPeriod) {
    return leftPeriod - rightPeriod;
  }

  if (leftPeriod !== null && rightPeriod === null) {
    return -1;
  }

  if (leftPeriod === null && rightPeriod !== null) {
    return 1;
  }

  const startDelta = left.startTime.localeCompare(right.startTime);

  if (startDelta !== 0) {
    return startDelta;
  }

  return left.endTime.localeCompare(right.endTime);
}

function canAppendToGroup(
  group: ScheduleTemplate[],
  template: ScheduleTemplate,
): boolean {
  const previous = group[group.length - 1];
  const previousPeriod = getPeriodNumber(previous);
  const nextPeriod = getPeriodNumber(template);

  return (
    previousPeriod !== null &&
    nextPeriod !== null &&
    nextPeriod === previousPeriod + 1 &&
    getTemplateTermId(previous) === getTemplateTermId(template) &&
    previous.weekday === template.weekday &&
    getNormalizedTitle(previous) === getNormalizedTitle(template)
  );
}

function formatPeriodLabel(group: ScheduleTemplate[]): string {
  const firstPeriod = getPeriodNumber(group[0]);
  const lastPeriod = getPeriodNumber(group[group.length - 1]);

  if (firstPeriod === null || lastPeriod === null) {
    return '';
  }

  return firstPeriod === lastPeriod ? `${firstPeriod}限` : `${firstPeriod}〜${lastPeriod}限`;
}

function buildGroupedTimetableSourceId(
  group: ScheduleTemplate[],
  date: string,
  title: string,
): string {
  const first = group[0];
  const last = group[group.length - 1];
  const firstPeriod = getPeriodNumber(first) ?? 'unknown';
  const lastPeriod = getPeriodNumber(last) ?? 'unknown';

  return [
    'timetable',
    getTemplateTermId(first),
    date,
    first.weekday,
    `${firstPeriod}-${lastPeriod}`,
    encodeURIComponent(title),
  ].join(':');
}

function summarizeClassrooms(group: ScheduleTemplate[]): {
  classroom: string;
  memoLine: string;
} {
  const classroomEntries = group
    .map((template) => ({
      periodLabel:
        getPeriodNumber(template) !== null ? `${getPeriodNumber(template)}限` : template.startTime,
      classroom: template.classroom?.trim() ?? '',
    }))
    .filter((entry) => entry.classroom.length > 0);
  const uniqueClassrooms = Array.from(new Set(classroomEntries.map((entry) => entry.classroom)));

  if (classroomEntries.length === 0) {
    return { classroom: '', memoLine: '' };
  }

  if (uniqueClassrooms.length === 1 && classroomEntries.length === group.length) {
    return {
      classroom: uniqueClassrooms[0],
      memoLine: `教室: ${uniqueClassrooms[0]}`,
    };
  }

  return {
    classroom: uniqueClassrooms.length === 1 ? uniqueClassrooms[0] : '複数教室',
    memoLine: `教室: ${classroomEntries
      .map((entry) => `${entry.periodLabel} ${entry.classroom}`)
      .join(' / ')}`,
  };
}

function summarizeTemplateMemos(group: ScheduleTemplate[]): string[] {
  const memoEntries = group
    .map((template) => ({
      periodLabel:
        getPeriodNumber(template) !== null ? `${getPeriodNumber(template)}限` : template.startTime,
      memo: template.memo.trim(),
    }))
    .filter((entry) => entry.memo.length > 0);

  if (memoEntries.length === 0) {
    return [];
  }

  const uniqueMemos = Array.from(new Set(memoEntries.map((entry) => entry.memo)));

  if (uniqueMemos.length === 1) {
    return [uniqueMemos[0]];
  }

  return memoEntries.map((entry) => `${entry.periodLabel}: ${entry.memo}`);
}

function buildCandidateFromGroup(
  group: ScheduleTemplate[],
  date: string,
): TimetableImportCandidate {
  const first = group[0];
  const last = group[group.length - 1];
  const title = getNormalizedTitle(first);
  const classroomSummary = summarizeClassrooms(group);
  const memoParts = [
    classroomSummary.memoLine,
    ...summarizeTemplateMemos(group),
  ].filter(Boolean);
  const sourceId =
    group.length === 1 ? first.id : buildGroupedTimetableSourceId(group, date, title);

  return {
    id: sourceId,
    sourceId,
    templates: group,
    title,
    subject: first.subject,
    type: first.type,
    weekday: first.weekday,
    termId: getTemplateTermId(first),
    startTime: first.startTime,
    endTime: last.endTime,
    periodLabel: formatPeriodLabel(group),
    classroom: classroomSummary.classroom,
    memo: memoParts.join('\n'),
    isGrouped: group.length > 1,
  };
}

export function buildTimetableImportCandidates({
  templates,
  date,
  weekday,
  termId,
}: TimetableImportCandidateInput): TimetableImportCandidate[] {
  const sortedTemplates = templates
    .filter(
      (template) =>
        template.weekday === weekday &&
        template.active !== false &&
        getTemplateTermId(template) === termId &&
        getNormalizedTitle(template).length > 0 &&
        minutesBetween(template.startTime, template.endTime) > 0,
    )
    .slice()
    .sort(compareTemplatesForImport);
  const groups: ScheduleTemplate[][] = [];
  const openGroupByTitle = new Map<string, ScheduleTemplate[]>();

  for (const template of sortedTemplates) {
    const title = getNormalizedTitle(template);
    const currentGroup = openGroupByTitle.get(title);

    if (currentGroup && canAppendToGroup(currentGroup, template)) {
      currentGroup.push(template);
      continue;
    }

    const nextGroup = [template];
    groups.push(nextGroup);
    openGroupByTitle.set(title, nextGroup);
  }

  return groups.map((group) => buildCandidateFromGroup(group, date));
}

export function createPlanDraftFromTimetableImportCandidate(
  candidate: TimetableImportCandidate,
  userId: string,
  date: string,
): PlanDraft {
  return {
    userId,
    title: candidate.title,
    subject: candidate.subject,
    date,
    startTime: candidate.startTime,
    endTime: candidate.endTime,
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: candidate.type,
    memo: candidate.memo,
    sourceType: 'timetable',
    sourceId: candidate.sourceId,
  };
}
