import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MonthEvent, Plan } from '../../types/domain';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
  type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';
import {
  CAMPAIGN, CAMPAIGN_MATERIALS, campaignProviderReply, campaignRendererReply, type CampaignRequest,
} from './testUtils/weeklyPlanningRealE2ECampaignFixture';
import type { Json } from './testUtils/weeklyPlanningSchedulingConstraintsFixture';

/*
 * Issue #488 exam-student RED B2: a MonthEvent is shown by the app (month calendar) and the controller is
 * handed it as `monthEvents`, but the placement engine only read `plans` for existing busy time, so the
 * preview put blocks over it. Every shape the product can hold must be honoured like a busy Plan row.
 */
vi.setConfig({ testTimeout: 30_000 });
const OWNER = 'issue488-owner';
const STAMP = '2026-10-01T00:00:00.000Z';
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let withSourceRequest = false;
function reply(call: ScriptedProviderCall) {
  if (call.kind === 'renderer') return campaignRendererReply(call.payload as Json);
  const text = campaignProviderReply('E', call.request as unknown as CampaignRequest);
  if (!withSourceRequest || call.kind !== 'semantic_generic') return text;
  const document = JSON.parse(text);
  document.constraintSourceRequests = [{
    localId: 'plans-source', kind: 'existing_plans', selector: 'active', requestedAction: 'use', sourceText: '卒業研究ノート',
  }];
  return JSON.stringify(document);
}
beforeEach(() => { withSourceRequest = false; resetScriptedConversationRuntime(); provider = installScriptedWeeklyPlanningProvider(reply); });
afterEach(() => { provider.restore(); resetScriptedConversationRuntime(); });

type Block = { date: string; startTime: string; endTime: string };
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
async function preview(params: { plans?: Plan[]; monthEvents?: MonthEvent[]; architecture?: 'interaction_v1' | 'legacy_v5' }): Promise<Block[]> {
  resetScriptedConversationRuntime();
  const conversation = createScriptedConversation({
    provider, architecture: params.architecture ?? 'interaction_v1', studyMaterials: CAMPAIGN_MATERIALS, ownerId: OWNER, ...params,
  });
  const turn = await conversation.submit(CAMPAIGN.E[0]);
  expect(turn.result?.failure).toBeUndefined();
  return (conversation.getState().previewCandidates ?? []) as Block[];
}
const overlaps = (blocks: Block[], date: string, start: string, end: string) =>
  blocks.filter(block => block.date === date && minutes(block.startTime) < minutes(end) && minutes(block.endTime) > minutes(start));

const monthEvent = (target: Block, extra: Partial<MonthEvent> = {}): MonthEvent => ({
  id: 'buffer-1', userId: OWNER, date: target.date, title: '夕食', startTime: target.startTime, endTime: target.endTime,
  repeat: 'none', repeatUntil: null, excludedDates: [], url: '', memo: '', checklist: [], locationTags: [],
  createdAt: STAMP, updatedAt: STAMP, ...extra,
});
const plan = (target: Block): Plan => ({
  id: 'buffer-1', seriesId: 'buffer-1', userId: OWNER, title: '夕食', subject: '', date: target.date, startTime: target.startTime,
  endTime: target.endTime, repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], type: 'other', memo: '',
  createdAt: STAMP, updatedAt: STAMP,
} as Plan);

describe('MonthEvent-backed busy time reaches the placement engine', () => {
  it('the baseline preview has candidates to collide with', async () => {
    expect((await preview({})).length).toBeGreaterThan(0);
  });
  it.each([
    ['seeded shape (no endDate)', (target: Block) => monthEvent(target)],
    ['product 予定を追加 shape (endDate = date)', (target: Block) => monthEvent(target, { endDate: target.date })],
  ])('%s: no candidate overlaps it', async (_name, make) => {
    const target = (await preview({}))[0];
    const blocks = await preview({ monthEvents: [make(target)] });
    expect(overlaps(blocks, target.date, target.startTime, target.endTime)).toEqual([]);
  });
  it('a multi-day all-day MonthEvent keeps every covered day free', async () => {
    const target = (await preview({}))[0];
    const blocks = await preview({ monthEvents: [monthEvent(target, { startTime: '00:00', endTime: '24:00', endDate: target.date })] });
    expect(blocks.filter(block => block.date === target.date)).toEqual([]);
  });
  it('a weekly repeating MonthEvent blocks its later occurrences too', async () => {
    const baseline = await preview({});
    const target = baseline[0];
    const blocks = await preview({ monthEvents: [monthEvent(target, { repeat: 'weekly', repeatUntil: null })] });
    expect(overlaps(blocks, target.date, target.startTime, target.endTime)).toEqual([]);
  });
  it('an all-day MonthEvent without a busy flag blocks its whole day; busy:false does not', async () => {
    const target = (await preview({}))[0];
    const allDay = { startTime: '00:00', endTime: '24:00', endDate: target.date };
    expect((await preview({ monthEvents: [monthEvent(target, allDay)] })).filter(block => block.date === target.date)).toEqual([]);
    expect(await preview({ monthEvents: [monthEvent(target, { ...allDay, busy: false })] })).toEqual(await preview({}));
  });
  it('both the MonthEvent and an existing_plans source request apply: the same blocks, no double effect', async () => {
    const target = (await preview({}))[0];
    const only = await preview({ monthEvents: [monthEvent(target)] });
    withSourceRequest = true;
    const both = await preview({ monthEvents: [monthEvent(target)] });
    expect(both).toEqual(only);
    expect(overlaps(both, target.date, target.startTime, target.endTime)).toEqual([]);
  });
  it('shared change, explicit: legacy_v5 also avoids a busy MonthEvent', async () => {
    const target = (await preview({ architecture: 'legacy_v5' }))[0];
    const blocks = await preview({ architecture: 'legacy_v5', monthEvents: [monthEvent(target)] });
    expect(overlaps(blocks, target.date, target.startTime, target.endTime)).toEqual([]);
  });
  it('control: busy=false (a canonical non-busy event) does not block', async () => {
    const target = (await preview({}))[0];
    const blocks = await preview({ monthEvents: [monthEvent(target, { busy: false })] });
    expect(blocks).toEqual(await preview({}));
  });
  it('control: a MonthEvent of another owner never blocks (and never changes the preview)', async () => {
    const target = (await preview({}))[0];
    const blocks = await preview({ monthEvents: [monthEvent(target, { userId: 'someone-else' })] });
    expect(overlaps(blocks, target.date, target.startTime, target.endTime).length).toBeGreaterThanOrEqual(0);
  });
  it('control: the same slot as a Plan row is honoured', async () => {
    const target = (await preview({}))[0];
    const blocks = await preview({ plans: [plan(target)] });
    expect(overlaps(blocks, target.date, target.startTime, target.endTime)).toEqual([]);
  });
});

describe('a busy MonthEvent with no times (date-only)', () => {
  // Canonical projection: no clock time => a zero-length point, not a block (and, in its own range arithmetic,
  // it appears or not depending on the range). The product editor always writes times (all-day = 00:00-24:00).
  // Pinned: it is not busy time for placement and never breaks the preview.
  it.each([
    ['empty strings', { startTime: '', endTime: '' }],
    ['missing fields', { startTime: undefined, endTime: undefined }],
  ])('%s: not busy, preview unchanged', async (_name, times) => {
    const baseline = await preview({});
    const blocks = await preview({ monthEvents: [monthEvent(baseline[0], times as unknown as Partial<MonthEvent>)] });
    expect(blocks).toEqual(baseline);
  });
});
