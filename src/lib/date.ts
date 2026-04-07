const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];
const JAPANESE_HOLIDAY_CACHE = new Map<number, Set<string>>();

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
  const monthKey = startOfMonth(dateString).slice(0, 7);

  return Array.from({ length: 6 }, (_, index) => {
    const dates = grid.slice(index * 7, index * 7 + 7).map((cell) => cell.date);
    return {
      index,
      startDate: dates[0],
      endDate: dates[6],
      dates,
    };
  })
    .filter((week) => week.dates.some((date) => date.startsWith(monthKey)))
    .map((week, index) => ({
      ...week,
      index,
      label: `第${index + 1}週`,
    }));
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

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function getNthWeekdayDateKey(
  year: number,
  month: number,
  weekday: number,
  occurrence: number,
): string {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const day = 1 + ((weekday - firstDay + 7) % 7) + (occurrence - 1) * 7;
  return toDateKey(year, month, day);
}

function getVernalEquinoxDay(year: number): number {
  const base =
    year <= 1979
      ? 20.8357
      : year <= 2099
        ? 20.8431
        : 21.851;

  return Math.floor(base + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function getAutumnalEquinoxDay(year: number): number {
  const base =
    year <= 1979
      ? 23.2588
      : year <= 2099
        ? 23.2488
        : 24.2488;

  return Math.floor(base + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function buildBaseJapaneseHolidays(year: number): Set<string> {
  const holidays = new Set<string>();

  holidays.add(toDateKey(year, 1, 1));

  if (year >= 2000) {
    holidays.add(getNthWeekdayDateKey(year, 1, 1, 2));
  } else if (year >= 1949) {
    holidays.add(toDateKey(year, 1, 15));
  }

  if (year >= 1967) {
    holidays.add(toDateKey(year, 2, 11));
  }

  if (year >= 2020) {
    holidays.add(toDateKey(year, 2, 23));
  } else if (year >= 1989 && year <= 2018) {
    holidays.add(toDateKey(year, 12, 23));
  }

  if (year >= 1949) {
    holidays.add(toDateKey(year, 3, getVernalEquinoxDay(year)));
  }

  if (year >= 1949) {
    holidays.add(toDateKey(year, 4, 29));
  }

  holidays.add(toDateKey(year, 5, 3));

  if (year >= 2007) {
    holidays.add(toDateKey(year, 5, 4));
  }

  holidays.add(toDateKey(year, 5, 5));

  if (year === 2020) {
    holidays.add(toDateKey(year, 7, 23));
    holidays.add(toDateKey(year, 7, 24));
  } else if (year === 2021) {
    holidays.add(toDateKey(year, 7, 22));
    holidays.add(toDateKey(year, 7, 23));
  } else if (year >= 2003) {
    holidays.add(getNthWeekdayDateKey(year, 7, 1, 3));
  } else if (year >= 1996) {
    holidays.add(toDateKey(year, 7, 20));
  }

  if (year === 2020) {
    holidays.add(toDateKey(year, 8, 10));
  } else if (year === 2021) {
    holidays.add(toDateKey(year, 8, 8));
  } else if (year >= 2016) {
    holidays.add(toDateKey(year, 8, 11));
  }

  if (year >= 2003) {
    holidays.add(getNthWeekdayDateKey(year, 9, 1, 3));
  } else if (year >= 1966) {
    holidays.add(toDateKey(year, 9, 15));
  }

  if (year >= 1948) {
    holidays.add(toDateKey(year, 9, getAutumnalEquinoxDay(year)));
  }

  if (year === 2020) {
    holidays.add(toDateKey(year, 7, 24));
  } else if (year === 2021) {
    holidays.add(toDateKey(year, 7, 23));
  } else if (year >= 2020) {
    holidays.add(getNthWeekdayDateKey(year, 10, 1, 2));
  } else if (year >= 2000) {
    holidays.add(getNthWeekdayDateKey(year, 10, 1, 2));
  } else if (year >= 1966) {
    holidays.add(toDateKey(year, 10, 10));
  }

  holidays.add(toDateKey(year, 11, 3));
  holidays.add(toDateKey(year, 11, 23));

  if (year === 2019) {
    holidays.add(toDateKey(year, 5, 1));
    holidays.add(toDateKey(year, 10, 22));
  }

  return holidays;
}

function addObservedHolidays(holidays: Set<string>) {
  const baseHolidayKeys = [...holidays];

  baseHolidayKeys.forEach((holidayKey) => {
    const holidayDate = toLocalDate(holidayKey);

    if (holidayDate.getDay() !== 0) {
      return;
    }

    const observedDate = new Date(holidayDate);

    do {
      observedDate.setDate(observedDate.getDate() + 1);
    } while (holidays.has(toIsoDate(observedDate)));

    holidays.add(toIsoDate(observedDate));
  });
}

function addCitizensHolidays(year: number, holidays: Set<string>) {
  const date = new Date(`${year}-01-02T00:00:00`);
  const endDate = new Date(`${year}-12-30T00:00:00`);

  while (date <= endDate) {
    const currentKey = toIsoDate(date);

    if (holidays.has(currentKey)) {
      date.setDate(date.getDate() + 1);
      continue;
    }

    const previousDate = new Date(date);
    previousDate.setDate(previousDate.getDate() - 1);
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);

    if (holidays.has(toIsoDate(previousDate)) && holidays.has(toIsoDate(nextDate))) {
      holidays.add(currentKey);
    }

    date.setDate(date.getDate() + 1);
  }
}

function getJapaneseHolidaySet(year: number): Set<string> {
  const cached = JAPANESE_HOLIDAY_CACHE.get(year);

  if (cached) {
    return cached;
  }

  const holidays = buildBaseJapaneseHolidays(year);

  if (year >= 1973) {
    addObservedHolidays(holidays);
  }

  if (year >= 1986) {
    addCitizensHolidays(year, holidays);
  }

  JAPANESE_HOLIDAY_CACHE.set(year, holidays);
  return holidays;
}

export function isJapaneseHoliday(dateString: string): boolean {
  const year = Number(dateString.slice(0, 4));
  return getJapaneseHolidaySet(year).has(dateString);
}

export type CalendarDayTone = 'weekday' | 'saturday' | 'holiday';

export function getCalendarDayTone(dateString: string): CalendarDayTone {
  const day = toLocalDate(dateString).getDay();

  if (day === 0 || isJapaneseHoliday(dateString)) {
    return 'holiday';
  }

  if (day === 6) {
    return 'saturday';
  }

  return 'weekday';
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
