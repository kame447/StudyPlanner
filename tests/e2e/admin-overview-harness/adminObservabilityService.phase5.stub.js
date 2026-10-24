import {
  getAdminObservabilityAiAnalysis,
  getAdminObservabilityOverview,
  getAdminObservabilityUserInvestigation,
  getAdminObservabilityUsers as getLegacyUsers,
  getAdminObservabilityUsersPage as getLegacyUsersPage,
  resolveAdminObservabilityUserIdentity,
} from './adminObservabilityService.stub.js';

export {
  getAdminObservabilityAiAnalysis,
  getAdminObservabilityOverview,
  getAdminObservabilityUserInvestigation,
  resolveAdminObservabilityUserIdentity,
};

function enrichUserPage(page) {
  return {
    ...page,
    users: page.users.map((user, index) => ({
      profileSubjectId: `profile-harness-${index + 1}`,
      actorSubjectId: user.actorSubjectId,
      registeredAt: `2026-08-${String(18 + index).padStart(2, '0')}T02:30:00.000Z`,
      firstActivityAt: user.firstActivityAt,
      lastActivityAt: user.lastActivityAt,
      activeDayCount: index === 1 ? null : 8 - index,
      eventCount: user.eventCount,
      productActivityCount: user.productActivityCount,
      aiRequestCount: user.aiRequestCount,
      planningOutcomeCount: user.planningOutcomeCount,
      recentErrorState: index === 0 ? 'present' : index === 1 ? 'unknown' : 'absent',
      recentErrorAt: index === 0 ? '2026-08-29T10:30:00.000Z' : null,
      recentErrorCategory: index === 0 ? 'provider_error' : null,
    })),
  };
}

export async function getAdminObservabilityUsers() {
  return enrichUserPage(await getLegacyUsers());
}

export async function getAdminObservabilityUsersPage() {
  return enrichUserPage(await getLegacyUsersPage());
}
