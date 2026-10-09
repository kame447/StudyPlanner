import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../../../src/App';
import { CAMPAIGN, campaignPayload, campaignProviderReply } from '../../../src/features/weeklyPlanning/testUtils/weeklyPlanningRealE2ECampaignFixture';
import { schedulingDocument } from '../../../src/features/weeklyPlanning/testUtils/weeklyPlanningSchedulingConstraintsFixture';
import '../../../src/styles.css';
import '../../../src/styles/interaction-continuity.css';
import '../../../src/styles/appSettingsMemory.css';

// Synthetic isolated save E2E (not Firestore, not online). The full production App runs with the
// real turn runtime; only the provider wire is answered here by authored replies, and the planner
// repository is the production local repository over this browser profile's localStorage.
const now = '2026-10-07T09:00:00.000Z';
const user = { id: 'synthetic-save-owner', email: 'synthetic-save@example.test', username: 'synthetic-save', avatar: '', createdAt: now };
const subject = { id: 'math', userId: user.id, name: '数学', color: '#2f6fc2', createdAt: now, updatedAt: now };
// Seed only a pristine profile, so a real reload reads what the first load durably saved.
if (!localStorage.getItem('studyplanner.e2e.seeded')) {
  localStorage.setItem('studyplanner.e2e.seeded', 'true');
  localStorage.setItem('studyplanner.users', JSON.stringify([user]));
  localStorage.setItem('studyplanner.session', user.id);
  for (const key of ['plans', 'actuals', 'dayNotes', 'monthEvents', 'todos.v1', 'scheduleTemplates.v1', 'timetableTerms.v1', 'timetablePeriods.v1', 'studyMaterials.v1']) {
    localStorage.setItem(`studyplanner.${key}`, '[]');
  }
  localStorage.setItem('studyplanner.studySubjects.v1', JSON.stringify([subject]));
  localStorage.setItem('study-planner-theme-mode', 'light');
  localStorage.setItem('study-planner-theme-palette', 'ocean');
}

const scenario = new URLSearchParams(location.search).get('scenario') ?? 'A';
const providerCalls = [];
const providerFailures = [];
const originalFetch = window.fetch.bind(window);
// Scenario S: one authored utterance whose work spans two calendar weeks of October 2026.
const SPAN_TEXT = '10月8日から10月14日の間に、アルゴリズムイントロダクションを60ページ読みたい。1ページ3分くらいで、平日は20時以降がいい';
function spanReply(request) {
  const schema = request.response_format?.json_schema;
  if (schema?.name !== 'weekly_planning_semantic_document_v5') return campaignProviderReply('A', request);
  if (campaignPayload(request).userText !== SPAN_TEXT) throw new Error('Unscripted span turn');
  const document = schedulingDocument('A');
  document.planningWindow = { localId: 'window', kind: 'absolute', value: '2026-10-08/2026-10-14', start: '2026-10-08', end: '2026-10-14', sourceText: '10月8日から10月14日の間に' };
  document.tasks[0].workloads[0].amount = 60;
  document.tasks[0].workloads[0].sourceText = '60ページ';
  document.tasks[0].sourceText = 'アルゴリズムイントロダクションを60ページ読みたい';
  if (!schema.schema?.properties?.conversationActs) delete document.conversationActs;
  return JSON.stringify(document);
}
window.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith('https://weekly-save.invalid/')) return originalFetch(input, init);
  const request = JSON.parse(String(init?.body));
  providerCalls.push(request.response_format?.json_schema?.name ?? 'unknown');
  try {
    const content = scenario === 'S' ? spanReply(request) : campaignProviderReply(scenario, request);
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (error) {
    providerFailures.push(String(error));
    throw error;
  }
};
window.__weeklySaveHarness = { texts: scenario === 'S' ? [SPAN_TEXT] : CAMPAIGN[scenario], providerCalls, providerFailures };

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
