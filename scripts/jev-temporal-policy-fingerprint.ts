import { temporalScopeRepairPolicyFingerprints } from '../workers/ai-proxy/src/decision/evaluation/temporalScopeRepairPolicyFingerprint';

console.log(JSON.stringify(await temporalScopeRepairPolicyFingerprints()));
