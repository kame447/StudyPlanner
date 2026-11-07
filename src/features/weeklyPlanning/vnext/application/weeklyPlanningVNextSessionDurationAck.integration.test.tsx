import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../../testUtils/plannerDataAvailabilityTest';
import type { WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput } from '../../application/useWeeklyPlanningApplication';
import { useWeeklyPlanningVNextApplication, type WeeklyPlanningVNextLocalApplicationServices } from './useWeeklyPlanningVNextApplication';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { createWeeklyPlanningStableV5DialogueRendererCore } from '../weeklyPlanningVNextV5Boundary';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../../application/weeklyPlanningStableV5RuntimeSession';
import { createWeeklyPlanningApprovalMemoryState, createMemoryWeeklyPlanningApprovalPlanRepository } from '../../application/weeklyPlanningApprovalMemoryRepository';
import { createInMemoryWeeklyPlanningTraceRepository } from '../../trace/weeklyPlanningTraceInMemoryRepository';
import { setWeeklyPlanningTraceRepositoryForTests } from '../../trace/weeklyPlanningTraceRepository';
import { resetWeeklyPlanningStableV5TraceRuntimeForTest } from '../../trace/weeklyPlanningStableV5TraceRuntime';
// @ts-expect-error plain mjs helper shared with the browser specs
import { vnextReadingFromFacts } from '../../../../../tests/e2e/support/weekly-planning-provider.mjs';

const capture = JSON.parse(readFileSync('tests/fixtures/weekly-session-duration-873.json', 'utf8'));
const OWNER = 'planner-recovery-owner';
const RECOVERY_TEXT = '今回の内容は計画へ反映していません。1回の長さをもう一度教えてください。';
// The browser spec weekly-session-duration-ack.spec.mjs asserts the same oracle through the full planner harness;
// this pins it at the hook level (real VNext session, interpreter, scheduler and Stable V5 renderer, stubbed transport).
const Harness = forwardRef<WeeklyPlanningApplication, { input: UseWeeklyPlanningApplicationInput; services: WeeklyPlanningVNextLocalApplicationServices }>((props, ref) => {
  const app = useWeeklyPlanningVNextApplication(props.input, props.services); useImperativeHandle(ref, () => app, [app]); return null;
});
let renderer: ReactTestRenderer | undefined; let restore: () => void;
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-26T07:59:00.000Z'));
  restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage); vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'false');
  resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest(); setWeeklyPlanningTraceRepositoryForTests(createInMemoryWeeklyPlanningTraceRepository()); });
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; setWeeklyPlanningTraceRepositoryForTests(undefined); vi.unstubAllEnvs(); vi.useRealTimers(); restore(); });

