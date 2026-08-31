import type { PlannerRepository, AuthRepository } from './repositoryContracts';

const PRODUCTION_CONFIGURATION_MESSAGE =
  '本番設定が不完全です。管理者に連絡してください。';

function createConfigurationError(): Error {
  return new Error(PRODUCTION_CONFIGURATION_MESSAGE);
}

export function createUnavailableAuthRepository(): AuthRepository {
  return {
    async signUpWithPassword() {
      throw createConfigurationError();
    },
    async signInWithPassword() {
      throw createConfigurationError();
    },
    async signInWithGoogle() {
      throw createConfigurationError();
    },
    async sendPasswordReset() {
      throw createConfigurationError();
    },
    async getCurrentUser() {
      throw createConfigurationError();
    },
    async updateUserProfile() {
      throw createConfigurationError();
    },
    async signOut() {
      return;
    },
  };
}

export function createUnavailablePlannerRepository(): PlannerRepository {
  return {
    async getPlans() {
      return [];
    },
    async getActuals() {
      return [];
    },
    async getDayNotes() {
      return [];
    },
    async getMonthEvents() {
      return [];
    },
    async getTodos() {
      return [];
    },
    async getStudySubjects() {
      return [];
    },
    async getStudyMaterials() {
      return [];
    },
    async getScheduleTemplates() {
      return [];
    },
    async getTimetableTerms() {
      return [];
    },
    async getTimetablePeriods() {
      return [];
    },
    async applyRecurringPlanMutation() {
      throw createConfigurationError();
    },
    async deletePlanWithDependents() {
      throw createConfigurationError();
    },
    async restorePlanWithDependents() {
      throw createConfigurationError();
    },
    async scheduleTodoPlan() {
      throw createConfigurationError();
    },
    async upsertActualWithMaterialProgress() {
      throw createConfigurationError();
    },
    async upsertStudySubjectWithMaterials() {
      throw createConfigurationError();
    },
    async applyTimetableMutation() {
      throw createConfigurationError();
    },
    async upsertPlan() {
      throw createConfigurationError();
    },
    async deletePlan() {
      throw createConfigurationError();
    },
    async upsertActual() {
      throw createConfigurationError();
    },
    async deleteActual() {
      throw createConfigurationError();
    },
    async upsertDayNote() {
      throw createConfigurationError();
    },
    async upsertMonthEvent() {
      throw createConfigurationError();
    },
    async deleteMonthEvent() {
      throw createConfigurationError();
    },
    async upsertTodo() {
      throw createConfigurationError();
    },
    async deleteTodo() {
      throw createConfigurationError();
    },
    async upsertStudySubject() {
      throw createConfigurationError();
    },
    async deleteStudySubject() {
      throw createConfigurationError();
    },
    async upsertStudyMaterial() {
      throw createConfigurationError();
    },
    async updateStudyMaterialProgress() {
      throw createConfigurationError();
    },
    async deleteStudyMaterial() {
      throw createConfigurationError();
    },
    async upsertScheduleTemplate() {
      throw createConfigurationError();
    },
    async deleteScheduleTemplate() {
      throw createConfigurationError();
    },
    async upsertTimetableTerm() {
      throw createConfigurationError();
    },
    async deleteTimetableTerm() {
      throw createConfigurationError();
    },
    async upsertTimetablePeriod() {
      throw createConfigurationError();
    },
    async deleteTimetablePeriod() {
      throw createConfigurationError();
    },
  };
}
