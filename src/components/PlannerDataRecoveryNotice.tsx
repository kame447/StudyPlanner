import type { PlannerDataRecovery } from '../domain/plannerDataReadAuthority';
import './PlannerDataRecoveryNotice.css';

interface PlannerDataRecoveryNoticeProps {
  ownerId: string | null;
  recovery: PlannerDataRecovery | null;
  onRetry: () => Promise<void>;
}

export function PlannerDataRecoveryNotice({
  ownerId,
  recovery,
  onRetry,
}: PlannerDataRecoveryNoticeProps) {
  if (!ownerId || recovery?.ownerId !== ownerId) return null;

  const subject = recovery.reason === 'actual-material' ? '実績・教材' : '学習データ';
  const message = recovery.phase === 'failed'
    ? `${subject}の最新表示を確認できませんでした。`
    : recovery.phase === 'refreshing'
      ? `${subject}の表示を更新しています。`
      : `${subject}の最新表示を確認するまでお待ちください。`;

  return (
    <section className="planner-data-recovery-notice print-hide" aria-label="学習データの表示状況">
      <p role="status" aria-live="polite" aria-atomic="true">
        {message} AIへの計画依頼は、確認が完了してから送信できます。
      </p>
      {recovery.canRetry ? (
        <button className="ghost-button" type="button" onClick={() => void onRetry()}>
          表示の更新を再試行
        </button>
      ) : null}
    </section>
  );
}
