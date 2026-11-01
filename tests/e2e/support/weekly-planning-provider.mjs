// The historical fixtures describe typed facts, not raw-language interpretation.
// Keep their product oracle while sending the native VNext wire representation.
// Deliberately reject unsupported fixture families instead of silently losing facts.
export const VNEXT_SCHEMA = 'weekly_planning_vnext_native_v1';

export function vnextReadingFromFacts(document) {
  for (const key of ['relations', 'constraintSourceRequests', 'userContextFacts', 'uncertainties', 'corrections', 'decisions']) {
    if (document[key]?.length) throw new Error(`Port ${key} explicitly before using this fixture on VNext`);
  }
  const add = [];
  if (document.planningWindow) {
    const { localId, kind: windowKind, value, start, end } = document.planningWindow;
    add.push({ kind: 'planning_window', localId, windowKind, value, start, end });
  }
  for (const task of document.tasks) {
    const taskRef = { localId: task.localId };
    add.push({ kind: 'task', localId: task.localId, category: task.category, title: task.title });
    if (task.study) {
      if (task.study.components?.length) throw new Error('Port component fixtures explicitly');
      add.push({ kind: 'study_context', localId: `${task.localId}-context`, taskRef,
        purpose: task.study.purpose, activityKind: task.study.activityKind, contextLabel: task.study.contextLabel });
    }
    for (const workload of task.workloads ?? []) {
      const { localId, quantityRole, amount, unitCode, unitLabel, rangeStart, rangeEnd, perOccurrence, periodExpression } = workload;
      add.push({ kind: 'workload', localId, taskRef, componentRef: null,
        quantityRole, amount, unitCode, unitLabel, rangeStart, rangeEnd, perOccurrence, periodExpression });
    }
    for (const estimate of task.effortEstimates ?? []) {
      const { localId, targetLocalId, kind: effortKind, minutes, unitCode, precision } = estimate;
      add.push({ kind: 'effort_estimate', localId, taskRef, targetRef: { localId: targetLocalId },
        effortKind, minutes, unitCode, unitLabel: estimate.unitLabel ?? null, precision });
    }
    for (const constraint of task.temporalConstraints ?? []) {
      const { localId, targetLocalId, kind: constraintKind, constraintLevel, dateExpression,
        namedTimePeriod, startTime, endTime, precision } = constraint;
      add.push({ kind: 'temporal_constraint', localId, taskRef, targetRef: { localId: targetLocalId },
        constraintKind, constraintLevel, dateExpression, namedTimePeriod, startTime, endTime, precision });
    }
    if (task.recurrence?.length) throw new Error('Port recurrence fixtures explicitly');
  }
  for (const availability of document.availabilityDeclarations ?? []) {
    const { localId, kind: availabilityKind, dateExpression, namedTimePeriod, startTime, endTime,
      recurrenceKind, days, constraintLevel, capacityMinutes } = availability;
    add.push({ kind: 'availability_declaration', localId, availabilityKind, dateExpression, namedTimePeriod,
      startTime, endTime, recurrenceKind, days, constraintLevel, capacityMinutes });
  }
  const conversationActs = (document.conversationActs ?? []).map(act => {
    if (act.targetPublicId !== null) throw new Error('Port existing-target registration explicitly');
    return { kind: act.kind, targetRef: null };
  });
  return { planningIntent: document.planningIntent, conversationActs,
    delta: { add, patch: [], remove: [], relate: [], defer: [] }, answer: null };
}
