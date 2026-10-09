import { StartupTimingPanel } from './components/StartupTimingPanel';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { LaplanceAppRoot } from './components/LaplanceAppRoot';
import { configureWeeklyPlanningTraceRepository } from './features/weeklyPlanning/trace/configureWeeklyPlanningTraceRepository';
import { installBottomSheetDragDismiss } from './lib/bottomSheetDragDismiss';
import { installLaplanceSpeechRecognition } from './lib/laplanceSpeechRecognition';
import { installStudySessionSwipeNavigation } from './lib/studySessionSwipeNavigation';
import './styles.css';
import './styles/interaction-continuity.css';
import './styles/appSettingsMemory.css';

const LazyAdminApp = React.lazy(async () => {
  const module = await import('./components/AdminApp');
  return { default: module.AdminApp };
});

configureWeeklyPlanningTraceRepository();
installLaplanceSpeechRecognition();

const currentPath = window.location.pathname;
const isAdminRoute = currentPath === '/admin' || currentPath.startsWith('/admin/');

if (!isAdminRoute) {
  installStudySessionSwipeNavigation();
  installBottomSheetDragDismiss();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StartupTimingPanel />
    {isAdminRoute ? (
      <React.Suspense fallback={null}>
        <LazyAdminApp />
      </React.Suspense>
    ) : (
      <LaplanceAppRoot />
    )}
  </React.StrictMode>,
);
