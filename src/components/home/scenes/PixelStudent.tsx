import type { PixelStudentState } from '../useScheduledPixelStudent';

function Head() {
  return <>
    <path d="M218 96h24v8h8v24h-8v8h-24v-8h-8v-24h8z" fill="var(--scene-skin)" />
    <path d="M214 96h28v4h8v20h-8v-12h-20v8h-12v-16h4z" fill="var(--scene-ink)" />
    <path d="M214 118h4v4h-4z" fill="var(--scene-ink)" />
  </>;
}

export function PixelStudent({ state, classroom = false }: { state: PixelStudentState; classroom?: boolean }) {
  if (state === 'empty') return null;
  return <g data-pixel-student={state} transform={classroom ? 'translate(36 -8)' : undefined}>
    {state === 'entering' ? <g className="home-pixel-student-walking">
      <Head />
      <path d="M216 128h28v24h-28z" fill="var(--scene-accent)" />
      <path className="home-pixel-student-step-front" d="M216 152h8v24h-8zM212 172h12v4h-12z" fill="var(--scene-ink)" />
      <path className="home-pixel-student-step-back" d="M236 152h8v24h-8zM232 172h12v4h-12z" fill="var(--scene-ink)" />
      <path d="M216 136h8v20h-8z" fill="var(--scene-skin)" />
    </g> : null}
    <g className="home-pixel-student-seated">
      <Head />
      <path d="M216 128h28v24h-32v-16h4zM236 148h8v28h-8zM216 148h8v28h-8z" fill="var(--scene-accent)" />
      <g className="home-pixel-student-writing">
        <path d="M204 132h24v8h-24z" fill="var(--scene-skin)" />
        <path d="M204 128h4v10h-4z" fill="var(--scene-ink)" />
      </g>
    </g>
  </g>;
}
