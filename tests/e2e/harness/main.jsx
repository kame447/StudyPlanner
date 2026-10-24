import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { AuthScreen } from '../../../src/components/AuthScreen';
import { QuickEntryModal } from '../../../src/components/QuickEntryModal';
import '../../../src/styles.css';

window.__quickEntryEvents = [];

function record(type, payload = null) {
  window.__quickEntryEvents.push({ type, payload });
}

const params = new URLSearchParams(window.location.search);
const gatedOperations = new Set(
  (params.get('gate') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const gateQueues = new Map();

function waitForGate(type) {
  if (!gatedOperations.has(type)) {
    return Promise.resolve();
  }

  record('await-gate', { type });
  return new Promise((resolve) => {
    const queue = gateQueues.get(type) ?? [];
    queue.push(resolve);
    gateQueues.set(type, queue);
  });
}

window.__quickEntryHarness = {
  release(type) {
    const queue = gateQueues.get(type) ?? [];
    const resolve = queue.shift();
    gateQueues.set(type, queue);
    if (!resolve) {
      return false;
    }
    record('release-gate', { type });
    resolve();
    return true;
  },
  pending(type) {
    return (gateQueues.get(type) ?? []).length;
  },
};

const scenario = params.get('scenario') ?? 'manual';

const linkablePlan = {
  id: 'browser-plan-english',
  seriesId: 'browser-plan-english',
  userId: 'browser-test-user',
  title: '英語の復習',
  subject: '英語',
  date: '2026-08-13',
  startTime: '19:00',
  endTime: '19:45',
  repeat: 'none',
  repeatUntil: null,
  excludedDates: [],
  recurrenceRules: [],
  type: 'study',
  memo: '',
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
};

const recordedActual = {
  id: 'browser-actual-english',
  userId: 'browser-test-user',
  planId: linkablePlan.id,
  occurrenceDate: '2026-08-13',
  actualStartTime: '19:00',
  actualEndTime: '19:45',
  title: '英語の復習',
  subject: '英語',
  isAlignedToPlan: true,
  note: '',
  updatedAt: '2026-08-13T08:00:00.000Z',
};

const scenarioPlans = scenario === 'linked-actual' || scenario === 'recorded-actual'
  ? [linkablePlan]
  : [];
const scenarioActuals = scenario === 'recorded-actual' ? [recordedActual] : [];

// Opt-in deferred callbacks exercise pending entry controls without a provider.
const deferAuthActions = new URLSearchParams(location.search).get('authDeferred') === '1';
function waitForAuthAction() {
  return new Promise((resolve, reject) => {
    window.__settleAuthAction = (failed = false) => {
      delete window.__settleAuthAction;
      if (failed) reject(new Error('Synthetic auth callback failure'));
      else resolve();
    };
  });
}

function AuthHarness() {
  return (
    <AuthScreen
      notice={null}
      onDismissNotice={() => record('auth-dismiss-notice')}
      onSignUpWithPassword={async (email, password, username) => {
        record('auth-sign-up', { email, password, username });
        if (deferAuthActions) await waitForAuthAction();
        return false;
      }}
      onSignInWithPassword={async (email, password) => {
        record('auth-sign-in', { email, password });
        if (deferAuthActions) await waitForAuthAction();
      }}
      onSignInWithGoogle={async () => {
        record('auth-google-sign-in');
        if (deferAuthActions) await waitForAuthAction();
      }}
      onSendPasswordReset={async (email) => {
        record('auth-password-reset', { email });
        if (deferAuthActions) await waitForAuthAction();
      }}
    />
  );
}

function Harness() {
  const [open, setOpen] = useState(true);
  function closeHarness() {
    record('close');
    setOpen(false);
  }

  if (!open) {
    return (
      <main>
        <button type="button" onClick={() => setOpen(true)}>
          モーダルを再度開く
        </button>
      </main>
    );
  }

  return (
    <QuickEntryModal
      userId="browser-test-user"
      selectedDate="2026-08-13"
      plans={scenarioPlans}
      actuals={scenarioActuals}
      materials={[]}
      subjects={[]}
      onClose={closeHarness}
      onSaveTodo={async (draft) => {
        record('save-todo', draft);
        await waitForGate('save-todo');
        record('complete-save-todo');
      }}
      onSavePlan={async (draft) => {
        record('save-plan', draft);
        await waitForGate('save-plan');
        record('complete-save-plan');
      }}
      onSaveStandaloneActual={async (draft) => {
        record('save-actual', draft);
        await waitForGate('save-actual');
        record('complete-save-actual');
      }}
      onSaveLinkedActual={async (plan, draft) => {
        record('save-linked-actual', { plan, draft });
        await waitForGate('save-linked-actual');
        record('complete-save-linked-actual');
      }}
    />
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  scenario === 'auth' ? <AuthHarness /> : <Harness />,
);
