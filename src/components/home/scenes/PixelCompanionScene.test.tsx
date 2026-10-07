import { readFileSync } from 'node:fs';
import { create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { HomeScene } from '../HomeScene';

const css = readFileSync(new URL('../../../styles/home-next-plan-visual.css', import.meta.url), 'utf8');
type Range = [number, number];

// These pixel paths use only straight, axis-aligned drawing commands. Fail if
// that changes rather than silently accepting a geometry we cannot inspect.
function pathXRange(path: string): Range {
  let x = 0; let startX = 0;
  const points: number[] = [];
  for (const [, command, values] of path.matchAll(/([a-z])([^a-z]*)/gi)) {
    const numbers = values.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const absolute = command === command.toUpperCase();
    switch (command.toLowerCase()) {
      case 'm': case 'l':
        expect(numbers).toHaveLength(2);
        x = (absolute ? 0 : x) + numbers[0];
        if (command.toLowerCase() === 'm') startX = x;
        break;
      case 'h':
        expect(numbers).toHaveLength(1);
        x = (absolute ? 0 : x) + numbers[0];
        break;
      case 'v': break;
      case 'z': x = startX; break;
      default: throw new Error(`Unsupported pixel path command: ${command}`);
    }
    points.push(x);
  }
  return [Math.min(...points), Math.max(...points)];
}

function translationX(transform: string): number {
  if (transform === 'none') return 0;
  const match = transform.match(/^(translate|translateX|translateY|scaleY)\(([^)]+)\)$/);
  if (!match) throw new Error(`Unsupported pixel transform: ${transform}`);
  return match[1] === 'translateY' || match[1] === 'scaleY' ? 0 : parseFloat(match[2]);
}

function animationXRange(className: string): Range {
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)].find(([, selectors, body]) =>
    selectors.includes(`.${className}`) && /animation:/.test(body));
  const name = rule?.[2].match(/animation:\s*([\w-]+)/)?.[1];
  if (!name) return [0, 0];
  const frames = css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1];
  if (!frames) throw new Error(`Missing animation: ${name}`);
  const translations = [...frames.matchAll(/transform:\s*([^;]+)/g)].map(([, value]) => translationX(value));
  return [Math.min(0, ...translations), Math.max(0, ...translations)];
}

function drawingXRange(drawing: ReactTestInstance, animated: boolean): Range {
  const ranges = drawing.findAllByType('path').map(path => {
    const range = pathXRange(path.props.d);
    for (let node: ReactTestInstance | null = path; node; node = node.parent) {
      if (typeof node.type !== 'string') continue;
      const offset = node.props.transform ? translationX(node.props.transform) : 0;
      const motion = animated && node.props.className ? animationXRange(node.props.className) : [0, 0];
      range[0] += offset + motion[0];
      range[1] += offset + motion[1];
    }
    return range;
  });
  return [Math.min(...ranges.map(range => range[0])), Math.max(...ranges.map(range => range[1]))];
}

describe('pixel companion planter clearance', () => {
  for (const companion of ['cat', 'turtle'] as const) {
    for (const kind of ['study', 'class', 'other'] as const) {
      it(`${companion}/${kind}: keeps the entire planter beside the pet in still, animated and preview scenes`, () => {
        for (const mode of ['still', 'animated', 'preview'] as const) {
          const renderer = create(<HomeScene kind={kind}
            preferences={{ style: `pixel-${companion}`, animated: mode !== 'still' }}
            preview={mode === 'preview'} />);
          const planter = drawingXRange(renderer.root.findByProps({ 'data-scene-prop': 'planter' }), false);
          const pet = drawingXRange(renderer.root.findByProps({ 'data-scene-companion': companion }), mode === 'animated');
          const head = drawingXRange(renderer.root.findByProps({ className: `home-scene-${companion}-head` }), mode === 'animated');
          // A horizontal gutter prevents both overlap and the hat-like alignment
          // even when the head, walk and tail animations reach different extrema.
          expect(planter[1] + 16).toBeLessThanOrEqual(pet[0]);
          expect(planter[1] + 16).toBeLessThanOrEqual(head[0]);
          const [left, , width] = renderer.root.findByType('svg').props.viewBox.split(' ').map(Number);
          expect(planter[0]).toBeGreaterThanOrEqual(left + 4);
          expect(pet[1]).toBeLessThanOrEqual(left + width - 4);
          renderer.unmount();
        }
      });
    }
  }
});
