import { proposalResponsePolicyFingerprints } from '../workers/ai-proxy/src/decision/evaluation/proposalResponsePolicyFingerprint';

console.log(JSON.stringify(await proposalResponsePolicyFingerprints()));
