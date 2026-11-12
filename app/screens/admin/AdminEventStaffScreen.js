import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import AdminButton from './components/AdminButton';
import AdminCard from './components/AdminCard';
import AdminConfirmDialog from './components/AdminConfirmDialog';
import AdminDemoTools from './components/AdminDemoTools';
import AdminField from './components/AdminField';
import AdminMissing from './components/AdminMissing';
import AdminNotice from './components/AdminNotice';
import AdminScreen from './components/AdminScreen';
import { adminColors } from './components/adminTheme';
import { useAdminDemo } from './AdminDemoContext';
import {
  describeEvent,
  findAccount,
  findEvent,
  getAccountIssue,
  getEventStaff,
  getStructureRules,
  grantStaff,
  revokeStaff,
  searchAccounts,
} from './adminDemoState';
import { useAdminAction } from './useAdminAction';

const ownParam = (params, key) =>
  (params != null && Object.prototype.hasOwnProperty.call(params, key) ? params[key] : undefined);

function accountStatus(account) {
  return `${account.active ? 'Conta ativa' : 'Conta inativa'} · ${account.emailVerified ? 'e-mail verificado' : 'e-mail não verificado'}`;
}

// Staff do evento (ADM02, D04): vínculo POR EVENTO, nunca por estação, só para
// contas JÁ EXISTENTES. Tudo é simulado: não altera papéis reais da conta
// conectada, não cria contas e não dá acesso real à Área Staff.
export default function AdminEventStaffScreen({ navigation, route }) {
  const { session, run } = useAdminDemo();
  const eventId = ownParam(route?.params, 'eventId');
  const event = session ? findEvent(session, eventId) : null;
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const action = useAdminAction(run);

  if (!event) {
    return (
      <AdminMissing title="Evento não encontrado" message="Volte e escolha um evento." actionLabel="VOLTAR" onAction={() => navigation.goBack()} />
    );
  }

  const info = describeEvent(event, session.clockNow, session);
  const rules = getStructureRules(session, event);
  const staff = getEventStaff(session, event.id);
  const aptCount = staff.filter((item) => item.apt).length;
  const results = searchAccounts(session, query);
  const selected = selectedId ? findAccount(session, selectedId) : null;
  const selectedIsStaff = Boolean(selected) && staff.some((item) => item.account?.id === selected.id);
  const selectedIssue = selected ? (getAccountIssue(selected) ?? (selectedIsStaff ? 'Já é Staff deste evento' : null)) : null;
  const grantFeedback = action.feedbackFor('grant');
  const revokeFeedback = action.feedbackFor('revoke');

  function handleGrant() {
    if (action.busy || !selected || selectedIssue) return;
    action.review({
      kind: 'grant',
      transition: grantStaff,
      args: [event.id, { email: selected.email }],
      email: selected.email,
    });
  }

  function handleRevoke(item) {
    if (action.busy) return;
    // Revogar o último Staff apto é permitido (C-14); o aviso só explica o efeito.
    const lastApt = item.apt && aptCount === 1;
    action.review({
      kind: 'revoke',
      transition: revokeStaff,
      args: [event.id, { grantId: item.grant.id }],
      email: item.email,
      lastApt,
    });
  }

  const pending = action.snapshot;
  const dialog = pending?.kind === 'grant'
    ? {
      title: 'Conceder Staff neste evento?',
      message: `${pending.email}\nEvento: ${event.name}`,
      note: 'Vale somente para este evento (todas as experiências e estações dele). Simulação local: nenhum papel real é alterado.',
      confirmLabel: 'CONCEDER STAFF',
      variant: 'primary',
    }
    : {
      title: 'Revogar este Staff?',
      message: pending ? `${pending.email}\nEvento: ${event.name}` : '',
      note: pending?.lastApt
        ? 'É o último Staff apto: novas participações ficarão suspensas, mas o evento NÃO será encerrado e ninguém perde a vez.'
        : 'A revogação vale somente para este evento.',
      confirmLabel: 'REVOGAR STAFF',
      variant: 'danger',
    };

  return (
    <AdminScreen
      title="Staff"
      highlight="do Evento"
      subtitle={`${event.name} · ${event.accessCode}`}
      backLabel="Evento"
      onBack={() => navigation.goBack()}
    >
      <AdminCard>
        <Text style={styles.line}>
          Staff é autorizado por evento: opera todas as experiências e estações deste evento, sem vínculo fixo com estação.
        </Text>
        <Text style={styles.line}>Staff apto (conta ativa e e-mail verificado): {aptCount}</Text>
        <Text style={styles.warning}>
          Concessões e revogações aqui são simuladas: não mudam os papéis da sua conta nem dão acesso real à Área Staff.
        </Text>
        {info.capacitySuspended ? (
          <Text style={styles.warning}>O evento está aberto, mas com novas participações suspensas por falta de capacidade.</Text>
        ) : null}
      </AdminCard>

      <Text style={styles.sectionTitle} accessibilityRole="header">Vínculos vigentes</Text>
      {staff.length === 0 ? (
        <AdminNotice tone="neutral" title="Nenhum Staff vinculado a este evento" message="Sem Staff apto o evento não fica pronto e, se já estiver aberto, não aceita novas participações." />
      ) : null}
      {staff.map((item) => (
        <AdminCard key={item.grant.id}>
          <Text style={styles.name}>{item.email}</Text>
          <Text style={item.apt ? styles.ok : styles.warning}>
            {item.apt ? 'Apto ✓ (conta ativa e e-mail verificado)' : `${item.issue}: não conta para a prontidão`}
          </Text>
          <AdminButton
            compact
            variant="danger"
            label="Revogar"
            accessibilityLabel={`Revogar Staff de ${item.email}`}
            disabled={action.busy || !rules.revokeStaff.allowed}
            onPress={() => handleRevoke(item)}
          />
        </AdminCard>
      ))}
      {revokeFeedback ? (
        <AdminNotice
          tone={revokeFeedback.tone}
          title={revokeFeedback.tone === 'success' ? 'Staff revogado' : 'Não foi possível revogar'}
          message={revokeFeedback.text}
        />
      ) : null}

      <Text style={styles.sectionTitle} accessibilityRole="header">Conceder Staff</Text>
      {rules.grantStaff.allowed ? (
        <>
          <AdminField
            label="Buscar conta por e-mail"
            hint="Somente contas que já existem. Esta tela não cria contas."
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              if (grantFeedback && grantFeedback.tone === 'error') action.clearFeedback();
            }}
            placeholder="Ex.: diego"
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!action.busy}
          />
          {results.length === 0 ? (
            <AdminNotice tone="neutral" title="Nenhuma conta encontrada" message="Nenhuma conta existente tem esse e-mail. Contas não são criadas por aqui." />
          ) : null}
          {results.map((account) => {
            const isStaff = staff.some((item) => item.account?.id === account.id);
            return (
              <AdminCard
                key={account.id}
                accent={selected?.id === account.id}
                onPress={action.busy ? undefined : () => {
                  setSelectedId(account.id);
                  if (grantFeedback && grantFeedback.tone === 'error') action.clearFeedback();
                }}
                accessibilityLabel={`Selecionar ${account.email}`}
              >
                <Text style={styles.name}>{account.email}</Text>
                <Text style={styles.line}>{accountStatus(account)}</Text>
                {isStaff ? <Text style={styles.ok}>Já é Staff deste evento</Text> : null}
              </AdminCard>
            );
          })}
          {selected ? (
            <View style={styles.selectedBox}>
              <Text style={styles.name}>Selecionada: {selected.email}</Text>
              <Text style={styles.line}>{accountStatus(selected)}</Text>
              {selectedIssue ? (
                <AdminNotice
                  tone="warning"
                  title="Concessão indisponível"
                  message={selectedIssue === 'Já é Staff deste evento'
                    ? 'Esta conta já é Staff deste evento.'
                    : `${selectedIssue}: a concessão de Staff exige conta ativa e e-mail verificado.`}
                />
              ) : null}
              <AdminButton
                label={action.saving === 'grant' ? 'CONCEDENDO...' : 'CONCEDER STAFF NESTE EVENTO'}
                loading={action.saving === 'grant'}
                disabled={action.busy || Boolean(selectedIssue)}
                onPress={handleGrant}
              />
            </View>
          ) : (
            <Text style={styles.muted}>Toque em uma conta para selecioná-la.</Text>
          )}
        </>
      ) : (
        <AdminNotice tone="warning" title="Concessão indisponível" message={rules.grantStaff.message} />
      )}
      {grantFeedback ? (
        <AdminNotice
          tone={grantFeedback.tone}
          title={grantFeedback.tone === 'success' ? 'Staff concedido' : 'Não foi possível conceder'}
          message={grantFeedback.text}
        />
      ) : null}

      <AdminButton label="Voltar ao evento" variant="secondary" disabled={action.busy} onPress={() => navigation.goBack()} />

      <AdminDemoTools disabled={action.busy} />

      <AdminConfirmDialog
        visible={action.dialog.visible}
        title={dialog.title}
        message={dialog.message}
        note={dialog.note}
        confirmLabel={dialog.confirmLabel}
        variant={dialog.variant}
        onConfirm={action.dialog.onConfirm}
        onCancel={action.dialog.onCancel}
      />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  name: { color: adminColors.text, fontSize: 15, fontWeight: 'bold' },
  sectionTitle: { color: adminColors.text, fontSize: 18, fontWeight: 'bold', marginTop: 24 },
  line: { color: adminColors.text, fontSize: 13, lineHeight: 19, marginTop: 4 },
  muted: { color: adminColors.muted, fontSize: 13, lineHeight: 19, marginTop: 8 },
  ok: { color: adminColors.success, fontSize: 13, lineHeight: 19, marginTop: 4 },
  warning: { color: adminColors.warning, fontSize: 13, lineHeight: 19, marginTop: 6 },
  selectedBox: {
    borderColor: adminColors.accent,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
});
