import { normalizeText } from "./normalize";
import type {
  DateSpec,
  DayTypeSpec,
  DurationSpec,
  RepeatSpec,
  TimeRangeSpec,
  TimeSpec,
  Token,
  Weekday,
  WeekdaySpec,
} from "./shared/types";

function parseTime(raw: string): TimeSpec {
  const [hourText, minuteText] = raw.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  return {
    raw,
    hour,
    minute,
    hm: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function parseTimeRange(
  raw: string,
  startRaw: string,
  endRaw: string
): TimeRangeSpec {
  return {
    raw,
    start: parseTime(startRaw),
    end: parseTime(endRaw),
  };
}

function parseDuration(
  raw: string,
  amountText: string,
  unit: string
): DurationSpec {
  const amount = Number(amountText);
  const minutes = unit === "時間" ? amount * 60 : amount;
  return { raw, minutes };
}

function parseWeekday(raw: string, jp: string): WeekdaySpec {
  const map: Record<string, Weekday> = {
    月: "mon",
    火: "tue",
    水: "wed",
    木: "thu",
    金: "fri",
    土: "sat",
    日: "sun",
  };

  return {
    raw,
    weekday: map[jp],
  };
}

function parseDayType(raw: string): DayTypeSpec {
  if (raw === "平日") {
    return { raw, dayType: "weekday" };
  }
  return { raw, dayType: "weekend" };
}

function parseRepeat(raw: string): RepeatSpec {
  if (raw === "毎日") {
    return { raw, kind: "daily" };
  }
  if (raw === "毎週") {
    return { raw, kind: "weekly" };
  }
  if (raw === "毎月") {
    return { raw, kind: "monthly" };
  }
  if (raw === "毎朝") {
    return { raw, kind: "daily", anchor: "morning" };
  }
  if (raw === "毎晩") {
    return { raw, kind: "daily", anchor: "night" };
  }
  return { raw, kind: "unknown" };
}

function parseDateSpec(raw: string): DateSpec {
  if (raw === "今日") {
    return { raw, kind: "relative-day", offsetDays: 0 };
  }
  if (raw === "明日") {
    return { raw, kind: "relative-day", offsetDays: 1 };
  }
  if (raw === "明後日") {
    return { raw, kind: "relative-day", offsetDays: 2 };
  }
  if (raw === "今週") {
    return { raw, kind: "week-scope", scope: "this-week" };
  }
  if (raw === "来週") {
    return { raw, kind: "week-scope", scope: "next-week" };
  }
  if (raw === "今週末") {
    return { raw, kind: "week-scope", scope: "this-weekend" };
  }
  if (raw === "来週末") {
    return { raw, kind: "week-scope", scope: "next-weekend" };
  }
  return { raw, kind: "week-scope", scope: "sometime-next-week" };
}

interface Rule {
  name: string;
  regex: RegExp;
  build: (match: RegExpExecArray) => Token;
}

const RULES: Rule[] = [
  {
    name: "DATE",
    regex: /^(来週のどこか|今週末|来週末|明後日|明日|今日|来週|今週)/,
    build: (match) => ({
      kind: "DATE",
      raw: match[0],
      value: parseDateSpec(match[0]),
    }),
  },
  {
    name: "TIME_RANGE",
    regex: /^(\d{1,2}:\d{2})\s*(?:-|から)\s*(\d{1,2}:\d{2})/,
    build: (match) => ({
      kind: "TIME_RANGE",
      raw: match[0],
      value: parseTimeRange(match[0], match[1], match[2]),
    }),
  },
  {
    name: "TIME",
    regex: /^\d{1,2}:\d{2}/,
    build: (match) => ({
      kind: "TIME",
      raw: match[0],
      value: parseTime(match[0]),
    }),
  },
  {
    name: "DURATION",
    regex: /^(\d+)\s*(分|時間)/,
    build: (match) => ({
      kind: "DURATION",
      raw: match[0],
      value: parseDuration(match[0], match[1], match[2]),
    }),
  },
  {
    name: "WEEKDAY",
    regex: /^(月|火|水|木|金|土|日)曜(?:日)?/,
    build: (match) => ({
      kind: "WEEKDAY",
      raw: match[0],
      value: parseWeekday(match[0], match[1]),
    }),
  },
  {
    name: "DAYTYPE",
    regex: /^(平日|週末|土日)/,
    build: (match) => ({
      kind: "DAYTYPE",
      raw: match[0],
      value: parseDayType(match[0]),
    }),
  },
  {
    name: "REPEAT",
    regex: /^(毎日|毎週|毎月|毎朝|毎晩)/,
    build: (match) => ({
      kind: "REPEAT",
      raw: match[0],
      value: parseRepeat(match[0]),
    }),
  },
  {
    name: "OVERRIDE",
    regex: /^(ただし|除く|以外)/,
    build: (match) => ({
      kind: "OVERRIDE",
      raw: match[0],
    }),
  },
  {
    name: "CONNECTIVE",
    regex: /^(そのあと|その後|次に|続けて)/,
    build: (match) => ({
      kind: "CONNECTIVE",
      raw: match[0],
    }),
  },
];

function isSeparator(ch: string): boolean {
  return ch === "。" || ch === "、" || ch === "," || ch === ";" || ch === "；";
}

function startsWithRule(text: string): boolean {
  return RULES.some((rule) => rule.regex.test(text));
}

function coalesceContent(tokens: Token[]): Token[] {
  const result: Token[] = [];

  for (const token of tokens) {
    if (token.kind !== "CONTENT") {
      result.push(token);
      continue;
    }

    const trimmed = token.raw.trim();
    if (!trimmed) {
      continue;
    }

    const last = result[result.length - 1];
    if (last && last.kind === "CONTENT") {
      last.raw = `${last.raw}${trimmed}`;
    } else {
      result.push({ kind: "CONTENT", raw: trimmed });
    }
  }

  return result;
}

export function tokenize(input: string): Token[] {
  const text = normalizeText(input);
  const tokens: Token[] = [];
  let i = 0;

  while (i < text.length) {
    const rest = text.slice(i);

    if (/^\s/.test(rest)) {
      i += 1;
      continue;
    }

    if (isSeparator(rest[0])) {
      i += 1;
      continue;
    }

    let matched = false;

    for (const rule of RULES) {
      const match = rule.regex.exec(rest);
      if (!match) {
        continue;
      }

      tokens.push(rule.build(match));
      i += match[0].length;
      matched = true;
      break;
    }

    if (matched) {
      continue;
    }

    let j = i + 1;
    while (j < text.length) {
      const current = text.slice(j);
      if (isSeparator(text[j]) || startsWithRule(current)) {
        break;
      }
      j += 1;
    }

    tokens.push({
      kind: "CONTENT",
      raw: text.slice(i, j),
    });
    i = j;
  }

  return coalesceContent(tokens);
}
