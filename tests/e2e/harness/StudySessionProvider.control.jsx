import React, { useEffect, useState } from 'react';
import { StudySessionProvider as RealStudySessionProvider } from '../../../src/components/StudySessionView';

// Test-only concurrency seam: independent launch surfaces retain the production
// session lifecycle and share App's real save callbacks/material admission hook.
// Mount both before either starts, so B does not recover A's persisted snapshot.
function ParallelStudySessions({ children, ...callbacks }) {
  const [secondary, setSecondary] = useState(false);
  useEffect(() => {
    const control = { openSecondary: () => setSecondary(true) };
    window.__plannerRecoveryStudySessions = control;
    return () => {
      if (window.__plannerRecoveryStudySessions === control) delete window.__plannerRecoveryStudySessions;
    };
  }, []);
  return <>
    <RealStudySessionProvider {...callbacks}>{secondary ? null : children}</RealStudySessionProvider>
    <RealStudySessionProvider {...callbacks}>{secondary ? children : null}</RealStudySessionProvider>
  </>;
}

export function StudySessionProvider(props) {
  return new URLSearchParams(location.search).get('parallelStudySessions') === 'true'
    ? <ParallelStudySessions {...props} /> : <RealStudySessionProvider {...props} />;
}
