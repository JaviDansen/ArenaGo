// A sessão só é publicada após o fluxo real de login/segundo fator e GET /auth/me.
// Não inferir TOTP de dados locais nem de parâmetros de navegação.
export function canAccessAdminArea(auth) {
  const roles = auth?.user?.roles;
  return Boolean(
    auth?.isAuthenticated && !auth.isInitializing &&
    auth.sessionStatus === 'authenticated' && auth.identityStatus === 'verified' &&
    !auth.adminChallenge && auth.user?.id && auth.user?.sessionId &&
    Array.isArray(roles) && roles.includes('admin') &&
    roles.every((role) => ['admin', 'staff', 'participante'].includes(role)) &&
    typeof auth.isIdentityVerified === 'function' && auth.isIdentityVerified() === true
  );
}
