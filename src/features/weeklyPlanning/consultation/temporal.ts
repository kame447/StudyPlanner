import type {
  RequestTemporalContext,
  TemporalCandidate,
  TemporalResolution,
} from './contracts';

export type TemporalResolutionResult =
  | { resolved: true; value: TemporalResolution }
  | { resolved: false; reason: string };

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

function formatIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function resolveTemporalCandidate(
  candidate: TemporalCandidate,
  context: RequestTemporalContext,
): TemporalResolutionResult {
  if (!parseIsoDate(context.currentDate)) {
    return { resolved: false, reason: 'invalid_request_current_date' };
  }

  if (candidate.kind === 'absolute_date') {
    if (!parseIsoDate(candidate.date)) return { resolved: false, reason: 'invalid_absolute_date' };
    return {
      resolved: true,
      value: {
        candidate,
        canonicalStartDate: candidate.date,
        canonicalEndDate: candidate.date,
        basis: `absolute:${candidate.date}`,
        resolvedAtDate: context.currentDate,
      },
    };
  }

  if (candidate.kind === 'month_end') {
    if (!Number.isSafeInteger(candidate.year)
        || candidate.year < 1
        || candidate.year > 9999
        || !Number.isSafeInteger(candidate.month)
        || candidate.month < 1
        || candidate.month > 12) {
      return { resolved: false, reason: 'invalid_month_end' };
    }
    const end = new Date(Date.UTC(candidate.year, candidate.month, 0));
    const date = formatIsoDate(end);
    return {
      resolved: true,
      value: {
        candidate,
        canonicalStartDate: date,
        canonicalEndDate: date,
        basis: `month_end:${candidate.year}-${String(candidate.month).padStart(2, '0')}`,
        resolvedAtDate: context.currentDate,
      },
    };
  }

  if (candidate.kind === 'relative_to_exam') {
    if (!Number.isSafeInteger(candidate.offsetDays)) return { resolved: false, reason: 'invalid_exam_offset' };
    const authoritativeDate = context.authoritativeDates[candidate.examRef];
    if (!authoritativeDate) return { resolved: false, reason: 'missing_authoritative_exam_date' };
    const examDate = parseIsoDate(authoritativeDate);
    if (!examDate) return { resolved: false, reason: 'invalid_authoritative_exam_date' };
    const resolved = addDays(examDate, candidate.offsetDays);
    if (!Number.isFinite(resolved.getTime())) return { resolved: false, reason: 'resolved_date_out_of_range' };
    const resolvedYear = resolved.getUTCFullYear();
    if (resolvedYear < 1 || resolvedYear > 9999) return { resolved: false, reason: 'resolved_date_out_of_range' };
    const resolvedDate = formatIsoDate(resolved);
    return {
      resolved: true,
      value: {
        candidate,
        canonicalStartDate: resolvedDate,
        canonicalEndDate: resolvedDate,
        basis: `authoritative_date:${candidate.examRef}:${authoritativeDate}:${candidate.offsetDays}`,
        resolvedAtDate: context.currentDate,
      },
    };
  }

  const start = parseIsoDate(candidate.startDate);
  const end = parseIsoDate(candidate.endDate);
  if (!start || !end || start.getTime() > end.getTime()) {
    return { resolved: false, reason: 'invalid_date_range' };
  }
  return {
    resolved: true,
    value: {
      candidate,
      canonicalStartDate: candidate.startDate,
      canonicalEndDate: candidate.endDate,
      basis: `date_range:${candidate.startDate}:${candidate.endDate}`,
      resolvedAtDate: context.currentDate,
    },
  };
}
