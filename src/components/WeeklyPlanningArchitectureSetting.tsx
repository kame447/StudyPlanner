import { useSyncExternalStore } from 'react';
import {
  WEEKLY_PLANNING_CONVERSATION_ARCHITECTURES,
  WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_LABELS,
} from '../features/weeklyPlanning/weeklyPlanningConversationArchitecture';
import {
  isWeeklyPlanningArchitectureSwitchEnabled,
  resolveNewConversationArchitecture,
  setWeeklyPlanningArchitecturePreference,
  subscribeWeeklyPlanningArchitecturePreference,
} from '../features/weeklyPlanning/weeklyPlanningConversationArchitecturePreference';

/**
 * Evaluation-only selector (Issue #488): which conversation architecture the NEXT new AI
 * planning conversation starts with. Rendered only while
 * `VITE_WEEKLY_PLANNING_ARCHITECTURE_SWITCH_ENABLED=1`; the default UI stays unchanged.
 * It never touches a conversation that already started (those stay pinned).
 */
export function WeeklyPlanningArchitectureSetting() {
  const enabled = isWeeklyPlanningArchitectureSwitchEnabled();
  const selected = useSyncExternalStore(
    subscribeWeeklyPlanningArchitecturePreference,
    resolveNewConversationArchitecture,
    resolveNewConversationArchitecture,
  );
  if (!enabled) return null;

  return (
    <div
      className="weekly-planning-architecture-setting"
      role="radiogroup"
      aria-label="次の新規AI計画会話の方式"
      data-testid="weekly-planning-architecture-setting"
    >
      <div className="label-row">
        <strong>会話方式（評価用）</strong>
        <span className="confidence-badge" data-testid="weekly-planning-architecture-selected">
          {WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_LABELS[selected]}
        </span>
      </div>
      <div className="weekly-planning-architecture-options">
        {WEEKLY_PLANNING_CONVERSATION_ARCHITECTURES.map((architecture) => (
          <button
            key={architecture}
            type="button"
            role="radio"
            aria-checked={selected === architecture}
            className={selected === architecture ? 'primary-button' : 'ghost-button'}
            data-architecture={architecture}
            onClick={() => setWeeklyPlanningArchitecturePreference(architecture)}
          >
            {WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_LABELS[architecture]}
          </button>
        ))}
      </div>
      <p className="detail-note">
        次の新規AI計画会話から適用されます。すでに始まっている会話は、開始時の方式のまま変わりません。
      </p>
    </div>
  );
}
