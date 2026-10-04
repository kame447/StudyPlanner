import { createLocalPlannerStorageGateway } from './localStorageGateway';
import { createLocalScheduleEventAuthority } from './localScheduleEventAuthority';
import { createPlannerRepository } from './plannerRepository';
import type { PlannerRepository } from './repositoryContracts';
import { createScheduleEventBackedPlannerRepository } from './scheduleEventAuthorityRepository';

// The local adapter replaces whole shared collections. Keep their read/modify/write
// and compensation in one queue, shared by every repository using this Storage.
// Shared only within this module instance for the exact same Storage object.
// This is not a cross-tab or crash-atomic transaction.
const storageOperations = new WeakMap<Storage, Promise<void>>();

function runWithStorageAccess<T>(storage: Storage, operation: () => Promise<T>): Promise<T> {
  const previous = storageOperations.get(storage) ?? Promise.resolve();
  const result = previous.then(operation);
  storageOperations.set(storage, result.then(() => undefined, () => undefined));
  return result;
}

export function createLocalPlannerRepository(
  storage: Storage = window.localStorage,
): PlannerRepository {
  const gateway = createLocalPlannerStorageGateway(storage);
  const repository = createScheduleEventBackedPlannerRepository(
    createPlannerRepository(gateway),
    createLocalScheduleEventAuthority(gateway, storage),
  );

  // Include reads: schedule getters can migrate legacy data on first access.
  // Raw repositories stay private so all application access has one boundary.
  const coordinated = { ...repository };
  for (const [name, operation] of Object.entries(repository)) {
    Object.defineProperty(coordinated, name, {
      value: (...args: unknown[]) => runWithStorageAccess(
        storage,
        async () => Reflect.apply(operation, repository, args),
      ),
    });
  }
  return coordinated;
}
