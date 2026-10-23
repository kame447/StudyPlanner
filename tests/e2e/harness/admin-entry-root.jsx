import React from 'react';
import App from '../../../src/App';
import { usePlannerAppState } from '../../../src/hooks/usePlannerAppState';

// Startup onboarding is outside this authenticated entry regression. The App,
// planner/chat hooks, My Page, root router and Admin access guard stay real.
export function LaplanceAppRoot() {
  const state = usePlannerAppState();
  return <App state={state} />;
}
