import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { WeeklyPlanningQuickEntryModal } from '../../../src/components/WeeklyPlanningQuickEntryModal';
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

function RealWeeklyApplicationHarness() {
  const [open, setOpen] = useState(true);
  const application = useWeeklyPlanningApplication({
    userId: 'browser-real-weekly-user',
    selectedDate: '2026-08-13',
    plans: [],
    actuals: [],
    scheduleTemplates: [],
    saveWeeklyApprovedPlan: saveApprovedPlan,
  });

  useEffect(() => {
    window.__realWeeklyState = application.state;
  }, [application.state]);

  useEffect(() => {
    window.__realWeeklyActions = {
      clearConversation: () => application.clearConversation(),
      resetSession: () => application.resetSession(),
    };
  }, [application.clearConversation, application.resetSession]);

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
    <>
      <div aria-label="real weekly application test controls">
        <button type="button" onClick={() => application.clearConversation()}>
          会話履歴だけ消す
        </button>
        <button type="button" onClick={() => application.resetSession()}>
          この週の相談をリセット
        </button>
      </div>
      <WeeklyPlanningQuickEntryModal
        application={application}
        userId="browser-real-weekly-user"
        selectedDate="2026-08-13"
        plans={[]}
        actuals={[]}
        materials={[]}
        subjects={[]}
        onClose={() => {
          record('real-close');
          setOpen(false);
        }}
        onSaveTodo={async (draft) => record('real-save-todo', draft)}
        onSavePlan={async (draft) => record('real-save-plan', draft)}
        onSaveStandaloneActual={async (draft) => record('real-save-actual', draft)}
        onSaveLinkedActual={async (plan, draft) => record('real-save-linked-actual', { plan, draft })}
      />
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <RealWeeklyApplicationHarness />,
);
