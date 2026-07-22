import type { RecurrenceFact as BaseRecurrenceFact } from './weeklyPlanningFactGraph';

export {};

declare module './weeklyPlanningFactGraphV2' {
  interface RecurrenceFact extends BaseRecurrenceFact {}
}
