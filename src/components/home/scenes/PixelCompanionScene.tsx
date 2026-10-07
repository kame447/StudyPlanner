import type { HomeNextPlanVisualKind } from '../../../lib/homeNextPlanVisual';

function CompanionBackdrop({ kind }: { kind: HomeNextPlanVisualKind }) {
  if (kind === 'class') {
    return <g data-companion-backdrop="class">
      <path d="M112 32h164v80H112z" fill="var(--scene-wood)" />
      <path d="M120 40h148v64H120z" fill="var(--scene-board)" />
      <path d="M136 56h56v4h-56zM136 72h36v4h-36zM136 88h64v4h-64zM232 56h4v28h-4zM220 68h28v4h-28z" fill="var(--scene-chalk)" />
      <path d="M252 108h12v4h-12z" fill="var(--scene-paper)" />
      <path d="M108 140h92v8h-92zM116 148h8v36h-8zM184 148h8v36h-8z" fill="var(--scene-wood)" />
      <path d="M124 128h28v12h-28zM156 128h28v12h-28z" fill="var(--scene-paper)" />
      <path d="M152 128h4v12h-4zM132 132h12v4h-12zM160 132h16v4h-16z" fill="var(--scene-line)" />
    </g>;
  }

  if (kind === 'other') {
    return <g data-companion-backdrop="other">
      <path d="M112 28h84v140h-84z" fill="var(--scene-wood)" />
      <path d="M120 36h68v132h-68z" fill="var(--scene-sky)" />
      <path d="M128 44h52v56h-52z" fill="var(--scene-wall)" />
      <path d="M150 52h4v40h-4zM132 72h44v4h-44z" fill="var(--scene-paper)" />
      <path className="home-scene-glint" d="M176 116h8v4h-8z" fill="var(--scene-sun)" />
      <path d="M104 172h96v8h-96z" fill="var(--scene-accent)" opacity=".55" />
      <path d="M214 44h48v40h-48z" fill="var(--scene-paper)" />
      <path d="M222 52h32v4h-32zM224 64h4v4h-4zM240 64h4v4h-4zM224 72h20v4h-20z" fill="var(--scene-accent)" />
      <path d="M84 144h24v32H84zM88 136h16v4H88zM84 140h4v8h-4zM104 140h4v8h-4z" fill="var(--scene-clay)" />
      <path d="M88 156h16v12H88z" fill="var(--scene-paper)" />
    </g>;
  }

  return <g data-companion-backdrop="study">
    <path d="M160 28h108v76H160z" fill="var(--scene-wood)" />
    <path d="M168 36h92v60h-92z" fill="var(--scene-sky)" />
    <path className="home-scene-cloud" d="M176 60h12v-4h16v4h8v8h-36z" fill="var(--scene-cloud)" />
    <path d="M236 44h12v12h-12z" fill="var(--scene-sun)" />
    <path d="M212 36h4v60h-4zM156 100h116v8H156z" fill="var(--scene-paper)" />
    <path d="M104 140h96v8h-96zM112 148h8v36h-8zM184 148h8v36h-8z" fill="var(--scene-wood)" />
    <path d="M120 132h28v8h-28zM124 124h28v8h-28z" fill="var(--scene-clay)" />
    <path d="M144 124h24v16h-24zM172 124h20v16h-20z" fill="var(--scene-paper)" />
    <path d="M168 124h4v16h-4zM148 128h16v4h-16zM176 128h12v4h-12z" fill="var(--scene-line)" />
    <path d="M112 92h4v32h-4zM104 88h20v8h-20zM104 124h20v4h-20z" fill="var(--scene-accent)" />
    <path d="M104 96h20v4h-20z" fill="var(--scene-sun)" />
  </g>;
}

