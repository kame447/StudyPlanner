import {
  detectType,
  parseDurationMinutes,
} from '../../../services/naturalLanguageRules';
import type {
  SimpleWeeklyTask,
  WeeklyPlanningTaskAmount,
} from '../weeklyPlanningTypes';
import {
  isPlacementConditionOnly,
  normalizeWeeklyPlanningText,
} from './weeklyPlanningText';
import { resolveSimpleTaskTitle } from './weeklyTitleCleanup';

export function splitWeeklyPlanningTaskTexts(text: string): string[] {
  return normalizeWeeklyPlanningText(text)
    .replace(/[。,]/g, '、')
    .split('、')
    .map((taskText) => taskText.trim())
    .filter(Boolean);
}

function padDatePart(value: string): string {
  return value.padStart(2, '0');
}

export function resolveTaskPriority(text: string): 'normal' | 'high' {
  return /重要|優先|急ぎ|高優先度|最優先|締切|期限/.test(text)
    ? 'high'
    : 'normal';
}

export function parseWeeklyPlanningTaskAmount(
  text: string,
): WeeklyPlanningTaskAmount | null {
  const normalizedText = normalizeWeeklyPlanningText(text);
  const daily = /毎日|1日|一日/.test(normalizedText);
  const durationMinutes = parseDurationMinutes(normalizedText);

  if (durationMinutes && !isPlacementConditionOnly(normalizedText)) {
    return {
      unit: 'minutes',
      value: durationMinutes,
      text: `${durationMinutes}分`,
      daily,
    };
  }

  const pageRangeMatch = normalizedText.match(/p\.\s*(\d+)\s*[-〜~]\s*(\d+)/i);

  if (pageRangeMatch) {
    const startPage = Number(pageRangeMatch[1]);
    const endPage = Number(pageRangeMatch[2]);

    return {
      unit: 'pages',
      value: Math.max(0, endPage - startPage + 1),
      text: pageRangeMatch[0],
      daily,
    };
  }

  const amountPatterns: Array<{
    unit: WeeklyPlanningTaskAmount['unit'];
    pattern: RegExp;
  }> = [
    { unit: 'words', pattern: /(\d+)\s*(?:語|単語)/ },
    { unit: 'items', pattern: /(\d+)\s*個/ },
    { unit: 'pages', pattern: /(\d+)\s*ページ/ },
    { unit: 'problems', pattern: /(\d+)\s*(?:問|問題)/ },
    { unit: 'passages', pattern: /(\d+)\s*題/ },
    { unit: 'years', pattern: /(\d+)\s*年分/ },
  ];

  for (const amountPattern of amountPatterns) {
    const match = normalizedText.match(amountPattern.pattern);

    if (match) {
      return {
        unit: amountPattern.unit,
        value: Number(match[1]),
        text: match[0],
        daily,
      };
    }
  }

  if (/第\s*\d+\s*章|章|単元|教材|ターゲット1900|青チャート/.test(normalizedText)) {
    return {
      unit: /第\s*\d+\s*章|章/.test(normalizedText) ? 'chapter' : 'material',
      text: normalizedText,
      daily,
    };
  }

  return null;
}

export function extractTaskDeadlineDate(
  text: string,
  selectedDate: string,
): string | undefined {
  const normalizedText = normalizeWeeklyPlanningText(text);
  const isoMatch = normalizedText.match(
    /(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s*(?:まで|迄|締切|期限)?/,
  );

  if (isoMatch) {
    return `${isoMatch[1]}-${padDatePart(isoMatch[2])}-${padDatePart(isoMatch[3])}`;
  }

  const monthDayMatch = normalizedText.match(
    /(\d{1,2})[/月](\d{1,2})(?:日)?\s*(?:まで|迄|締切|期限)?/,
  );

  if (!monthDayMatch) {
    return undefined;
  }

  const selectedYear = selectedDate.slice(0, 4);
  return `${selectedYear}-${padDatePart(monthDayMatch[1])}-${padDatePart(
    monthDayMatch[2],
  )}`;
}

export function extractSimpleWeeklyPlanningTasks(
  text: string,
  selectedDate?: string,
): SimpleWeeklyTask[] {
  const trimmedText = text.trim();

  if (!trimmedText) {
    return [];
  }

  return splitWeeklyPlanningTaskTexts(trimmedText)
    .map((taskText) => {
      if (isPlacementConditionOnly(taskText)) {
        return null;
      }

      const amount = parseWeeklyPlanningTaskAmount(taskText);

      if (!amount) {
        return null;
      }

      const title = resolveSimpleTaskTitle(taskText);
      const durationMinutes = amount.unit === 'minutes' ? amount.value ?? 0 : 0;
      const deadlineDate = extractTaskDeadlineDate(
        taskText,
        selectedDate ?? new Date().toISOString().slice(0, 10),
      );
      const task: SimpleWeeklyTask = {
        title,
        durationMinutes,
        amount,
        requiresTimeEstimate: amount.unit !== 'minutes',
        type: detectType(taskText),
        sourceText: taskText,
        priority: resolveTaskPriority(taskText),
      };

      if (deadlineDate) {
        task.deadlineDate = deadlineDate;
      }

      return task;
    })
    .filter((task): task is SimpleWeeklyTask => task !== null);
}
