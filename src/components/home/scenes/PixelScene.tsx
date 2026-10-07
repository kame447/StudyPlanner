import type { HomeNextPlanVisualKind } from '../../../lib/homeNextPlanVisual';

function PixelPlant({ x, y }: { x: number; y: number }) {
  return <g transform={`translate(${x} ${y})`}>
    <path d="M12 32V8h4v24M4 12h8v4H4zM16 4h8v4h-8zM16 20h12v4H16zM0 8h4v4H0zM24 0h4v4h-4z" fill="var(--scene-leaf)" />
    <path d="M4 30h24v8h-4v16H8V38H4z" fill="var(--scene-clay)" />
    <path d="M8 34h4v16H8z" fill="var(--scene-paper)" opacity=".3" />
  </g>;
}

function PixelWindow() {
  return <g>
    <path d="M160 24h108v88H160z" fill="var(--scene-wood)" />
    <path d="M168 32h92v72h-92z" fill="var(--scene-sky)" />
    <path className="home-scene-cloud" d="M176 52h12v-4h16v4h8v8h-36zM226 76h8v-4h16v4h10v8h-34z" fill="var(--scene-cloud)" />
    <path d="M236 40h12v12h-12z" fill="var(--scene-sun)" />
    <path d="M212 32h4v72h-4zM168 68h92v4h-92zM156 108h116v8H156z" fill="var(--scene-paper)" />
  </g>;
}

export function PixelScene({ kind }: { kind: HomeNextPlanVisualKind }) {
  return <g shapeRendering="crispEdges" data-scene-art="pixel">
    <path d="M0 0h320v200H0z" fill="var(--scene-wall)" />
    <path d="M0 168h320v32H0z" fill="var(--scene-floor)" />
    <path d="M64 172h240v4H64zM96 188h56v4H96zM224 192h76v4h-76z" fill="var(--scene-wood)" opacity=".22" />
    {kind === 'study' ? <>
      <PixelWindow />
      <path d="M78 44h48v4H78zM82 28h8v16h-8zM94 20h8v24h-8zM106 32h12v12h-12z" fill="var(--scene-accent)" />
      <PixelPlant x={76} y={110} />
      <path d="M226 144h32v8h-32zM250 148h8v36h-8zM226 148h8v36h-8zM254 116h8v32h-8z" fill="var(--scene-wood)" />
      <path d="M218 96h24v8h8v24h-8v8h-24v-8h-8v-24h8z" fill="var(--scene-skin)" />
      <path d="M214 96h28v4h8v20h-8v-12h-20v8h-12v-16h4z" fill="var(--scene-ink)" />
      <path d="M216 128h28v24h-32v-16h4zM236 148h8v28h-8zM216 148h8v28h-8z" fill="var(--scene-accent)" />
      <path d="M204 132h24v8h-24z" fill="var(--scene-skin)" />
      <path d="M130 140h102v8H130zM138 148h8v36h-8zM218 148h8v36h-8z" fill="var(--scene-wood)" />
      <path d="M150 132h28v8h-28z" fill="var(--scene-clay)" />
      <path d="M154 124h28v8h-28zM180 128h24v12h-24z" fill="var(--scene-paper)" />
      <path d="M184 132h16v4h-16z" fill="var(--scene-line)" />
      <path d="M130 124h12v12h-12zM142 124h4v8h-4z" fill="var(--scene-accent)" />
      <path className="home-scene-steam" d="M134 112h4v8h-4z" fill="var(--scene-cloud)" />
      <path d="M270 156h8v-8h8v8h12v12h-28zM266 160h4v8h-8v-4h4z" fill="var(--scene-cat)" />
      <path d="M282 156h4v4h-4zM290 156h4v4h-4z" fill="var(--scene-ink)" />
    </> : kind === 'class' ? <>
      <path d="M106 32h160v84H106z" fill="var(--scene-wood)" />
      <path d="M114 40h144v68H114z" fill="var(--scene-board)" />
      <path d="M130 56h60v4h-60zM130 72h36v4h-36zM174 72h24v4h-24zM130 88h48v4h-48zM218 64h4v24h-4zM206 76h28v4h-28zM204 112h24v4h-24z" fill="var(--scene-chalk)" opacity=".9" />
      <path d="M280 44h20v20h-20z" fill="var(--scene-paper)" />
      <path className="home-scene-glint" d="M288 48h4v8h8v4h-12z" fill="var(--scene-accent)" />
      <PixelPlant x={74} y={114} />
      {[142, 232].map(x => <g key={x} transform={`translate(${x} 132)`}>
        <path d="M0 0h60v8H0zM4 8h4v40H4zM52 8h4v40h-4z" fill="var(--scene-wood)" />
        <path d="M14 16h32v8H14zM14 24h4v24h-4zM42 24h4v24h-4zM14 8h4v12h-4zM42 8h4v12h-4z" fill="var(--scene-accent)" />
        <path d="M12 -8h32v8H12z" fill="var(--scene-paper)" />
        <path d="M26 -8h4v8h-4z" fill="var(--scene-line)" />
      </g>)}
    </> : <>
      <path d="M182 28h92v140h-92z" fill="var(--scene-wood)" />
      <path d="M190 36h76v132h-76z" fill="var(--scene-sky)" />
      <path d="M198 44h60v64h-60z" fill="var(--scene-wall)" />
      <path d="M230 56h4v28h-4zM214 68h36v4h-36z" fill="var(--scene-paper)" />
      <path className="home-scene-glint" d="M252 118h8v4h-8z" fill="var(--scene-sun)" />
      <path d="M158 172h128v12H158z" fill="var(--scene-accent)" opacity=".5" />
      <PixelPlant x={278} y={114} />
      <path d="M110 132h56v8h-56zM114 140h8v36h-8zM154 140h8v36h-8z" fill="var(--scene-wood)" />
      <path d="M120 104h32v28h-32zM128 96h16v4h-16zM124 100h4v8h-4zM144 100h4v8h-4z" fill="var(--scene-clay)" />
      <path d="M128 116h16v12h-16z" fill="var(--scene-paper)" />
      <path d="M110 44h36v40h-36z" fill="var(--scene-paper)" />
      <path d="M118 52h20v4h-20zM118 64h4v4h-4zM130 64h4v4h-4zM118 72h16v4h-16z" fill="var(--scene-accent)" />
      <path d="M202 160h8v8h12v8h-24v-12h4zM234 160h8v8h12v8h-24v-12h4z" fill="var(--scene-ink)" />
    </>}
  </g>;
}
