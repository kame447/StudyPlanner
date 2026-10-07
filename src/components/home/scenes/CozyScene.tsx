import type { HomeNextPlanVisualKind } from '../../../lib/homeNextPlanVisual';

function LeafyPlant() {
  return <g>
    <path d="M284 154c-5-27-4-49 7-69m-7 58c-1-16-12-21-19-24m20 10c5-12 13-19 24-22" fill="none" stroke="var(--scene-leaf)" strokeWidth="3" strokeLinecap="round" />
    <path d="M289 105c-9-10-9-19 4-26 5 13 4 20-4 26Zm-10 32c-15 0-24-8-20-20 14 1 20 8 20 20Zm9-13c-1-14 8-23 23-19-1 13-9 19-23 19Z" fill="var(--scene-leaf)" />
    <path d="M269 151h31l-5 28h-21Z" fill="var(--scene-clay)" />
    <path d="m278 155 2 18" stroke="var(--scene-paper)" strokeWidth="3" opacity=".45" strokeLinecap="round" />
  </g>;
}

export function CozyScene({ kind }: { kind: HomeNextPlanVisualKind }) {
  return <g data-scene-art="cozy">
    <path d="M0 0h320v200H0z" fill="var(--scene-wall)" />
    <path d="M36 166c75-20 195-6 284-14v48H36Z" fill="var(--scene-floor)" />
    <ellipse cx="216" cy="182" rx="87" ry="8" fill="var(--scene-wood)" opacity=".12" />
    {kind === 'study' ? <>
      <path d="M165 119V61a51 51 0 0 1 102 0v58Z" fill="var(--scene-paper)" />
      <path d="M173 111V62a43 43 0 0 1 86 0v49Z" fill="var(--scene-sky)" />
      <circle cx="234" cy="49" r="12" fill="var(--scene-sun)" />
      <path className="home-scene-cloud" d="M179 69q7-14 19-5 8-3 12 6Z" fill="var(--scene-cloud)" />
      <path d="M173 97q22-25 47-3t39-5v22h-86Z" fill="var(--scene-leaf)" opacity=".3" />
      <path d="M216 19v94m-45-35h90" fill="none" stroke="var(--scene-paper)" strokeWidth="5" />
      <path d="M97 138h166v10H97zM112 147l-5 37m143-37 5 37" fill="var(--scene-wood)" stroke="var(--scene-wood)" strokeWidth="5" strokeLinecap="round" />
      <path d="M191 152q25-12 41 0v17h-41Z" fill="var(--scene-accent)" />
      <path d="m196 168-3 19m33-19 3 19" stroke="var(--scene-wood)" strokeWidth="5" strokeLinecap="round" />
      <path d="M165 119q17-7 32 0 13-7 31-1l-4 20q-14-5-27 0-14-6-31 0Z" fill="var(--scene-paper)" stroke="var(--scene-line)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M197 120v15m-23-10 15-1m-15 5 15-1m15-4 15-1m-15 5 15-1" stroke="var(--scene-line)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="m121 137 6-39m-10 0h29l-9-21h-12Z" fill="var(--scene-clay)" stroke="var(--scene-clay)" strokeWidth="4" strokeLinejoin="round" />
      <path d="M236 124h14v9q-7 8-14 0Zm14 1q12 0 0 8" fill="var(--scene-accent)" stroke="var(--scene-accent)" strokeWidth="2" />
      <path className="home-scene-steam" d="M242 118q-5-4 0-8t0-7" fill="none" stroke="var(--scene-line)" strokeWidth="2" strokeLinecap="round" />
      <path d="M88 53h44m-38-5V32h8v16m8 0V26h8v22" stroke="var(--scene-wood)" strokeWidth="4" strokeLinecap="round" />
    </> : kind === 'class' ? <>
      <rect x="106" y="28" width="156" height="91" rx="12" fill="var(--scene-wood)" />
      <rect x="113" y="35" width="142" height="76" rx="7" fill="var(--scene-board)" />
      <path d="M131 54h56m-56 14h36m-36 14h47m38-24v30m-15-15h30" stroke="var(--scene-chalk)" strokeWidth="3" strokeLinecap="round" opacity=".85" />
      <path d="M140 118h97" stroke="var(--scene-wood)" strokeWidth="6" strokeLinecap="round" />
      <circle cx="285" cy="47" r="16" fill="var(--scene-paper)" />
      <path d="M285 36v12l8 4" stroke="var(--scene-accent)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {[131, 213].map(x => <g key={x} transform={`translate(${x} 137)`}>
        <rect width="65" height="8" rx="4" fill="var(--scene-wood)" />
        <path d="m8 8-3 35m51-35 3 35" stroke="var(--scene-wood)" strokeWidth="4" strokeLinecap="round" />
        <rect x="16" y="13" width="34" height="18" rx="7" fill="var(--scene-accent)" />
        <path d="M20 31v16m25-16v16" stroke="var(--scene-wood)" strokeWidth="4" strokeLinecap="round" />
        <path d="M13-4h30v-8H13Z" fill="var(--scene-paper)" />
        <path d="M13-4h30" stroke="var(--scene-clay)" strokeWidth="3" strokeLinecap="round" />
      </g>)}
      <path className="home-scene-glint" d="m86 62 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" fill="var(--scene-sun)" />
    </> : <>
      <path d="M182 166V67a42 42 0 0 1 84 0v99Z" fill="var(--scene-wood)" />
      <path d="M189 164V68a35 35 0 0 1 70 0v96Z" fill="var(--scene-sky)" />
      <path d="M202 91V69a22 22 0 0 1 44 0v22Z" fill="var(--scene-paper)" />
      <circle cx="249" cy="120" r="4" fill="var(--scene-sun)" />
      <ellipse cx="221" cy="175" rx="49" ry="7" fill="var(--scene-accent)" opacity=".5" />
      <path d="M117 93v87m-16-69 16-8 19 8m-28 69h19" stroke="var(--scene-wood)" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M121 121q14-7 27 0l3 28q-16 10-33-1Z" fill="var(--scene-clay)" />
      <path d="M127 121v-6q8-10 15 0v6" stroke="var(--scene-clay)" strokeWidth="4" fill="none" />
      <path d="m126 134 6 5 11-12" stroke="var(--scene-paper)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="99" y="34" width="43" height="42" rx="5" fill="var(--scene-paper)" />
      <path d="M108 46h25m-25 10h6m10 0h6m-22 9h16" stroke="var(--scene-accent)" strokeWidth="3" strokeLinecap="round" />
      <path className="home-scene-glint" d="m160 44 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z" fill="var(--scene-sun)" />
    </>}
    <LeafyPlant />
  </g>;
}
