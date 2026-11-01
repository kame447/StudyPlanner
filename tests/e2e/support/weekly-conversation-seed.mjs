// Seeds a weekly-planning conversation for the core the production build runs: VNext. The pre-VNext specs wrote
// V5's compatibility slot (`studyplanner.weeklyPlanning.<owner>.<week>` plus the `activeSession` index), which
// VNext never reads, so no conversation or preview existed and every such spec waited for a button that never came.
//
// Call `installWeeklyConversationSeeder(page)` before the spec's own `page.addInitScript`; that script then calls
// `window.__seedWeeklyConversation({ ownerId, weekStartDate, state })` with the same PlanningState it used to store.
// The state goes into VNext's chat-less weekly UI slot, which a user without a chat index reads on first load
// (`createWeeklyPlanningVNextLocalSession().load()`). Placement candidates carry the V5 placement metadata the
// persisted-state codec requires; graph revision 0 matches a conversation with no accepted VNext core yet.
// `tests/e2e/ai-planning-surface` and the other specs that seeded the old slot use the same call.
export async function installWeeklyConversationSeeder(page) {
  await page.addInitScript(() => {
    window.__seedWeeklyConversation = ({ ownerId, weekStartDate, state, conversationId = 'e2e-seeded-conversation' }) => {
      const metadata = { runtime: 'stable_v5', conversationId, graphRevision: 0, taskId: 'e2e-seeded-task',
        sourceFactRefs: ['e2e-seeded-fact'], planType: 'study' };
      const seeded = { ...state, previewCandidates: (state.previewCandidates ?? [])
        .map(candidate => ({ ...candidate, stableV5Metadata: candidate.stableV5Metadata ?? metadata })) };
      localStorage.setItem(`studyplanner.weeklyPlanning.vnext.${ownerId}.${weekStartDate}.ui`, JSON.stringify({
        ownerId, conversationId, payload: { version: 2, state: seeded },
      }));
    };
  });
}
