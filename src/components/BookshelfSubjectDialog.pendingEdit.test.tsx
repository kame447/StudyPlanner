import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookshelfSubjectDialog } from './BookshelfSubjectDialog';
import type { StudySubject } from '../types/domain';

const subject: StudySubject = { id: 'math', userId: 'owner', name: '数学', color: '#2f6fc2',
  createdAt: '2026-10-09T00:00:00Z', updatedAt: '2026-10-09T00:00:00Z' };
const renderers: ReactTestRenderer[] = [];
afterEach(() => { act(() => renderers.splice(0).forEach(renderer => renderer.unmount())); vi.unstubAllGlobals(); });

describe('subject pending input', () => {
  it.each(['save', 'delete'] as const)('disables name/color during %s while keeping dismissal available', async kind => {
    let resolve!: (value: StudySubject) => void;
    const promise = new Promise<StudySubject>(yes => { resolve = yes; });
    const onClose = vi.fn(), onSave = vi.fn().mockReturnValue(promise), onDelete = vi.fn().mockReturnValue(promise);
    vi.stubGlobal('window', { confirm: () => true });
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<BookshelfSubjectDialog userId="owner" subject={subject} hasMaterials={false}
      onClose={onClose} onSave={onSave} onDelete={onDelete} />); });
    renderers.push(renderer);
    function inputsDisabled(expected: boolean) {
      expect(Boolean(renderer.root.findByType('input').props.disabled)).toBe(expected);
      for (const node of renderer.root.findAllByType('button').filter(node => node.props.className.includes('bookshelf-color-button'))) {
        expect(Boolean(node.props.disabled)).toBe(expected);
      }
    }
    inputsDisabled(false);
    act(() => {
      if (kind === 'save') void renderer.root.findByType('form').props.onSubmit({ preventDefault() {} });
      else renderer.root.findByProps({ className: 'ghost-button danger' }).props.onClick();
    });
    inputsDisabled(true);
    const dismissals = renderer.root.findAllByType('button').filter(node => ['閉じる', 'キャンセル'].includes(node.props.children));
    expect(dismissals).toHaveLength(2);
    dismissals.forEach(node => expect(Boolean(node.props.disabled)).toBe(false));
    expect(kind === 'save' ? onSave : onDelete).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(subject); await promise; });
    inputsDisabled(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('unlocks inputs after a rejected save and preserves the draft', async () => {
    let reject!: (error: unknown) => void;
    const promise = new Promise<StudySubject>((_, no) => { reject = no; });
    let renderer!: ReactTestRenderer;
    const onClose = vi.fn();
    act(() => { renderer = create(<BookshelfSubjectDialog userId="owner" subject={subject} hasMaterials={false}
      onClose={onClose} onSave={vi.fn().mockReturnValue(promise)} onDelete={vi.fn()} />); });
    renderers.push(renderer);
    act(() => { renderer.root.findByType('input').props.onChange({ target: { value: '物理' } }); });
    act(() => { void renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    expect(renderer.root.findByType('input').props.disabled).toBe(true);
    await act(async () => { reject(new Error('controlled failure')); await promise.catch(() => undefined); });
    expect(renderer.root.findByType('input').props.disabled).toBe(false);
    expect(renderer.root.findByType('input').props.value).toBe('物理');
    expect(renderer.root.findByProps({ type: 'submit' }).props.disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });
});
