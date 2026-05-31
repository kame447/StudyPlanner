import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  calculateAutoEndTimeForCreate,
  calculateShiftedEndTimeForEdit,
  calculateTimeRangeDurationMinutes,
  formatMinutesToTime,
  parseTimeToMinutes,
} from '../lib/date';

type TimeRangeMode = 'create' | 'edit';
type TimePickerRole = 'start' | 'end';

const MINUTES_PER_DAY = 24 * 60;
const MINUTE_STEP = 5;
const PICKER_SCROLL_SETTLE_MS = 90;

interface TimeRangeFieldsProps {
  startTime: string;
  endTime: string;
  mode: TimeRangeMode;
  onChange: (range: { startTime: string; endTime: string }) => void;
  startLabel?: string;
  endLabel?: string;
  disabled?: boolean;
  labelClassName?: string;
  inputClassName?: string;
}

interface TimeWheelPickerProps {
  value: string;
  role: TimePickerRole;
  onChange: (time: string) => void;
  disabled?: boolean;
  inputClassName?: string;
  minMinutes?: number;
}

function padTimePart(value: number): string {
  return value.toString().padStart(2, '0');
}

function clampPickerMinutes(
  minutes: number,
  role: TimePickerRole,
  minMinutes = 0,
): number {
  const maxMinutes = role === 'end' ? MINUTES_PER_DAY : MINUTES_PER_DAY - 1;
  return Math.min(Math.max(minutes, minMinutes), maxMinutes);
}

function buildHourOptions(role: TimePickerRole, minMinutes = 0): number[] {
  const maxHour = role === 'end' ? 24 : 23;
  const minHour = role === 'end' ? Math.floor(minMinutes / 60) : 0;

  const hours = Array.from(
    { length: maxHour - minHour + 1 },
    (_, index) => minHour + index,
  );

  if (role === 'start') {
    return hours;
  }

  return hours.filter(
    (hour) => buildMinuteOptions(hour, role, minMinutes).length > 0,
  );
}

function buildMinuteOptions(
  hour: number,
  role: TimePickerRole,
  minMinutes = 0,
): number[] {
  if (role === 'end' && hour === 24) {
    return [0];
  }

  const hourStartMinutes = hour * 60;
  const minMinute =
    role === 'end' && Math.floor(minMinutes / 60) === hour
      ? Math.ceil((minMinutes - hourStartMinutes) / MINUTE_STEP) * MINUTE_STEP
      : 0;

  if (minMinute >= 60) {
    return [];
  }

  return Array.from(
    { length: Math.floor((60 - minMinute - 1) / MINUTE_STEP) + 1 },
    (_, index) => minMinute + index * MINUTE_STEP,
  );
}

