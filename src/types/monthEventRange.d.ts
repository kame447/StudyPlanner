import './domain';

declare module './domain' {
  interface MonthEvent {
    endDate?: string;
  }

  interface MonthEventDraft {
    endDate?: string;
  }
}

export {};
