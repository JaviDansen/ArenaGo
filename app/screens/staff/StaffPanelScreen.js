import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import StaffButton from './components/StaffButton';
import StaffConfirmDialog from './components/StaffConfirmDialog';
import StaffMissingSession from './components/StaffMissingSession';
import StaffScreen from './components/StaffScreen';
import { staffColors } from './components/staffTheme';
import { useStaffDemo } from './StaffDemoContext';
import { getExperienceSummary } from './staffDemoState';

// Painel Operacional (SV01, print 02): identificação do evento, Controle de
// Entrada, experiências com contadores fictícios e troca de evento.
export default function StaffPanelScreen({ navigation }) {
  const { session, leaveEvent } = useStaffDemo();
  const [isSwitching, setIsSwitching] = useState(false);

  if (!session) {
    return (
      <StaffMissingSession
        title="Nenhum evento selecionado"
        message="Informe um código de evento de demonstração para abrir o painel."
        actionLabel="IR PARA A ÁREA DO STAFF"
        onAction={() => navigation.replace('StaffAccess')}
      />
    );
  }

  const { entryQueue } = session;

  function handleSwitchEvent() {
    setIsSwitching(false);
    leaveEvent();
    navigation.replace('StaffAccess');
  }

  return (
    <StaffScreen title="Painel Operacional" subtitle={`${session.name} · ${session.code}`}>
      <Text style={styles.intro}>
        Selecione onde você vai atuar. As áreas abaixo são as configuradas para este evento.
      </Text>

      <StaffButton
        label="🚪 Controle de Entrada"
        accessibilityLabel={`Controle de Entrada, fila ${entryQueue.active ? 'ativa' : 'inativa'}, ${entryQueue.waiting.length} aguardando`}
        onPress={() => navigation.navigate('StaffEntryControl')}
      />

      <Text style={styles.sectionTitle} accessibilityRole="header">Estações do evento</Text>

      {session.experiences.map((experience) => {
        const summary = getExperienceSummary(experience);
        const counters = `(${summary.pendingCalls} chamado · ${summary.queueSize} na fila)`;
        // Abre a primeira estação disponível; a troca entre estações fica na própria tela.
        const firstStation = experience.stations.find((station) => station.available)
          ?? experience.stations[0];
        return (
          <StaffButton
            key={experience.id}
            variant="secondary"
            label={`${experience.icon ?? ''} ${experience.name} ${counters}`.trim()}
            accessibilityLabel={`Abrir ${experience.name}, ${summary.pendingCalls} chamado, ${summary.queueSize} na fila`}
            onPress={() => navigation.navigate('StaffStation', {
              experienceId: experience.id,
              stationId: firstStation?.id,
            })}
          />
        );
      })}

      <StaffButton label="↩ Trocar de evento" variant="secondary" onPress={() => setIsSwitching(true)} />

      <StaffConfirmDialog
        visible={isSwitching}
        title="Trocar de evento?"
        message="A seleção e as alterações simuladas deste evento serão descartadas."
        confirmLabel="TROCAR DE EVENTO"
        onConfirm={handleSwitchEvent}
        onCancel={() => setIsSwitching(false)}
      />
    </StaffScreen>
  );
}

const styles = StyleSheet.create({
  intro: { color: staffColors.muted, fontSize: 13, lineHeight: 19, marginTop: 12 },
  sectionTitle: { color: staffColors.text, fontSize: 18, fontWeight: 'bold', marginTop: 24 },
});
