import React from 'react';
import App from '../../../src/App';
import { usePlannerAppState } from '../../../src/hooks/usePlannerAppState';

// Startup onboarding is outside this authenticated entry regression. The App,
// planner/chat hooks, My Page, root router and Admin access guard stay real.
export function LaplanceAppRoot({ authSession }) {
  const [session, setSession] = React.useState(() => ({ owner: authSession.getCurrentUser()?.id ?? null, epoch: 0 }));
  React.useEffect(() => authSession.subscribe(user => {
    const owner = user?.id ?? null;
    setSession(previous => previous.owner === owner ? previous : { owner, epoch: previous.epoch + 1 });
  }), [authSession]);
  return <EntryPlanner key={session.epoch} />;
}

function EntryPlanner() {
  const state = usePlannerAppState();
  return <App state={state} />;
}
