import './domain';

declare module './domain' {
  interface Plan {
    /** Compatibility projection of canonical ScheduleEvent busy semantics. */
    busy?: boolean;
  }

  interface MonthEvent {
    /** Compatibility projection of canonical ScheduleEvent busy semantics. */
    busy?: boolean;
  }
}

export {};
