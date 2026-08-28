import type { ProductActivityAction } from '../../shared/productObservabilityContract';
import {
  createFirebaseProductTelemetryPort,
  type ProductTelemetryPort,
} from '../features/productObservability/productTelemetry';
import type { TodoStatus } from '../types/domain';
import type { PlannerRepository } from './repositoryContracts';

function recordBestEffort(port: ProductTelemetryPort, action: ProductActivityAction): void {
  try {
    port.recordActivity({ action });
  } catch {
    // Product persistence remains authoritative even when observability is unavailable.
  }
}

function isNewTimestampedRecord(value: { createdAt: string; updatedAt: string }): boolean {
  return value.createdAt === value.updatedAt;
}

export function createObservedPlannerRepository(
  repository: PlannerRepository,
  telemetry: ProductTelemetryPort = createFirebaseProductTelemetryPort(),
): PlannerRepository {
  const todoStatusById = new Map<string, TodoStatus>();
  const appActiveUsers = new Set<string>();

  return {
    ...repository,
    async getPlans(userId) {
      const plans = await repository.getPlans(userId);
      if (!appActiveUsers.has(userId)) {
        appActiveUsers.add(userId);
        recordBestEffort(telemetry, 'app_active');
      }
      return plans;
    },
    async getTodos(userId) {
      const todos = await repository.getTodos(userId);
      todos.forEach((todo) => todoStatusById.set(todo.id, todo.status));
      return todos;
    },
    async upsertPlan(plan) {
      const saved = await repository.upsertPlan(plan);
      recordBestEffort(
        telemetry,
        isNewTimestampedRecord(saved) ? 'plan_created' : 'plan_updated',
      );
      return saved;
    },
    async deletePlan(userId, planId) {
      await repository.deletePlan(userId, planId);
      recordBestEffort(telemetry, 'plan_deleted');
    },
    async upsertActual(actual) {
      const saved = await repository.upsertActual(actual);
      // Actual currently has no createdAt field. Treat a successful save as a recorded
      // learning result; mutation-specific update analytics can be added when the domain
      // owns an explicit creation/update discriminator.
      recordBestEffort(telemetry, 'actual_recorded');
      return saved;
    },
    async deleteActual(userId, actualId) {
      await repository.deleteActual(userId, actualId);
      recordBestEffort(telemetry, 'actual_deleted');
    },
    async upsertTodo(todo) {
      const previousStatus = todoStatusById.get(todo.id);
      const saved = await repository.upsertTodo(todo);
      const action: ProductActivityAction = previousStatus !== undefined
        && previousStatus !== 'done'
        && saved.status === 'done'
        ? 'todo_completed'
        : isNewTimestampedRecord(saved)
          ? 'todo_created'
          : 'todo_updated';
      todoStatusById.set(saved.id, saved.status);
      recordBestEffort(telemetry, action);
      return saved;
    },
    async deleteTodo(userId, todoId) {
      await repository.deleteTodo(userId, todoId);
      todoStatusById.delete(todoId);
    },
    async upsertStudyMaterial(item) {
      const saved = await repository.upsertStudyMaterial(item);
      recordBestEffort(
        telemetry,
        isNewTimestampedRecord(saved) ? 'material_created' : 'material_updated',
      );
      return saved;
    },
    async updateStudyMaterialProgress(userId, materialId, nextCurrentUnit) {
      await repository.updateStudyMaterialProgress(userId, materialId, nextCurrentUnit);
      recordBestEffort(telemetry, 'material_updated');
    },
  };
}
