import type {
  Actual,
  DayNote,
  MonthEvent,
  Plan,
  ScheduleTemplate,
  TimetablePeriod,
  TimetableTerm,
  TodoTask,
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
  readTodos(): Promise<TodoTask[]>;
  writeTodos(todos: PromiseLike<TodoTask[]> | TodoTask[]): Promise<void>;
  readScheduleTemplates(): Promise<ScheduleTemplate[]>;
  writeScheduleTemplates(
    items: PromiseLike<ScheduleTemplate[]> | ScheduleTemplate[],
  ): Promise<void>;
  readTimetableTerms(): Promise<TimetableTerm[]>;
  writeTimetableTerms(
    items: PromiseLike<TimetableTerm[]> | TimetableTerm[],
  ): Promise<void>;
  readTimetablePeriods(): Promise<TimetablePeriod[]>;
  writeTimetablePeriods(
    items: PromiseLike<TimetablePeriod[]> | TimetablePeriod[],
  ): Promise<void>;
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
  getTodos(userId: string): Promise<TodoTask[]>;
  getScheduleTemplates(userId: string): Promise<ScheduleTemplate[]>;
  getTimetableTerms(userId: string): Promise<TimetableTerm[]>;
  getTimetablePeriods(userId: string): Promise<TimetablePeriod[]>;
  upsertPlan(plan: Plan): Promise<Plan>;
  deletePlan(userId: string, planId: string): Promise<void>;
  upsertActual(actual: Actual): Promise<Actual>;
  deleteActual(userId: string, actualId: string): Promise<void>;
  upsertDayNote(dayNote: DayNote): Promise<DayNote>;
  upsertMonthEvent(monthEvent: MonthEvent): Promise<MonthEvent>;
  deleteMonthEvent(userId: string, monthEventId: string): Promise<void>;
  upsertTodo(todo: TodoTask): Promise<TodoTask>;
  deleteTodo(userId: string, todoId: string): Promise<void>;
  upsertScheduleTemplate(item: ScheduleTemplate): Promise<ScheduleTemplate>;
  deleteScheduleTemplate(userId: string, templateId: string): Promise<void>;
  upsertTimetableTerm(item: TimetableTerm): Promise<TimetableTerm>;
  upsertTimetablePeriod(item: TimetablePeriod): Promise<TimetablePeriod>;
  deleteTimetablePeriod(userId: string, periodId: string): Promise<void>;
}
