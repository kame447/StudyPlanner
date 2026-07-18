import React from 'react';
import ReactDOM from 'react-dom/client';
import { AdminApp } from './components/AdminApp';
import { StudyPlannerAppRoot } from './components/StudyPlannerAppRoot';
import { configureWeeklyPlanningTraceRepository } from './features/weeklyPlanning/trace/configureWeeklyPlanningTraceRepository';
import { scheduleAppViewPreload } from './lib/preloadAppViews';
import './styles.css';

configureWeeklyPlanningTraceRepository();

const currentPath = window.location.pathname;
const isAdminRoute = currentPath === '/admin' || currentPath.startsWith('/admin/');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isAdminRoute ? <AdminApp /> : <StudyPlannerAppRoot />}
  </React.StrictMode>,
);

if (!isAdminRoute) {
  scheduleAppViewPreload();
}
