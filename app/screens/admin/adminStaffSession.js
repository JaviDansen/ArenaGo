import { grantEventStaff, revokeEventStaff } from '../../services/adminEventSetupService';
import { adminIdentifier } from '../../services/adminEventsService';
import { canAccessAdminArea } from '../../context/adminAccess';
import { staffEmail } from './adminCreationForm';

const messages = {
  RESOURCE_NOT_FOUND: 'O recurso solicitado não está disponível.',
  ROLE_TARGET_INELIGIBLE: 'A conta precisa estar ativa e ter e-mail verificado.',
  ROLE_ALREADY_GRANTED: 'O acesso Staff já está concedido neste evento.',
  ADMIN_REQUIRED: 'É necessário acesso administrativo.',
  ADMIN_2FA_REQUIRED: 'Confirme o segundo fator administrativo.',
  ADMIN_EMAIL_UNVERIFIED: 'Verifique o e-mail da conta administrativa.',
  ACCOUNT_DEACTIVATED: 'A conta foi desativada.',
  INVALID_SESSION: 'Sessão inválida. Entre novamente.',
  SESSION_REVOKED: 'Sessão encerrada. Entre novamente.',
  SESSION_EXPIRED: 'Sessão expirada. Entre novamente.',
  IDEMPOTENCY_KEY_REUSED: 'Conflito de chave. Confira a operação com o responsável.',
};

const unavailableGrant = 'Não foi possível confirmar o estado desta concessão. O vínculo ou o evento pode não estar disponível.';

export function bindStaffSession(manager, newKey, isProviderActive = () => true) {
  let entry;
  function scope() {
    if (!isProviderActive()) return null;
    const auth = manager.getSnapshot();
    const { user } = auth;
    if (!auth.isAuthenticated || !user?.id || !user.sessionId || !Array.isArray(user.roles) || !user.roles.includes('admin') ||
        user.emailVerified !== true || auth.adminChallenge) return null;
    const verified = canAccessAdminArea({ ...auth, isIdentityVerified: manager.isIdentityVerified });
    const suspended = auth.isInitializing || ['checking', 'error'].includes(auth.identityStatus);
    if (!verified && !suspended) return null;
    return { userId: user.id, sessionId: user.sessionId, epoch: manager.getSessionEpoch(), client: manager.client, verified };
  }
  function matches(expected, live) {
    return live && expected.userId === live.userId && expected.sessionId === live.sessionId &&
      expected.epoch === live.epoch && expected.client === live.client;
  }
  function sync() {
    const live = scope();
    if (entry && !matches(entry, live)) entry = null;
    return live;
  }
  return {
    sync,
    get() {
      const live = sync();
      if (!live?.verified) return null;
      if (!entry) {
        const owner = live;
        const current = () => entry === owner && matches(owner, scope());
        owner.store = createStaffSession(owner.client, newKey, () => current() && scope().verified, {
          canSettle: current,
          revision: manager.getIdentityRevision,
          renew: revision => {
            if (!current() || manager.getIdentityRevision() !== revision) return;
            return manager.refreshSession();
          },
        });
        entry = owner;
      }
      return entry.store;
    },
  };
}

