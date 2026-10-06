import { useSyncExternalStore } from 'react';
import {
  getLatestWeeklyPlanningTurnMeasurement,
  subscribeWeeklyPlanningTurnMeasurements,
  type WeeklyPlanningTurnMeasurement,
} from '../features/weeklyPlanning/application/weeklyPlanningTurnMeasurement';
import {
  WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_LABELS,
  type WeeklyPlanningConversationArchitecture,
} from '../features/weeklyPlanning/weeklyPlanningConversationArchitecture';
import {
  isWeeklyPlanningArchitectureSwitchEnabled,
  resolveNewConversationArchitecture,
  subscribeWeeklyPlanningArchitecturePreference,
} from '../features/weeklyPlanning/weeklyPlanningConversationArchitecturePreference';
import './AiPlanningArchitectureEvaluationPanel.css';

interface AiPlanningArchitectureEvaluationPanelProps {
  /** Architecture the CURRENT conversation is pinned to; undefined while it is still empty. */
  pinnedArchitecture: WeeklyPlanningConversationArchitecture | undefined;
}

function outcomeText(measurement: WeeklyPlanningTurnMeasurement): string {
  if (measurement.failureCode) return `失敗 ${measurement.failureCode}`;
  const kind = measurement.interactionOutcome ?? measurement.resultKind;
  return measurement.status === 'discarded' ? `破棄 ${kind}` : kind;
}

/**
 * Evaluation-only strip on the AI planning surface (Issue #488): shows which architecture the
 * current conversation actually runs under and the latest turn's comparison metrics. Rendered
 * only while `VITE_WEEKLY_PLANNING_ARCHITECTURE_SWITCH_ENABLED=1`. Read-only: it observes
 * the in-memory measurement and never feeds anything back into the conversation.
 */
export function AiPlanningArchitectureEvaluationPanel({
  pinnedArchitecture,
}: AiPlanningArchitectureEvaluationPanelProps) {
  const enabled = isWeeklyPlanningArchitectureSwitchEnabled();
  const latest = useSyncExternalStore(
    subscribeWeeklyPlanningTurnMeasurements,
    getLatestWeeklyPlanningTurnMeasurement,
    getLatestWeeklyPlanningTurnMeasurement,
  );
  const nextDefault = useSyncExternalStore(
    subscribeWeeklyPlanningArchitecturePreference,
    resolveNewConversationArchitecture,
    resolveNewConversationArchitecture,
  );
  if (!enabled) return null;

  const labels = WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_LABELS;
  return (
    <div
      className="ai-planning-architecture-eval"
      data-testid="ai-planning-architecture-eval"
      aria-label="会話方式の評価情報"
    >
      <div className="ai-planning-architecture-eval-row">
        <span className="ai-planning-architecture-eval-key">この会話</span>
        <strong
          className="ai-planning-architecture-eval-mode"
          data-testid="architecture-eval-mode"
          data-architecture={pinnedArchitecture ?? 'unpinned'}
        >
          {pinnedArchitecture
            ? labels[pinnedArchitecture]
            : `未固定（最初の送信で ${labels[nextDefault]} に固定）`}
        </strong>
      </div>
      <div
        className="ai-planning-architecture-eval-row"
        data-testid="architecture-eval-metrics"
        role="status"
        aria-live="polite"
        data-sequence={latest?.sequence ?? 0}
      >
        <span className="ai-planning-architecture-eval-key">直近のターン</span>
        {latest ? (
          <span className="ai-planning-architecture-eval-values">
            <span data-metric="mode" data-architecture={latest.architecture}>
              方式 {labels[latest.architecture]}
            </span>
            <span data-metric="elapsed-ms" data-value={latest.elapsedMs}>
              経過 {latest.elapsedMs} ms
            </span>
            <span data-metric="ai-dispatches" data-value={latest.aiDispatches.total}>
              AI呼出 {latest.aiDispatches.total}
              （意味 {latest.aiDispatches.semantic} / 応答 {latest.aiDispatches.renderer}）
            </span>
            <span data-metric="outcome">結果 {outcomeText(latest)}</span>
            <span data-metric="question">
              質問 {latest.pendingQuestion === 'none'
                ? 'なし'
                : latest.pendingQuestion === 'presented' ? '提示' : '再提示'}
            </span>
          </span>
        ) : (
          <span>まだありません</span>
        )}
      </div>
    </div>
  );
}
