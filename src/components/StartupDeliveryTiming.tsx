import { useMemo } from 'react';
import { readStartupDeliveryTiming } from '../lib/startupDeliveryTiming';

const ms = (value: number | null) => value === null ? '不明' : `${Math.round(value)} ms`;
const bytes = (value: number | null) => value === null ? '不明' : `${value} B`;

/** Kept below the existing query/administrator boundary; adds no subscription. */
export function StartupDeliveryTiming({ splashStartMs }: { splashStartMs: number | null }) {
  const sample = useMemo(() => readStartupDeliveryTiming(splashStartMs), [splashStartMs]);
  return <section aria-label="起動配信の診断">
    <p>HTML・初期資源の受信（ページ開始から）</p>
    <p>HTML: 取得開始 {ms(sample.navigation?.fetchStartMs ?? null)} / リクエスト開始 {ms(sample.navigation?.requestStartMs ?? null)} / 応答開始 {ms(sample.navigation?.responseStartMs ?? null)} / 応答完了 {ms(sample.navigation?.responseEndMs ?? null)}</p>
    <ul>{sample.assets.map(asset => <li key={asset.role}>
      {asset.role}: {asset.status === 'ambiguous' ? '複数候補のため不明' : asset.status === 'unavailable' ? '未取得・未対応などで不明' :
        <>開始 {ms(asset.startMs)} / 応答完了 {ms(asset.responseEndMs)} / 転送 {bytes(asset.transferBytes)} / 圧縮後 {bytes(asset.encodedBytes)} / 展開後 {bytes(asset.decodedBytes)}</>}
    </li>)}</ul>
    <p>Splashのeffect: {ms(sample.splashMountedMs)} / 受信後からSplashまでの未観測区間（推定）: {ms(sample.deliveryToSplashGapMs)}</p>
    <p>対象は初期JS/CSSの6資源です。未観測区間は評価・待機・描画などを含み、CPU時間や初回描画の実測ではありません。欠落・重複時は推定しません。0のバイト値は不明とし、キャッシュの種類は断定しません。ページ復帰は新規起動と分けて比較してください。</p>
  </section>;
}
