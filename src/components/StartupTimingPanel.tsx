import { startupMarkerObservation } from '../lib/startupMarkerObservation';
import { startupProfileObservation } from '../lib/startupProfileObservation';
import { startupFirestoreTransport } from '../lib/startupFirestoreTransport';
import { useEffect, useSyncExternalStore } from 'react';
import { startupTiming } from '../lib/startupTiming';
import { StartupTimingButton } from './StartupTimingButton';

export function StartupTimingPanel() {
  const rows = useSyncExternalStore(startupTiming.subscribe, startupTiming.getSnapshot, startupTiming.getSnapshot);
  useEffect(() => {
    if (!startupTiming.enabled) return;
    let frame = 0;
    let done = false;
    const check = () => {
      if (done || frame) return;
      const home = document.querySelector('.home-main');
      if (!home?.getClientRects().length || document.querySelector('.splash-screen')) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!home.isConnected || !home.getClientRects().length || document.querySelector('.splash-screen')) return;
        done = true;
        startupTiming.markOnce('home-visible');
        observer.disconnect();
      });
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    check();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  if (!startupTiming.enabled) return null;
  return <details aria-label="起動時間の診断" style={{ position: 'fixed', bottom: 'calc(var(--app-bottom-nav-clearance, 72px) + 8px)', left: 8,
    zIndex: 100000, maxWidth: '94vw', maxHeight: '50vh', overflow: 'auto',
    background: '#fff', color: '#111', padding: 8, border: '1px solid #777', fontSize: 12 }}>
    <summary>起動計測（端末内のみ）</summary>
    <p>ページ開始からのミリ秒。通信待ちを含みます。外部送信・保存はしません。</p>
    <p>準備待ちと動画終了は別に記録します。待機終了だけではデータ取得成功を意味しません。</p>
    <p>Firestore比較設定: {startupFirestoreTransport}（この起動のみ）</p>
    <p>Profile比較設定: {startupProfileObservation}（この起動のみ）</p>
    <p>Marker比較設定: {startupMarkerObservation}（この起動のみ）</p>
    <StartupTimingButton enabled />
    <pre>{JSON.stringify(rows, null, 2)}</pre>
  </details>;
}
