import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, CirclePlay, MessageCircle, TrendingUp } from 'lucide-react';
import '../styles/first-run-tutorial.css';

type Scene = 'cycle' | 'plan' | 'study' | 'review' | 'welcome';

const SLIDES: readonly { scene: Scene; eyebrow: string; title: string; description: string }[] = [
  {
    scene: 'cycle',
    eyebrow: 'Laplanceへようこそ',
    title: '勉強を、続けられる形に。',
    description: 'Laplanceは、計画を立てて終わりではありません。学んで、記録して、次の計画を考えるためのアプリです。',
  },
  {
    scene: 'plan',
    eyebrow: '01  計画を立てる',
    title: '目標も、毎日の予定も。',
    description: 'やりたい勉強や期限、授業や用事を伝えると、AIと一緒に空き時間を使った学習計画を考えられます。',
  },
  {
    scene: 'study',
    eyebrow: '02  勉強する',
    title: '予定どおりじゃなくてもいい。',
    description: '勉強できた分を実績として記録。予定を立てていない日でも、今から始められます。',
  },
  {
    scene: 'review',
    eyebrow: '03  振り返る',
    title: '計画と実際を、見比べる。',
    description: 'どこまで進んだか、どれだけ時間を使ったかを振り返って、次の学習を考えられます。',
  },
  {
    scene: 'welcome',
    eyebrow: '自分のペースで',
    title: '今日、全部決めなくて大丈夫。',
    description: 'まずはホームを見てみましょう。目標が決まったら計画を、勉強した日には記録を。少しずつ使い始められます。',
  },
];

function SceneIllustration({ scene }: { scene: Scene }) {
  if (scene === 'cycle') return (
    <div className="tour-cycle" aria-hidden="true">
      <div className="tour-cycle-step"><CalendarDays /><span>計画</span></div>
      <ArrowRight className="tour-cycle-arrow" />
      <div className="tour-cycle-step"><CirclePlay /><span>学習</span></div>
      <ArrowRight className="tour-cycle-arrow" />
      <div className="tour-cycle-step"><TrendingUp /><span>振り返り</span></div>
      <span className="tour-cycle-loop">何度でも、少しずつ</span>
    </div>
  );

  if (scene === 'plan') return (
    <div className="tour-plan" aria-hidden="true">
      <div className="tour-plan-chat"><MessageCircle size={17} /><span>今週、英単語を100語進めたい</span></div>
      <div className="tour-plan-week">
        <div><small>月</small><span className="tour-plan-busy">授業</span><span className="tour-plan-study">英単語</span></div>
        <div><small>火</small><span className="tour-plan-study">英単語</span><span className="tour-plan-busy">用事</span></div>
        <div><small>水</small><span className="tour-plan-busy">授業</span><span className="tour-plan-study">復習</span></div>
      </div>
    </div>
  );

  if (scene === 'study') return (
    <div className="tour-study" aria-hidden="true">
      <div className="tour-study-heading"><BookOpen size={20} /><span>英単語の学習</span><Check size={18} /></div>
      <div className="tour-study-row"><span>予定</span><span className="tour-study-bar"><i style={{ width: '100%' }} /></span><strong>60分</strong></div>
      <div className="tour-study-row"><span>実績</span><span className="tour-study-bar"><i style={{ width: '58%' }} /></span><strong>35分</strong></div>
      <div className="tour-study-caption">できた分を、そのまま残せる</div>
    </div>
  );

  if (scene === 'review') return (
    <div className="tour-review" aria-hidden="true">
      <span className="tour-review-heading">今週の学習</span>
      <div className="tour-review-bars">
        <div><span className="tour-review-bar planned" /><small>予定</small></div>
        <div><span className="tour-review-bar recorded" /><small>実績</small></div>
      </div>
      <div className="tour-review-message"><TrendingUp size={17} />記録を見て、次の予定を考える</div>
    </div>
  );

  return (
    <div className="tour-welcome" aria-hidden="true">
      <div className="tour-welcome-card"><CalendarDays size={23} /><span>予定を見る</span></div>
      <div className="tour-welcome-card"><MessageCircle size={23} /><span>AIと計画する</span></div>
      <div className="tour-welcome-card"><BookOpen size={23} /><span>学習を記録する</span></div>
    </div>
  );
}

export function FirstRunTutorial({ onFinish, onOpenAiPlanning }: {
  onFinish: () => void;
  onOpenAiPlanning: () => void;
}) {
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const slide = SLIDES[index];
  const last = index === SLIDES.length - 1;

  function goTo(next: number) {
    setIndex(Math.min(SLIDES.length - 1, Math.max(0, next)));
  }

  return (
    <main className="first-run-tour" role="dialog" aria-modal="true" aria-label="Laplanceの使い方">
      <div className="first-run-tour-shell">
        <header className="first-run-tour-header">
          <span className="first-run-tour-brand">Laplance</span>
          <button type="button" className="first-run-tour-skip" onClick={onFinish}>スキップ</button>
        </header>
        <div className="first-run-tour-main"
          onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }}
          onTouchEnd={(event) => {
            const from = touchStartX.current;
            touchStartX.current = null;
            const to = event.changedTouches[0]?.clientX;
            if (from == null || to == null || Math.abs(from - to) < 55) return;
            goTo(index + (from > to ? 1 : -1));
          }}
        >
          <div key={slide.scene} className="first-run-tour-illustration" data-scene={slide.scene}>
            <span className="first-run-tour-example">イメージ</span>
            <SceneIllustration scene={slide.scene} />
          </div>
          <div className="first-run-tour-copy" aria-live="polite" aria-atomic="true">
            <span className="first-run-tour-eyebrow">{slide.eyebrow}</span>
            <h1>{slide.title}</h1>
            <p>{slide.description}</p>
          </div>
        </div>
        <footer className="first-run-tour-footer">
          <div className="first-run-tour-dots" aria-label={`${index + 1} / ${SLIDES.length} ページ`}>
            {SLIDES.map((item, position) => <span key={item.scene} className={position === index ? 'active' : ''} />)}
          </div>
          <div className="first-run-tour-controls">
            {index > 0 ? (
              <button className="first-run-tour-back" type="button" onClick={() => goTo(index - 1)}>
                <ArrowLeft size={18} />戻る
              </button>
            ) : <span />}
            <button className="first-run-tour-next" type="button" onClick={() => last ? onFinish() : goTo(index + 1)}>
              {last ? 'ホームを見る' : '次へ'}<ArrowRight size={19} />
            </button>
          </div>
          {last ? (
            <button className="first-run-tour-plan-link" type="button" onClick={onOpenAiPlanning}>
              AIと計画を考える
            </button>
          ) : null}
        </footer>
      </div>
    </main>
  );
}
