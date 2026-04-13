import type { Plan, RecurringPlanScope } from '../types/domain';

interface RecurringPlanScopeDialogProps {
  action: 'edit' | 'delete';
  plan: Plan;
  onSelect: (scope: RecurringPlanScope) => void;
  onClose: () => void;
}

const SCOPE_OPTIONS: Array<{
  value: RecurringPlanScope;
  label: string;
  description: string;
}> = [
  {
    value: 'single',
    label: 'この予定だけ',
    description: 'この日だけを例外として編集・削除します。',
  },
  {
    value: 'future',
    label: 'この日以降',
    description: 'この日の前後で系列を分割し、以降だけ反映します。',
  },
  {
    value: 'all',
    label: 'すべての予定',
    description: '同じ系列の予定全体へ反映します。',
  },
];

export function RecurringPlanScopeDialog({
  action,
  plan,
  onSelect,
  onClose,
}: RecurringPlanScopeDialogProps) {
  return (
    <div className="overlay modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="section-stack">
          <div className="section-header">
            <div>
              <h2>{action === 'edit' ? '繰り返し予定の更新範囲' : '繰り返し予定の削除範囲'}</h2>
              <p>
                {plan.title} / {plan.date} / {plan.startTime} - {plan.endTime}
              </p>
            </div>
            <button className="ghost-button" onClick={onClose} type="button">
              閉じる
            </button>
          </div>

          <div className="section-stack">
            {SCOPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className="scope-option-card"
                onClick={() => onSelect(option.value)}
                type="button"
              >
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
