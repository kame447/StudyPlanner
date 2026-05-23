const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];
const JAPANESE_HOLIDAY_CACHE = new Map<number, Set<string>>();
const JAPANESE_HOLIDAY_NAME_CACHE = new Map<number, Map<string, string>>();

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

function addHolidayName(
  holidays: Set<string>,
  holidayNames: Map<string, string>,
  dateKey: string,
  name: string,
) {
  holidays.add(dateKey);
  holidayNames.set(dateKey, name);
}

function buildBaseJapaneseHolidays(year: number): {
  holidays: Set<string>;
  holidayNames: Map<string, string>;
} {
  const holidays = new Set<string>();
  const holidayNames = new Map<string, string>();

  addHolidayName(holidays, holidayNames, toDateKey(year, 1, 1), '元日');

  if (year >= 2000) {
    addHolidayName(
      holidays,
      holidayNames,
      getNthWeekdayDateKey(year, 1, 1, 2),
      '成人の日',
    );
  } else if (year >= 1949) {
    addHolidayName(holidays, holidayNames, toDateKey(year, 1, 15), '成人の日');
  }

  if (year >= 1967) {
    addHolidayName(holidays, holidayNames, toDateKey(year, 2, 11), '建国記念の日');
  }

  if (year >= 2020) {
    addHolidayName(holidays, holidayNames, toDateKey(year, 2, 23), '天皇誕生日');
  } else if (year >= 1989 && year <= 2018) {
    addHolidayName(holidays, holidayNames, toDateKey(year, 12, 23), '天皇誕生日');
  }

  if (year >= 1949) {
    addHolidayName(
      holidays,
      holidayNames,
      toDateKey(year, 3, getVernalEquinoxDay(year)),
      '春分の日',
    );
  }

  if (year >= 1949) {
    addHolidayName(holidays, holidayNames, toDateKey(year, 4, 29), '昭和の日');
  }

  addHolidayName(holidays, holidayNames, toDateKey(year, 5, 3), '憲法記念日');

  if (year >= 2007) {
    addHolidayName(holidays, holidayNames, toDateKey(year, 5, 4), 'みどりの日');
  }

  addHolidayName(holidays, holidayNames, toDateKey(year, 5, 5), 'こどもの日');

  if (year === 2020) {
    addHolidayName(holidays, holidayNames, toDateKey(year, 7, 23), '海の日');
    addHolidayName(holidays, holidayNames, toDateKey(year, 7, 24), 'スポーツの日');
  } else if (year === 2021) {
    addHolidayName(holidays, holidayNames, toDateKey(year, 7, 22), '海の日');
    addHolidayName(holidays, holidayNames, toDateKey(year, 7, 23), 'スポーツの日');
  } else if (year >= 2003) {
    addHolidayName(
      holidays,
      holidayNames,
      getNthWeekdayDateKey(year, 7, 1, 3),
      '海の日',
    );
  } else if (year >= 1996) {
    addHolidayName(holidays, holidayNames, toDateKey(year, 7, 20), '海の日');
  }

  if (year === 2020) {
    addHolidayName(holidays, holidayNames, toDateKey(year, 8, 10), '山の日');
  } else if (year === 2021) {
    addHolidayName(holidays, holidayNames, toDateKey(year, 8, 8), '山の日');
  } else if (year >= 2016) {
    addHolidayName(holidays, holidayNames, toDateKey(year, 8, 11), '山の日');
  }

  if (year >= 2003) {
    addHolidayName(
      holidays,
      holidayNames,
      getNthWeekdayDateKey(year, 9, 1, 3),
      '敬老の日',
    );
  } else if (year >= 1966) {
    addHolidayName(holidays, holidayNames, toDateKey(year, 9, 15), '敬老の日');
  }

  if (year >= 1948) {
    addHolidayName(
      holidays,
      holidayNames,
      toDateKey(year, 9, getAutumnalEquinoxDay(year)),
      '秋分の日',
    );
  }

  if (year >= 2022) {
    addHolidayName(
      holidays,
      holidayNames,
      getNthWeekdayDateKey(year, 10, 1, 2),
      'スポーツの日',
    );
  } else if (year >= 2000 && year !== 2020 && year !== 2021) {
    addHolidayName(
      holidays,
      holidayNames,
      getNthWeekdayDateKey(year, 10, 1, 2),
      '体育の日',
    );
  } else if (year >= 1966) {
    addHolidayName(holidays, holidayNames, toDateKey(year, 10, 10), '体育の日');
  }

  addHolidayName(holidays, holidayNames, toDateKey(year, 11, 3), '文化の日');
  addHolidayName(holidays, holidayNames, toDateKey(year, 11, 23), '勤労感謝の日');

  if (year === 2019) {
    addHolidayName(holidays, holidayNames, toDateKey(year, 5, 1), '天皇の即位の日');
    addHolidayName(holidays, holidayNames, toDateKey(year, 10, 22), '即位礼正殿の儀');
  }

  return {
    holidays,
    holidayNames,
  };
}

function addObservedHolidays(holidays: Set<string>, holidayNames: Map<string, string>) {
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

    addHolidayName(
      holidays,
      holidayNames,
      toIsoDate(observedDate),
      '振替休日',
    );
  });
}

function addCitizensHolidays(
  year: number,
  holidays: Set<string>,
  holidayNames: Map<string, string>,
) {
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
      addHolidayName(holidays, holidayNames, currentKey, '国民の休日');
    }

    date.setDate(date.getDate() + 1);
  }
}

function getJapaneseHolidaySet(year: number): Set<string> {
  const cachedHolidayNames = JAPANESE_HOLIDAY_NAME_CACHE.get(year);
  const cached = JAPANESE_HOLIDAY_CACHE.get(year);

  if (cached && cachedHolidayNames) {
    return cached;
  }

  const { holidays, holidayNames } = buildBaseJapaneseHolidays(year);

  if (year >= 1973) {
    addObservedHolidays(holidays, holidayNames);
  }

  if (year >= 1986) {
    addCitizensHolidays(year, holidays, holidayNames);
  }

  JAPANESE_HOLIDAY_CACHE.set(year, holidays);
  JAPANESE_HOLIDAY_NAME_CACHE.set(year, holidayNames);
  return holidays;
}

export function isJapaneseHoliday(dateString: string): boolean {
  const year = Number(dateString.slice(0, 4));
  return getJapaneseHolidaySet(year).has(dateString);
}

export function getJapaneseHolidayName(dateString: string): string | null {
  const year = Number(dateString.slice(0, 4));

  if (!JAPANESE_HOLIDAY_NAME_CACHE.has(year)) {
    getJapaneseHolidaySet(year);
  }

  return JAPANESE_HOLIDAY_NAME_CACHE.get(year)?.get(dateString) ?? null;
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
  const startMinutes = minutesFromTime(startTime);
  const endMinutes = minutesFromTime(endTime);

  if (endMinutes === startMinutes) {
    return 0;
  }

  return endMinutes > startMinutes
    ? endMinutes - startMinutes
    : endMinutes + 24 * 60 - startMinutes;
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

export function formatCompactMinutes(minutes: number): string {
  if (minutes <= 0) {
    return '0m';
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0 && remainingMinutes > 0) {
    return `${hours}h${remainingMinutes}m`;
  }

  if (hours > 0) {
    return `${hours}h`;
  }

  return `${remainingMinutes}m`;
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