function PixelCat() {
  return <g data-scene-companion="cat" transform="translate(220 104)">
    <path d="M-4 76h72v4H-4z" fill="var(--scene-wood)" opacity=".3" />
    <g className="home-scene-cat-tail">
      <path d="M48 56h12v-4h4V36h8v20h-4v8h-8v4H48z" fill="var(--scene-cat)" />
      <path d="M64 36h8v8h-8z" fill="var(--scene-clay)" />
    </g>
    <path d="M12 36h36v8h8v24h-4v8H4v-8h4V44h4z" fill="var(--scene-cat)" />
    <path d="M24 48h16v8h4v16H20V56h4z" fill="var(--scene-paper)" />
    <path d="M8 72h16v4H8zM36 72h16v4H36z" fill="var(--scene-clay)" />
    <g className="home-scene-cat-head">
      <path d="M8 0h8v4h8v8h16V4h8V0h8v40h-8v8H16v-8H8z" fill="var(--scene-cat)" />
      <path d="M12 8h4v4h4v8h-8zM48 8h4v12h-8v-8h4z" fill="var(--scene-clay)" />
      <path d="M28 12h8v8h-8zM8 28h8v4H8zM48 28h8v4h-8z" fill="var(--scene-clay)" />
      <path className="home-scene-cat-eyes" d="M20 28h4v4h-4zM40 28h4v4h-4z" fill="var(--scene-ink)" />
      <path d="M28 36h8v4h-8z" fill="var(--scene-clay)" />
      <path d="M16 36h4v4h-4zM44 36h4v4h-4z" fill="var(--scene-paper)" />
    </g>
  </g>;
}

function PixelTurtle() {
  return <g data-scene-companion="turtle" transform="translate(204 124)">
    <path d="M0 56h88v4H0z" fill="var(--scene-wood)" opacity=".3" />
    <g className="home-scene-turtle-walk">
      <path className="home-scene-turtle-leg-back" d="M16 44h12v12H12v-8h4zM52 44h12v12H48v-8h4z" fill="var(--scene-turtle-skin)" />
      <path d="M4 36H0v8h12v-8z" fill="var(--scene-turtle-skin)" />
      <g className="home-scene-turtle-head">
        <path d="M60 28h8v-8h16v4h8v16h-4v8H64v-4h-4z" fill="var(--scene-turtle-skin)" />
        <path d="M80 28h4v4h-4z" fill="var(--scene-ink)" />
        <path d="M84 40h8v4h-8z" fill="var(--scene-leaf)" />
      </g>
      <path d="M12 16h8V8h12V4h16v4h12v8h8v12h4v16H8V28h4z" fill="var(--scene-leaf)" />
      <path d="M28 12h20v4h8v16h-8v8H28v-8h-8V20h8z" fill="var(--scene-turtle-shell)" />
      <path d="M28 12h4v12H20v-4h8zM48 16h4v12h-4zM32 32h16v4H32zM12 32h8v4h-8zM60 28h8v4h-8z" fill="var(--scene-leaf)" />
      <path d="M8 40h64v8H8z" fill="var(--scene-turtle-skin)" />
      <path className="home-scene-turtle-leg-front" d="M24 44h12v12H20v-8h4zM60 44h12v12H56v-8h4z" fill="var(--scene-leaf)" />
    </g>
  </g>;
}

export function PixelCompanionScene({ kind, companion }: {
  kind: HomeNextPlanVisualKind;
  companion: 'cat' | 'turtle';
}) {
  return <g shapeRendering="crispEdges" data-scene-art={`pixel-${companion}`}>
    <path d="M0 0h320v200H0z" fill="var(--scene-wall)" />
    <path d="M0 168h320v32H0z" fill="var(--scene-floor)" />
    <path d="M80 188h88v4H80zM208 192h80v4h-80z" fill="var(--scene-wood)" opacity=".2" />
    <CompanionBackdrop kind={kind} />
    <path d="M284 100h4v28h-4zM276 108h8v4h-8zM288 100h8v4h-8zM292 96h4v4h-4z" fill="var(--scene-leaf)" />
    <path d="M276 124h20v4h-4v12h-12v-12h-4z" fill="var(--scene-clay)" />
    <path d="M272 140h28v4h-28z" fill="var(--scene-wood)" />
    {companion === 'cat' ? <PixelCat /> : <PixelTurtle />}
  </g>;
}
