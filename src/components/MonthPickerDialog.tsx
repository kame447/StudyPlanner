import { useEffect, useMemo, useRef, useState } from 'react';
import { formatMonthLabel, todayIsoDate } from '../lib/date';

interface MonthPickerDialogProps {
  open: boolean;
  activeMonthDate: string;
  onSelectMonth: (date: string) => void;
  onClose: () => void;
}

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: `${index + 1}月`,
}));

const PICKER_SCROLL_SETTLE_MS = 90;

function buildMonthDate(year: number, month: number): string {
  return `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-01`;
}

function findClosestPickerValue(
  container: HTMLDivElement,
  values: number[],
): number | null {
  const centerY = container.scrollTop + container.clientHeight / 2;
  let closestValue: number | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  values.forEach((value) => {
    const item = container.querySelector<HTMLElement>(`[data-value="${value}"]`);

    if (!item) {
      return;
    }

    const itemCenter = item.offsetTop + item.offsetHeight / 2;
    const distance = Math.abs(itemCenter - centerY);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestValue = value;
    }
  });

  return closestValue;
}

function scrollToPickerValue(
  container: HTMLDivElement | null,
  value: number,
  behavior: ScrollBehavior,
) {
  if (!container) {
    return;
  }

  const item = container.querySelector<HTMLElement>(`[data-value="${value}"]`);

  if (!item) {
    return;
  }

  const nextScrollTop =
    item.offsetTop - container.clientHeight / 2 + item.offsetHeight / 2;

  container.scrollTo({
    top: Math.max(0, nextScrollTop),
    behavior,
  });
}

export function MonthPickerDialog({
  open,
  activeMonthDate,
  onSelectMonth,
  onClose,
}: MonthPickerDialogProps) {
  const activeYear = Number(activeMonthDate.slice(0, 4));
  const activeMonth = Number(activeMonthDate.slice(5, 7));
  const currentMonthDate = useMemo(() => todayIsoDate().slice(0, 7) + '-01', []);
  const currentYear = Number(currentMonthDate.slice(0, 4));
  const currentMonth = Number(currentMonthDate.slice(5, 7));
  const [selectedYear, setSelectedYear] = useState(activeYear);
  const [selectedMonth, setSelectedMonth] = useState(activeMonth);
  const yearPickerRef = useRef<HTMLDivElement | null>(null);
  const monthPickerRef = useRef<HTMLDivElement | null>(null);
  const yearScrollTimeoutRef = useRef<number | null>(null);
  const monthScrollTimeoutRef = useRef<number | null>(null);
  const yearOptions = useMemo(() => {
    const startYear = Math.min(activeYear, currentYear) - 40;
    const endYear = Math.max(activeYear, currentYear) + 40;
    return Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index);
  }, [activeYear, currentYear]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSelectedYear(activeYear);
    setSelectedMonth(activeMonth);
  }, [activeMonth, activeYear, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    window.setTimeout(() => {
      scrollToPickerValue(yearPickerRef.current, activeYear, 'auto');
      scrollToPickerValue(monthPickerRef.current, activeMonth, 'auto');
    }, 0);

    return () => {
      if (yearScrollTimeoutRef.current !== null) {
        window.clearTimeout(yearScrollTimeoutRef.current);
      }

      if (monthScrollTimeoutRef.current !== null) {
        window.clearTimeout(monthScrollTimeoutRef.current);
      }
    };
  }, [activeMonthDate, open]);

  if (!open) {
    return null;
  }

  function handleApply() {
    onSelectMonth(buildMonthDate(selectedYear, selectedMonth));
    onClose();
  }

  function handleYearScroll() {
    if (!yearPickerRef.current) {
      return;
    }

    if (yearScrollTimeoutRef.current !== null) {
      window.clearTimeout(yearScrollTimeoutRef.current);
    }

    yearScrollTimeoutRef.current = window.setTimeout(() => {
      const nextYear = findClosestPickerValue(yearPickerRef.current!, yearOptions);

      if (nextYear !== null) {
        setSelectedYear(nextYear);
        scrollToPickerValue(yearPickerRef.current, nextYear, 'smooth');
      }
    }, PICKER_SCROLL_SETTLE_MS);
  }

  function handleMonthScroll() {
    if (!monthPickerRef.current) {
      return;
    }

    if (monthScrollTimeoutRef.current !== null) {
      window.clearTimeout(monthScrollTimeoutRef.current);
    }

    monthScrollTimeoutRef.current = window.setTimeout(() => {
      const nextMonth = findClosestPickerValue(
        monthPickerRef.current!,
        MONTH_OPTIONS.map((month) => month.value),
      );

      if (nextMonth !== null) {
        setSelectedMonth(nextMonth);
        scrollToPickerValue(monthPickerRef.current, nextMonth, 'smooth');
      }
    }, PICKER_SCROLL_SETTLE_MS);
  }

  return (
    <div className="overlay modal-overlay" onClick={onClose}>
      <div
        className="modal-card month-picker-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="section-stack">
          <div className="section-header">
            <div>
              <h2>年月を選択</h2>
              <p>{formatMonthLabel(activeMonthDate)} から直接移動できます。</p>
            </div>
            <button className="ghost-button" onClick={onClose} type="button">
              閉じる
            </button>
          </div>

          <section className="assistant-settings-card">
            <div className="month-wheel-picker">
              <div className="month-wheel-column">
                <span className="month-wheel-label">年</span>
                <div
                  ref={yearPickerRef}
                  className="month-wheel-list"
                  onScroll={handleYearScroll}
                >
                  {yearOptions.map((year) => (
                    <button
                      key={year}
                      className={
                        selectedYear === year
                          ? 'month-wheel-item active'
                          : 'month-wheel-item'
                      }
                      data-value={year}
                      onClick={() => {
                        setSelectedYear(year);
                        scrollToPickerValue(yearPickerRef.current, year, 'smooth');
                      }}
                      type="button"
                    >
                      {year}年
                    </button>
                  ))}
                </div>
              </div>

              <div className="month-wheel-column">
                <span className="month-wheel-label">月</span>
                <div
                  ref={monthPickerRef}
                  className="month-wheel-list"
                  onScroll={handleMonthScroll}
                >
                  {MONTH_OPTIONS.map((month) => (
                    <button
                      key={month.value}
                      className={
                        selectedMonth === month.value
                          ? 'month-wheel-item active'
                          : 'month-wheel-item'
                      }
                      data-value={month.value}
                      onClick={() => {
                        setSelectedMonth(month.value);
                        scrollToPickerValue(
                          monthPickerRef.current,
                          month.value,
                          'smooth',
                        );
                      }}
                      type="button"
                    >
                      {month.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="row-actions month-picker-actions">
              <button
                className="ghost-button"
                onClick={() => {
                  setSelectedYear(currentYear);
                  scrollToPickerValue(yearPickerRef.current, currentYear, 'smooth');
                }}
                type="button"
              >
                今年
              </button>
              <button
                className="ghost-button"
                onClick={() => {
                  setSelectedYear(currentYear);
                  setSelectedMonth(currentMonth);
                  onSelectMonth(currentMonthDate);
                  onClose();
                }}
                type="button"
              >
                今月へ
              </button>
              <button className="primary-button" onClick={handleApply} type="button">
                {selectedYear}年{selectedMonth}月へ移動
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
