import { StyleSheet, Text, View } from 'react-native';

import { liveColors as c } from '../../admin/components/AdminLiveUI';

const ENTRY_REJECTION_MESSAGES = {
  ENTRY_NOT_FIRST: 'A fila mudou. Confira o primeiro participante na lista atualizada.',
  ENTRY_QUEUE_EMPTY: 'A fila externa está vazia. Nenhum participante aguarda chamada.',
  ENTRY_CALL_PENDING: 'Já existe uma chamada externa pendente neste evento. Resolva-a antes de chamar o próximo.',
  ENTRY_CALL_REQUIRED: 'É necessário chamar um participante antes de executar esta ação.',
  ENTRY_CALL_NOT_PENDING: 'A chamada externa já não está pendente. Confira o estado atualizado.',
  EVENT_ENTRY_UNAVAILABLE: 'A operação na fila externa não é permitida no estado atual do evento.',
  STAFF_EVENT_FORBIDDEN: 'O acesso a este evento não está disponível.',
  FORBIDDEN: 'O acesso a este evento não está disponível.',
  SESSION_REVOKED: 'Sessão inválida. Entre novamente para continuar.',
  UNAUTHORIZED: 'Sessão inválida. Entre novamente para continuar.',
};

const STATION_REJECTION_MESSAGES = {
  QUEUE_EMPTY: 'A fila da experiência está vazia. Nenhum participante aguarda chamada.',
  STATION_UNAVAILABLE: 'A estação não está disponível para esta operação.',
  STATION_HAS_PENDING_CALL: 'Esta estação já possui um atendimento pendente. Resolva-o antes de chamar o próximo.',
  SERVICE_NOT_PENDING: 'A chamada já não está pendente. Atualize o atendimento antes de decidir a próxima ação.',
  EVENT_OPERATION_ENDED: 'A operação não é permitida no estado atual do evento.',
  QUEUE_ENTRY_NOT_WAITING: 'A fila mudou. Confira o próximo participante antes de continuar.',
  STAFF_EVENT_FORBIDDEN: 'O acesso a este evento não está disponível.',
  FORBIDDEN: 'O acesso a este evento não está disponível.',
  SESSION_REVOKED: 'Sessão inválida. Entre novamente para continuar.',
  UNAUTHORIZED: 'Sessão inválida. Entre novamente para continuar.',
};

export function resolveStaffPollingIndicator({
  hidden = false,
  verifying = false,
  loading = false,
  pollingEnabled = false,
  visible = true,
  stale = false,
  recoverableError = false,
  unavailableError = false,
  intervalSeconds = 5,
}) {
  if (hidden) return null;
  if (verifying) {
    return {
      tone: 'muted',
      text: 'Atualização indisponível · verificando autorização',
    };
  }
  if (loading) {
    return {
      tone: 'stale',
      text: 'Atualização temporariamente pausada · carregamento em andamento',
    };
  }
  if (stale) {
    if (!pollingEnabled || !visible) {
      return {
        tone: 'stale',
        text: 'Dados desatualizados · atualização temporariamente pausada',
      };
    }
    return {
      tone: 'stale',
      text: `Dados desatualizados · tentando atualizar a cada ${intervalSeconds}s`,
    };
  }
  if (recoverableError) {
    if (pollingEnabled && visible) {
      return {
        tone: 'muted',
        text: `Atualização indisponível · aguardando recuperação (a cada ${intervalSeconds}s)`,
      };
    }
    if (!visible) {
      return {
        tone: 'stale',
        text: 'Atualização temporariamente pausada',
      };
    }
    return {
      tone: 'muted',
      text: 'Atualização indisponível · aguardando recuperação',
    };
  }
  if (unavailableError) {
    return {
      tone: 'muted',
      text: 'Atualização indisponível · aguardando recuperação',
    };
  }
  if (!pollingEnabled || !visible) {
    return {
      tone: 'stale',
      text: 'Atualização temporariamente pausada',
    };
  }
  return {
    tone: 'active',
    text: `Atualização automática ativa · a cada ${intervalSeconds}s`,
  };
}

export function describeEntryConfirmed(operation, result) {
  const kind = typeof operation === 'string' ? operation : operation?.kind;
  if (kind === 'toggle') {
    if (result?.externalQueueEnabled === true) {
      return 'Fila externa reativada pelo servidor.';
    }
    if (result?.externalQueueEnabled === false && Number.isSafeInteger(result?.releasedCount)) {
      return `Fila externa desativada pelo servidor. Participantes liberados: ${result.releasedCount}.`;
    }
    return 'Estado da fila externa atualizado pelo servidor.';
  }
  if (kind === 'call') return 'Participante chamado pelo servidor.';
  if (kind === 'confirm_call') return 'Entrada confirmada pelo servidor.';
  if (kind === 'absent') {
    if (result?.requeued === true) {
      return 'Ausência registrada pelo servidor. Participante retornou ao fim da fila externa.';
    }
    if (result?.requeued === false) {
      return 'Ausência registrada pelo servidor. Após o corte de entrada, o participante não retornou à fila externa.';
    }
    return 'Ausência registrada pelo servidor.';
  }
  if (kind === 'remove') return 'Participante removido da fila externa pelo servidor.';
  return 'Operação confirmada pelo servidor.';
}

