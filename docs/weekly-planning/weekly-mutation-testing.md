# Weekly Planning Mutation Testing Notes

This is preparation only. Stryker is not installed yet and mutation testing is not part of the normal test or CI path.

Candidate scope for a future limited mutation run:

- src/features/weeklyPlanning/scheduling/sessionChunking.ts
- src/features/weeklyPlanning/scheduling/placementScoring.ts
- src/features/weeklyPlanning/parsing/weeklyTaskExtraction.ts
- src/features/weeklyPlanning/parsing/weeklyQualityPreferenceParser.ts

Recommended future setup:

- Add @stryker-mutator/core and @stryker-mutator/vitest-runner as dev dependencies.
- Add a dedicated stryker.weekly.conf.json that only mutates the files above.
- Add a separate script such as test:mutation:weekly.
- Do not run mutation testing against React UI, repositories, or the whole project by default.
- Do not make mutation testing a required CI gate until the weekly planning suite is stable and runtime is measured.
