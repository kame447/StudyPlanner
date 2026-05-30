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
  const selectedHour = Math.floor(selectedMinutes / 60);
  const selectedMinute = selectedMinutes % 60;
  const hourOptions = buildHourOptions(role, normalizedMinMinutes);
  const minuteOptions = buildMinuteOptions(
    selectedHour,
    role,
    normalizedMinMinutes,
  );
  const selectClassName = inputClassName
    ? `time-wheel-select ${inputClassName}`
    : 'time-wheel-select';

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

    onChange(formatMinutesToTime(nextMinutes, role));
  }

  return (
    <div className="time-wheel-picker">
      <div className="time-wheel-column">
        <span className="time-wheel-unit">時</span>
        <select
          aria-label={role === 'start' ? '開始 時' : '終了 時'}
          className={selectClassName}
          value={selectedHour}
          disabled={disabled}
          onChange={(event) => commit(Number(event.target.value), selectedMinute)}
        >
          {hourOptions.map((hour) => (
            <option key={hour} value={hour}>
              {padTimePart(hour)}
            </option>
          ))}
        </select>
      </div>

      <div className="time-wheel-column">
        <span className="time-wheel-unit">分</span>
        <select
          aria-label={role === 'start' ? '開始 分' : '終了 分'}
          className={selectClassName}
          value={selectedMinute}
          disabled={disabled}
          onChange={(event) => commit(selectedHour, Number(event.target.value))}
        >
          {minuteOptions.map((minute) => (
            <option key={minute} value={minute}>
              {padTimePart(minute)}
            </option>
          ))}
        </select>
      </div>
    </div>
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
    <>
      <label className={labelClassName}>
        <span>{startLabel}</span>
        <TimeWheelPicker
          value={startValue}
          role="start"
          disabled={disabled}
          inputClassName={inputClassName}
          onChange={updateStart}
        />
      </label>

      <label className={labelClassName}>
        <span>{endLabel}</span>
        <TimeWheelPicker
          value={endValue}
          role="end"
          disabled={disabled}
          inputClassName={inputClassName}
          minMinutes={Math.min(startMinutes + 1, MINUTES_PER_DAY)}
          onChange={updateEnd}
        />
      </label>
    </>
  );
}
