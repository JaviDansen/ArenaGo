// Snapshot de identidade confirmada; não simula nem executa criptografia/TOTP.
function verifiedAdminAuth(overrides = {}) {
  const auth = {
    isAuthenticated: true,
    isInitializing: false,
    sessionStatus: 'authenticated',
    identityStatus: 'verified',
    adminChallenge: null,
    getSessionEpoch: () => 1,
    getIdentityRevision: () => 1,
    ...overrides,
    user: { id: 'u-1', name: 'Conta Teste', roles: ['admin'],
      sessionId: '10000000-0000-4000-8000-000000000001', hasCompletedQuestionnaire: true,
      ...overrides.user },
  };
  auth.isIdentityVerified = overrides.isIdentityVerified ?? (() =>
    auth.isAuthenticated && !auth.isInitializing && auth.identityStatus === 'verified');
  return auth;
}

module.exports = { verifiedAdminAuth };
