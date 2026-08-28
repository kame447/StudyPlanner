import { describe, expect, it, vi } from 'vitest';
import type { ProductActivityAction } from '../../shared/productObservabilityContract';
import type { ProductTelemetryPort } from '../features/productObservability/productTelemetry';
import type { Plan, TodoTask } from '../types/domain';
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

  it('uses typed Todo state to distinguish completion from ordinary updates', async () => {
    const actions: ProductActivityAction[] = [];
    const base = {
      upsertTodo: vi.fn(async (value: TodoTask) => value),
    } as unknown as PlannerRepository;
    const repository = createObservedPlannerRepository(base, telemetry(actions));

    await repository.upsertTodo(todo());
    await repository.upsertTodo(todo({
      updatedAt: '2026-08-28T01:00:00.000Z',
      status: 'open',
    }));
    await repository.upsertTodo(todo({
      updatedAt: '2026-08-28T02:00:00.000Z',
      status: 'done',
    }));

    expect(actions).toEqual(['todo_created', 'todo_updated', 'todo_completed']);
  });
});
