import type { HomeNextPlanVisualKind } from '../../../lib/homeNextPlanVisual';

export function MinimalScene({ kind }: { kind: HomeNextPlanVisualKind }) {
  return <g data-scene-art="minimal" strokeLinecap="round" strokeLinejoin="round">
    <path d="M0 0h320v200H0z" fill="var(--scene-wall)" />
    <circle cx="216" cy="98" r="68" fill="var(--scene-sky)" opacity=".6" />
    <circle cx="277" cy="47" r="17" fill="var(--scene-sun)" opacity=".65" />
    <path d="M111 166h182M134 177h121" stroke="var(--scene-line)" strokeWidth="1.5" opacity=".6" />
    <circle className="home-scene-glint" cx="128" cy="63" r="4" fill="var(--scene-accent)" />
    <path d="m291 101 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z" fill="var(--scene-clay)" />
    {kind === 'study' ? <>
      <path d="M146 79q31-13 60 0 29-13 59 0v70q-32-12-59 0-30-12-60 0Z" fill="var(--scene-paper)" stroke="var(--scene-ink)" strokeWidth="2.5" />
      <path d="M206 80v68m-47-54q16-5 31 0m-31 13q16-5 31 0m-31 13q16-5 23-2m39-24q16-5 30-1m-30 14q16-5 30-1" fill="none" stroke="var(--scene-line)" strokeWidth="2" />
      <path d="M239 69v36l-7-5-7 5V69" fill="var(--scene-clay)" />
      <path d="m264 151 11-31 5 2-11 31-5 4Z" fill="var(--scene-accent)" />
    </> : kind === 'class' ? <>
      <rect x="143" y="56" width="132" height="88" rx="6" fill="var(--scene-paper)" stroke="var(--scene-ink)" strokeWidth="2.5" />
      <rect x="153" y="66" width="112" height="66" rx="2" fill="var(--scene-board)" />
      <path d="M168 85h40m-40 12h29m34-16v28m-14-14h28" stroke="var(--scene-chalk)" strokeWidth="2.5" />
      <path d="m173 144-9 21m80-21 9 21" stroke="var(--scene-ink)" strokeWidth="2.5" />
      <path d="M211 149h44v9h-44z" fill="var(--scene-clay)" />
      <path d="M211 159h50v6h-50z" fill="var(--scene-accent)" />
    </> : <>
      <rect x="159" y="57" width="96" height="102" rx="10" fill="var(--scene-paper)" stroke="var(--scene-ink)" strokeWidth="2.5" />
      <path d="M160 86h94" stroke="var(--scene-ink)" strokeWidth="2" />
      <path d="M182 50v18m49-18v18" stroke="var(--scene-accent)" strokeWidth="5" />
      <path d="m178 105 4 4 8-10m-12 27 4 4 8-10" stroke="var(--scene-accent)" strokeWidth="2.5" fill="none" />
      <path d="M201 105h34m-34 22h24" stroke="var(--scene-line)" strokeWidth="2.5" />
      <circle cx="256" cy="146" r="18" fill="var(--scene-clay)" />
      <path d="m248 146 6 6 11-12" stroke="var(--scene-paper)" strokeWidth="2.5" fill="none" />
    </>}
  </g>;
}
