import { expect, it, vi } from 'vitest';
import { createDeferred } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createWeeklyPlanningRuntimeLoader, WeeklyPlanningRuntimeModuleError } from './weeklyPlanningRuntimeModule';
it('deduplicates loading, clears only rejected app promises, and never calls the runtime during retry', async () => {
  const first=createDeferred<object>(); const runtime={execute:vi.fn()};
  const importer=vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(runtime);
  const load=createWeeklyPlanningRuntimeLoader(importer);
  const a=load(),b=load();expect(a).toBe(b);
  const rejection=expect(a).rejects.toBeInstanceOf(WeeklyPlanningRuntimeModuleError);
  first.reject(new TypeError('text/html'));await rejection;
  expect(await load()).toBe(runtime);expect(await load()).toBe(runtime);
  expect(importer).toHaveBeenCalledTimes(2);expect(runtime.execute).not.toHaveBeenCalled();
});
it('keeps the original import error as a cause and does not swallow another rejected retry',async()=>{
  const cause=new TypeError('network');const importer=vi.fn(async()=>{throw cause});const load=createWeeklyPlanningRuntimeLoader(importer);
  await expect(load()).rejects.toMatchObject({name:'WeeklyPlanningRuntimeModuleError',cause});
  await expect(load()).rejects.toMatchObject({name:'WeeklyPlanningRuntimeModuleError',cause});expect(importer).toHaveBeenCalledTimes(2);
});
