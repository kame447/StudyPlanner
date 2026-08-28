import React from 'react';
import ReactDOM from 'react-dom/client';
import { StudyPlannerAppRoot } from './components/StudyPlannerAppRoot';
import { configureWeeklyPlanningTraceRepository } from './features/weeklyPlanning/trace/configureWeeklyPlanningTraceRepository';
import { installBottomSheetDragDismiss } from './lib/bottomSheetDragDismiss';
import { scheduleAppViewPreload } from './lib/preloadAppViews';
import { installStudyPlannerSpeechRecognition } from './lib/studyPlannerSpeechRecognition';
import { installStudySessionSwipeNavigation } from './lib/studySessionSwipeNavigation';
import './styles.css';
import './styles/interaction-continuity.css';
import './styles/appSettingsMemory.css';

const LazyAdminApp = React.lazy(async () => {
  const module = await import('./components/AdminApp');
  return { default: module.AdminApp };
});

configureWeeklyPlanningTraceRepository();
installStudyPlannerSpeechRecognition();

const currentPath = window.location.pathname;
const isAdminRoute = currentPath === '/admin' || currentPath.startsWith('/admin/');

if (!isAdminRoute) {
  installStudySessionSwipeNavigation();
  installBottomSheetDragDismiss();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isAdminRoute ? (
      <React.Suspense fallback={null}>
        <LazyAdminApp />
      </React.Suspense>
    ) : (
      <StudyPlannerAppRoot />
    )}
  </React.StrictMode>,
);

if (!isAdminRoute) {
  scheduleAppViewPreload();
}
