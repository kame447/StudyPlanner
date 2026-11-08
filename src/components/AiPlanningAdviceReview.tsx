import type { AdviceView } from '../features/weeklyPlanning/consultation/adviceView';
import './AiPlanningAdviceReview.css';

interface AiPlanningAdviceReviewProps {
  advice: AdviceView;
  /** Disabled while the conversation is busy. */
  disabled: boolean;
  onReview: (action: 'approve' | 'dismiss', optionIndex?: number) => void;
}

/**
 * What the user may do with the latest advice. Adopting records the decision and nothing else: it does not make a plan,
 * a fact or a save. Only these buttons adopt or decline; no chat reply does.
 */
export function AiPlanningAdviceReview({ advice, disabled, onReview }: AiPlanningAdviceReviewProps) {
  if (advice.status === 'withdrawn') {
    return <p className="ai-planning-advice-review-note" role="status">削除された記憶に基づく助言のため、この助言の保存した案は消しました。会話に表示済みの返信は残っています。</p>;
  }
  if (advice.status === 'approved') {
    return <p className="ai-planning-advice-review-note" role="status">この助言を採用しました。予定にはまだ入っていません。予定にするときは、条件を伝えて「予定を作って」と送ってください。</p>;
  }
  const several = advice.optionTitles.length > 1;
  return (
    <section className="ai-planning-advice-review" aria-label="助言の採用">
      <p>{several ? '採用する案を選べます。採用しても予定には入りません。' : 'この助言を採用しますか？採用しても予定には入りません。'}</p>
      <div className="ai-planning-advice-review-actions">
        {several
          ? advice.optionTitles.map((title, index) => (
            <button key={index} type="button" disabled={disabled} onClick={() => onReview('approve', index)}>案{index + 1}「{title}」を採用</button>))
          : <button type="button" disabled={disabled} onClick={() => onReview('approve')}>この助言を採用</button>}
        <button type="button" disabled={disabled} onClick={() => onReview('dismiss')}>採用しない</button>
      </div>
    </section>
  );
}
