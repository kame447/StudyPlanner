import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  recordWeeklyPlanningTurnMeasurement,
  resetWeeklyPlanningTurnMeasurementsForTest,
} from '../features/weeklyPlanning/application/weeklyPlanningTurnMeasurement';
import { AiPlanningArchitectureEvaluationPanel } from './AiPlanningArchitectureEvaluationPanel';
import { WeeklyPlanningArchitectureSetting } from './WeeklyPlanningArchitectureSetting';

afterEach(() => {
  vi.unstubAllEnvs();
  resetWeeklyPlanningTurnMeasurementsForTest();
});

describe('architecture evaluation UI (gate off)', () => {
  it('renders nothing, so the production UI stays simple', () => {
    recordWeeklyPlanningTurnMeasurement({
      sequence: 0, architecture: 'legacy_v5', requestId: 'r', turnId: 't', elapsedMs: 5,
      aiDispatches: { total: 1, semantic: 1, renderer: 0, enforced: false, refused: 0 },
      status: 'committed', interactionOutcome: null, resultKind: 'status', failureCode: null, pendingQuestion: 'none',
    });
    expect(renderToStaticMarkup(<AiPlanningArchitectureEvaluationPanel pinnedArchitecture="legacy_v5" />)).toBe('');
    expect(renderToStaticMarkup(<WeeklyPlanningArchitectureSetting />)).toBe('');
  });
});

describe('architecture evaluation UI (gate on)', () => {
  it('shows both options, the new-conversation scope note and the current default', () => {
    vi.stubEnv('VITE_WEEKLY_PLANNING_ARCHITECTURE_SWITCH_ENABLED', '1');
    const html = renderToStaticMarkup(<WeeklyPlanningArchitectureSetting />);
    expect(html).toContain('旧Stable V5');
    expect(html).toContain('新Interaction V1');
    expect(html).toContain('次の新規AI計画会話から適用');
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/aria-checked="true"[^>]*data-architecture="interaction_v1"/);
  });

  it('shows the pinned mode of the current conversation and the latest turn metrics', () => {
    vi.stubEnv('VITE_WEEKLY_PLANNING_ARCHITECTURE_SWITCH_ENABLED', '1');
    recordWeeklyPlanningTurnMeasurement({
      sequence: 0, architecture: 'legacy_v5', requestId: 'r', turnId: 't', elapsedMs: 1234,
      aiDispatches: { total: 5, semantic: 4, renderer: 1, enforced: false, refused: 0 },
      status: 'failed', interactionOutcome: null, resultKind: 'failure',
      failureCode: 'stable_v5_normalization_rejected', pendingQuestion: 'none',
    });
    const html = renderToStaticMarkup(<AiPlanningArchitectureEvaluationPanel pinnedArchitecture="legacy_v5" />);
    expect(html).toContain('data-architecture="legacy_v5"');
    expect(html).toContain('旧Stable V5');
    expect(html).toContain('経過 1234 ms');
    expect(html).toContain('AI呼出 5');
    expect(html).toContain('失敗 stable_v5_normalization_rejected');
  });

  it('says an empty conversation is not pinned yet and what the first send will pin', () => {
    vi.stubEnv('VITE_WEEKLY_PLANNING_ARCHITECTURE_SWITCH_ENABLED', '1');
    const html = renderToStaticMarkup(<AiPlanningArchitectureEvaluationPanel pinnedArchitecture={undefined} />);
    expect(html).toContain('未固定');
    expect(html).toContain('新Interaction V1');
    expect(html).toContain('まだありません');
  });
});
