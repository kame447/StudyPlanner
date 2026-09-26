import { useCallback, useState } from 'react';

export const MAX_ADMIN_DATE_RANGE_DAYS = 93;
export const ADMIN_DATE_RANGE_ERROR_MESSAGE =
  '有効な期間（実在する日付・93日以内）を入力してください。';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MIN_SUPPORTED_YEAR = 1000;
const MILLISECONDS_PER_DAY = 86_400_000;

export interface AdminDateRangeOptions {
  defaultFromDate: string;
  defaultToDate: string;
  initialFromDate?: string | null;
  initialToDate?: string | null;
}

export interface AdminDateRangeState {
  fromDate: string;
  toDate: string;
  appliedFromDate: string;
  appliedToDate: string;
  errorMessage: string;
  setFromDate: (value: string) => void;
  setToDate: (value: string) => void;
}

export function isValidAdminDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())
    && date.getUTCFullYear() >= MIN_SUPPORTED_YEAR
    && date.toISOString().slice(0, 10) === value;
}

export function validateAdminDateRange(fromDate: string, toDate: string): string | null {
  if (!isValidAdminDate(fromDate) || !isValidAdminDate(toDate)) {
    return ADMIN_DATE_RANGE_ERROR_MESSAGE;
  }

  if (fromDate > toDate) {
    return ADMIN_DATE_RANGE_ERROR_MESSAGE;
  }

  const from = new Date(`${fromDate}T00:00:00.000Z`).getTime();
  const to = new Date(`${toDate}T00:00:00.000Z`).getTime();
  const days = Math.floor((to - from) / MILLISECONDS_PER_DAY) + 1;
  if (days > MAX_ADMIN_DATE_RANGE_DAYS) {
    return ADMIN_DATE_RANGE_ERROR_MESSAGE;
  }

  return null;
}

function resolveInitialRange(options: AdminDateRangeOptions): {
  fromDate: string;
  toDate: string;
} {
  const fallback = {
    fromDate: options.defaultFromDate,
    toDate: options.defaultToDate,
  };
  const candidate = {
    fromDate: options.initialFromDate ?? fallback.fromDate,
    toDate: options.initialToDate ?? fallback.toDate,
  };

  return validateAdminDateRange(candidate.fromDate, candidate.toDate) === null
    ? candidate
    : fallback;
}

export function useAdminDateRange(options: AdminDateRangeOptions): AdminDateRangeState {
  const [initialRange] = useState(() => resolveInitialRange(options));
  const [fromDate, setFromDateState] = useState(initialRange.fromDate);
  const [toDate, setToDateState] = useState(initialRange.toDate);
  const [appliedFromDate, setAppliedFromDate] = useState(initialRange.fromDate);
  const [appliedToDate, setAppliedToDate] = useState(initialRange.toDate);
  const [errorMessage, setErrorMessage] = useState('');

  const updateRange = useCallback((nextFromDate: string, nextToDate: string) => {
    const nextErrorMessage = validateAdminDateRange(nextFromDate, nextToDate);
    setErrorMessage(nextErrorMessage ?? '');
    if (nextErrorMessage !== null) return;

    setAppliedFromDate(nextFromDate);
    setAppliedToDate(nextToDate);
  }, []);

  const setFromDate = useCallback((value: string) => {
    setFromDateState(value);
    updateRange(value, toDate);
  }, [toDate, updateRange]);

  const setToDate = useCallback((value: string) => {
    setToDateState(value);
    updateRange(fromDate, value);
  }, [fromDate, updateRange]);

  return {
    fromDate,
    toDate,
    appliedFromDate,
    appliedToDate,
    errorMessage,
    setFromDate,
    setToDate,
  };
}
