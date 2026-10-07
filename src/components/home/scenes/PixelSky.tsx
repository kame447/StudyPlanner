import { useId } from 'react';
import { pixelMoonPaths, type HomeSceneAtmosphere } from '../../../lib/homeSceneAtmosphere';

export function PixelSky({ x, y, width, height, atmosphere }: {
  x: number; y: number; width: number; height: number; atmosphere: HomeSceneAtmosphere;
}) {
  const clipId = `home-sky-${useId().replace(/:/g, '')}`;
  const { period, moonStage } = atmosphere;
  const moon = period === 'night' ? pixelMoonPaths(moonStage) : null;
  const moonScale = width < 50 ? 1 : 2;
  return <g data-scene-sky={period}>
    <defs><clipPath id={clipId}><rect x={x} y={y} width={width} height={height} /></clipPath></defs>
    <g clipPath={`url(#${clipId})`}>
      <path d={`M${x} ${y}h${width}v${height}h-${width}z`} fill="var(--scene-atmosphere-sky)" />
      {moon ? <>
        <path className="home-scene-glint" d={`M${x + 5} ${y + 8}h2v2h-2zM${x + width * .4} ${y + 20}h2v2h-2zM${x + 8} ${y + height - 12}h2v2h-2z`} fill="var(--scene-atmosphere-star)" />
        <g transform={`translate(${x + width - 12 * moonScale - 5} ${y + 5}) scale(${moonScale})`} data-moon-stage={moonStage}>
          <path d={moon.disc} fill="var(--scene-atmosphere-moon-shadow)" />
          <path data-moon-light="true" d={moon.light} fill="var(--scene-atmosphere-moon)" />
        </g>
      </> : <>
        <path className="home-scene-cloud" d={`M${x + 8} ${y + 20}h12v-4h16v4h8v8h-36zM${x + 58} ${y + 44}h8v-4h16v4h10v8h-34z`} fill="var(--scene-atmosphere-cloud)" />
        <path d={`M${x + width - 24} ${y + (period === 'day' ? 8 : height - 20)}h12v12h-12z`} fill="var(--scene-atmosphere-sun)" />
        {period !== 'day' ? <path d={`M${x} ${y + height - 8}h${width}v8h-${width}z`} fill="var(--scene-atmosphere-horizon)" /> : null}
      </>}
    </g>
  </g>;
}
