import { useState } from 'react';
import type { WeeklyPlanningWeekStartsOn } from '../features/weeklyPlanning/personalization/weeklyPlanningWeek';
import { StudyPlannerLogo } from './StudyPlannerLogo';

interface InitialWeekStartPreferenceScreenProps {
  error: string;
  onSave(value: WeeklyPlanningWeekStartsOn): Promise<boolean>;
  onRetry(): Promise<void>;
  onSignOut(): Promise<void>;
}

export function InitialWeekStartPreferenceScreen({
  error,
  onSave,
  onRetry,
  onSignOut,
}: InitialWeekStartPreferenceScreenProps) {
  const [selected, setSelected] = useState<WeeklyPlanningWeekStartsOn>('monday');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');

  async function save() {
    if (submitting) return;
    setSubmitting(true);
    setLocalError('');
    try {
      const saved = await onSave(selected);
      if (!saved) setLocalError('週の始まりを保存できませんでした。');
    } catch (caught) {
      setLocalError(
        caught instanceof Error && caught.message.trim()
          ? caught.message.trim()
          : '週の始まりを保存できませんでした。',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell auth-shell-modern">
      <section className="auth-card auth-main-card">
        <div className="auth-brand-header">
          <StudyPlannerLogo />
        </div>

        <div className="auth-stage-card">
          <div className="auth-stage-header">
            <div>
              <h2>1週間の始まりを選択</h2>
              <p>
                「今週」「来週」の予定を正しく解釈するため、最初に一度だけ確認します。後からアプリ設定で変更できます。
              </p>
            </div>
          </div>

          <div className="auth-form">
            <label className="field">
              <span>週の始まり</span>
              <select
                value={selected}
                onChange={(event) => setSelected(event.target.value as WeeklyPlanningWeekStartsOn)}
              >
                <option value="monday">月曜日から</option>
                <option value="sunday">日曜日から</option>
              </select>
            </label>

            <div className="panel section-stack">
              <strong>{selected === 'monday' ? '月曜日〜日曜日' : '日曜日〜土曜日'}</strong>
              <p>
                {selected === 'monday'
                  ? '「来週」は次の月曜日から日曜日として扱います。'
                  : '「来週」は次の日曜日から土曜日として扱います。'}
              </p>
              <p>具体的な日付や曜日を指定した場合は、そちらを優先します。</p>
            </div>

            {localError || error ? (
              <p className="inline-error">{localError || error}</p>
            ) : null}

            <button
              className="primary-button"
              disabled={submitting}
              onClick={() => void save()}
              type="button"
            >
              {submitting ? '保存中...' : 'この設定で始める'}
            </button>
            {error ? (
              <button
                className="ghost-button"
                disabled={submitting}
                onClick={() => void onRetry()}
                type="button"
              >
                もう一度読み込む
              </button>
            ) : null}
            <button
              className="ghost-button"
              disabled={submitting}
              onClick={() => void onSignOut()}
              type="button"
            >
              ログアウトする
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
