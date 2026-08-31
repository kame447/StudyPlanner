import { describe, expect, it, vi } from 'vitest';
import type { ProductActivityAction } from '../../shared/productObservabilityContract';
import type { ProductTelemetryPort } from '../features/productObservability/productTelemetry';
import type { Actual, Plan, StudyMaterial, TodoTask } from '../types/domain';
import { createObservedPlannerRepository } from './observedPlannerRepository';
import type { PlannerRepository } from './repositoryContracts';

function telemetry(actions: ProductActivityAction[]): ProductTelemetryPort {
  return {
    recordActivity(input) {
      actions.push(input.action);
    },
  };
}

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    seriesId: 'plan-1',
    userId: 'user-1',
    title: 'Math',
    subject: 'Math',
    date: '2026-08-28',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

function todo(overrides: Partial<TodoTask> = {}): TodoTask {
  return {
    id: 'todo-1',
    userId: 'user-1',
    title: 'Review',
    subject: 'English',
    type: 'study',
    estimatedMinutes: 30,
    dueDate: null,
    memo: '',
    status: 'open',
    scheduledPlanId: null,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('createObservedPlannerRepository', () => {
  it('records authenticated app activity once per loaded user', async () => {
    const actions: ProductActivityAction[] = [];
    const base = {
      getPlans: vi.fn(async () => []),
    } as unknown as PlannerRepository;
    const repository = createObservedPlannerRepository(base, telemetry(actions));

    await repository.getPlans('user-1');
    await repository.getPlans('user-1');
    await repository.getPlans('user-2');

    expect(actions).toEqual(['app_active', 'app_active']);
  });

  it('records activity only after a successful planner mutation', async () => {
    const actions: ProductActivityAction[] = [];
    const base = {
      upsertPlan: vi.fn(async (value: Plan) => value),
      deletePlan: vi.fn(async () => undefined),
    } as unknown as PlannerRepository;
    const repository = createObservedPlannerRepository(base, telemetry(actions));

    await repository.upsertPlan(plan());
    await repository.upsertPlan(plan({ updatedAt: '2026-08-28T01:00:00.000Z' }));
    await repository.deletePlan('user-1', 'plan-1');

    expect(actions).toEqual(['plan_created', 'plan_updated', 'plan_deleted']);
  });

  it('does not report a successful action when persistence fails', async () => {
    const actions: ProductActivityAction[] = [];
    const base = {
      upsertPlan: vi.fn(async () => {
        throw new Error('write failed');
      }),
    } as unknown as PlannerRepository;
    const repository = createObservedPlannerRepository(base, telemetry(actions));

    await expect(repository.upsertPlan(plan())).rejects.toThrow('write failed');
    expect(actions).toEqual([]);
  });

  it('counts Todo completion only for a known non-done to done transition', async () => {
    const actions: ProductActivityAction[] = [];
    const base = {
      getTodos: vi.fn(async () => [todo()]),
      upsertTodo: vi.fn(async (value: TodoTask) => value),
    } as unknown as PlannerRepository;
    const repository = createObservedPlannerRepository(base, telemetry(actions));

    await repository.getTodos('user-1');
    await repository.upsertTodo(todo());
    await repository.upsertTodo(todo({
      updatedAt: '2026-08-28T01:00:00.000Z',
      status: 'open',
    }));
    await repository.upsertTodo(todo({
      updatedAt: '2026-08-28T02:00:00.000Z',
      status: 'done',
    }));
    await repository.upsertTodo(todo({
      updatedAt: '2026-08-28T03:00:00.000Z',
      status: 'done',
      title: 'Review again',
    }));

    expect(actions).toEqual([
      'todo_created',
      'todo_updated',
      'todo_completed',
      'todo_updated',
    ]);
  });

  it('does not infer completion from a done snapshot when prior status is unknown', async () => {
    const actions: ProductActivityAction[] = [];
    const base = {
      upsertTodo: vi.fn(async (value: TodoTask) => value),
    } as unknown as PlannerRepository;
    const repository = createObservedPlannerRepository(base, telemetry(actions));

    await repository.upsertTodo(todo({
      status: 'done',
      updatedAt: '2026-08-28T02:00:00.000Z',
    }));

    expect(actions).toEqual(['todo_updated']);
  });

  it('preserves telemetry for aggregate Actual and material persistence', async () => {
    const actions: ProductActivityAction[] = [];
    const savedActual = {
      id: 'actual-1', userId: 'user-1', planId: null, occurrenceDate: '2026-08-31',
      actualStartTime: '09:00', actualEndTime: '10:00', title: 'Math', subject: 'Math',
      isAlignedToPlan: false, note: '', updatedAt: '2026-08-31T01:00:00.000Z',
    } as Actual;
    const savedMaterial = {
      id: 'material-1', userId: 'user-1', name: 'Book', subjectId: 'subject-1', subjectName: 'Math',
      aliases: [], status: 'active', paceEnabled: true, progressUnit: 'page', totalUnits: 100, currentUnit: 20,
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-31T01:00:00.000Z',
    } as StudyMaterial;
    const base = {
      upsertActualWithMaterialProgress: vi.fn(async () => savedActual),
    } as unknown as PlannerRepository;
    const repository = createObservedPlannerRepository(base, telemetry(actions));

    await repository.upsertActualWithMaterialProgress({
      actual: savedActual,
      materials: [savedMaterial],
    });

    expect(actions).toEqual(['actual_recorded', 'material_updated']);
  });
});
