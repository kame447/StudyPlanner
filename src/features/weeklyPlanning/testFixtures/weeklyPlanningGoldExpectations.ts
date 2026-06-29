export const WP_RP_001_WEEKEND_EXAM_EXPECTED = {
  yearRange: {
    startYear: 2019,
    endYear: 2025,
    sourceText: '2019〜2025',
  },
  completedYearsByField: {
    '数学・数理系': [2025, 2024, 2023, 2022, 2021],
  },
  unitRate: {
    unit: 'year_field_chunk',
    minutesPerUnit: 120,
    source: 'user',
  },
  priorityOrder: ['数学・数理系', 'ソフトウェア系'],
  remainingYearsByField: {
    '数学・数理系': [2020, 2019],
    'ソフトウェア系': [2025, 2024, 2023, 2022, 2021, 2020, 2019],
  },
  fixedEvents: [],
} as const;