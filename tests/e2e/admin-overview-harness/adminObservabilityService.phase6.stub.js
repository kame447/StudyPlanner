import {
  getAdminObservabilityAiAnalysis,
  getAdminObservabilityOverview,
  getAdminObservabilityUserInvestigation,
  getAdminObservabilityUsers,
  resolveAdminObservabilityUserIdentity,
} from './adminObservabilityService.phase5.stub.js';

export {
  getAdminObservabilityAiAnalysis,
  getAdminObservabilityOverview,
  getAdminObservabilityUserInvestigation,
  getAdminObservabilityUsers,
  resolveAdminObservabilityUserIdentity,
};

const harnessState = new URLSearchParams(window.location.search).get('state') ?? 'populated';

function emptyAggregate() {
  return {
    sessionCount: 0,
    previewReachedCount: 0,
    approvalReachedCount: 0,
    saveCompletedCount: 0,
    abandonedCount: 0,
    failedCount: 0,
    fallbackUsedCount: 0,
    semanticRepairUsedCount: 0,
    staleObservedCount: 0,
    unscheduledObservedCount: 0,
    approvalFailureObservedCount: 0,
    turnCountSum: 0,
    firstPreviewTurnIndexSum: 0,
    firstPreviewTurnIndexKnownCount: 0,
  };
}

function aggregate(overrides = {}) {
  return { ...emptyAggregate(), ...overrides };
}

function rates(value) {
  const sessions = value.sessionCount;
  const rate = (count) => sessions > 0 ? count / sessions : null;
  return {
    previewRate: rate(value.previewReachedCount),
    approvalRate: rate(value.approvalReachedCount),
    saveRate: rate(value.saveCompletedCount),
    failureObservedRate: rate(value.failedCount),
    fallbackRate: rate(value.fallbackUsedCount),
    semanticRepairRate: rate(value.semanticRepairUsedCount),
    staleObservedRate: rate(value.staleObservedCount),
    unscheduledObservedRate: rate(value.unscheduledObservedCount),
    approvalFailureObservedRate: rate(value.approvalFailureObservedCount),
    averageTurns: sessions > 0 ? value.turnCountSum / sessions : null,
    averageTurnsToFirstPreview: value.firstPreviewTurnIndexKnownCount > 0
      ? value.firstPreviewTurnIndexSum / value.firstPreviewTurnIndexKnownCount
      : null,
  };
}

function dimension(key, value) {
  return { key, aggregate: value, rates: rates(value) };
}

const total = aggregate({
  sessionCount: 42,
  previewReachedCount: 35,
  approvalReachedCount: 31,
  saveCompletedCount: 29,
  failedCount: 3,
  fallbackUsedCount: 7,
  semanticRepairUsedCount: 8,
  staleObservedCount: 2,
  unscheduledObservedCount: 5,
  approvalFailureObservedCount: 2,
  turnCountSum: 93,
  firstPreviewTurnIndexSum: 58,
  firstPreviewTurnIndexKnownCount: 35,
});

const dailyValues = [
  ['2026-08-23', 4, 3, 3, 3, 0],
  ['2026-08-24', 5, 4, 4, 3, 1],
  ['2026-08-25', 6, 5, 4, 4, 0],
  ['2026-08-26', 7, 6, 5, 5, 1],
  ['2026-08-27', 6, 5, 5, 5, 0],
  ['2026-08-28', 7, 6, 5, 5, 1],
  ['2026-08-29', 7, 6, 5, 4, 0],
];

export async function getAdminObservabilityPlanningAnalysis() {
  if (harnessState === 'error') throw new Error('Harness planning analytics read failed.');
  const value = harnessState === 'empty' ? emptyAggregate() : total;
  return {
    fromDate: '2026-08-23',
    toDate: '2026-08-29',
    environment: 'production',
    reportingTimeZone: 'Asia/Tokyo',
    aggregate: value,
    rates: rates(value),
    byAppVersion: harnessState === 'empty' ? [] : [
      dimension('2026.8.29', aggregate({
        sessionCount: 32,
        previewReachedCount: 27,
        approvalReachedCount: 24,
        saveCompletedCount: 23,
        failedCount: 2,
        fallbackUsedCount: 5,
        semanticRepairUsedCount: 6,
        staleObservedCount: 1,
        unscheduledObservedCount: 4,
        approvalFailureObservedCount: 1,
        turnCountSum: 69,
        firstPreviewTurnIndexSum: 43,
        firstPreviewTurnIndexKnownCount: 27,
      })),
      dimension('2026.8.28', aggregate({
        sessionCount: 10,
        previewReachedCount: 8,
        approvalReachedCount: 7,
        saveCompletedCount: 6,
        failedCount: 1,
        fallbackUsedCount: 2,
        semanticRepairUsedCount: 2,
        staleObservedCount: 1,
        unscheduledObservedCount: 1,
        approvalFailureObservedCount: 1,
        turnCountSum: 24,
        firstPreviewTurnIndexSum: 15,
        firstPreviewTurnIndexKnownCount: 8,
      })),
    ],
    bySchedulerVersion: harnessState === 'empty' ? [] : [
      dimension('stable-v5', aggregate({
        sessionCount: 38,
        previewReachedCount: 33,
        approvalReachedCount: 29,
        saveCompletedCount: 27,
        failedCount: 2,
        fallbackUsedCount: 5,
        semanticRepairUsedCount: 7,
        staleObservedCount: 2,
        unscheduledObservedCount: 4,
        approvalFailureObservedCount: 2,
        turnCountSum: 84,
        firstPreviewTurnIndexSum: 54,
        firstPreviewTurnIndexKnownCount: 33,
      })),
      dimension('unknown', aggregate({
        sessionCount: 4,
        previewReachedCount: 2,
        approvalReachedCount: 2,
        saveCompletedCount: 2,
        failedCount: 1,
        fallbackUsedCount: 2,
        semanticRepairUsedCount: 1,
        unscheduledObservedCount: 1,
        turnCountSum: 9,
        firstPreviewTurnIndexSum: 4,
        firstPreviewTurnIndexKnownCount: 2,
      })),
    ],
    byPromptVersion: harnessState === 'empty' ? [] : [dimension('unknown', total)],
    byModel: harnessState === 'empty' ? [] : [dimension('unknown', total)],
    daily: harnessState === 'empty' ? dailyValues.map(([localDate]) => ({
      localDate,
      aggregate: emptyAggregate(),
      rates: rates(emptyAggregate()),
    })) : dailyValues.map(([localDate, sessions, previews, approvals, saves, failures]) => {
      const day = aggregate({
        sessionCount: sessions,
        previewReachedCount: previews,
        approvalReachedCount: approvals,
        saveCompletedCount: saves,
        failedCount: failures,
        turnCountSum: sessions * 2,
        firstPreviewTurnIndexSum: previews,
        firstPreviewTurnIndexKnownCount: previews,
      });
      return { localDate, aggregate: day, rates: rates(day) };
    }),
    measurementStartedAt: harnessState === 'empty' ? null : '2026-08-23T00:00:00.000Z',
    lastUpdatedAt: harnessState === 'empty' ? null : '2026-08-29T14:00:00.000Z',
    abandonedMeasured: false,
  };
}
