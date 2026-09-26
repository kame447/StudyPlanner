import React from 'react';
import ReactDOM from 'react-dom/client';
import { WeekView } from '../../../src/components/WeekView';
import '../../../src/styles.css';

const baseEvent = {
  userId: 'week-layout-user',
  date: '2026-08-24',
  repeat: 'none',
  repeatUntil: null,
  excludedDates: [],
  url: '',
  memo: '',
  checklist: [],
  locationTags: [],
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T00:00:00.000Z',
};

const monthEvents = [
  { ...baseEvent, id: 'overlap-a', title: '重複A', startTime: '08:00', endTime: '10:00' },
  { ...baseEvent, id: 'overlap-b', title: '重複B', startTime: '09:00', endTime: '11:00' },
  { ...baseEvent, id: 'independent', title: '独立予定', startTime: '13:00', endTime: '14:00' },
  { ...baseEvent, id: 'touching', title: '境界予定', startTime: '14:00', endTime: '15:00' },
  {
    ...baseEvent,
    id: 'all-day-readable',
    date: '2026-08-28',
    endDate: '2026-08-29',
    title: 'オープン',
    startTime: '00:00',
    endTime: '00:00',
  },
];

function Harness() {
  return (
    <main style={{ width: '100%', height: '100%' }}>
      <WeekView
        selectedDate="2026-08-24"
        userId="week-layout-user"
        plans={[]}
        actuals={[]}
        monthEvents={monthEvents}
        onDeletePlan={async () => undefined}
        onDeleteMonthEvent={async () => undefined}
        onOpenDay={() => undefined}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Harness />);
