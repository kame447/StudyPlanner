import { expect, it } from 'vitest';
import { clearAccountBrowserStorage } from './accountDeletionLocalData';

function storage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); }, clear: () => values.clear() };
}
it('clears this account across shared, uid-scoped, legacy, draft and trace stores while preserving B', () => {
  const local = storage(), session = storage();
  for (const uid of ['A', 'B']) {
    for (const key of [`studyplanner.weeklyPlanning.stableV5.${uid}.2026-10-26`, `studyplanner.aiPlanning.chats.v1.${uid}`,
      `studyplanner.activeSession.v1.${uid}`, `studyplanner.activeSession.v1.${uid}.dispatch.timer`, `studyplanner.userPlanningContext.${uid}`,
      `studyplanner.weeklyPlanning.trace.stableV5.${uid}::chat`, `study-planner-day-timetable:${uid}`]) local.setItem(key, '{}');
  }
  local.setItem('studyplanner.plans', JSON.stringify([{ userId: 'A' }, { userId: 'B' }]));
  local.setItem('studyplanner.users', JSON.stringify([{ id: 'A' }, { id: 'B' }]));
  local.setItem('studyplanner.weeklyPlanning.trace.outbox.v1', JSON.stringify({ version: 1, items: [{ input: { userId: 'A' } }, { input: { userId: 'B' } }] }));
  local.setItem('studyplanner-weekly-approval-ledger-v1', JSON.stringify({ version: 1, operations: [{ userId: 'A' }, { userId: 'B' }] }));
  local.setItem('studyplanner.session', 'A');
  local.setItem('study-planner-theme-mode', 'dark');
  session.setItem('laplance.inquiry-receipt.v1', JSON.stringify({ userId: 'A' }));
  session.setItem('studyplanner.aiPlanning.moduleRecovery.v1', JSON.stringify({ binding: { ownerId: 'B' } }));
  clearAccountBrowserStorage('A', local, session);
  expect(JSON.parse(local.getItem('studyplanner.plans')!)).toEqual([{ userId: 'B' }]);
  expect(JSON.parse(local.getItem('studyplanner.users')!)).toEqual([{ id: 'B' }]);
  expect(JSON.parse(local.getItem('studyplanner.weeklyPlanning.trace.outbox.v1')!).items).toEqual([{ input: { userId: 'B' } }]);
  expect(JSON.parse(local.getItem('studyplanner-weekly-approval-ledger-v1')!).operations).toEqual([{ userId: 'B' }]);
  expect(local.getItem('studyplanner.weeklyPlanning.stableV5.A.2026-10-26')).toBeNull();
  expect(local.getItem('studyplanner.weeklyPlanning.stableV5.B.2026-10-26')).toBe('{}');
  expect(local.getItem('studyplanner.activeSession.v1.A.dispatch.timer')).toBeNull();
  expect(local.getItem('studyplanner.activeSession.v1.B.dispatch.timer')).toBe('{}');
  expect(local.getItem('studyplanner.session')).toBeNull();
  expect(local.getItem('study-planner-theme-mode')).toBe('dark');
  expect(session.getItem('laplance.inquiry-receipt.v1')).toBeNull();
  expect(session.getItem('studyplanner.aiPlanning.moduleRecovery.v1')).toContain('B');
  clearAccountBrowserStorage('A', local, session);
});
