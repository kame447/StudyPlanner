from pathlib import Path


target = Path('src/features/weeklyPlanning/__tests__/weeklyPlanningAdversarialInput.test.ts')
text = target.read_text()
old = """    [
      'unit-rate range',
      '3時間です',
      {
        type: 'set_unit_rate',
        unitRate: {
          unit: 'year_field_chunk',
          minutesPerUnit: 0,
          source: 'user',
        },
        sourceText: '3時間です',
        confidence: 'high',
      },
      'invalid-unit-rate-minutes',
    ],
"""
new = """    [
      'unit-rate range',
      '0分です',
      {
        type: 'set_unit_rate',
        unitRate: {
          unit: 'year_field_chunk',
          minutesPerUnit: 0,
          source: 'user',
        },
        sourceText: '0分です',
        confidence: 'high',
      },
      'invalid-unit-rate-minutes',
    ],
"""
if old not in text:
    raise RuntimeError('unit-rate range test fixture not found')
target.write_text(text.replace(old, new, 1))
