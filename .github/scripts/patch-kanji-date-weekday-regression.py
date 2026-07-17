from pathlib import Path

path = Path('src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts')
text = path.read_text(encoding='utf-8')
old = """function isBareWeekdayStartAnswer(text: string): boolean {
  return /^\\s*[月火水木金土日](?:曜(?:日)?)?\\s*から(?:\\s*です)?\\s*$/.test(
    normalizeIntakeText(text),
  );
}
"""
new = """function isBareWeekdayStartAnswer(text: string): boolean {
  return /^\\s*(?:来週の?)?[月火水木金土日](?:曜(?:日)?)?\\s*から(?:\\s*(?:(?:一|1)\\s*週間|7\\s*日間?))?(?:\\s*です)?\\s*$/.test(
    normalizeIntakeText(text),
  );
}
"""
if text.count(old) != 1:
    raise SystemExit(f'weekday answer anchor count: {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
