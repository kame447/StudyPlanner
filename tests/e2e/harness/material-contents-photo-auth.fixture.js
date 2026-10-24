// Test-only synthetic authentication. No production build imports this module.
export function getFirebaseAuth() { return { currentUser: { uid: 'photo-ui-owner', getIdToken: async () => 'synthetic-photo-ui-token' } }; }
export function getCloudflareAiProxyUrl() { return 'http://127.0.0.1:4174'; }
