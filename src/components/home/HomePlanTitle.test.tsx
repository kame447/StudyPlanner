import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HomePlanTitle } from './HomePlanTitle';
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
vi.mock('../../hooks/useDialogFocus', () => ({ useDialogFocus: () => ({ dialogRef: { current: null }, initialFocusRef: { current: null } }) }));
let renderer: ReactTestRenderer | undefined;
beforeEach(() => vi.stubGlobal('document', { body: {} }));
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
for (const title of ['情報資源総論', '非常に長い予定名の全文を読む'.repeat(20)]) {
  it(`opens and closes a read-only title using the existing dialog contract (${title.length})`, () => {
    act(() => { renderer = create(<HomePlanTitle title={title} />); });
    const trigger = renderer!.root.findByType('button');
    expect(trigger.props['aria-haspopup']).toBe('dialog');
    expect(trigger.props['aria-label']).toContain(title);
    expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
    act(() => trigger.props.onClick());
    const dialog = renderer!.root.findByProps({ role: 'dialog' });
    expect(dialog.parent!.props.className).toContain('home-title-overlay');
    expect(dialog.props['aria-modal']).toBe('true');
    expect(dialog.findByType('h2').children).toEqual([title]);
    const actions = dialog.findAllByType('button');
    expect(actions).toHaveLength(1); expect(actions[0].children).toEqual(['閉じる']);
    act(() => actions[0].props.onClick());
    expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
  });
}
