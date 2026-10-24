import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminInquiriesPage } from './AdminInquiriesPage';
import { listInquiries } from '../services/inquiryService';
import type { InquiryPage } from '../features/support/inquiry';
vi.mock('../services/inquiryService', () => ({ listInquiries: vi.fn() }));
let renderer: ReactTestRenderer;
const item = { id: 'receipt', userId: 'owner', body: '<script>private text</script>\nsecond line', createdAt: '2026-10-13T00:00:00.000Z' };
const cursor = { id: 'receipt', seconds: 1, nanoseconds: 1 };
const text = () => JSON.stringify(renderer.toJSON());
const button = (label: string) => renderer.root.findAllByType('button').find((node) => node.children.includes(label))!;
async function mount() { await act(async () => { renderer = create(<AdminInquiriesPage />); }); }
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { act(() => renderer?.unmount()); });
describe('admin inquiry inbox', () => {
  it('shows empty state with one demand read and no listener/polling', async () => {
    vi.mocked(listInquiries).mockResolvedValue({ items: [], nextCursor: null });
    await mount();
    expect(text()).toContain('まだありません');
    expect(listInquiries).toHaveBeenCalledExactlyOnceWith(null);
  });
  it('shows escaped text and owner ID without profile or email lookup; paginates on demand', async () => {
    vi.mocked(listInquiries).mockResolvedValueOnce({ items: [item], nextCursor: cursor }).mockResolvedValueOnce({ items: [{ ...item, id: 'second' }], nextCursor: null });
    await mount();
    expect(renderer.root.findByProps({ className: 'inquiry-admin-body' }).children).toEqual([item.body]);
    expect(text()).toContain('owner');
    await act(async () => button('次の25件').props.onClick());
    expect(listInquiries).toHaveBeenLastCalledWith(cursor);
    expect(renderer.root.findAllByType('article')).toHaveLength(1);
    expect(text()).toContain('second');
  });
  it('retries the failed cursor without losing or skipping the current page', async () => {
    vi.mocked(listInquiries).mockResolvedValueOnce({ items: [item], nextCursor: cursor }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [], nextCursor: null });
    await mount();
    await act(async () => button('次の25件').props.onClick());
    expect(text()).toContain('取得できません');
    expect(text()).toContain(item.id);
    await act(async () => button('再試行').props.onClick());
    expect(vi.mocked(listInquiries).mock.calls.map((call) => call[0])).toEqual([null, cursor, cursor]);
  });
  it('locks repeated reads and discards completion after navigation', async () => {
    let finish!: (page: InquiryPage) => void;
    vi.mocked(listInquiries).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await mount();
    act(() => { button('最新を表示').props.onClick(); button('最新を表示').props.onClick(); });
    expect(listInquiries).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
    await act(async () => { finish({ items: [item], nextCursor: null }); });
    expect(renderer.toJSON()).toBeNull();
  });
});
