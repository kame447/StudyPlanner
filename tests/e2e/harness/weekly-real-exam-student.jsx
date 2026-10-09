import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../../../src/App';
import { campaignPayload, campaignRendererReply } from '../../../src/features/weeklyPlanning/testUtils/weeklyPlanningRealE2ECampaignFixture';
import { OWNER_ID, FOREIGN_OWNER_ID, seedPlans, seedBufferPlans, seedBufferMonthEvents, providerDocument } from '../support/examStudentScenario.mjs';
import '../../../src/styles.css';
import '../../../src/styles/interaction-continuity.css';
import '../../../src/styles/appSettingsMemory.css';

// Synthetic isolated exam-student persona E2E (not Firestore, not online). Production App and real
// turn runtime; only the provider wire is answered here by authored semantic documents (a declared
// limitation: this tests the application, not model understanding). The planner repository is the
// production local repository over this browser profile's localStorage.
const now = '2026-10-09T09:00:00.000Z';
const user = { id: OWNER_ID, email: 'exam-student@example.test', username: 'exam-student', avatar: '', createdAt: now };
const params = new URLSearchParams(location.search);
// seed: full (15 events + 14 buffers) | monthBuffers | noBusy (no existing busy rows) | foreign (the same rows owned by another user)
const seed = params.get('seed') ?? 'full';
if (!localStorage.getItem('studyplanner.e2e.seeded')) {
  localStorage.setItem('studyplanner.e2e.seeded', 'true');
  localStorage.setItem('studyplanner.users', JSON.stringify([user]));
  localStorage.setItem('studyplanner.session', user.id);
  for (const key of ['actuals', 'dayNotes', 'todos.v1', 'scheduleTemplates.v1', 'timetableTerms.v1', 'timetablePeriods.v1', 'studyMaterials.v1']) {
    localStorage.setItem(`studyplanner.${key}`, '[]');
  }
  // The persona's rows go through the product's own legacy storage shape; the local repository migrates them.
  const owner = seed === 'foreign' ? FOREIGN_OWNER_ID : OWNER_ID;
  const events = seed === 'noBusy' ? [] : seedPlans(owner);
  // full / foreign: life buffers are typed Plan rows (type 'other'). monthBuffers: the same rows as MonthEvents.
  const bufferPlans = seed === 'monthBuffers' || seed === 'noBusy' ? [] : seedBufferPlans(owner);
  localStorage.setItem('studyplanner.plans', JSON.stringify([...events, ...bufferPlans]));
  localStorage.setItem('studyplanner.monthEvents', JSON.stringify(seed === 'monthBuffers' ? seedBufferMonthEvents(owner) : []));
  localStorage.setItem('studyplanner.studySubjects.v1', '[]');
  localStorage.setItem('study-planner-theme-mode', 'light');
  localStorage.setItem('study-planner-theme-palette', 'ocean');
}

const providerCalls = [];
const providerFailures = [];
const semanticRequests = [];
const rendererRequests = [];
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith('https://weekly-exam.invalid/')) return originalFetch(input, init);
  const request = JSON.parse(String(init?.body));
  const schemaName = request.response_format?.json_schema?.name ?? 'unknown';
  providerCalls.push(schemaName);
  try {
    let content;
    if (schemaName === 'weekly_planning_stable_v5_dialogue_response') {
      rendererRequests.push(campaignPayload(request));
      content = campaignRendererReply(campaignPayload(request));
    }
    else if (schemaName === 'weekly_planning_focused_contextual_answer_v5') {
      content = JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    } else if (schemaName === 'weekly_planning_dense_turn_completeness_audit_v5') {
      // Declared limitation: the scripted completeness auditor always accepts the scripted document.
      content = JSON.stringify({ decision: 'complete', missingFacts: [] });
    } else if (schemaName === 'weekly_planning_semantic_document_v5') {
      semanticRequests.push(campaignPayload(request));
      // ?math=N seeds the fresh-plan control (the same math quantity as a follow-up, requested up front).
      const document = providerDocument(campaignPayload(request), { mathProblems: Number(params.get('math')) || 30 });
      if (!request.response_format.json_schema.schema?.properties?.conversationActs) delete document.conversationActs;
      content = JSON.stringify(document);
    } else throw new Error(`Unscripted provider schema: ${schemaName}`);
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (error) {
    providerFailures.push(String(error));
    throw error;
  }
};
window.__examHarness = { providerCalls, providerFailures, semanticRequests, rendererRequests };

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
