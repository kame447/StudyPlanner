import { useLayoutEffect, useMemo, useState } from 'react';
import type { Actual, MonthEvent, Plan, StudyMaterial, StudySubject } from '../types/domain';
import type { usePlannerMutationScope } from './usePlannerMutationScope';

export type ActualActionTarget = Pick<Actual, 'userId' | 'planId' | 'occurrenceDate'> & { id?: string };
type Projection = 'actual-material' | 'plans-todos';
type Scope = ReturnType<typeof usePlannerMutationScope>['scope'];
const pendingMessage = 'この記録または予定は保存・更新中です。完了してから開き直してください。';
const refreshMessage = '記録の最新状態を確認できていません。データの再読み込みを試してから、現在の記録を開き直してください。';
export const actualUnavailableMessage = '最新の記録または予定を確認できません。再読み込みして、現在の記録や予定を開き直してください。';
export const materialStaleMessage = '教材が変更されています。入力内容を確認し、教材を開き直してから保存してください。';
export const materialUncertainMessage = '保存結果を確認できません。再読み込み後に記録と教材を確認し、保存済みの内容を開き直してください。再送すると重複する可能性があります。';
const materialPendingMessage = 'この教材は保存・更新中です。入力内容は保持されています。完了してからもう一度保存してください。';
export const materialRefreshMessage = '教材の最新状態を確認できていません。データを再読み込みし、保存結果を確認して開き直してください。';

export class ActualMutationAdmissionError extends Error {}
export class MaterialMutationAdmissionError extends ActualMutationAdmissionError {}
declare const materialBaselineBrand: unique symbol;
/** Opaque, immutable, same-owner edit-session evidence; never a storage revision. */
export type MaterialEditBaseline = Readonly<{ materialId: string; [materialBaselineBrand]: true }>;

function planKey(ownerId: string, planId: string) { return JSON.stringify(['plan', ownerId, planId]); }
function materialKey(ownerId: string, id: string) { return JSON.stringify(['material', ownerId, id]); }
function subjectKey(ownerId: string, id: string) { return JSON.stringify(['subject', ownerId, id]); }
function keysFor(target: ActualActionTarget): string[] {
  return [
    ...(target.id ? [JSON.stringify(['actual', target.userId, target.id])] : []),
    ...(target.planId ? [JSON.stringify(['occurrence', target.userId, target.planId, target.occurrenceDate])] : []),
  ];
}

type MaterialContent = ReadonlyArray<readonly [string, unknown]>;

// Material fields are primitives or ordered string arrays. Copy their values
// so later in-place changes cannot rewrite the evidence. Omitted optional
// fields and explicit undefined represent the same persisted content.
function materialContent(material: StudyMaterial | undefined): MaterialContent | undefined {
  return material && Object.entries(material)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, Array.isArray(value) ? [...value] : value] as const);
}

function sameMaterialContent(left: MaterialContent | undefined, right: MaterialContent | undefined): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every(([key, value], index) => {
    const [otherKey, otherValue] = right[index];
    return key === otherKey && (Array.isArray(value) && Array.isArray(otherValue)
      ? value.length === otherValue.length && value.every((item, itemIndex) => Object.is(item, otherValue[itemIndex]))
      : Object.is(value, otherValue));
  });
}

