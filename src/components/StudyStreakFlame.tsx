import { useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import '../styles/study-streak-flame.css';

/** Decorative motion follows real learning today, never a rest-ticket balance. */
export function StudyStreakFlame({ studiedToday, className = '', size = 30 }: {
  studiedToday: boolean;
  className?: string;
  size?: number;
}) {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    if (typeof document === 'undefined' || !document.addEventListener) return;
    const update = () => setVisible(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return <Flame className={`study-streak-flame ${className}${studiedToday && visible ? ' is-studied-today' : ''}`}
    size={size} strokeWidth={1.5} aria-hidden="true" />;
}
