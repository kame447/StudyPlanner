import React from 'react';
import ReactDOM from 'react-dom/client';
import { StudyPlannerAppRoot } from '../../../src/components/StudyPlannerAppRoot';
import { StartupTimingPanel } from '../../../src/components/StartupTimingPanel';
import { addDays, toIsoDate } from '../../../src/lib/date';
import { createLocalWeeklyPlanningPersonalizationRepository } from '../../../src/features/weeklyPlanning/personalization/weeklyPlanningPersonalizationRepository';
import './plannerRecoveryRepository.fixture.js';
import '../../../src/styles.css';
import '../../../src/styles/interaction-continuity.css';
import '../../../src/styles/appSettingsMemory.css';

const ownerId = 'startup-gates-owner';
const now = new Date().toISOString();
const plan = { id: 'startup-plan', seriesId: 'startup-plan', userId: ownerId, title: '最新の予定', subject: '数学',
  date: toIsoDate(new Date()), startTime: '12:00', endTime: '13:00', repeat: 'none', repeatUntil: null,
  excludedDates: [], recurrenceRules: [], type: 'study', memo: '', createdAt: now, updatedAt: now };
if (!localStorage.getItem('startup-gates-seeded')) {
  localStorage.setItem('studyplanner.users', JSON.stringify([{ id: ownerId, email: 'startup-gates@example.test', username: '起動検証', avatar: '', createdAt: now }]));
  localStorage.setItem('studyplanner.session', ownerId);
  localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
  localStorage.setItem(`studyplanner.startup-schedule.v1:${ownerId}`, JSON.stringify({
    version: 1, ownerId, savedAt: Date.now(), startDate: plan.date, endDate: addDays(plan.date, 7),
    rows: [{ date: plan.date, startTime: '12:00', endTime: '13:00', title: '退役した表示コピー', subject: '' }],
  }));
  localStorage.setItem('startup-gates-seeded', 'true');
}
await createLocalWeeklyPlanningPersonalizationRepository().setWeekStartsOn(ownerId, 'monday');
window.__plannerRecoveryRepository.holdTargetReads();
window.__realWeeklyEvents = [];
const authListeners = new Set();
const policyListeners = new Set();
let currentUser = null;
window.__startupGateHarness = {
  React,
  policy: 'loading',
  ownerId,
  emitAuth(id = ownerId) {
    currentUser = id ? { id, requiresEmailVerification: false } : null;
    if (id) localStorage.setItem('studyplanner.session', id); else localStorage.removeItem('studyplanner.session');
    authListeners.forEach(listener => listener(currentUser));
  },
  emitPolicy(status) { this.policy = status; policyListeners.forEach(listener => listener()); },
  subscribePolicy(listener) { policyListeners.add(listener); return () => policyListeners.delete(listener); },
};
const session = {
  available: true,
  getCurrentUser: () => currentUser,
  subscribe(listener) { authListeners.add(listener); return () => authListeners.delete(listener); },
  async signOut() { window.__startupGateHarness.emitAuth(null); },
};
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode>
  <StartupTimingPanel /><StudyPlannerAppRoot authSession={session} />
</React.StrictMode>);
