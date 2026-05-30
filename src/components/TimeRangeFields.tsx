import { useMemo } from 'react';
import {
  calculateAutoEndTimeForCreate,
  calculateShiftedEndTimeForEdit,
  calculateTimeRangeDurationMinutes,
  formatMinutesToTime,
  parseTimeToMinutes,
} from '../lib/date';

type TimeRangeMode = 'create' | 'edit';

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

function buildStartOptions(): string[] {
  return Array.from({ length: 24 * 60 }, (_, minutes) =>
    formatMinutesToTime(minutes, 'start'),
  );
}

function buildEndOptions(startTime: string, currentEndTime: string): string[] {
  const startMinutes = parseTimeToMinutes(startTime, 'start');
  const currentEndMinutes = parseTimeToMinutes(currentEndTime, 'end');
  const options = Array.from(
    { length: 24 * 60 - startMinutes },
    (_, index) => formatMinutesToTime(startMinutes + index + 1, 'end'),
  );
  const currentEndDisplay = formatMinutesToTime(currentEndMinutes, 'end');

  return options.includes(currentEndDisplay)
    ? options
    : [...options, currentEndDisplay].sort(
        (left, right) =>
          parseTimeToMinutes(left, 'end') - parseTimeToMinutes(right, 'end'),
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
  const startOptions = useMemo(() => buildStartOptions(), []);
  const endOptions = useMemo(
    () => buildEndOptions(startTime, endTime),
    [endTime, startTime],
  );
  const startValue = formatMinutesToTime(parseTimeToMinutes(startTime, 'start'), 'start');
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
    <>
      <label className={labelClassName}>
        <span>{startLabel}</span>
        <select
          className={inputClassName}
          value={startValue}
          disabled={disabled}
          onChange={(event) => updateStart(event.target.value)}
        >
          {startOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <label className={labelClassName}>
        <span>{endLabel}</span>
        <select
          className={inputClassName}
          value={endValue}
          disabled={disabled}
          onChange={(event) => updateEnd(event.target.value)}
        >
          {endOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
