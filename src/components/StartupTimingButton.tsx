import { useRef, useState } from 'react';
import { reloadWithStartupTiming } from '../lib/startupTimingNavigation';

export function StartupTimingButton({ enabled }: { enabled: boolean }) {
  const navigating = useRef(false);
  const [failed, setFailed] = useState(false);
  return <>
    <button className="ghost-button" type="button" style={{ maxWidth: '100%', whiteSpace: 'normal', minHeight: 44 }} onClick={() => {
      if (navigating.current) return;
      navigating.current = true;
      setFailed(false);
      try {
        reloadWithStartupTiming(!enabled);
      } catch {
        setFailed(true);
      } finally {
        // A beforeunload prompt can cancel without throwing. Keep the next
        // user click available while coalescing callbacks from this one turn.
        queueMicrotask(() => { navigating.current = false; });
      }
    }}>
      {enabled ? '計測を終了して再読み込み' : '起動を計測して再読み込み'}
    </button>
    {failed ? <p role="alert">再読み込みできませんでした。もう一度お試しください。</p> : null}
  </>;
}
