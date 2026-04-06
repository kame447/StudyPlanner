const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];

function toLocalDate(dateString: string): Date {
  return new Date(`${dateString}T00:00:00`);
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayIsoDate(): string {
  return toIsoDate(new Date());
}

export function addDays(dateString: string, amount: number): string {
  const date = toLocalDate(dateString);
  date.setDate(date.getDate() + amount);
  return toIsoDate(date);
}

export function addMonths(dateString: string, amount: number): string {
  const date = toLocalDate(dateString);
  date.setDate(1);
  date.setMonth(date.getMonth() + amount);
  return toIsoDate(date);
}

export function startOfMonth(dateString: string): string {
  const date = toLocalDate(dateString);
  date.setDate(1);
  return toIsoDate(date);
}

export function isSameMonth(left: string, right: string): boolean {
  return left.slice(0, 7) === right.slice(0, 7);
}

export function startOfWeek(dateString: string): string {
  const date = toLocalDate(dateString);
  const currentDay = date.getDay();
  const diff = currentDay === 0 ? -6 : 1 - currentDay;
  date.setDate(date.getDate() + diff);
  return toIsoDate(date);
}

export function getWeekDates(dateString: string): string[] {
  const start = startOfWeek(dateString);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function getMonthGrid(dateString: string): Array<{
  date: string;
  inCurrentMonth: boolean;
}> {
  const monthStart = startOfMonth(dateString);
  const firstGridDate = startOfWeek(monthStart);
  const monthKey = monthStart.slice(0, 7);

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(firstGridDate, index);
    return {
      date,
      inCurrentMonth: date.startsWith(monthKey),
    };
  });
}

export function getMonthWeeks(dateString: string): Array<{
  index: number;
  startDate: string;
  endDate: string;
  label: string;
  dates: string[];
}> {
  const grid = getMonthGrid(dateString);

  return Array.from({ length: 6 }, (_, index) => {
    const dates = grid.slice(index * 7, index * 7 + 7).map((cell) => cell.date);
    return {
      index,
      startDate: dates[0],
      endDate: dates[6],
      label: `第${index + 1}週`,
      dates,
    };
  });
}

export function formatMonthLabel(dateString: string): string {
  const date = toLocalDate(startOfMonth(dateString));
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

export function formatDateLabel(dateString: string): string {
  const date = toLocalDate(dateString);
  const day = date.getDay() === 0 ? 6 : date.getDay() - 1;
  return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAY_LABELS[day]})`;
}

export function formatCompactDate(dateString: string): string {
  const date = toLocalDate(dateString);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function getWeekdayLabel(dateString: string): string {
  const date = toLocalDate(dateString);
  const day = date.getDay() === 0 ? 6 : date.getDay() - 1;
  return WEEKDAY_LABELS[day];
}

export function getWeekdayLabels(): string[] {
  return WEEKDAY_LABELS;
}

export function minutesFromTime(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function timeFromMinutes(totalMinutes: number): string {
  const safeMinutes = Math.max(0, totalMinutes);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${pad(hours)}:${pad(minutes)}`;
}

export function minutesBetween(startTime: string, endTime: string): number {
  const result = minutesFromTime(endTime) - minutesFromTime(startTime);
  return result > 0 ? result : 0;
}

export function formatMinutes(minutes: number): string {
  if (minutes <= 0) {
    return '0分';
  }

  if (minutes % 60 === 0) {
    return `${minutes / 60}時間`;
  }

  if (minutes > 60 && minutes % 30 === 0) {
    return `${minutes / 60}時間`;
  }

  return `${Math.floor(minutes / 60)}時間${minutes % 60}分`;
}

export function sortByDateTime<T extends { date: string; startTime: string }>(
  items: T[],
): T[] {
  return [...items].sort((left, right) => {
    if (left.date === right.date) {
      return minutesFromTime(left.startTime) - minutesFromTime(right.startTime);
    }

    return left.date.localeCompare(right.date);
  });
}