for (const mode of ['original redundant duration', 'misleading duration', 'false save claim', 'invalid renderer JSON', 'invalid typed duration']) {
  it(`${mode}: bounded label repair, one reply, one unapproved 60-minute preview and nothing saved`, async () => {
    const reading = structuredClone(capture.semanticDocument);
    const reply = capture.replies.find((item: { name: string }) => item.name === mode);
    reading.tasks[0].effortEstimates[0].precision = reply?.precision ?? 'exact';
    if (mode === 'invalid typed duration') reading.tasks[0].effortEstimates[0].minutes = 0;
    const modelText = mode === 'misleading duration' ? '英語の勉強は明日90分ですね。候補を確認してください。' : mode === 'false save claim' ? '保存しました。'
      : `${reply?.acknowledgement ?? capture.replies[0].acknowledgement}候補を確認してください。`;
    const calls: string[] = []; const prompts: unknown[] = []; let recoveryActionId: string | null = null;
    const client = { createChatCompletion: async (request: { responseFormat?: { json_schema?: { name?: string } }; messages: { role: string; content: string }[] }) => {
      const schema = request.responseFormat?.json_schema?.name ?? 'none'; calls.push(schema);
      if (schema === 'weekly_planning_vnext_native_v1') return JSON.stringify(vnextReadingFromFacts(reading));
      // Preserve the captured utterance and legitimate paraphrase. Its naming
      // fragment is verified by the existing single repair, not invented by the renderer.
      if (schema === 'weekly_planning_vnext_label_repair_v1') return JSON.stringify({ ...vnextReadingFromFacts(reading),
        labelEvidence: [{ localId: 'english', quote: '英語' }] });
      if (schema === 'weekly_planning_stable_v5_dialogue_response') {
        const prompt = request.messages.filter(m => m.role === 'user').map(m => { try { return JSON.parse(m.content); } catch { return null; } }).reverse().find(v => v?.applicationDecision);
        prompts.push(prompt);
        if (mode === 'invalid typed duration') { expect(prompt.applicationDecision).toMatchObject({ actionKind: 'status', previewCount: 0, recovery: { planningDetailsNotApplied: true, acceptedStateUnchanged: true } });
          expect(prompt.currentTurnGrounding?.acceptedFacts ?? []).toEqual([]); recoveryActionId = prompt.actionId; }
        if (mode === 'invalid typed duration') return JSON.stringify({ actionId: prompt.actionId, actionKind: 'status', questionCode: null, groundingAcknowledgement: null, text: RECOVERY_TEXT });
        const effort = prompt.currentTurnGrounding.acceptedFacts.find((f: { kind: string }) => f.kind === 'effort_estimate');
        return mode === 'invalid renderer JSON' ? '{invalid' : JSON.stringify({ actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind, questionCode: prompt.applicationDecision.questionCode,
          groundingAcknowledgement: { factIds: [effort.factId], text: modelText }, text: modelText });
      }
      if (schema === 'weekly_planning_recovery_verdict') { const p = JSON.parse(request.messages[request.messages.length - 1].content); expect(p).toMatchObject({ actionId: recoveryActionId, question: null, text: RECOVERY_TEXT, recovery: { planningDetailsNotApplied: true, acceptedStateUnchanged: true } }); return JSON.stringify({ actionId: p.actionId, questionMatches: 'yes', planningDetailsNotApplied: 'yes', acceptedStateUnchanged: 'yes', retainedPreviewUnchanged: 'yes', noUnsupportedClaims: 'yes' }); }
      throw new Error('unexpected schema ' + schema);
    } };
    const repository = createMemoryWeeklyPlanningApprovalPlanRepository(createWeeklyPlanningApprovalMemoryState());
    const services: WeeklyPlanningVNextLocalApplicationServices = { storage: window.localStorage, now: () => new Date().toISOString(), client: () => client as never,
      interpret: () => createWeeklyPlanningVNextProviderInterpreter() as never, createRenderer: (c, o) => createWeeklyPlanningStableV5DialogueRendererCore(c, o) };
    const input: UseWeeklyPlanningApplicationInput = { userId: OWNER, selectedDate: '2026-10-26', plans: [], scheduleTemplates: [],
      plannerDataAvailability: createReadyPlannerDataAvailability(OWNER), isPlannerDataSnapshotCurrent: () => true,
      saveWeeklyApprovedPlan: repository.saveApprovedPlan, completeWeeklyApprovalOperation: repository.completeOperation };
    const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<Harness ref={ref} input={input} services={services} />); });
    await act(async () => { ref.current!.chat.initialize(); });
    await act(async () => { await ref.current!.submitTurn(capture.userText); });
    const state = ref.current!.state;
    const assistants = state.messages.filter(m => m.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(state.draftBlocks).toEqual([]);
    expect(state.pendingApproval).toBeUndefined();
    if (mode === 'invalid typed duration') {
      // Rejected before preview: two native readings (one reread), one recovery status, one verdict, no accepted facts.
      expect(calls).toEqual(['weekly_planning_vnext_native_v1', 'weekly_planning_vnext_label_repair_v1', 'weekly_planning_stable_v5_dialogue_response', 'weekly_planning_recovery_verdict']);
      expect(assistants[0].content).toBe(RECOVERY_TEXT);
      expect(state.previewCandidates ?? []).toEqual([]);
      return;
    }
    // One native reading and its one quoted repair, then one renderer call; no additional attempt.
    expect(calls).toEqual(['weekly_planning_vnext_native_v1', 'weekly_planning_vnext_label_repair_v1', 'weekly_planning_stable_v5_dialogue_response']);
    const fallback = ['false save claim', 'invalid renderer JSON'].includes(mode);
    if (fallback) {
      expect(assistants[0].content).toContain('まだ保存していません');
      expect(assistants[0].content).not.toBe(modelText);
    } else expect(assistants[0].content).toBe(modelText);
    expect(state.previewCandidates).toHaveLength(1);
    expect(state.previewCandidates![0]).toMatchObject({ title: '英語の勉強 60分', date: '2026-10-27', startTime: '09:00', endTime: '10:00', durationMinutes: 60, approvalStatus: 'unapproved' });
  });
}
