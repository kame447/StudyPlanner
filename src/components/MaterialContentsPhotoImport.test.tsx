import { readFileSync } from 'node:fs';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaterialContentsPhotoImport } from './MaterialContentsPhotoImport';
import { extractMaterialContentsPhoto } from '../lib/materialContentsPhoto';
vi.mock('../lib/materialContentsPhoto', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/materialContentsPhoto')>(), extractMaterialContentsPhoto: vi.fn(),
}));
const rows = [{ title: '章', level: 1, startPage: 1, endPage: null }, { title: '節', level: 2, startPage: 2, endPage: null }];
const renderers: ReactTestRenderer[] = [];
afterEach(() => { act(() => renderers.forEach(r => r.unmount())); renderers.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount(hasExistingItems = false) {
  const onApply = vi.fn(); let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<MaterialContentsPhotoImport hasExistingItems={hasExistingItems} onApply={onApply} />); });
  renderers.push(renderer);
  const button = (text: string) => renderer.root.findAllByType('button').find(node => node.props.children === text)!;
  const select = () => renderer.root.findByProps({ 'aria-label': '目次写真を選択' }).props.onChange({ target: { files: [{}], value: 'file' } });
  return { renderer, onApply, button, select };
}
describe('contents photo review', () => {
  it('keeps the photo touch target more specific than responsive modal buttons', () => {
    const css = readFileSync(new URL('../styles/bookshelf.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.modal-card\.bookshelf-structure-editor \.material-contents-photo-action\s*\{[^}]*min-height:\s*44px/);
  });
  it('uses the existing secondary action surface for the photo entry', () => {
    const view = mount();
    expect(view.button('目次写真から読み取る').props.className).toBe('ghost-button material-contents-photo-action');
  });
  it('requires review and overwrite confirmation, preserves edited nested sections', async () => {
    vi.mocked(extractMaterialContentsPhoto).mockResolvedValue(rows);
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true); vi.stubGlobal('window', { confirm });
    const view = mount(true); await act(async () => view.select());
    expect(view.onApply).not.toHaveBeenCalled();
    const titleInputs = view.renderer.root.findAllByType('input').filter(node => node.props.maxLength === 300);
    act(() => titleInputs[1].props.onChange({ target: { value: '修正した節' } }));
    act(() => view.button('確認した目次を編集欄へ反映').props.onClick()); expect(view.onApply).not.toHaveBeenCalled();
    act(() => view.button('確認した目次を編集欄へ反映').props.onClick());
    expect(view.onApply).toHaveBeenCalledTimes(1);
    expect(view.onApply.mock.calls[0][0][0]).toMatchObject({ title: '章', children: [{ title: '修正した節', startUnit: 2 }] });
  });
  it('keeps the old draft on invalid edits or provider failure', async () => {
    vi.mocked(extractMaterialContentsPhoto).mockResolvedValueOnce(rows).mockRejectedValueOnce(new Error('読取失敗'));
    const view = mount(); await act(async () => view.select());
    act(() => view.renderer.root.findAllByType('select')[0].props.onChange({ target: { value: '3' } }));
    act(() => view.button('確認した目次を編集欄へ反映').props.onClick()); expect(view.onApply).not.toHaveBeenCalled();
    expect(view.renderer.root.findByProps({ role: 'alert' })).toBeTruthy();
    await act(async () => view.select()); expect(view.onApply).not.toHaveBeenCalled();
    expect(view.renderer.root.findByProps({ role: 'alert' }).props.children).toBe('読取失敗');
  });
  it('ignores older results after replacement and cancellation', async () => {
    let resolveOld!: (value: typeof rows) => void;
    vi.mocked(extractMaterialContentsPhoto).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce([{ ...rows[0], title: '新しい章' }]);
    const view = mount(); await act(async () => view.select()); await act(async () => view.select());
    await act(async () => resolveOld(rows));
    expect(view.renderer.root.findAllByType('input').find(node => node.props.maxLength === 300)?.props.value).toBe('新しい章');
    act(() => view.button('写真の取込をキャンセル').props.onClick()); expect(view.onApply).not.toHaveBeenCalled();
    expect(view.button('確認した目次を編集欄へ反映')).toBeUndefined();
  });
});
