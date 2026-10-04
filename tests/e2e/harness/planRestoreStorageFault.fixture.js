// Test-only physical-storage fault, shared by the real-App case and its Node
// schedule control. It never supplies repository results or writes replacement
// data. The saved MonthEvent must come from the caller's real public callback.
export function installPlanRestoreStorageFault({ storage, storagePrototype, planId, onPlanRestore }) {
  const scheduleKey = 'studyplanner.scheduleEvents.v1';
  const actualKey = 'studyplanner.actuals';
  const originalSetItem = storagePrototype.setItem;
  const events = [];
  const failure = new Error('Synthetic Plan Undo Actual write failure');
  let entered = false;
  let failed = false;

  function setItem(key, value) {
    if (this !== storage || ![scheduleKey, actualKey].includes(key)) {
      return originalSetItem.call(this, key, value);
    }
    const rows = JSON.parse(value);
    if (entered && !failed && key === actualKey) {
      failed = true;
      events.push({ phase: 'failed-write', key, rows });
      throw failure;
    }
    const result = originalSetItem.call(this, key, value);
    events.push({ phase: 'written', key, rows });
    if (!entered && key === scheduleKey && rows.some(row =>
      row.provenance?.legacy.kind === 'plan' && row.provenance.legacy.id === planId)) {
      entered = true;
      events.push({ phase: 'enqueue-month' });
      // Synchronous admission is the boundary under test. Never await a facade
      // call while its predecessor still holds the same physical-storage queue.
      onPlanRestore();
    }
    return result;
  }
  storagePrototype.setItem = setItem;
  return {
    failure,
    snapshot: () => structuredClone({ entered, failed, events }),
    dispose() {
      if (storagePrototype.setItem === setItem) storagePrototype.setItem = originalSetItem;
    },
  };
}
