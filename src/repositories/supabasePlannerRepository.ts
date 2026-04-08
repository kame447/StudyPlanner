import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Actual,
  DayNote,
  MonthEvent,
  MonthEventChecklistItem,
  Plan,
} from '../types/domain';
import type { PlannerRepository } from './repositoryContracts';

interface PlanRow {
  id: string;
  user_id: string;
  title: string;
  subject: string | null;
  date: string;
  start_time: string;
  end_time: string;
  type: Plan['type'];
  memo: string | null;
  created_at: string;
  updated_at: string;
}

interface ActualRow {
  id: string;
  user_id: string;
  plan_id: string;
  actual_start_time: string;
  actual_end_time: string;
  title: string | null;
  subject: string | null;
  is_aligned_to_plan: boolean | null;
  note: string | null;
  updated_at: string;
}

interface DayNoteRow {
  id: string;
  user_id: string;
  date: string;
  quick_memo: string | null;
  reflection: string | null;
  next_focus: string | null;
  checked_plan: boolean | null;
  checked_record: boolean | null;
  checked_ready: boolean | null;
  updated_at: string;
}

interface MonthEventRow {
  id: string;
  user_id: string;
  date: string;
  title: string;
  start_time: string;
  end_time: string;
  repeat: MonthEvent['repeat'];
  repeat_until: string | null;
  excluded_dates: string[] | null;
  url: string | null;
  memo: string | null;
  checklist: MonthEventChecklistItem[] | null;
  location_tags: string[] | null;
  created_at: string;
  updated_at: string;
}

function normalizeErrorMessage(
  fallbackMessage: string,
  error: { message?: string | null } | null,
): string {
  const message = error?.message?.trim();
  return message || fallbackMessage;
}

function normalizeDbTime(value: string): string {
  return value.slice(0, 5);
}

function toDbTime(value: string): string {
  return /^\d{2}:\d{2}:\d{2}$/.test(value) ? value : `${value}:00`;
}

function mapPlanRow(row: PlanRow): Plan {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    subject: row.subject ?? '',
    date: row.date,
    startTime: normalizeDbTime(row.start_time),
    endTime: normalizeDbTime(row.end_time),
    type: row.type,
    memo: row.memo ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapActualRow(row: ActualRow): Actual {
  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    actualStartTime: normalizeDbTime(row.actual_start_time),
    actualEndTime: normalizeDbTime(row.actual_end_time),
    title: row.title ?? '',
    subject: row.subject ?? '',
    isAlignedToPlan: row.is_aligned_to_plan ?? true,
    note: row.note ?? '',
    updatedAt: row.updated_at,
  };
}

function mapDayNoteRow(row: DayNoteRow): DayNote {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    quickMemo: row.quick_memo ?? '',
    reflection: row.reflection ?? '',
    nextFocus: row.next_focus ?? '',
    checkedPlan: row.checked_plan ?? false,
    checkedRecord: row.checked_record ?? false,
    checkedReady: row.checked_ready ?? false,
    updatedAt: row.updated_at,
  };
}

