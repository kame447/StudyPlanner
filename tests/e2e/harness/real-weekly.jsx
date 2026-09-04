import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { AiPlanningView } from '../../../src/components/AiPlanningView';
import { useWeeklyPlanningApplication } from '../../../src/features/weeklyPlanning/application/useWeeklyPlanningApplication';
import '../../../src/styles.css';

window.__realWeeklyEvents = [];

function record(type, payload = null) {
  window.__realWeeklyEvents.push({ type, payload });
}

function queryParams() {
  return new URLSearchParams(window.location.search);
}

function hasGate(name) {
  return (queryParams().get('gate') ?? '')
    .split(',')
    .map((value) => value.trim())
    .includes(name);
}

const approvalSaveResolvers = [];
let approvalSaveAttemptCount = 0;

window.__realWeeklyApproval = {
  release() {
    const resolve = approvalSaveResolvers.shift();
    if (!resolve) return false;
    resolve();
    return true;
  },
  pending() {
    return approvalSaveResolvers.length;
  },
};

async function saveApprovedPlan(draft) {
  approvalSaveAttemptCount += 1;
  record('real-save-approved-plan', {
    ...draft,
    testAttempt: approvalSaveAttemptCount,
  });
  if (hasGate('approval-save')) {
    await new Promise((resolve) => approvalSaveResolvers.push(resolve));
  }
  if (queryParams().get('approvalFailure') === 'once' && approvalSaveAttemptCount === 1) {
    record('real-fail-approved-plan', { testAttempt: approvalSaveAttemptCount });
    throw new Error('browser test approval persistence failure');
  }
  record('real-complete-approved-plan', {
    ...draft,
    testAttempt: approvalSaveAttemptCount,
  });
  return {
    ...draft,
    id: `real-approved-${Date.now()}`,
    seriesId: `real-approved-series-${Date.now()}`,
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
  };
}

const REAL_WEEKLY_USER_ID = 'browser-real-weekly-user';
const REAL_WEEKLY_PLANNER_DATA_AVAILABILITY = {
  status: 'ready',
  ownerId: REAL_WEEKLY_USER_ID,
  observedAt: '2026-08-13T00:00:00.000Z',
  lastSuccessfulAt: '2026-08-13T00:00:00.000Z',
};

function RealWeeklyApplicationHarness() {
  const [open, setOpen] = useState(true);
  const application = useWeeklyPlanningApplication({
    userId: REAL_WEEKLY_USER_ID,
    selectedDate: '2026-08-13',
    plans: [],
    actuals: [],
    scheduleTemplates: [],
    plannerDataAvailability: REAL_WEEKLY_PLANNER_DATA_AVAILABILITY,
    saveWeeklyApprovedPlan: saveApprovedPlan,
  });
  const { state } = application;

  useEffect(() => {
    window.__realWeeklyState = state;
  }, [state]);

  useEffect(() => {
    window.__realWeeklyActions = {
      clearConversation: () => application.clearConversation(),
      resetSession: () => application.resetSession(),
      cancelTurn: () => application.cancelTurn(),
    };
  }, [application.cancelTurn, application.clearConversation, application.resetSession]);

  if (!open) {
    return (
      <main>
        <button type="button" onClick={() => setOpen(true)}>
          AI計画を再度開く
        </button>
      </main>
    );
  }

  return (
    <main data-testid="real-weekly-application-harness">
      <button
        type="button"
        aria-label="テスト用にAI計画を閉じる"
        onClick={() => {
          record('real-close');
          setOpen(false);
        }}
      >
        テスト用に閉じる
      </button>
      <AiPlanningView
        application={application}
        userId={REAL_WEEKLY_USER_ID}
        selectedDate="2026-08-13"
        plans={[]}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <RealWeeklyApplicationHarness />,
);
