import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { WeeklyPlanningTraceDebugPage } from './features/weeklyPlanning/trace/WeeklyPlanningTraceDebugPage';
import './styles.css';

const isWeeklyPlanningTraceDebugRoute =
  window.location.pathname === '/debug/weekly-planning-conversations';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isWeeklyPlanningTraceDebugRoute ? <WeeklyPlanningTraceDebugPage /> : <App />}
  </React.StrictMode>,
);
