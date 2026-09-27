import { temporalSideContributionPolicyFingerprints } from '../workers/ai-proxy/src/decision/evaluation/temporalSideContributionPolicyFingerprint';

console.log(JSON.stringify(await temporalSideContributionPolicyFingerprints()));
