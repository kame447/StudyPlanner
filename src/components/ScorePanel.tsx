import type { EvaluationSummary } from '../types/domain';

interface ScorePanelProps {
  summary: EvaluationSummary;
}

const SCORE_ITEMS: Array<{
  key: keyof Pick<EvaluationSummary, 'achievement' | 'consistency' | 'realism'>;
  title: string;
  description: string;
}> = [
  {
    key: 'achievement',
    title: '達成度',
    description: '計画時間に対して実績がどこまで届いたか',
  },
  {
    key: 'consistency',
    title: '継続度',
    description: '記録を継続できているか',
  },
  {
    key: 'realism',
    title: '現実性',
    description: '計画時間が実績に近いか',
  },
];

export function ScorePanel({ summary }: ScorePanelProps) {
  return (
    <section className="panel section-stack">
      <div className="section-header">
        <div>
          <h2>AI評価</h2>
          <p>達成・継続・現実性を簡易スコアで見ます。</p>
        </div>
      </div>

      <div className="score-grid">
        {SCORE_ITEMS.map((item) => (
          <article key={item.key} className="score-card">
            <p className="score-title">{item.title}</p>
            <strong className="score-value">{summary[item.key]}</strong>
            <p className="score-help">{item.description}</p>
          </article>
        ))}
      </div>

      <p className="score-comment">{summary.comment}</p>
    </section>
  );
}
