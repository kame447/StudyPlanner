import type {
  WeeklyConditionOperation,
  WeeklyPlanningQualityPreference,
} from '../weeklyPlanningTypes';
import { normalizeConditionText } from './weeklyPlanningText';

export function hasQualityAvoidanceCue(text: string): boolean {
  return /ならない|なりにくい|避けたい|避ける|避けて|しない|しにくい|なし|出ない|作らない|固めない|固まらない|細切れにならない/.test(
    text,
  );
}

export function classifyQualityPreferenceOperations(
  text: string,
): WeeklyConditionOperation[] {
  const operations: WeeklyConditionOperation[] = [];
  const normalizedText = normalizeConditionText(text);
  const addPreference = (preference: WeeklyPlanningQualityPreference) => {
    if (
      !operations.some(
        (operation) =>
          operation.kind === 'addQualityPreference' && operation.preference === preference,
      )
    ) {
      operations.push({ kind: 'addQualityPreference', preference });
    }
  };

  if (/分散/.test(normalizedText)) {
    addPreference('preferTaskSpread');
  }

  if (
    /(?:1|一)\s*日\s*(?:1|一)\s*科目|(?:1|一)\s*日(?:だけ)?に?固め|(?:1|一)\s*日(?:だけ)?/.test(
      normalizedText,
    ) && hasQualityAvoidanceCue(normalizedText)
  ) {
    addPreference('avoidSingleSubjectDay');
  }

  if (
    /30\s*分台|30\s*分だけ|短すぎ|短い/.test(normalizedText) &&
    hasQualityAvoidanceCue(normalizedText)
  ) {
    addPreference('avoidTinyChunks');
  }

  if (/細切れ/.test(normalizedText) && hasQualityAvoidanceCue(normalizedText)) {
    addPreference(
      /重いタスク|重め|卒研|レポート|実装|計算理論/.test(normalizedText)
        ? 'avoidFragmentingHeavyTasks'
        : 'avoidTinyChunks',
    );
  }

  if (
    /同じ科目|同一科目|同じタスク|同一タスク|科目/.test(normalizedText) &&
    /固ま|固め/.test(normalizedText) &&
    hasQualityAvoidanceCue(normalizedText)
  ) {
    addPreference('avoidSameTaskClumping');
  }

  return operations;
}

export function mergeWeeklyPlanningQualityPreferences(
  current: WeeklyPlanningQualityPreference[] | undefined,
  preference: WeeklyPlanningQualityPreference,
): WeeklyPlanningQualityPreference[] {
  return current?.includes(preference) ? [...current] : [...(current ?? []), preference];
}

export function getQualityPreferenceMessage(
  preference: WeeklyPlanningQualityPreference,
): string {
  switch (preference) {
    case 'preferTaskSpread':
      return '複数日に分散しやすい配置を優先します。';
    case 'avoidSingleSubjectDay':
      return '1日1科目だけに偏りにくい配置を優先します。';
    case 'avoidTinyChunks':
      return '30分台の細かい学習ブロックを避ける設定にしました。';
    case 'avoidFragmentingHeavyTasks':
      return '重いタスクが細切れになりにくい配置を優先します。';
    case 'avoidSameTaskClumping':
      return '同じ科目が同じ日に固まりにくい配置を優先します。';
  }
}