function findClosestWheelValue(
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

function scrollToWheelValue(
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

export function TimeWheelPicker({
  value,
  role,
  onChange,
  disabled = false,
  inputClassName,
  minMinutes = 0,
}: TimeWheelPickerProps) {
  const normalizedMinMinutes =
    role === 'end' ? clampPickerMinutes(minMinutes, role) : 0;
  const selectedMinutes = clampPickerMinutes(
    parseTimeToMinutes(value, role),
    role,
    normalizedMinMinutes,
  );
  const [open, setOpen] = useState(false);
  const [draftMinutes, setDraftMinutes] = useState(selectedMinutes);
  const hourListRef = useRef<HTMLDivElement | null>(null);
  const minuteListRef = useRef<HTMLDivElement | null>(null);
  const hourScrollTimeoutRef = useRef<number | null>(null);
  const minuteScrollTimeoutRef = useRef<number | null>(null);
  const selectedHour = Math.floor(draftMinutes / 60);
  const selectedMinute = draftMinutes % 60;
  const hourOptions = useMemo(
    () => buildHourOptions(role, normalizedMinMinutes),
    [normalizedMinMinutes, role],
  );
  const minuteOptions = useMemo(
    () => buildMinuteOptions(selectedHour, role, normalizedMinMinutes),
    [normalizedMinMinutes, role, selectedHour],
  );
  const triggerClassName = inputClassName
    ? `time-wheel-trigger ${inputClassName}`
    : 'time-wheel-trigger';

  function normalizeToWheelMinutes(minutes: number): number {
    const clampedMinutes = clampPickerMinutes(
      minutes,
      role,
      normalizedMinMinutes,
    );
    const hours = buildHourOptions(role, normalizedMinMinutes);
    const rawHour = Math.floor(clampedMinutes / 60);
    const nextHour = hours.includes(rawHour)
      ? rawHour
      : hours.find((hour) => hour > rawHour) ?? hours[hours.length - 1];
    const minuteOptionsForHour = buildMinuteOptions(
      nextHour,
      role,
      normalizedMinMinutes,
    );
    const rawMinute = nextHour === rawHour ? clampedMinutes % 60 : 0;
    const nextMinute = minuteOptionsForHour.includes(rawMinute)
      ? rawMinute
      : minuteOptionsForHour.find((minute) => minute > rawMinute) ??
        minuteOptionsForHour[0];

    return clampPickerMinutes(
      nextHour * 60 + nextMinute,
      role,
      normalizedMinMinutes,
    );
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    const nextDraftMinutes = normalizeToWheelMinutes(selectedMinutes);
    const nextHour = Math.floor(nextDraftMinutes / 60);
    const nextMinute = nextDraftMinutes % 60;

    setDraftMinutes(nextDraftMinutes);

    const scrollTimer = window.setTimeout(() => {
      scrollToWheelValue(hourListRef.current, nextHour, 'auto');
      scrollToWheelValue(minuteListRef.current, nextMinute, 'auto');
    }, 0);

    return () => {
      window.clearTimeout(scrollTimer);

      if (hourScrollTimeoutRef.current !== null) {
        window.clearTimeout(hourScrollTimeoutRef.current);
      }

      if (minuteScrollTimeoutRef.current !== null) {
        window.clearTimeout(minuteScrollTimeoutRef.current);
      }
    };
  }, [open, selectedMinutes, normalizedMinMinutes]);

  function setDraftFromParts(nextHour: number, preferredMinute: number) {
    const nextMinuteOptions = buildMinuteOptions(
      nextHour,
      role,
      normalizedMinMinutes,
    );

    if (nextMinuteOptions.length === 0) {
      return null;
    }

    const nextMinute = nextMinuteOptions.includes(preferredMinute)
      ? preferredMinute
      : nextMinuteOptions.find((minute) => minute > preferredMinute) ??
        nextMinuteOptions[0];
    const nextMinutes = clampPickerMinutes(
      nextHour * 60 + nextMinute,
      role,
      normalizedMinMinutes,
    );

    setDraftMinutes(nextMinutes);

    return {
      hour: Math.floor(nextMinutes / 60),
      minute: nextMinutes % 60,
      minutes: nextMinutes,
    };
  }

  function commit(nextHour: number, preferredMinute: number) {
    setDraftFromParts(nextHour, preferredMinute);
  }

  function commitAndClose() {
    if (hourScrollTimeoutRef.current !== null) {
      window.clearTimeout(hourScrollTimeoutRef.current);
    }

    if (minuteScrollTimeoutRef.current !== null) {
      window.clearTimeout(minuteScrollTimeoutRef.current);
    }

    const wheelHour =
      hourListRef.current
        ? findClosestWheelValue(hourListRef.current, hourOptions)
        : null;
    const commitHour = wheelHour ?? selectedHour;
    const commitMinuteOptions = buildMinuteOptions(
      commitHour,
      role,
      normalizedMinMinutes,
    );
    const wheelMinute =
      minuteListRef.current
        ? findClosestWheelValue(minuteListRef.current, commitMinuteOptions)
        : null;
    const commitMinute = wheelMinute ?? selectedMinute;
    const nextDraft = setDraftFromParts(commitHour, commitMinute);
    const nextMinutes = clampPickerMinutes(
      normalizeToWheelMinutes(nextDraft?.minutes ?? draftMinutes),
      role,
      normalizedMinMinutes,
    );

    onChange(formatMinutesToTime(nextMinutes, role));
    setOpen(false);
  }

  function handleHourScroll() {
    if (!hourListRef.current) {
      return;
    }

    if (hourScrollTimeoutRef.current !== null) {
      window.clearTimeout(hourScrollTimeoutRef.current);
    }

    hourScrollTimeoutRef.current = window.setTimeout(() => {
      const nextHour = findClosestWheelValue(hourListRef.current!, hourOptions);

      if (nextHour === null) {
        return;
      }

      const nextDraft = setDraftFromParts(nextHour, selectedMinute);

      scrollToWheelValue(hourListRef.current, nextHour, 'smooth');

      if (nextDraft) {
        window.setTimeout(() => {
          scrollToWheelValue(minuteListRef.current, nextDraft.minute, 'smooth');
        }, 0);
      }
    }, PICKER_SCROLL_SETTLE_MS);
  }

  function handleMinuteScroll() {
    if (!minuteListRef.current) {
      return;
    }

    if (minuteScrollTimeoutRef.current !== null) {
      window.clearTimeout(minuteScrollTimeoutRef.current);
    }

    minuteScrollTimeoutRef.current = window.setTimeout(() => {
      const nextMinute = findClosestWheelValue(
        minuteListRef.current!,
        minuteOptions,
      );

      if (nextMinute === null) {
        return;
      }

      setDraftFromParts(selectedHour, nextMinute);
      scrollToWheelValue(minuteListRef.current, nextMinute, 'smooth');
    }, PICKER_SCROLL_SETTLE_MS);
  }

  const pickerDialog = open ? (
    <div
      className="overlay modal-overlay time-picker-overlay"
      onClick={() => setOpen(false)}
    >
      <div
        className="modal-card time-picker-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={role === 'start' ? '開始時刻を選択' : '終了時刻を選択'}
      >
        <div className="time-picker-title">
          <strong>{role === 'start' ? '開始時刻' : '終了時刻'}</strong>
          <span>{formatMinutesToTime(draftMinutes, role)}</span>
        </div>

        <div className="time-wheel-picker" aria-label="時刻を選択">
          <div className="time-wheel-selection" aria-hidden="true" />
          <div className="time-wheel-column">
            <span className="time-wheel-unit">時</span>
            <div
              className="time-wheel-list"
              ref={hourListRef}
              onScroll={handleHourScroll}
            >
              {hourOptions.map((hour) => (
                <button
                  key={hour}
                  className={
                    hour === selectedHour
                      ? 'time-wheel-item active'
                      : 'time-wheel-item'
                  }
                  data-value={hour}
                  type="button"
                  onClick={() => {
                    const nextDraft = setDraftFromParts(hour, selectedMinute);

                    scrollToWheelValue(hourListRef.current, hour, 'smooth');

                    if (nextDraft) {
                      window.setTimeout(() => {
                        scrollToWheelValue(
                          minuteListRef.current,
                          nextDraft.minute,
                          'smooth',
                        );
                      }, 0);
                    }
                  }}
                >
                  {padTimePart(hour)}
                </button>
              ))}
            </div>
          </div>

          <span className="time-wheel-separator" aria-hidden="true">
            :
          </span>

          <div className="time-wheel-column">
            <span className="time-wheel-unit">分</span>
            <div
              className="time-wheel-list"
              ref={minuteListRef}
              onScroll={handleMinuteScroll}
            >
              {minuteOptions.map((minute) => (
                <button
                  key={minute}
                  className={
                    minute === selectedMinute
                      ? 'time-wheel-item active'
                      : 'time-wheel-item'
                  }
                  data-value={minute}
                  type="button"
                  onClick={() => {
                    commit(selectedHour, minute);
                    scrollToWheelValue(minuteListRef.current, minute, 'smooth');
                  }}
                >
                  {padTimePart(minute)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="time-picker-actions">
          <button
            className="ghost-button"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
            }}
            type="button"
          >
            キャンセル
          </button>
          <button
            className="primary-button"
            onClick={(event) => {
              event.stopPropagation();
              commitAndClose();
            }}
            type="button"
          >
            決定
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        {formatMinutesToTime(selectedMinutes, role)}
      </button>

      {pickerDialog && typeof document !== 'undefined'
        ? createPortal(pickerDialog, document.body)
        : pickerDialog}
    </>
  );
}

export function TimeRangeFields({
  startTime,
  endTime,
  mode,
  onChange,
  startLabel = '開始',
  endLabel = '終了',
  disabled = false,
  labelClassName = 'field',
  inputClassName,
}: TimeRangeFieldsProps) {
  const startValue = formatMinutesToTime(
    parseTimeToMinutes(startTime, 'start'),
    'start',
  );
  const startMinutes = parseTimeToMinutes(startValue, 'start');
  const endValue = formatMinutesToTime(parseTimeToMinutes(endTime, 'end'), 'end');

  function updateStart(nextStartTime: string) {
    const nextStartMinutes = parseTimeToMinutes(nextStartTime, 'start');
    const nextEndTime =
      mode === 'create'
        ? calculateAutoEndTimeForCreate(nextStartMinutes)
        : calculateShiftedEndTimeForEdit(
            nextStartMinutes,
            calculateTimeRangeDurationMinutes(startTime, endTime),
          );

    onChange({
      startTime: nextStartTime,
      endTime: nextEndTime,
    });
  }

  function updateEnd(nextEndTime: string) {
    onChange({
      startTime,
      endTime: nextEndTime,
    });
  }

  return (
    <div className="time-range-fields">
      <div className={labelClassName}>
        <span>{startLabel}</span>
        <TimeWheelPicker
          value={startValue}
          role="start"
          disabled={disabled}
          inputClassName={inputClassName}
          onChange={updateStart}
        />
      </div>

      <div className={labelClassName}>
        <span>{endLabel}</span>
        <TimeWheelPicker
          value={endValue}
          role="end"
          disabled={disabled}
          inputClassName={inputClassName}
          minMinutes={Math.min(startMinutes + 1, MINUTES_PER_DAY)}
          onChange={updateEnd}
        />
      </div>
    </div>
  );
}
