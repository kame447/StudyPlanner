import type { CandidateManifest, CandidateTuple, SelectionMenu } from './contracts';
import { isCreatedCandidateManifest } from './manifest';

/** Provider contract limit; the application MUST supply its separate menu-width policy. */
export const CANDIDATE_CHOICE_OPTION_LIMIT = 255;

export interface CandidateHierarchyNode<T extends CandidateTuple = CandidateTuple> {
  readonly menu: SelectionMenu<T>;
  readonly children: readonly CandidateHierarchyNode<T>[];
}

export function buildCandidateHierarchy<T extends CandidateTuple>(
  manifest: CandidateManifest<T>, maximumChildrenPerMenu: number,
): CandidateHierarchyNode<T> {
  if (!isCreatedCandidateManifest(manifest)
    || !Number.isSafeInteger(maximumChildrenPerMenu) || maximumChildrenPerMenu < 2
    || maximumChildrenPerMenu + 1 > CANDIDATE_CHOICE_OPTION_LIMIT) {
    throw new Error('Invalid application menu width or manifest.');
  }
  const build = (start: number, end: number, depth: number): CandidateHierarchyNode<T> => {
    const nodeId = `group:${start}:${end}`;
    const candidates = manifest.candidates.slice(start, end);
    const children: CandidateHierarchyNode<T>[] = [];
    const options: SelectionMenu<T>['options'][number][] = [];
    if (candidates.length <= maximumChildrenPerMenu) {
      candidates.forEach((candidate, index) => options.push(Object.freeze({ kind: 'leaf', id: `leaf:${start + index}`, candidate })));
    } else {
      const size = Math.ceil(candidates.length / maximumChildrenPerMenu);
      for (let offset = start; offset < end; offset += size) {
        const limit = Math.min(end, offset + size);
        const child = build(offset, limit, depth + 1);
        children.push(child);
        // Complete leaves are retained: a group label can never erase tuple qualifiers.
        options.push(Object.freeze({ kind: 'group', id: child.menu.nodeId, candidates: Object.freeze(manifest.candidates.slice(offset, limit)) }));
      }
    }
    options.push(Object.freeze({ kind: 'none', id: 'none' }));
    return Object.freeze({
      menu: Object.freeze({ nodeId, depth, kind: children.length > 0 ? 'groups' : 'leaves', options: Object.freeze(options) }),
      children: Object.freeze(children),
    });
  };
  return build(0, manifest.candidates.length, 0);
}
