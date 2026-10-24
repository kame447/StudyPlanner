import { afterEach, describe, expect, it, vi } from 'vitest';
import { D5_TOP1_ANSWER_POLICY_VERSION } from '../../../../shared/d5AnswerPolicy';
import type { ControlledCandidateDomainHost } from './weeklyPlanningControlledCandidateChoice';
import * as choice from './weeklyPlanningControlledCandidateChoice';
import * as registry from './weeklyPlanningControlledCandidateRegistry';
import { validateControlledCandidateChoiceConfiguration, WEEKLY_PLANNING_C5_CHOICE_CALIBRATION } from './weeklyPlanningCandidateChoiceCalibration';
import { D5_ANSWER_PROPOSAL_CALIBRATION, D5_ANSWER_PROPOSAL_POLICY_VERSION, D5_CHOICE_CALIBRATION,
  D5_DOMAIN_POLICY_VERSION, TEMPORAL_DATE_CHOICE_CALIBRATION, weeklyPlanningRegisteredCandidateDomains } from './weeklyPlanningRegisteredCandidateDomains';
import { numericFixture } from '../semantic/weeklyPlanningNumericPendingChoiceV5.testUtils';
import type { ControlledCandidateCaptureContext } from './weeklyPlanningControlledCandidateDomains';
import { createCandidateManifest } from './candidateSelection/manifest';
import { buildCandidateHierarchy } from './candidateSelection/hierarchy';
import { hasCalibratedMenu } from './candidateSelection/gate';
import type { CandidateChoiceRequest } from './candidateSelection/contracts';

