import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Plan } from '../../types/domain';

export type PixelStudentState = 'empty' | 'entering' | 'studying';
export type PixelStudentPlan = Pick<Plan, 'id' | 'userId' | 'date' | 'startTime' | 'endTime'>;
export const PIXEL_STUDENT_ENTRY_MS = 2800;

export function useScheduledPixelStudent(
  plan: PixelStudentPlan | null | undefined, now: Date, enabled: boolean, animated: boolean,
): PixelStudentState {
  // Plan dates/times use the same device-local civil time as the Home dashboard.
  const start = plan ? new Date(`${plan.date}T${plan.startTime}:00`).getTime() : NaN;
  const end = plan ? new Date(`${plan.date}T${plan.endTime}:00`).getTime() : NaN;
  const key = plan ? JSON.stringify([plan.userId, plan.id, plan.date, start, end]) : '';
  const instant = now.getTime();
  const active = enabled && start <= instant && instant < end;
  const previous = useRef<{ key: string; instant: number; end: number; owner: string | undefined; animated: boolean } | null>(null);
  const [entryKey, setEntryKey] = useState<string | null>(null);

  useLayoutEffect(() => {
    const prior = previous.current;
    previous.current = enabled ? { key, instant, end, owner: plan?.userId, animated } : null;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Only animate a witnessed, timely boundary, never an already-active mount,
    // a hidden-page catch-up, an arbitrary replacement, or a settings preview.
    if (active && animated && !reduced && prior?.animated && prior.owner === plan?.userId
      && (prior.key === key || prior.end === start)
      && prior.instant < start && start - prior.instant <= 60_000
      && instant - start < 1500) {
      setEntryKey(key);
    } else if (!active || !animated || reduced || prior?.key !== key) {
      setEntryKey(null);
    }
  }, [active, animated, enabled, end, instant, key, plan?.userId, start]);

  useEffect(() => {
    if (!entryKey) return;
    const timer = setTimeout(() => setEntryKey(null), PIXEL_STUDENT_ENTRY_MS);
    return () => clearTimeout(timer);
  }, [entryKey]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof document === 'undefined') return;
    const reset = () => { previous.current = null; setEntryKey(null); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') reset(); };
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onMotion = () => { if (motion?.matches) reset(); };
    document.addEventListener?.('visibilitychange', onVisibility);
    window.addEventListener?.('pagehide', reset);
    motion?.addEventListener?.('change', onMotion);
    return () => {
      document.removeEventListener?.('visibilitychange', onVisibility);
      window.removeEventListener?.('pagehide', reset);
      motion?.removeEventListener?.('change', onMotion);
    };
  }, [enabled]);

  return !active ? 'empty' : animated && entryKey === key ? 'entering' : 'studying';
}
