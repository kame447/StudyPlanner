import { useEffect, useMemo, useRef, useState } from 'react';
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
const WHEEL_ITEM_HEIGHT = 48;

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

  return Array.from(
    { length: maxHour - minHour + 1 },
    (_, index) => minHour + index,
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
      ? minMinutes - hourStartMinutes
      : 0;

  return Array.from(
    { length: 60 - minMinute },
    (_, index) => minMinute + index,
  );
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

  useEffect(() => {
    if (open) {
      setDraftMinutes(selectedMinutes);
    }
  }, [open, selectedMinutes]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const hourIndex = hourOptions.indexOf(selectedHour);
    const minuteIndex = minuteOptions.indexOf(selectedMinute);

    if (hourIndex >= 0) {
      hourListRef.current?.scrollTo({
        top: hourIndex * WHEEL_ITEM_HEIGHT,
        behavior: 'smooth',
      });
    }

    if (minuteIndex >= 0) {
      minuteListRef.current?.scrollTo({
        top: minuteIndex * WHEEL_ITEM_HEIGHT,
        behavior: 'smooth',
      });
    }
  }, [hourOptions, minuteOptions, open, selectedHour, selectedMinute]);

  function commit(nextHour: number, preferredMinute: number) {
    const nextMinuteOptions = buildMinuteOptions(
      nextHour,
      role,
      normalizedMinMinutes,
    );
    const nextMinute = nextMinuteOptions.includes(preferredMinute)
      ? preferredMinute
      : nextMinuteOptions[0];
    const nextMinutes = clampPickerMinutes(
      nextHour * 60 + nextMinute,
      role,
      normalizedMinMinutes,
    );

    setDraftMinutes(nextMinutes);
  }

  function commitAndClose() {
    onChange(formatMinutesToTime(draftMinutes, role));
    setOpen(false);
  }

  function handleColumnScroll(
    list: HTMLDivElement,
    options: number[],
    unit: 'hour' | 'minute',
  ) {
    const optionIndex = Math.min(
      Math.max(0, Math.round(list.scrollTop / WHEEL_ITEM_HEIGHT)),
      options.length - 1,
    );
    const nextValue = options[optionIndex];

    if (unit === 'hour') {
      commit(nextValue, selectedMinute);
      return;
    }

    commit(selectedHour, nextValue);
  }

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

      {open ? (
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
                  onScroll={(event) =>
                    handleColumnScroll(event.currentTarget, hourOptions, 'hour')
                  }
                >
                  {hourOptions.map((hour) => (
                    <button
                      key={hour}
                      className={
                        hour === selectedHour
                          ? 'time-wheel-item active'
                          : 'time-wheel-item'
                      }
                      type="button"
                      onClick={() => commit(hour, selectedMinute)}
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
                  onScroll={(event) =>
                    handleColumnScroll(event.currentTarget, minuteOptions, 'minute')
                  }
                >
                  {minuteOptions.map((minute) => (
                    <button
                      key={minute}
                      className={
                        minute === selectedMinute
                          ? 'time-wheel-item active'
                          : 'time-wheel-item'
                      }
                      type="button"
                      onClick={() => commit(selectedHour, minute)}
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
                onClick={() => setOpen(false)}
                type="button"
              >
                キャンセル
              </button>
              <button
                className="primary-button"
                onClick={commitAndClose}
                type="button"
              >
                決定
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
