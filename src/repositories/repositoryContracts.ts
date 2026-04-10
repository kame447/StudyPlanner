import type {
  Actual,
  DayNote,
  MonthEvent,
  Plan,
  User,
  UserProfileDraft,
} from '../types/domain';

export interface AuthStorageGateway {
  readUsers(): Promise<User[]>;
  writeUsers(users: User[]): Promise<void>;
  readSessionUserId(): Promise<string | null>;
  writeSessionUserId(userId: string): Promise<void>;
  clearSessionUserId(): Promise<void>;
}

export interface PlannerStorageGateway {
  readPlans(): Promise<Plan[]>;
  writePlans(plans: Plan[]): Promise<void>;
  readActuals(): Promise<Actual[]>;
  writeActuals(actuals: Actual[]): Promise<void>;
  readDayNotes(): Promise<DayNote[]>;
  writeDayNotes(dayNotes: DayNote[]): Promise<void>;
  readMonthEvents(): Promise<MonthEvent[]>;
  writeMonthEvents(monthEvents: MonthEvent[]): Promise<void>;
}

export interface AuthRepository {
  signUpWithPassword(email: string, password: string, username: string): Promise<void>;
  signInWithPassword(email: string, password: string): Promise<User>;
  signInWithGoogle(): Promise<User>;
  sendPasswordReset(email: string): Promise<void>;
  getCurrentUser(): Promise<User | null>;
  updateUserProfile(userId: string, draft: UserProfileDraft): Promise<User>;
  signOut(): Promise<void>;
}

export interface PlannerRepository {
  getPlans(userId: string): Promise<Plan[]>;
  getActuals(userId: string): Promise<Actual[]>;
  getDayNotes(userId: string): Promise<DayNote[]>;
  getMonthEvents(userId: string): Promise<MonthEvent[]>;
  upsertPlan(plan: Plan): Promise<Plan>;
  deletePlan(userId: string, planId: string): Promise<void>;
  upsertActual(actual: Actual): Promise<Actual>;
  deleteActual(userId: string, actualId: string): Promise<void>;
  upsertDayNote(dayNote: DayNote): Promise<DayNote>;
  upsertMonthEvent(monthEvent: MonthEvent): Promise<MonthEvent>;
  deleteMonthEvent(userId: string, monthEventId: string): Promise<void>;
}
