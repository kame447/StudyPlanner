export class WeeklyPlanningRuntimeModuleError extends Error {
  constructor(readonly cause: unknown) {
    super('計画に必要な機能を読み込めませんでした。入力内容はこの画面に保持しています。');
    this.name = 'WeeklyPlanningRuntimeModuleError';
  }
}

export function createWeeklyPlanningRuntimeLoader<T>(importModule: () => Promise<T>) {
  let pending: Promise<T> | null = null;
  return function load(): Promise<T> {
    if (pending) return pending;
    const attempt = Promise.resolve().then(importModule).catch((cause: unknown) => {
      if (pending === attempt) pending = null;
      throw new WeeklyPlanningRuntimeModuleError(cause);
    });
    pending = attempt;
    return attempt;
  };
}

// Only code loading is shared/retryable. Never retry execution, OCR, or provider calls here.
export const loadWeeklyPlanningRuntimeModule = createWeeklyPlanningRuntimeLoader(
  () => import('./weeklyPlanningStableV5InstrumentedRuntimeExecutor'),
);
