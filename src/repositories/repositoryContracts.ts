import type {
  Actual,
  DayNote,
  EmailChallenge,
  Plan,
  User,
} from '../types/domain';

export interface AuthCodeRecord {
  email: string;
  code: string;
  expiresAt: string;
}

export interface AuthStorageGateway {
  readUsers(): Promise<User[]>;
  writeUsers(users: User[]): Promise<void>;
  readPendingCodes(): Promise<AuthCodeRecord[]>;
  writePendingCodes(codes: AuthCodeRecord[]): Promise<void>;
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
}

export interface AuthRepository {
  requestEmailCode(email: string): Promise<EmailChallenge>;
  verifyEmailCode(email: string, code: string): Promise<User>;
  getCurrentUser(): Promise<User | null>;
  signOut(): Promise<void>;
}

export interface PlannerRepository {
  getPlans(userId: string): Promise<Plan[]>;
  getActuals(userId: string): Promise<Actual[]>;
  getDayNotes(userId: string): Promise<DayNote[]>;
  upsertPlan(plan: Plan): Promise<Plan>;
  deletePlan(userId: string, planId: string): Promise<void>;
  upsertActual(actual: Actual): Promise<Actual>;
  deleteActual(userId: string, actualId: string): Promise<void>;
  upsertDayNote(dayNote: DayNote): Promise<DayNote>;
}
