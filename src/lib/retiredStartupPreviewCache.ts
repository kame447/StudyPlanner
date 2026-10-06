/** Retire only the withdrawn display-copy cache, never planner/application data. */
export function retireStartupPreviewCache() {
  let storage: Storage;
  const keys: string[] = [];
  try {
    storage = window.localStorage;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith('studyplanner.startup-schedule.v1:') || key === 'studyplanner.startup-schedule.disabled') keys.push(key);
    }
  } catch { return; }
  for (const key of keys) {
    try { storage.removeItem(key); } catch { /* Cleanup failure must not block normal startup. */ }
  }
}
