// The scripted VNext readings of the synthetic provider (pure: no browser import, so the unit suite can run them
// through the real VNext session; see weeklyPlanningVNextProductionSmokeReadings.integration.test.ts).
const EMPTY = { add: [], patch: [], remove: [], relate: [], defer: [] };
const reading = (planningIntent, delta = {}, conversationActs = []) => ({ planningIntent, conversationActs, answer: null, delta: { ...EMPTY, ...delta } });
export const requestContextOf = (messages) => messages.map((message) => { try { return JSON.parse(message.content); } catch { return null; } })
  .find((content) => content?.activeFacts);

/**
 * The scripted VNext reading for one kind of production-flow turn. `context` is the request context the Worker sent
 * (activeFacts with the stored ids), so a correction targets the stored workload exactly as a model would.
 *   consultation  advice only: no facts, no plan
 *   registration  a fixed event on `date`, with the user's request to register it
 *   plan          one study task of 90 minutes on `date`, plan requested
 *   correction    the same task's amount corrected to 60 minutes
 */
export function scriptedReading(kind, { title, date }, context) {
  switch (kind) {
    case 'consultation': return reading('discuss');
    case 'registration': return reading('discuss', { add: [
      { kind: 'task', localId: 'club', category: 'non_study', title },
      { kind: 'temporal_constraint', localId: 'club-time', taskRef: { localId: 'club' }, targetRef: { localId: 'club' },
        constraintKind: 'fixed_interval', constraintLevel: 'hard', dateExpression: date, namedTimePeriod: null,
        startTime: '10:30', endTime: '12:00', precision: 'exact' }] }, [{ kind: 'request_event_registration', targetRef: null }]);
    case 'plan': return reading('create_plan', { add: [
      { kind: 'task', localId: 'reading', category: 'study', title },
      { kind: 'workload', localId: 'reading-work', taskRef: { localId: 'reading' }, componentRef: null, quantityRole: 'remaining',
        amount: 90, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
      { kind: 'task_date_rule', localId: 'reading-day', taskRef: { localId: 'reading' }, targetRef: { localId: 'reading' },
        ruleKind: 'allowed_date', dateExpression: date, constraintLevel: 'hard' }] });
    case 'correction': return reading('update_plan', { patch: [{ kind: 'workload', localId: 'amount-correction',
      targetFactId: context.activeFacts.workloads[0].id, amountDelta: null, changes: { amount: 60, quantityRole: null,
        unitCode: null, unitLabel: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } }] });
    default: throw new Error(`Unknown scripted turn kind: ${kind}`);
  }
}