export function createStaffSession(client, newKey, isCurrent, { canSettle = isCurrent, revision, renew } = {}) {
  const events = new Map();
  const listeners = new Set();
  let denied = '';

  function publish(eventId, refresh = false) {
    if (!isCurrent()) return;
    return Promise.all([...listeners].map(listener => listener(eventId, refresh)));
  }
  function snapshot(id) {
    if (!isCurrent()) return { grants: [], attempts: [], feedback: [], denied: '' };
    const event = events.get(id);
    return { grants: event ? [...event.grants.values()] : [], attempts: event ? [...event.intents.values()] : [],
      feedback: event ? [...event.feedback.values()] : [], denied };
  }
  async function send(eventId, kind, target, recovery, listedGrant) {
    if (!isCurrent() || denied || !['grant', 'revoke'].includes(kind)) return;
    adminIdentifier(eventId);
    if (!events.has(eventId)) events.set(eventId, { grants: new Map(), intents: new Map(), feedback: new Map() });
    const event = events.get(eventId);
    const grant = kind === 'revoke' ? (recovery?.grant ?? listedGrant ?? event.grants.get(target)) : null;
    if (kind === 'revoke' && (!grant || grant.id !== target || grant.role !== 'staff' || grant.eventId !== eventId ||
        grant.revokedAt !== null || (grant.unconfirmed && !recovery))) return;
    const email = grant ? grant.email : staffEmail(target);
    const slot = kind + ':' + (grant?.id ?? email);
    const previous = event.intents.get(slot);
    const observedAgain = listedGrant && previous?.status === 'unavailable';
    if (recovery ? previous !== recovery || recovery.status !== 'unknown' : previous && !observedAgain) return;
    const record = Object.freeze({ kind, target: grant?.id ?? email, email, key: recovery?.key ?? newKey(), status: 'sending',
      ...(grant ? { grant: Object.freeze({ ...grant }) } : {}) });
    const requestRevision = revision?.();
    let grantId = grant?.id;
    function report(message, tone = 'warning') {
      const feedbackId = grantId ? kind + ':' + grantId : slot;
      event.feedback.delete(feedbackId);
      event.feedback.set(feedbackId, Object.freeze({ id: feedbackId, eventId, grantId, kind,
        email, intentKey: record.key, retry: Boolean(recovery), message, tone }));
    }
    const current = () => canSettle() && !denied && event.intents.get(slot) === record;
    const track = status => event.intents.set(slot, Object.freeze({ ...record, status }));
    event.intents.set(slot, record);
    event.feedback.delete(slot);
    publish(eventId);

    try {
      if (!current()) return;
      if (!isCurrent()) { track('unknown'); return; }
      if (grant) {
        await revokeEventStaff(client, eventId, grant, record.key);
        if (!current()) return;
        event.grants.delete(grant.id);
        event.feedback.delete('grant:' + grant.id);
      } else {
        const result = await grantEventStaff(client, eventId, email, record.key);
        if (!current()) return;
        const { id, userId, role, grantedAt, revokedAt } = result;
        const known = event.grants.get(id);
        if (known && known.userId !== userId) throw new Error('Vínculo Staff divergente.');
        event.grants.set(id, Object.freeze({ id, userId, role, eventId, grantedAt, revokedAt, email }));
        grantId = id;
      }
    } catch (error) {
      if (!current()) return;
      if (error?.status === 401 && error.code === 'ACCESS_TOKEN_EXPIRED') {
        track('unknown');
        report('O token expirou. Repita a mesma solicitação após a revalidação da sessão.');
        publish(eventId);
        try { await renew?.(requestRevision); } catch { /* A autenticação exibe o estado da renovação. */ }
        return;
      }
      if ([401, 403].includes(error?.status)) {
        denied = messages[error.code] || 'Acesso administrativo indisponível. Entre novamente.';
        events.clear();
        publish(null);
        return;
      }
      if (grant && error?.status === 404) {
        if (event.grants.has(grant.id)) event.grants.set(grant.id, Object.freeze({ ...grant, unconfirmed: true }));
        if (listedGrant && !recovery) event.intents.delete(slot);
        else track(recovery ? 'unknown' : 'unavailable');
        event.feedback.delete('grant:' + grant.id);
        report(unavailableGrant);
        await publish(eventId, true);
        return;
      }
      const conflict = error?.code === 'IDEMPOTENCY_KEY_REUSED';
      const notSent = error?.isNetworkError && !error.outcomeUnknown && error.cause?.requestNotSent === true;
      const unknown = (!error?.status && !notSent) || error?.outcomeUnknown || error?.status >= 500 || error?.status === 408 ||
        error.code === 'IDEMPOTENCY_IN_PROGRESS' || Boolean(recovery);
      if (unknown || conflict) track(conflict ? 'conflict' : 'unknown');
      else event.intents.delete(slot);
      report(conflict ? messages[error.code] : unknown ?
        'Resultado não confirmado. Repita a mesma solicitação para consultar o resultado.' :
        notSent ? 'O envio não foi iniciado. Tente novamente.' : messages[error?.code] || 'A operação foi recusada. Confira os dados.');
      publish(eventId, error?.code === 'ROLE_ALREADY_GRANTED');
      return;
    }

    event.intents.delete(slot);
    report(grant ? 'Revogação confirmada.' : 'Concessão confirmada.', 'success');
    await publish(eventId, true);
    return true;
  }
  return {
    snapshot, send,
    revokeListed(eventId, grant) { return send(eventId, 'revoke', grant.id, undefined, grant); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
