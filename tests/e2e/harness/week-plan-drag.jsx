import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { WeekView } from '../../../src/components/WeekView';
import '../../../src/styles.css';

window.__weekPlanDragEvents = [];

function record(type, payload = null) {
  window.__weekPlanDragEvents.push({ type, payload });
}

const initialPlans = [
  {
    id: 'drag-plan-once',
    seriesId: 'drag-plan-once',
    userId: 'browser-test-user',
    title: '数学の復習',
    subject: '数学',
    date: '2026-08-24',
    startTime: '13:00',
    endTime: '14:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
  },
  {
    id: 'drag-plan-recurring',
    seriesId: 'drag-plan-recurring',
    userId: 'browser-test-user',
    title: '英単語',
    subject: '英語',
    date: '2026-08-25',
    startTime: '16:00',
    endTime: '16:30',
    repeat: 'weekly',
    repeatUntil: '2026-09-30',
    excludedDates: [],
    recurrenceRules: [
      {
        id: 'recurrence-base',
        kind: 'weekday',
        startDate: '2026-08-25',
        until: '2026-09-30',
        dates: [],
        weekdays: ['tue'],
        dayType: null,
        startTime: '16:00',
        endTime: '16:30',
        isOverride: false,
      },
    ],
    type: 'study',
    memo: '',
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
  },
];

function Harness() {
  const [plans, setPlans] = useState(initialPlans);

  return (
    <main style={{ width: '100%', height: '100%' }}>
      <WeekView
        selectedDate="2026-08-24"
        userId="browser-test-user"
        plans={plans}
        actuals={[]}
        onOpenPlan={(plan) => record('open-plan', { id: plan.id })}
        onMovePlan={async (plan, target) => {
          record('move-plan', { id: plan.id, target });
          setPlans((current) =>
            current.map((item) =>
              item.id === plan.id && item.repeat === 'none'
                ? {
                    ...item,
                    date: target.date,
                    startTime: target.startTime,
                    endTime: target.endTime,
                  }
                : item,
            ),
          );
        }}
        onDeletePlan={async (plan) => {
          record('delete-plan', {
            id: plan.id,
            occurrenceDate: plan.occurrenceDate ?? plan.date,
          });
          setPlans((current) => current.filter((item) => item.id !== plan.id));
        }}
        onDeleteMonthEvent={async () => undefined}
        onOpenDay={(date) => record('open-day', { date })}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Harness />);