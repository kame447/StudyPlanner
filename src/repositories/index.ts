import { createLocalAuthRepository } from './authRepository';
import { createLocalPlannerRepository } from './plannerRepository';

export const authRepository = createLocalAuthRepository();
export const plannerRepository = createLocalPlannerRepository();
