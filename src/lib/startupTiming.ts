// Explicit, local-only diagnostics. Never collect identities, payloads or raw errors.
export const STARTUP_PHASES = [
  'splash-mounted', 'auth-session', 'consent', 'preferences', 'memory',
  'profile-observation', 'profile-observer-stop', 'profile', 'schedule-snapshot', 'plans', 'actuals', 'day-notes', 'month-events', 'todos',
  'subjects', 'materials', 'templates', 'terms', 'periods',
  'schedule-marker-observation', 'schedule-marker-observer-stop',
  'schedule-marker-read', 'schedule-marker-complete', 'schedule-marker-unavailable',
  'schedule-migration-acquire', 'schedule-legacy-read', 'schedule-migration-backfill',
  'schedule-migration-complete-write', 'schedule-canonical-snapshot', 'schedule-canonical-plans', 'schedule-canonical-month-events',
  'timetable-write', 'bootstrap', 'home-visible',
] as const;
export type StartupPhase = typeof STARTUP_PHASES[number];
type Outcome = 'pending' | 'success' | 'error' | 'cancelled';
export interface StartupTimingRow {
  id: number; phase: StartupPhase; startMs: number; durationMs: number | null; outcome: Outcome;
}
const EMPTY: readonly StartupTimingRow[] = [];
export function createStartupTimingRecorder(enabled: boolean, now: () => number) {
  let rows = EMPTY;
  let sequence = 0;
  let closed = false;
  const points = new Set<StartupPhase>();
  const listeners = new Set<() => void>();
  const clock = () => { try { const value = now(); return Number.isFinite(value) ? Math.max(0, value) : 0; } catch { return 0; } };
  const notify = () => listeners.forEach(listener => { try { listener(); } catch { /* Diagnostics cannot fail startup. */ } });
  const begin = (phase: StartupPhase) => {
    if (!enabled || closed || rows.length >= 80 || !STARTUP_PHASES.includes(phase)) return (_outcome?: Exclude<Outcome, 'pending'>) => {};
    const id = ++sequence;
    const startMs = clock();
    rows = [...rows, { id, phase, startMs, durationMs: null, outcome: 'pending' }];
    notify();
    let finished = false;
    return (outcome: Exclude<Outcome, 'pending'> = 'success') => {
      if (finished) return;
      finished = true;
      rows = rows.map(row => row.id === id ? { ...row, durationMs: Math.max(0, clock() - startMs), outcome } : row);
      notify();
    };
  };
  return {
    enabled,
    begin,
    markOnce(phase: StartupPhase) {
      if (points.has(phase)) return;
      points.add(phase);
      begin(phase)();
      if (phase === 'home-visible') closed = true;
    },
    measure<T>(phase: StartupPhase, action: () => Promise<T>): Promise<T> {
      if (!enabled || closed) return action();
      const finish = begin(phase);
      try {
        return action().then(value => { finish(); return value; }, error => { finish('error'); throw error; });
      } catch (error) { finish('error'); throw error; }
    },
    getSnapshot: () => rows,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
function diagnosticsEnabled() {
  try { return new URLSearchParams(window.location.search).get('startupTiming') === '1'; } catch { return false; }
}
export const startupTiming = createStartupTimingRecorder(diagnosticsEnabled(), () => performance.now());
