import { describe, expect, it, vi } from 'vitest';
import { attendanceCounts, assertAttendanceDraft } from '../domain/classAttendance';
import { createPlanDraftFromPlan, createPlanFromDraft } from '../domain/planner';
import { createLocalClassAttendanceRepository } from './classAttendanceRepository';
import { createLocalFixture, plan } from './localPersistenceConcurrency.testUtils';
import type { ScheduleTemplate } from '../types/domain';

const template: ScheduleTemplate = { id: 'class-1', userId: 'owner', title: '数理論理', subject: '数学', type: 'school-event', weekday: 'mon', startTime: '09:00', endTime: '10:00', memo: '', active: true, createdAt: 'created', updatedAt: 'updated' };
async function fixture() {
  const local = createLocalFixture();
  await local.repository.upsertScheduleTemplate(template);
  return { ...local, attendance: createLocalClassAttendanceRepository(local.storage, local.repository) };
}

describe('independent class attendance persistence', () => {
  it('keeps one record per lesson and date, corrects status and survives renaming/reopening', async () => {
    const f = await fixture();
    const first = await f.attendance.save({ userId: 'owner', templateId: template.id, date: '2026-10-13', status: 'present' });
    await f.attendance.save({ userId: 'owner', templateId: template.id, date: '2026-10-13', status: 'absent' });
    await f.attendance.save({ userId: 'owner', templateId: template.id, date: '2026-10-14', status: 'late-or-left' });
    await f.repository.upsertScheduleTemplate({ ...template, title: '新しい授業名' });
    const reopened = createLocalClassAttendanceRepository(f.storage, f.repository);
    const rows = await reopened.list('owner', template.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ status: 'absent', createdAt: first.createdAt });
    expect(attendanceCounts(rows)).toEqual({ present: 0, absent: 1, 'late-or-left': 1 });
    expect(await f.repository.getActuals('owner')).toEqual([]);
    expect(await f.repository.getPlans('owner')).toEqual([]);
  });
  it('rejects writes to another owner or missing class and isolates reads', async () => {
    const f = await fixture();
    await f.attendance.save({ userId: 'owner', templateId: template.id, date: '2026-10-13', status: 'present' });
    expect(await f.attendance.list('intruder', template.id)).toEqual([]);
    expect(await f.attendance.list('owner', 'other-class')).toEqual([]);
    await expect(f.attendance.save({ userId: 'intruder', templateId: template.id, date: '2026-10-13', status: 'present' })).rejects.toThrow();
    await f.repository.deleteScheduleTemplate('owner', template.id);
    await expect(f.attendance.save({ userId: 'owner', templateId: template.id, date: '2026-10-13', status: 'absent' })).rejects.toThrow();
    expect(await f.attendance.list('owner', template.id)).toHaveLength(1);
  });
  it('separates repeated and concurrent dates without replacing the whole collection', async () => {
    const f = await fixture();
    await Promise.all(Array.from({ length: 20 }, (_, index) => f.attendance.save({ userId: 'owner', templateId: template.id, date: `2026-10-${String(index + 1).padStart(2, '0')}`, status: 'present' })));
    await Promise.all(Array.from({ length: 3 }, () => f.attendance.save({ userId: 'owner', templateId: template.id, date: '2026-10-01', status: 'absent' })));
    expect(await f.attendance.list('owner', template.id)).toHaveLength(20);
    expect(attendanceCounts(await f.attendance.list('owner', template.id))).toEqual({ present: 19, absent: 1, 'late-or-left': 0 });
  });
  it.each(['2026-02-30', '2026-13-01', 'not-a-date', ''])('rejects invalid date %s before any storage', async date => {
    const f = await fixture();
    const write = vi.spyOn(f.storage, 'setItem');
    await expect(f.attendance.save({ userId: 'owner', templateId: template.id, date, status: 'present' })).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
  it('does not claim a failed storage write as saved or erase corrupt history', async () => {
    const f = await fixture();
    vi.spyOn(f.storage, 'setItem').mockImplementationOnce(() => { throw Error('quota'); });
    await expect(f.attendance.save({ userId: 'owner', templateId: template.id, date: '2026-10-13', status: 'present' })).rejects.toThrow('quota');
    expect(await f.attendance.list('owner', template.id)).toEqual([]);
    f.storage.setItem('studyplanner.classAttendance.v1:owner:class-1:2026-10-13', '{invalid');
    await expect(f.attendance.list('owner', template.id)).rejects.toThrow();
    await expect(f.attendance.save({ userId: 'owner', templateId: template.id, date: '2026-10-13', status: 'present' })).rejects.toThrow();
  });
  it('rejects path-like identities and unknown statuses', () => {
    expect(() => assertAttendanceDraft({ userId: 'owner', templateId: 'other/records/class', date: '2026-10-13', status: 'present' })).toThrow();
    expect(() => assertAttendanceDraft({ userId: 'owner', templateId: 'class', date: '2026-10-13', status: 'unknown' as never })).toThrow();
  });
});

it('round-trips associated schedules through canonical storage and normal editing without creating a timetable occurrence', async () => {
  const f = await fixture();
  const source = plan({ classTemplateId: template.id, sourceType: 'manual', sourceId: null, type: 'deadline', title: 'レポート提出' });
  await f.repository.upsertPlan(source);
  const reloaded = (await f.repository.getPlans('owner'))[0];
  expect(reloaded.classTemplateId).toBe(template.id);
  const draft = createPlanDraftFromPlan(reloaded);
  expect(draft.classTemplateId).toBe(template.id);
  await f.repository.upsertPlan(createPlanFromDraft({ ...draft, title: '修正した提出予定' }, reloaded));
  const canonical = JSON.parse(f.storage.getItem('studyplanner.scheduleEvents.v1')!);
  expect(canonical).toHaveLength(1);
  expect(canonical[0]).toMatchObject({ category: 'deadline', provenance: { sourceType: 'manual', sourceId: null }, plan: { classTemplateId: template.id } });
  expect((await f.repository.getPlans('owner'))[0]).toMatchObject({ classTemplateId: template.id, title: '修正した提出予定' });
  expect(await f.repository.getActuals('owner')).toEqual([]);
});
