import { StartupTimingPanel } from './components/StartupTimingPanel';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ApplicationRouteRoot } from './components/ApplicationRouteRoot';
import { configureWeeklyPlanningTraceRepository } from './features/weeklyPlanning/trace/configureWeeklyPlanningTraceRepository';
import { installLaplanceSpeechRecognition } from './lib/laplanceSpeechRecognition';
import { installMotionPreference } from './lib/motionPreference';
import './styles.css';
import './styles/interaction-continuity.css';
import './styles/appSettingsMemory.css';

installMotionPreference();
configureWeeklyPlanningTraceRepository();
installLaplanceSpeechRecognition();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StartupTimingPanel />
    <ApplicationRouteRoot />
  </React.StrictMode>,
);
