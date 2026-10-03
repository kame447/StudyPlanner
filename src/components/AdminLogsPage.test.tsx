import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObservabilityLogEntryPage, ObservabilityLogSessionSummary } from '../../shared/productObservabilityLogReadModel';

const { listMock, entriesMock } = vi.hoisted(() => ({ listMock: vi.fn(), entriesMock: vi.fn() }));
vi.mock('../services/adminObservabilityService', () => ({
  getAdminObservabilityLogs: listMock,
  getAdminObservabilityLogEntries: entriesMock,
  getAdminObservabilityDebugBundle: vi.fn(),
}));
import { AdminLogsPage } from './AdminLogsPage';

function session(overrides: Partial<ObservabilityLogSessionSummary> = {}): ObservabilityLogSessionSummary {
  return {
    source: 'weekly_planning_trace', traceSessionId: 'synthetic-session', subjectAlias: 'synthetic-subject',
    status: 'active', severity: 'info', startedAt: '2026-10-01T00:00:00Z', lastActivityAt: '2026-10-01T01:00:00Z',
    endedAt: null, planningRangeStart: null, planningRangeEnd: null, entryCount: 0, turnCount: 0,
    hasPreview: false, hasApprovalFailure: false, hasFallback: false, hasError: false,
    appVersion: null, traceSchemaVersion: 2, summary: 'metadata only', metadataEvidence: 'no_indexed_entries',
    ...overrides,
  };
}

function entryPage(overrides: Partial<ObservabilityLogEntryPage> = {}): ObservabilityLogEntryPage {
  return {
    entries: [], totalEntryCount: 0, nextAfterSequence: null, responseBytes: 2,
    pageEvidence: {
      indexCountStatus: 'valid', requestedStartSequence: 0, requestedEndSequence: -1, unavailableSequenceCount: 0,
      unprojectableEntryCount: 0, byteLimited: false, indexedRangeExhausted: true,
    },
    ...overrides,
  };
}

let renderer: ReactTestRenderer | undefined;
async function render() {
  await act(async () => { renderer = create(<AdminLogsPage />); });
  return renderer!;
}
function text() { return JSON.stringify(renderer!.toJSON()); }
async function expand() {
  await act(async () => { renderer!.root.findByProps({ className: 'admin-log-session-toggle' }).props.onClick(); });
}

beforeEach(() => {
  listMock.mockReset().mockResolvedValue({
    sessions: [session()], nextCursor: null,
    pageEvidence: { rawDocumentCount: 1, mappedSessionCount: 1, unreadableSessionCount: 0, statusFilteredCount: 0 },
  });
  entriesMock.mockReset().mockResolvedValue(entryPage());
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('AdminLogsPage evidence boundaries', () => {
  it.each([
    ['no_indexed_entries', '索引0件（保存先の空は未確認）'],
    ['activity_without_indexed_entries', '活動情報あり・索引0件'],
    ['unknown_or_invalid_metadata', 'メタデータ不明・不正'],
    ['indexed_activity', '索引に記録あり（本文未確認）'],
  ] as const)('shows %s without asserting inspected trace content', async (metadataEvidence, label) => {
    listMock.mockResolvedValue({ sessions: [session({ metadataEvidence })], nextCursor: null });
    await render();
    expect(text()).toContain(label);
    expect(text()).not.toContain('traceあり');
    expect(text()).toContain('export履歴は管理していません');
    expect(entriesMock).not.toHaveBeenCalled();
  });

  it('distinguishes unreadable or filtered list records from normal zero', async () => {
    listMock.mockResolvedValue({
      sessions: [], nextCursor: 'next-page',
      pageEvidence: { rawDocumentCount: 2, mappedSessionCount: 1, unreadableSessionCount: 1, statusFilteredCount: 1 },
    });
    await render();
    expect(text()).toContain('一覧に表示できない記録があります');
    expect(text()).toContain('この取得範囲に表示対象の診断sessionはありません');
    expect(text()).toContain('次のsessionを読む');
  });

  it('reports zero displayed entries without treating indexed-range exhaustion as storage completeness', async () => {
    await render();
    await expand();
    expect(text()).toContain('索引上の取得対象は0件です');
    expect(text()).toContain('保存先全体の完全性の証明ではありません');
    expect(text()).toContain('表示できるentryは0件です。空のsessionと断定しないでください');
    expect(text()).not.toContain('未export');
  });

  it('retains an earlier read issue after a later clean page without summing overlapping ranges', async () => {
    entriesMock.mockResolvedValueOnce(entryPage({
      totalEntryCount: 40, nextAfterSequence: 19,
      pageEvidence: { indexCountStatus: 'valid', requestedStartSequence: 0, requestedEndSequence: 19, unavailableSequenceCount: 1,
        unprojectableEntryCount: 1, byteLimited: true, indexedRangeExhausted: false },
    })).mockResolvedValueOnce(entryPage({
      totalEntryCount: 40,
      pageEvidence: { requestedStartSequence: 20, requestedEndSequence: 39, unavailableSequenceCount: 0,
        unprojectableEntryCount: 0, byteLimited: false, indexedRangeExhausted: true },
    }));
    await render();
    await expand();
    expect(text()).toContain('応答サイズ上限で区切っています');
    const next = renderer!.root.findAllByType('button').find((button) => button.children.includes('次のentryを読む'));
    expect(next).toBeDefined();
    await act(async () => { next!.props.onClick(); });
    expect(text()).toContain('取得済みの範囲に欠損または読めない記録があります');
    expect(entriesMock).toHaveBeenLastCalledWith({ sessionId: 'synthetic-session', afterSequence: 19, limit: 20 });
  });

  it('keeps missing evidence from an older Worker explicit', async () => {
    listMock.mockResolvedValue({ sessions: [session({ metadataEvidence: undefined })], nextCursor: null });
    entriesMock.mockResolvedValue(entryPage({ pageEvidence: undefined }));
    await render();
    expect(text()).toContain('メタデータ検証情報なし');
    await expand();
    expect(text()).toContain('このWorkerは本文取得範囲の検証情報を返していません');
  });

  it('does not render a failed request as a normal empty page', async () => {
    entriesMock.mockRejectedValue(new Error('synthetic API failure'));
    await render();
    await expand();
    expect(renderer!.root.findByProps({ role: 'alert' })).toBeDefined();
    expect(text()).toContain('synthetic API failure');
    expect(text()).not.toContain('表示できるentryは0件');
  });
  it.each(['invalid', 'capped', undefined] as const)('does not describe unverified index count %s as zero or complete', async (indexCountStatus) => {
    const page = entryPage();
    entriesMock.mockResolvedValue({ ...page, pageEvidence: { ...page.pageEvidence, indexCountStatus, indexedRangeExhausted: false } });
    await render();
    await expand();
    expect(text()).not.toContain('索引上の取得対象は0件です');
    expect(text()).not.toContain('索引範囲の末尾に到達しました');
    expect(text()).toContain('索引件数の完全性は確認できていません');
  });

});