function mapMonthEventRow(row: MonthEventRow): MonthEvent {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    title: row.title,
    startTime: normalizeDbTime(row.start_time),
    endTime: normalizeDbTime(row.end_time),
    repeat: row.repeat,
    repeatUntil: row.repeat_until,
    excludedDates: row.excluded_dates ?? [],
    url: row.url ?? '',
    memo: row.memo ?? '',
    checklist: row.checklist ?? [],
    locationTags: row.location_tags ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPlanRow(plan: Plan): PlanRow {
  return {
    id: plan.id,
    user_id: plan.userId,
    title: plan.title,
    subject: plan.subject,
    date: plan.date,
    start_time: toDbTime(plan.startTime),
    end_time: toDbTime(plan.endTime),
    type: plan.type,
    memo: plan.memo,
    created_at: plan.createdAt,
    updated_at: plan.updatedAt,
  };
}

function toActualRow(actual: Actual): ActualRow {
  return {
    id: actual.id,
    user_id: actual.userId,
    plan_id: actual.planId,
    actual_start_time: toDbTime(actual.actualStartTime),
    actual_end_time: toDbTime(actual.actualEndTime),
    title: actual.title ?? '',
    subject: actual.subject,
    is_aligned_to_plan: actual.isAlignedToPlan ?? true,
    note: actual.note,
    updated_at: actual.updatedAt,
  };
}

function toDayNoteRow(dayNote: DayNote): DayNoteRow {
  return {
    id: dayNote.id,
    user_id: dayNote.userId,
    date: dayNote.date,
    quick_memo: dayNote.quickMemo,
    reflection: dayNote.reflection,
    next_focus: dayNote.nextFocus,
    checked_plan: dayNote.checkedPlan,
    checked_record: dayNote.checkedRecord,
    checked_ready: dayNote.checkedReady,
    updated_at: dayNote.updatedAt,
  };
}

function toMonthEventRow(monthEvent: MonthEvent): MonthEventRow {
  return {
    id: monthEvent.id,
    user_id: monthEvent.userId,
    date: monthEvent.date,
    title: monthEvent.title,
    start_time: toDbTime(monthEvent.startTime),
    end_time: toDbTime(monthEvent.endTime),
    repeat: monthEvent.repeat,
    repeat_until: monthEvent.repeatUntil,
    excluded_dates: monthEvent.excludedDates,
    url: monthEvent.url,
    memo: monthEvent.memo,
    checklist: monthEvent.checklist,
    location_tags: monthEvent.locationTags,
    created_at: monthEvent.createdAt,
    updated_at: monthEvent.updatedAt,
  };
}

export function createSupabasePlannerRepository(
  supabaseClient: SupabaseClient,
): PlannerRepository {
  return {
    async getPlans(userId) {
      const { data, error } = await supabaseClient
        .from('plans')
        .select('*')
        .eq('user_id', userId)
        .order('date')
        .order('start_time');

      if (error) {
        throw new Error(normalizeErrorMessage('予定を取得できませんでした。', error));
      }

      return ((data as PlanRow[] | null) ?? []).map(mapPlanRow);
    },
    async getActuals(userId) {
      const { data, error } = await supabaseClient
        .from('actuals')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      if (error) {
        throw new Error(normalizeErrorMessage('実績を取得できませんでした。', error));
      }

      return ((data as ActualRow[] | null) ?? []).map(mapActualRow);
    },
    async getDayNotes(userId) {
      const { data, error } = await supabaseClient
        .from('day_notes')
        .select('*')
        .eq('user_id', userId)
        .order('date');

      if (error) {
        throw new Error(normalizeErrorMessage('日次メモを取得できませんでした。', error));
      }

      return ((data as DayNoteRow[] | null) ?? []).map(mapDayNoteRow);
    },
    async getMonthEvents(userId) {
      const { data, error } = await supabaseClient
        .from('month_events')
        .select('*')
        .eq('user_id', userId)
        .order('date')
        .order('start_time');

      if (error) {
        throw new Error(normalizeErrorMessage('主要予定を取得できませんでした。', error));
      }

      return ((data as MonthEventRow[] | null) ?? []).map(mapMonthEventRow);
    },
    async upsertPlan(plan) {
      const { data, error } = await supabaseClient
        .from('plans')
        .upsert(toPlanRow(plan))
        .select('*')
        .single();

      if (error || !data) {
        throw new Error(normalizeErrorMessage('予定を保存できませんでした。', error));
      }

      return mapPlanRow(data as PlanRow);
    },
    async deletePlan(userId, planId) {
      const { error: deleteActualsError } = await supabaseClient
        .from('actuals')
        .delete()
        .eq('user_id', userId)
        .eq('plan_id', planId);

      if (deleteActualsError) {
        throw new Error(
          normalizeErrorMessage('予定に紐づく実績を削除できませんでした。', deleteActualsError),
        );
      }

      const { error } = await supabaseClient
        .from('plans')
        .delete()
        .eq('user_id', userId)
        .eq('id', planId);

      if (error) {
        throw new Error(normalizeErrorMessage('予定を削除できませんでした。', error));
      }
    },
    async upsertActual(actual) {
      const { data, error } = await supabaseClient
        .from('actuals')
        .upsert(toActualRow(actual))
        .select('*')
        .single();

      if (error || !data) {
        throw new Error(normalizeErrorMessage('実績を保存できませんでした。', error));
      }

      return mapActualRow(data as ActualRow);
    },
    async deleteActual(userId, actualId) {
      const { error } = await supabaseClient
        .from('actuals')
        .delete()
        .eq('user_id', userId)
        .eq('id', actualId);

      if (error) {
        throw new Error(normalizeErrorMessage('実績を削除できませんでした。', error));
      }
    },
    async upsertDayNote(dayNote) {
      const { data, error } = await supabaseClient
        .from('day_notes')
        .upsert(toDayNoteRow(dayNote))
        .select('*')
        .single();

      if (error || !data) {
        throw new Error(normalizeErrorMessage('日次メモを保存できませんでした。', error));
      }

      return mapDayNoteRow(data as DayNoteRow);
    },
    async upsertMonthEvent(monthEvent) {
      const { data, error } = await supabaseClient
        .from('month_events')
        .upsert(toMonthEventRow(monthEvent))
        .select('*')
        .single();

      if (error || !data) {
        throw new Error(normalizeErrorMessage('主要予定を保存できませんでした。', error));
      }

      return mapMonthEventRow(data as MonthEventRow);
    },
    async deleteMonthEvent(userId, monthEventId) {
      const { error } = await supabaseClient
        .from('month_events')
        .delete()
        .eq('user_id', userId)
        .eq('id', monthEventId);

      if (error) {
        throw new Error(normalizeErrorMessage('主要予定を削除できませんでした。', error));
      }
    },
  };
}
