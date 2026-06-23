import { sanitizeSuggestedTitle } from '../../../services/naturalLanguageRules';
import { normalizeWeeklyPlanningText } from './weeklyPlanningText';

function removeWeeklyConditionFragments(text: string): string {
  return text
    .replace(/この条件で(?:作成|生成)(?:して)?/g, '')
    .replace(/[\d一二三四五六七八九十]+\s*日(?:間)?\s*(?:に|で|へ)?\s*(?:分散|やって|作成|生成|配置)?/g, '')
    .replace(/(?:分散してほしい|分散したい|分散)/g, '')
    .replace(/(?:1|一)\s*日\s*(?:1|一)\s*科目(?:だけ)?(?:になりにくい|にならないように|だけは避けたい|は避けたい|を避けたい)?/g, '')
    .replace(/(?:30|三十)\s*分台(?:にならない|を避けたい|は避けたい)?/g, '')
    .replace(/(?:1|一)\s*回\s*が?\s*(?:30|三十)\s*分台(?:にならない|を避けたい|は避けたい)?/g, '')
    .replace(/(?:重いタスクが)?細切れ(?:にならない|を避けたい|は避けたい)?/g, '')
    .replace(/同じ科目が固まらない(?:ように)?/g, '');
}

export function stripWeeklyPlanningTaskTitle(text: string): string {
  return removeWeeklyConditionFragments(normalizeWeeklyPlanningText(text))
    .replace(/来週|今週|週間|週/g, '')
    .replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*(?:まで|迄|締切|期限)?/g, '')
    .replace(/\d{1,2}[/月]\d{1,2}(?:日)?\s*(?:まで|迄|締切|期限)?/g, '')
    .replace(/p\.\s*\d+\s*[-〜~]\s*\d+/gi, '')
    .replace(/(?:毎日|1日|一日)?\s*\d+(?:\.\d+)?\s*(?:時間|分|語|単語|個|ページ|問|問題|題|年分)/g, '')
    .replace(/第\s*\d+\s*章/g, '')
    .replace(/\d{1,2}(?::\d{1,2})?\s*(?:時)?\s*(?:起床|起きる|起き|就寝|寝たい|寝る|寝)/g, '')
    .replace(/(?:前後|バッファ|余裕)\s*\d+\s*分/g, '')
    .replace(/\d+\s*分\s*(?:前後|バッファ|余裕)/g, '')
    .replace(/(?:最大|1回|一回|セッション)\s*\d+\s*分/g, '')
    .replace(/\d+\s*分\s*(?:まで|以内|最大)/g, '')
    .replace(/(?:休憩|休み)\s*\d+\s*分/g, '')
    .replace(/\d+\s*分\s*(?:休憩|休み)/g, '')
    .replace(/深夜(?:も)?(?:OK|ok|可|使う|使って|入れて)/g, '')
    .replace(/夜中(?:も)?(?:OK|ok|可)/g, '')
    .replace(/0時以降(?:も)?(?:OK|ok|可)/g, '')
    .replace(/(?:午前|午後|夜|夜中心|午後中心|午前中心|日中中心|夜型|朝型)中心/g, '')
    .replace(/(?:(?:2|\u4e8c)\s*\u6642\u9593\s*\u5358\u4f4d|\u9577\u3081|\u4e00\u6c17|\u307e\u3068\u3081\u3066|\u5148\u306b|\u7247\u3065\u3051(?:\u305f\u3044)?|\u7247\u4ed8\u3051(?:\u305f\u3044)?)/g, '')
    .replace(/\d{1,2}(?::\d{1,2})?\s*(?:時)?\s*(?:から|まで|迄)$/g, '')
    .replace(/(?:まで|迄|締切|期限)に?/g, '')
    .replace(/(?:重要な|優先|急ぎ|高優先度|最優先)な?/g, '')
    .replace(/(?:おまかせ|任せ|普通|デフォルト|そのまま|適当|わからない|分からない|OK|ok|はい|進め)/g, '')
    .replace(/\s*(?:追加|変更|修正)\s*$/g, '')
    .replace(/\s*(?:やりたい|したい|勉強したい|学習したい|進めたい|取り組みたい)\s*$/g, '')
    .replace(/\s*(?:にして|として|で|を|は|に|が|へ|より|の)+\s*$/g, '')
    .replace(/^\s*(?:を|は|に|で|が|へ|より|の)+\s*/g, '')
    .replace(/\s*(?:\u306b\u3057\u3066|\u3068\u3057\u3066|\u3067|\u3092|\u306f|\u306b|\u3082|\u304c|\u3078|\u3088\u308a|\u306e)+\s*$/g, '')
    .replace(/^\s*(?:\u3092|\u306f|\u306b|\u3082|\u3067|\u304c|\u3078|\u3088\u308a|\u306e)+\s*/g, '')
    .replace(/[「」"'、。,.]/g, ' ')
    .replace(/(?:(?:2|\u4e8c)\s*\u6642\u9593\s*\u5358\u4f4d|\u9577\u3081|\u4e00\u6c17|\u307e\u3068\u3081\u3066|\u5148\u306b|\u7247\u3065\u3051(?:\u305f\u3044)?|\u7247\u4ed8\u3051(?:\u305f\u3044)?)/g, '')
    .replace(/\s*(?:\u306b\u3057\u3066|\u3068\u3057\u3066|\u3067|\u3092|\u306f|\u306b|\u3082|\u304c|\u3078|\u3088\u308a|\u306e)+\s*$/g, '')
    .replace(/^\s*(?:\u3092|\u306f|\u306b|\u3082|\u3067|\u304c|\u3078|\u3088\u308a|\u306e)+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveSimpleTaskTitle(text: string): string {
  const weeklyTitle = stripWeeklyPlanningTaskTitle(text);

  if (weeklyTitle) {
    return weeklyTitle;
  }

  const sanitizedTitle = removeWeeklyConditionFragments(sanitizeSuggestedTitle(text))
    .replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*(?:まで|迄|締切|期限)?/g, '')
    .replace(/\d{1,2}[/月]\d{1,2}(?:日)?\s*(?:まで|迄|締切|期限)?/g, '')
    .replace(/\d{1,2}(?::\d{1,2})?\s*(?:時)?\s*(?:起床|起きる|起き|就寝|寝たい|寝る|寝)/g, '')
    .replace(/(?:前後|バッファ|余裕)\s*\d+\s*分/g, '')
    .replace(/\d+\s*分\s*(?:前後|バッファ|余裕)/g, '')
    .replace(/(?:最大|1回|一回|セッション)\s*\d+\s*分/g, '')
    .replace(/\d+\s*分\s*(?:まで|以内|最大)/g, '')
    .replace(/(?:休憩|休み)\s*\d+\s*分/g, '')
    .replace(/\d+\s*分\s*(?:休憩|休み)/g, '')
    .replace(/深夜(?:も)?(?:OK|ok|可|使う|使って|入れて)/g, '')
    .replace(/夜中(?:も)?(?:OK|ok|可)/g, '')
    .replace(/0時以降(?:も)?(?:OK|ok|可)/g, '')
    .replace(/(?:まで|迄|締切|期限)に?/g, '')
    .replace(/(?:重要|優先|急ぎ|高優先度|最優先)な?/g, '')
    .replace(/(?:おまかせ|任せ|普通|デフォルト|そのまま|適当|OK|ok|はい|進め|作成|生成)/g, '')
    .replace(/\s*(?:やりたい|したい|勉強したい|学習したい|進めたい|取り組みたい)\s*$/g, '')
    .replace(/[をはにでがへよりの]+$/g, '')
    .replace(/^[をはにでがへよりの]+/g, '')
    .trim();

  return sanitizedTitle || '学習';
}