/** Same-owner UI admission, not a queue, identity registry or read authority. */
export function useActualMutationAdmission(
  scope: Scope, ownerId: string | null, actuals: Actual[], plans: Plan[], monthEvents: MonthEvent[],
  materials: StudyMaterial[], subjects: StudySubject[],
) {
  const [publication, setPublication] = useState({ scope, revision: 0 });
  const admission = useMemo(() => {
    type Ticket = { settledAt?: number; waitingFor?: Set<Projection>; planKeys: Set<string>; hasSubjectDependency: boolean };
    type MaterialVersion = { row: StudyMaterial | undefined; content: MaterialContent | undefined; generation: number };
    type Baseline = { id: string; generation: number; absent: boolean; awaitingRemoval?: true };
    const claims = new Map<string, Ticket>();
    const versions = new Map<string, MaterialVersion>();
    const baselines = new WeakMap<MaterialEditBaseline, Baseline>();
    const awaitingRemoval = new Set<Baseline>();
    let nextRevision = 0;
    let currentActuals: Actual[] = [];
    let currentPlans: Plan[] = [];
    let currentMonthEvents: MonthEvent[] = [];
    let currentMaterials: StudyMaterial[] = [];
    let currentSubjects: StudySubject[] = [];
    const dependencyKeys = (materialIds: string[], subjectIds: string[]) => [
      ...materialIds.map(id => materialKey(ownerId ?? '', id)),
      ...subjectIds.map(id => subjectKey(ownerId ?? '', id)),
    ];
    const pendingReason = (targets: ActualActionTarget[], exclusivePlanIds: string[] = [], materialIds: string[] = [], subjectIds: string[] = []) => {
      const tickets = new Set([
        ...targets.flatMap(target => [...keysFor(target), ...(target.planId ? [planKey(target.userId, target.planId)] : [])]),
        ...dependencyKeys(materialIds, subjectIds),
      ].flatMap(key => { const ticket = claims.get(key); return ticket ? [ticket] : []; }));
      const exclusiveKeys = exclusivePlanIds.map(id => planKey(ownerId ?? '', id));
      for (const ticket of claims.values()) {
        if (exclusiveKeys.some(key => ticket.planKeys.has(key))) tickets.add(ticket);
      }
      const hasMaterialDependency = materialIds.length > 0 || subjectIds.length > 0;
      return [...tickets].some(ticket => ticket.waitingFor?.size)
        ? hasMaterialDependency ? materialRefreshMessage : refreshMessage
        : tickets.size ? hasMaterialDependency ? materialPendingMessage : pendingMessage : null;
    };
    const notify = () => { const revision = ++nextRevision; setPublication({ scope, revision }); };
    const captureMaterial = (material: StudyMaterial): MaterialEditBaseline => {
      const version = versions.get(material.id);
      if (!scope.isCurrent() || material.userId !== ownerId || !version?.row
        || !sameMaterialContent(version.content, materialContent(material))) {
        throw new MaterialMutationAdmissionError(materialStaleMessage);
      }
      const token = Object.freeze({ materialId: material.id }) as MaterialEditBaseline;
      baselines.set(token, { id: material.id, generation: version.generation, absent: false });
      return token;
    };
    const requireMaterialBaseline = (id: string, token?: MaterialEditBaseline, absent = false) => {
      const baseline = token && baselines.get(token);
      const version = versions.get(id);
      if (!scope.isCurrent() || !baseline || baseline.id !== id || baseline.awaitingRemoval
        || baseline.absent !== absent || baseline.generation !== version?.generation
        || (absent ? version.row !== undefined : !version.row)) {
        throw new MaterialMutationAdmissionError(materialStaleMessage);
      }
      return version.row;
    };
    return {
      current: () => currentActuals,
      plans: () => currentPlans,
      materials: () => currentMaterials,
      subjects: () => currentSubjects,
      captureMaterial,
      requireMaterialBaseline,
      expectMaterialRemoval: (material: StudyMaterial): MaterialEditBaseline => {
        const token = captureMaterial(material);
        const baseline = baselines.get(token)!;
        baseline.absent = true;
        baseline.awaitingRemoval = true;
        awaitingRemoval.add(baseline);
        return token;
      },
      hasLinkedTarget: (id: string) => [...currentPlans, ...currentMonthEvents].some(target => target.userId === ownerId && target.id === id),
      reason: (target: ActualActionTarget) => {
        if (!scope.isCurrent() || target.userId !== ownerId) return actualUnavailableMessage;
        const pending = pendingReason([target]);
        if (pending) return pending;
        if (target.id && !currentActuals.some(actual => actual.id === target.id && actual.userId === ownerId)) return actualUnavailableMessage;
        return null;
      },
      acquire: (targets: ActualActionTarget[], exclusivePlanIds: string[] = [], materialIds: string[] = [], subjectIds: string[] = []) => {
        if (targets.some(target => target.userId !== ownerId) || !ownerId || !scope.isCurrent()) throw new ActualMutationAdmissionError(actualUnavailableMessage);
        const pending = pendingReason(targets, exclusivePlanIds, materialIds, subjectIds);
        if (pending) throw materialIds.length || subjectIds.length ? new MaterialMutationAdmissionError(pending) : new ActualMutationAdmissionError(pending);
        const exclusiveKeys = exclusivePlanIds.map(id => planKey(ownerId, id));
        const ticket: Ticket = { hasSubjectDependency: subjectIds.length > 0, planKeys: new Set([
          ...exclusiveKeys,
          ...targets.flatMap(target => target.planId ? [planKey(target.userId, target.planId)] : []),
        ]) };
        const keys = [...new Set([...targets.flatMap(keysFor), ...exclusiveKeys, ...dependencyKeys(materialIds, subjectIds)])];
        keys.forEach(key => claims.set(key, ticket));
        notify();
        return (waitFor: boolean | readonly Projection[] = false) => {
          if (ticket.settledAt !== undefined || ticket.waitingFor) return;
          ticket.waitingFor = new Set(waitFor === true ? ['actual-material'] : waitFor || []);
          if (!ticket.waitingFor.size) ticket.settledAt = nextRevision + 1;
          if (scope.isCurrent()) notify();
        };
      },
      requiresSubjectRepair: () => [...claims.values()].some(ticket => ticket.hasSubjectDependency && ticket.waitingFor?.has('actual-material')),
      requiredProjections: (): readonly Projection[] => scope.isCurrent()
        ? (['actual-material', 'plans-todos'] as const).filter(projection =>
            [...claims.values()].some(ticket => ticket.waitingFor?.has(projection)))
        : [],
      refreshed: (projections: readonly Projection[]) => {
        let released = false;
        for (const ticket of new Set(claims.values())) {
          if (!ticket.waitingFor?.size) continue;
          projections.forEach(projection => ticket.waitingFor!.delete(projection));
          if (!ticket.waitingFor.size) { ticket.settledAt = nextRevision + 1; released = true; }
        }
        if (released && scope.isCurrent()) notify();
      },
      publish: (records: Actual[], nextPlans: Plan[], events: MonthEvent[], nextMaterials: StudyMaterial[], nextSubjects: StudySubject[], committedRevision: number) => {
        currentActuals = records;
        currentPlans = nextPlans;
        currentMonthEvents = events;
        currentMaterials = nextMaterials.filter(material => material.userId === ownerId);
        currentSubjects = nextSubjects.filter(subject => subject.userId === ownerId);
        const rows = new Map(currentMaterials.map(material => [material.id, material]));
        for (const id of new Set([...versions.keys(), ...rows.keys()])) {
          const previous = versions.get(id);
          const row = rows.get(id);
          const content = materialContent(row);
          const changed = !previous || !sameMaterialContent(previous.content, content);
          versions.set(id, { row, content, generation: (previous?.generation ?? 0) + (changed ? 1 : 0) });
        }
        for (const baseline of awaitingRemoval) {
          const version = versions.get(baseline.id);
          if (version && version.generation !== baseline.generation) {
            // Equal present rereads leave this waiting. The first actual
            // content/presence transition must be the expected absence;
            // changed content or a later recreation invalidates this Undo.
            if (!version.row) baseline.generation = version.generation;
            delete baseline.awaitingRemoval;
            awaitingRemoval.delete(baseline);
          }
        }
        let released = false;
        for (const [key, ticket] of claims) {
          if (ticket.settledAt !== undefined && ticket.settledAt <= committedRevision) { claims.delete(key); released = true; }
        }
        // Only committed publication releases claims, never a promise's finally.
        if (released) notify();
      },
    };
  }, [scope, ownerId]);
  useLayoutEffect(() => {
    admission.publish(actuals, plans, monthEvents, materials, subjects, publication.scope === scope ? publication.revision : 0);
  }, [admission, actuals, plans, monthEvents, materials, subjects, publication, scope]);
  return admission;
}