export function describeEntryRejection(code) {
  if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(ENTRY_REJECTION_MESSAGES, code)) {
    return ENTRY_REJECTION_MESSAGES[code];
  }
  return 'Operação recusada pelo servidor. Atualize o estado antes de tentar novamente.';
}

export function describeEntryNotice(notice) {
  if (!notice?.outcome) return null;
  if (notice.outcome.kind === 'confirmed') {
    return describeEntryConfirmed(notice.operation, notice.outcome.result);
  }
  if (notice.outcome.kind === 'rejected') {
    return describeEntryRejection(notice.outcome.code);
  }
  return 'Operação finalizada pelo servidor.';
}

export function describeStationConfirmed(result) {
  if (result?.status === 'absent') {
    return result.requeued
      ? 'Ausência registrada; participante retornou ao fim da fila.'
      : 'Ausência registrada; participante não retornou à fila após o corte.';
  }
  if (result?.status === 'pending') {
    return 'Participante chamado. Operação confirmada pelo servidor.';
  }
  if (result?.status === 'completed') {
    return 'Atendimento concluído. Operação confirmada pelo servidor.';
  }
  if (result?.status === 'canceled') {
    return 'Participante removido da fila. Operação confirmada pelo servidor.';
  }
  return 'Operação confirmada pelo servidor.';
}

export function describeStationRejection(code) {
  if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(STATION_REJECTION_MESSAGES, code)) {
    return STATION_REJECTION_MESSAGES[code];
  }
  return 'Operação recusada pelo servidor. Atualize o atendimento antes de decidir a próxima ação.';
}

export function describeStationFeedback(feedback) {
  if (!feedback) return null;
  if (feedback.kind === 'confirmed') {
    return { tone: 'success', text: describeStationConfirmed(feedback.result) };
  }
  if (feedback.kind === 'rejected') {
    if (feedback.phase === 'precondition' && feedback.network && !feedback.code) {
      return {
        tone: 'warning',
        text: 'Falha de conexão ao verificar a operação. Nenhuma alteração foi enviada. Atualize o atendimento antes de tentar novamente.',
      };
    }
    return { tone: 'warning', text: describeStationRejection(feedback.code) };
  }
  if (feedback.kind === 'blocked') {
    return {
      tone: 'warning',
      text: 'O estado operacional mudou antes do envio. Confira os dados atualizados antes de continuar.',
    };
  }
  if (feedback.kind === 'confirmed_cleanup_pending') {
    return {
      tone: 'warning',
      text: 'Resultado confirmado pelo servidor, mas o reconhecimento local ainda não foi concluído. Não repita a operação; atualize o atendimento.',
    };
  }
  if (feedback.kind === 'rejected_cleanup_pending') {
    return {
      tone: 'warning',
      text: 'Recusa registrada pelo servidor, mas o reconhecimento local ainda não foi concluído. Não repita a operação; atualize o atendimento.',
    };
  }
  if (feedback.kind === 'storage_error') {
    return {
      tone: 'warning',
      text: 'Armazenamento seguro indisponível para proteger esta operação. Atualize o atendimento antes de tentar novamente.',
    };
  }
  if (feedback.kind === 'uncertain' || feedback.kind === 'pending_reconciliation') {
    return {
      tone: 'warning',
      text: 'Não foi possível confirmar o resultado desta operação. O resultado exige verificação ou reconciliação. Não repita a operação. Atualize os dados e, se a situação persistir, procure o responsável.',
    };
  }
  return null;
}

export function StaffPollingStatusPill({ indicator }) {
  if (!indicator) return null;
  const dotStyle = indicator.tone === 'active'
    ? styles.pollingDotActive
    : indicator.tone === 'stale'
      ? styles.pollingDotStale
      : styles.pollingDotMuted;
  return (
    <View style={styles.pollingRow}>
      <View style={[styles.pollingDot, dotStyle]} />
      <Text style={styles.pollingText}>{indicator.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pollingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  pollingDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  pollingDotActive: { backgroundColor: '#10B981' },
  pollingDotStale: { backgroundColor: '#F59E0B' },
  pollingDotMuted: { backgroundColor: '#64748B' },
  pollingText: { color: c.muted, fontSize: 13, lineHeight: 18, flex: 1 },
});