import { submitWeeklyPlanningApplicationTurn } from './weeklyPlanningTurnApplication';
import { weeklyPlanningTurnRuntimeGateway } from './weeklyPlanningTurnRuntimeGateway';
import { c5ControllerHarness, OWNER, WEEK } from './c5LocalSelection/controller.testUtils';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { hydrateWeeklyPlanningStableV5RuntimeSession, resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';

// Production registry/options/producer/host run unchanged; no validator-port injection.
const host = (): ControlledCandidateDomainHost => ({
  semanticObservation: () => ({ client: { createChatCompletion: vi.fn() }, finish: vi.fn() }),
  bindSemanticObservation: vi.fn(), sourceAccess: () => 'allowed',
  inputForTurn: () => { throw new Error('registration must not dispatch'); },
  requestContextForTurn: () => { throw new Error('registration must not dispatch'); },
  continueSelectedTurn: async () => { throw new Error('registration must not dispatch'); },
});
afterEach(() => vi.restoreAllMocks());

describe('D5 production registration release boundary', () => {
  it('registers only the proposal v2 domain through the actual production host', () => {
    const register = vi.spyOn(registry, 'registerControlledCandidateDomain');
    expect(D5_ANSWER_PROPOSAL_POLICY_VERSION).toBe(D5_TOP1_ANSWER_POLICY_VERSION);
    expect(D5_CHOICE_CALIBRATION).toBeNull();
    expect(TEMPORAL_DATE_CHOICE_CALIBRATION).toBeNull();
    expect(WEEKLY_PLANNING_C5_CHOICE_CALIBRATION).toBeNull();
    const registered = weeklyPlanningRegisteredCandidateDomains(host());
    expect(registered.map(d => [d.domainId, d.questionCode])).toEqual([['d5_numeric', 'missing_effort_estimate']]);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0][0].domainPolicyVersion).toBe(D5_TOP1_ANSWER_POLICY_VERSION);
    expect(register.mock.calls[0][0].proposeAnswerPayload).toBeTypeOf('function');
    expect(register.mock.calls[0][1]).toMatchObject({ maximumChildrenPerMenu: 8, maximumDecisions: 1 });
    const artifact = validateControlledCandidateChoiceConfiguration(D5_ANSWER_PROPOSAL_CALIBRATION, 'd5_numeric', D5_TOP1_ANSWER_POLICY_VERSION)!;
    expect(artifact).toMatchObject({ mode: 'canary', choicePolicy: { calibrationEvidenceId: 'issue305-top1-live-2026-10-21' },
      semanticPolicy: { calibrationEvidenceId: 'issue305-top1-live-2026-10-21', maximumConditionChange: 1, maximumIndependentMeaning: 1 } });
    expect(artifact.choicePolicy.rules).toEqual(Array.from({ length: 8 }, (_, i) => ({ menuKind: 'leaves', optionCount: i + 2,
      depth: 0, minimumTopProbability: 0, minimumMargin: 0 })));
    expect(validateControlledCandidateChoiceConfiguration(D5_ANSWER_PROPOSAL_CALIBRATION, 'd5_numeric', 'd5-answer-proposal-2026-10-20-v1')).toBeUndefined();
  });

  it('captures v2 through the default application services and its real production host', async () => {
    const restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
    try {
      const h = c5ControllerHarness();
      h.graph.effortEstimates = [];
      h.graph.workloads = h.graph.workloads.filter(workload => workload.id === 'work-a');
      h.graph.tasks = h.graph.tasks.filter(task => task.id === 'task-a');
      h.graph.factLifecycles = [...h.graph.tasks, ...h.graph.workloads].map(fact => ({
        factId: fact.id, status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null,
      }));
      hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER, weekStartDate: WEEK, conversationId: h.conversationId, graph: h.graph });
      // Only interpretation is a fixture; the default application host and registry are real.
      vi.spyOn(weeklyPlanningTurnRuntimeGateway, 'execute').mockResolvedValue({
        state: { ...createInitialPlanningIntakeState(), questions: ['教材aは1問何分かかりますか？'],
          lastQuestionContext: { kind: 'ambiguity', targetSlot: 'stable_v5:missing_effort_estimate', topicId: 'work-a', intent: 'duration_per_unit' } },
        message: '教材aは1問何分かかりますか？', draftCandidates: [], stableV5Graph: h.graph,
        responseSource: 'ai', questionPresentationContent: { responseSource: 'ai', currentTurnGrounding: 'none', selfRepairNotice: false,
          groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false },
      });
      const register = vi.spyOn(registry, 'registerControlledCandidateDomain');
      const result = await submitWeeklyPlanningApplicationTurn({ session: h.session, userId: OWNER, ownerId: OWNER,
        userText: '計画を相談します', selectedDate: WEEK, plans: [], scheduleTemplates: [],
        plannerDataAvailability: { status: 'ready', ownerId: OWNER, observedAt: '2026-10-05T01:00:00Z', lastSuccessfulAt: '2026-10-05T01:00:00Z' },
        isPlannerDataSnapshotCurrent: () => true, getState: h.getState, dispatch: h.dispatch,
      });
      expect(result.accepted).toBe(true);
      expect(register).toHaveBeenCalledTimes(1);
      expect(register.mock.calls[0][1].sourceAccess()).toBe('allowed');
      expect(h.getState().intakeState?.lastQuestionContext?.controlledCandidate).toMatchObject({
        domainId: 'd5_numeric', domainPolicyVersion: D5_TOP1_ANSWER_POLICY_VERSION,
      });
    } finally { restore(); resetWeeklyPlanningStableV5RuntimeSessionsForTest(); }
  });

  it.each(Array.from({ length: 8 }, (_, i) => i + 1))('calibrates the actual v2 proposal width %i plus none as a root leaf menu', async count => {
    const register = vi.spyOn(registry, 'registerControlledCandidateDomain');
    weeklyPlanningRegisteredCandidateDomains(host());
    const [domain, options] = register.mock.calls[0];
    const fixture = numericFixture('duration_per_unit');
    const binding = fixture.state.binding;
    const context = { ownerId: binding.ownerId, conversationId: binding.conversationId, graph: fixture.graph,
      question: { ...binding.question, presentedQuestion: { assistantMessageId: binding.question.presentingMessageId, text: '数学は1問何分ですか？' } },
      selectionEpoch: binding.selectionEpoch, domainPolicyVersion: domain.domainPolicyVersion,
      state: { intakeState: { lastQuestionContext: { topicId: binding.target.id,
        targetSlot: 'stable_v5:missing_effort_estimate', intent: 'duration_per_unit', presentation: { graphRevision: fixture.graph.revision } } } },
    } as unknown as ControlledCandidateCaptureContext;
    const captured = domain.capture(context)!;
    expect(captured).not.toBeNull();
    const payload = domain.proposeAnswerPayload!(captured, Array.from({ length: count }, (_, i) => `${31 + i}分`).join('、'))!;
    expect(payload).not.toBeNull();
    expect(payload.candidates).toHaveLength(count);
    const manifest = await createCandidateManifest({ binding: { ...binding, scope: payload.scope, sources: payload.sources, target: payload.target }, candidates: payload.candidates });
    const hierarchy = buildCandidateHierarchy(manifest, options.maximumChildrenPerMenu);
    expect(hierarchy.children).toEqual([]);
    expect(hierarchy.menu).toMatchObject({ kind: 'leaves', depth: 0 });
    expect(hierarchy.menu.options).toHaveLength(count + 1);
    expect(hierarchy.menu.options[hierarchy.menu.options.length - 1]).toEqual({ kind: 'none', id: 'none' });
    expect(hasCalibratedMenu({ menu: hierarchy.menu } as CandidateChoiceRequest, options.policy)).toBe(true);
  });

  it.each(['canary', 'off', 'malformed'] as const)('keeps the existing at-most-one registration fallback for %s', mode => {
    const actual = choice.createControlledCandidateChoiceOptions;
    const calls: string[] = [];
    vi.spyOn(choice, 'createControlledCandidateChoiceOptions').mockImplementation((domain, configuration, h) => {
      calls.push(domain.domainPolicyVersion);
      const proposal = domain.domainPolicyVersion === D5_ANSWER_PROPOSAL_POLICY_VERSION;
      expect(configuration).toEqual(proposal ? D5_ANSWER_PROPOSAL_CALIBRATION : null);
      const artifact = { ...(D5_ANSWER_PROPOSAL_CALIBRATION as object), domainPolicyVersion: domain.domainPolicyVersion,
        mode: proposal && mode === 'off' ? 'off' : 'canary' };
      return actual(domain, proposal && mode === 'malformed' ? { ...artifact, domainPolicyVersion: 'wrong' } : artifact, h);
    });
    expect(weeklyPlanningRegisteredCandidateDomains(host()).map(d => d.domainId)).toEqual(['d5_numeric']);
    expect(calls).toEqual(mode === 'canary' ? [D5_ANSWER_PROPOSAL_POLICY_VERSION]
      : [D5_ANSWER_PROPOSAL_POLICY_VERSION, D5_DOMAIN_POLICY_VERSION]);
  });
});
