import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { usePlannerDataState, type UsePlannerDataStateResult } from '../hooks/usePlannerDataState';
import { createLocalPlannerRepository } from '../repositories/createLocalPlannerRepository';
import { MemoryStorage, actual as makeActual, plan as makePlan } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { ActualEditorCard } from './ActualEditorCard';
import { StandaloneActualEditorCard } from './StandaloneActualEditorCard';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({
  plannerRepository: new Proxy({}, {
    get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
  }),
}));
const plan = makePlan();
const actual = makeActual();
const showNotice = vi.fn();
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
type EditorKind = 'linked-new' | 'linked-existing' | 'standalone';
function Harness({ kind }: { kind: EditorKind }) {
  state = usePlannerDataState({ userId: plan.userId, showNotice });
  const [open, setOpen] = useState(true);
  const close = () => setOpen(false);
  if (!open) return null;
  return kind === 'standalone' ? <StandaloneActualEditorCard
    actual={{ ...actual, planId: null }} plans={state.plans} actuals={state.actuals}
    onSaveStandaloneActual={state.saveStandaloneActual} onLinkStandaloneActualToPlan={state.linkStandaloneActualToPlan}
    onDeleteActual={state.deleteActual} onClose={close} /> : <ActualEditorCard
    plan={plan} plans={state.plans} actuals={state.actuals} actual={kind === 'linked-new' ? undefined : actual}
    onEditPlan={() => undefined} onDeletePlan={state.deletePlan} onSaveActual={state.saveActual}
    onDeleteActual={state.deleteActual} onClose={close} forceOpen hideToggleButton hidePlanActions />;
}
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.clearAllMocks(); });

for (const kind of ['linked-new', 'linked-existing', 'standalone'] as const) {
  it(`${kind} keeps invalid dates out of the real local repository and survives a corrected save and fresh read`, async () => {
    const storage = new MemoryStorage();
    boundary.repository = createLocalPlannerRepository(storage);
    await boundary.repository.upsertPlan(plan);
    if (kind !== 'linked-new') await boundary.repository.upsertActual({ ...actual, planId: kind === 'standalone' ? null : plan.id });
    const storedBefore = await boundary.repository.getActuals(plan.userId);
    await act(async () => { renderer = create(<Harness kind={kind} />); });
    await act(async () => { await state.loadPlannerData(plan.userId); });
    const root = renderer!.root;
    const date = () => root.findByProps({ type: 'date' });
    const memo = () => root.findByType('textarea');
    const save = () => root.findAllByType('button').find(node => node.children.includes(kind === 'standalone' ? '保存' : '記録保存'))!;
    act(() => { memo().props.onChange({ target: { value: '修正後に永続化するメモ' } }); });
    act(() => { date().props.onChange({ target: { value: '' } }); });
    expect(date().props.value).toBe('');
    await act(async () => { save().props.onClick(); });
    // Read through the production repository, not only a callback spy or hook state.
    expect(await boundary.repository.getActuals(plan.userId)).toEqual(storedBefore);
    expect(state.actuals).toEqual(storedBefore);
    expect(date().props.value).toBe('');
    expect(memo().props.value).toBe('修正後に永続化するメモ');
    expect(root.findByProps({ role: 'alert' }).children.join('')).toContain('有効な日付');
    act(() => { date().props.onChange({ target: { value: plan.date } }); });
    await act(async () => { save().props.onClick(); });
    expect(root.findAllByProps({ type: 'date' })).toHaveLength(0);
    const reloaded = await createLocalPlannerRepository(storage).getActuals(plan.userId);
    expect(reloaded).toEqual([expect.objectContaining({ occurrenceDate: plan.date,
      planId: kind === 'standalone' ? null : plan.id, note: '修正後に永続化するメモ' })]);
    if (kind !== 'linked-new') expect(reloaded[0].id).toBe(actual.id);
    expect(state.actuals).toEqual(reloaded);
  });
}
