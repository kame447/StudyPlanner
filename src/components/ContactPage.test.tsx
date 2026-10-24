import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactPage } from './ContactPage';
import { createFakeAuthSession } from '../test/fakeAuthSession';
import { getInquiryDraft } from '../services/inquiryDraft';
import { submitInquiry } from '../services/inquiryService';

vi.mock('../services/inquiryService', () => ({ submitInquiry: vi.fn(), recoverInquiryReceipt: vi.fn() }));
vi.mock('../services/inquiryAttachmentService', () => ({ inquiryAttachmentsAvailable: vi.fn(async () => false), uploadInquiryAttachments: vi.fn(), prepareInquiryAttachments: vi.fn() }));
let renderer: ReactTestRenderer;
let auth: ReturnType<typeof createFakeAuthSession>;
const owner = { id: 'owner', requiresEmailVerification: false };
const text = () => JSON.stringify(renderer.toJSON());
async function mount() { await act(async () => { renderer = create(<ContactPage authSession={auth.session} />); await vi.dynamicImportSettled(); }); }
function fill(body = '予定を保存できません') { act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: body } })); }
function submit() { renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); }

beforeEach(() => { vi.clearAllMocks(); auth = createFakeAuthSession(); });
afterEach(() => { act(() => renderer?.unmount()); getInquiryDraft(auth.session).dispose(); });

describe('email-free contact', () => {
  it('waits for auth then requests login without sending or asking for an email', async () => {
    await mount();
    expect(text()).toContain('ログイン状態を確認');
    act(() => auth.emit(null));
    expect(text()).toContain('ログインしてください');
    expect(renderer.root.findAllByType('form')).toHaveLength(0);
    expect(text()).not.toContain('メール');
    expect(submitInquiry).not.toHaveBeenCalled();
  });
  it('reports unavailable storage instead of providing fake local submission', async () => {
    auth = createFakeAuthSession({ available: false }); await mount();
    expect(text()).toContain('接続できません');
    expect(renderer.root.findAllByType('form')).toHaveLength(0);
  });
  it('blocks whitespace and duplicate clicks, then displays only an acknowledged receipt', async () => {
    let finish!: (receipt: string) => void;
    vi.mocked(submitInquiry).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await mount(); act(() => auth.emit(owner));
    fill('  \n '); act(submit);
    expect(submitInquiry).not.toHaveBeenCalled();
    fill();
    const label = renderer.root.findAllByType('label').find((label) => label.props.htmlFor === 'inquiry-body')!;
    expect(label.props.htmlFor).toBe(renderer.root.findByType('textarea').props.id);
    expect(label.findAllByType('textarea')).toHaveLength(0);
    expect(label.findByType('span').children).toEqual(['お問い合わせ内容']);
    act(() => { submit(); submit(); });
    expect(submitInquiry).toHaveBeenCalledTimes(1);
    expect(text()).toContain('送信中');
    expect(text()).not.toContain('受け付けました');
    expect(renderer.root.findByType('textarea').props.disabled).toBe(true);
    await act(async () => { finish('receipt'); });
    expect(text()).toContain('受け付けました');
    expect(text()).toContain('receipt');
    expect(renderer.root.findAllByType('textarea')).toHaveLength(0);
  });
  it('preserves exact content and request ID on an unknown result retry', async () => {
    vi.mocked(submitInquiry).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('receipt');
    await mount(); act(() => auth.emit(owner)); fill();
    await act(async () => submit());
    const first = vi.mocked(submitInquiry).mock.calls[0];
    expect(text()).toContain('送信結果を確認できません');
    expect(renderer.root.findByType('textarea').props.disabled).toBe(true);
    await act(async () => submit());
    expect(vi.mocked(submitInquiry).mock.calls[1]).toEqual(first);
    expect(text()).toContain('受け付けました');
  });
  it('clears previous-owner content and ignores that owner’s late acknowledgement', async () => {
    let finish!: (receipt: string) => void;
    vi.mocked(submitInquiry).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await mount(); act(() => auth.emit(owner)); fill('private owner content'); act(submit);
    act(() => auth.emit({ ...owner, id: 'other' }));
    expect(renderer.root.findByType('textarea').props.value).toBe('');
    await act(async () => { finish('old-receipt'); });
    expect(text()).not.toContain('old-receipt');
    expect(text()).not.toContain('private owner content');
    act(() => auth.emit(null));
    expect(renderer.root.findAllByType('form')).toHaveLength(0);
  });
  it('keeps the draft on same-document remount and never automatically resends an unknown result', async () => {
    vi.mocked(submitInquiry).mockRejectedValue(new Error('network'));
    await mount(); act(() => auth.emit(owner)); fill(); await act(async () => submit());
    act(() => renderer.unmount());
    await mount(); act(() => auth.emit(owner));
    expect(renderer.root.findByType('textarea').props.value).toBe('予定を保存できません');
    expect(submitInquiry).toHaveBeenCalledTimes(1);
  });
  it('renders static HTML as auth-unresolved without exposing an in-memory owner or draft', async () => {
    await mount(); act(() => auth.emit(owner)); fill('private owner draft');
    const html = renderToStaticMarkup(<ContactPage authSession={auth.session} />);
    expect(html).toContain('ログイン状態を確認しています');
    expect(html).not.toContain('private owner draft'); expect(html).not.toContain('textarea');
  });
  it('creates a new receipt only after explicitly choosing another inquiry', async () => {
    vi.mocked(submitInquiry).mockResolvedValue('receipt');
    await mount(); act(() => auth.emit(owner)); fill(); await act(async () => submit());
    act(() => renderer.root.findByType('button').props.onClick());
    fill(); await act(async () => submit());
    const calls = vi.mocked(submitInquiry).mock.calls;
    expect(calls[0][1].requestId).not.toBe(calls[1][1].requestId);
  });
});
