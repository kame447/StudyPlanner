import React from 'react';
import ReactDOM from 'react-dom/client';
import { StudyPlannerAppRoot } from '../../../src/components/StudyPlannerAppRoot';
import { authRepository, plannerRepository } from '../../../src/repositories';
import { StartupTimingPanel } from '../../../src/components/StartupTimingPanel';
import { addDays, toIsoDate } from '../../../src/lib/date';
import { createLocalWeeklyPlanningPersonalizationRepository, setWeeklyPlanningPersonalizationRepositoryForTests } from '../../../src/features/weeklyPlanning/personalization/weeklyPlanningPersonalizationRepository';
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
if (new URLSearchParams(location.search).get('weekStart') !== 'missing') {
  await createLocalWeeklyPlanningPersonalizationRepository().setWeekStartsOn(ownerId, 'monday');
}
// Opt-in synthetic read failure; the production hook/root own retry and readiness.
if (new URLSearchParams(location.search).get('preferenceWait') === '1') {
  const local = createLocalWeeklyPlanningPersonalizationRepository();
  const requests = [];
  const control = window.__preferenceReadHarness = {
    writes: 0,
    get readCount() { return requests.length; },
    async resolve(index, missing = false) {
      requests[index].resolve(missing ? null : await local.getProfile(ownerId));
    },
  };
  setWeeklyPlanningPersonalizationRepositoryForTests({
    getProfile() { return new Promise((resolve, reject) => requests.push({ resolve, reject })); },
    setWeekStartsOn(...args) { control.writes += 1; return local.setWeekStartsOn(...args); },
    resetProfile(...args) { control.writes += 1; return local.resetProfile(...args); },
  });
}

window.__plannerRecoveryRepository.holdTargetReads();
window.__realWeeklyEvents = [];
const authListeners = new Set();
const policyListeners = new Set();
let currentUser = new URLSearchParams(location.search).get('cachedAuth') === '1' ? { id: ownerId, requiresEmailVerification: false } : null;
const observations = { started: 0, active: 0, stopped: 0, maxActive: 0 };
// Only the optional IO port is replaced; the root and hook own real lifetimes.
authRepository.observeStartupProfile = (_owner, scope) => {
  observations.started += 1; observations.active += 1;
  observations.maxActive = Math.max(observations.maxActive, observations.active);
  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true; observations.active -= 1; observations.stopped += 1;
  };
  scope.onInvalidate(stop);
  return stop;
};
const markerObservations = { started: 0, active: 0, stopped: 0, maxActive: 0 };
plannerRepository.observeStartupScheduleMarker = (_owner, scope) => {
  markerObservations.started += 1; markerObservations.active += 1;
  markerObservations.maxActive = Math.max(markerObservations.maxActive, markerObservations.active);
  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true; markerObservations.active -= 1; markerObservations.stopped += 1;
  };
  scope.onInvalidate(stop); return stop;
};
window.__startupGateHarness = {
  React,
  observations,
  markerObservations,
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
