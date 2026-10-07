import { deferred } from '../repositories/localPersistenceConcurrency.testUtils';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { StudyMaterial } from '../types/domain';
import { MaterialQuickCreateModal } from './MaterialQuickCreateModal';

const material: StudyMaterial = {
  id: 'material-1',
  userId: 'user-1',
  name: '数学問題集',
  subjectId: 'subject-math',
  subjectName: '数学',
  status: 'active',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function renderModal({
  onSavePlan = vi.fn().mockResolvedValue(undefined),
  onSaveStandaloneActual = vi.fn().mockResolvedValue(undefined),
  onClose = vi.fn(),
} = {}) {
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = create(
      <MaterialQuickCreateModal
        userId="user-1"
        selectedDate="2026-08-14"
        material={material}
        onClose={onClose}
        onSavePlan={onSavePlan}
        onSaveStandaloneActual={onSaveStandaloneActual}
      />,
    );
  });

  return { renderer, onSavePlan, onSaveStandaloneActual, onClose };
}

describe('MaterialQuickCreateModal', () => {
  for (const kind of ['予定', '記録']) {
    it.each([
      ['date', ''], ['date', '2026-02-30'], ['date', '2026-13-01'], ['date', 'invalid'],
      ['time', ''], ['time', '25:00'], ['time', '19:90'], ['time', '7:00'],
    ])(`rejects invalid %s=%s for ${kind} and allows correction`, async (type, value) => {
      const { renderer, onSavePlan, onSaveStandaloneActual, onClose } = renderModal();
      const root = renderer.root;
      act(() => root.findAllByType('button').find(button => button.props.role === 'tab' && button.props.children === kind)!.props.onClick());
      const input = () => root.findAllByType('input').find(input => input.props.type === type)!;
      act(() => input().props.onChange({ target: { value } }));
      expect(root.findByProps({ type: 'submit' }).props.disabled).toBe(true);
      await act(async () => { await root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });
      expect(onSavePlan).not.toHaveBeenCalled();
      expect(onSaveStandaloneActual).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(input().props.value).toBe(value);
      act(() => input().props.onChange({ target: { value: type === 'date' ? '2028-02-29' : '19:00' } }));
      expect(root.findByProps({ type: 'submit' }).props.disabled).toBe(false);
      await act(async () => { await root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });
      expect(kind === '予定' ? onSavePlan : onSaveStandaloneActual).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
      act(() => renderer.unmount());
    });
  }

  it('keeps the default material quick-create path as a standalone actual', async () => {
    const { renderer, onSaveStandaloneActual, onClose } = renderModal();

    await act(async () => {
      await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });

    expect(onSaveStandaloneActual).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        planId: null,
        occurrenceDate: '2026-08-14',
        actualStartTime: '19:00',
        actualEndTime: '19:30',
        title: '数学問題集',
        subject: '数学',
        materialId: 'material-1',
        materialName: '数学問題集',
        isAlignedToPlan: false,
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('preserves the existing cross-midnight clock behavior after extraction', async () => {
    const { renderer, onSaveStandaloneActual } = renderModal();
    const timeInput = renderer.root.findAllByType('input').find(
      (input) => input.props.type === 'time',
    );

    expect(timeInput).toBeDefined();

    act(() => {
      timeInput?.props.onChange({ target: { value: '23:45' } });
    });

    await act(async () => {
      await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });

    expect(onSaveStandaloneActual).toHaveBeenCalledWith(
      expect.objectContaining({
        actualStartTime: '23:45',
        actualEndTime: '00:15',
      }),
    );
  });

  it('keeps the plan tab mapped to the original material plan draft contract', async () => {
    const { renderer, onSavePlan, onSaveStandaloneActual } = renderModal();
    const planTab = renderer.root.findAllByType('button').find(
      (button) => button.props.role === 'tab' && button.props.children === '予定',
    );

    expect(planTab).toBeDefined();

    act(() => {
      planTab?.props.onClick();
    });

    await act(async () => {
      await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });

    expect(onSavePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        date: '2026-08-14',
        startTime: '19:00',
        endTime: '19:30',
        title: '数学問題集',
        subject: '数学',
        materialId: 'material-1',
        repeat: 'none',
        type: 'study',
        sourceType: 'manual',
      }),
    );
    expect(onSaveStandaloneActual).not.toHaveBeenCalled();
  });
});


it('keeps a replacement quick-entry session open and admits a pending submission only once', async () => {
  const gate = deferred(); const save = vi.fn(() => gate.promise), close = vi.fn();
  let renderer!: ReactTestRenderer;
  const view = (date: string) => <MaterialQuickCreateModal userId="user-1" selectedDate={date} material={material}
    onClose={close} onSavePlan={vi.fn()} onSaveStandaloneActual={save} />;
  act(() => { renderer = create(view('2026-08-14')); });
  const submit = renderer.root.findByType('form').props.onSubmit;
  let pending!: Promise<void>;
  act(() => { pending = submit({ preventDefault: vi.fn() }); void submit({ preventDefault: vi.fn() }); });
  expect(save).toHaveBeenCalledOnce();
  act(() => { renderer.update(view('2026-08-15')); });
  await act(async () => { gate.resolve(); await pending; });
  expect(close).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType('input').find(input => input.props.type === 'date')!.props.value).toBe('2026-08-15');
  await act(async () => { await submit({ preventDefault: vi.fn() }); });
  expect(save).toHaveBeenCalledOnce();
  await act(async () => { await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });
  expect(close).toHaveBeenCalledOnce(); expect(save).toHaveBeenCalledTimes(2);
  act(() => renderer.unmount());
});
