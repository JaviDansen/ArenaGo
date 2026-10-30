/**
 * ArenaGo Design System — Tela Isolada de Demonstração Visual (UI-01 Preview)
 * Ambiente de showcase isolado fora da navegação principal (não altera telas funcionais).
 */

import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import colors from '../../theme/colors.js';
import spacing from '../../theme/spacing.js';
import typography from '../../theme/typography.js';
import { Badge } from './Badge.js';
import { Button } from './Button.js';
import { Card } from './Card.js';
import { InputField } from './InputField.js';
import { ScreenHeader } from './ScreenHeader.js';
import { StepperIndicator } from './StepperIndicator.js';
import { TagChip } from './TagChip.js';

export function DesignSystemPreview() {
  const [email, setEmail] = useState('participante@arenago.com');
  const [selectedGames, setSelectedGames] = useState(['Fortnite', 'Valorant']);
  const [lastAction, setLastAction] = useState('Nenhuma ação disparada');

  function handleToggleGame(game) {
    setSelectedGames((prev) =>
      prev.includes(game) ? prev.filter((item) => item !== game) : [...prev, game]
    );
    setLastAction(`Selecionado: ${game}`);
  }

  function handleRemoveGame(game) {
    setSelectedGames((prev) => prev.filter((item) => item !== game));
    setLastAction(`Removido: ${game}`);
  }

  return (
    <View style={styles.screen} testID="design-system-preview">
      <ScreenHeader
        title="ArenaGo UI-01 Preview"
        subtitle="Catálogo Isolado do Design System"
        onBack={() => setLastAction('Voltar pressionado')}
        rightAction={<Badge label="UI-01" variant="brand" size="sm" />}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.actionBanner} testID="preview-last-action">
          Status: {lastAction}
        </Text>

        {/* Seção 1: StepperIndicator */}
        <Card variant="elevated" style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>1. StepperIndicator</Text>
          <StepperIndicator
            totalSteps={3}
            currentStep={2}
            title="Seus jogos"
            subtitle="Informe quais jogos você costuma jogar na Arena BEAST."
          />
        </Card>

        {/* Seção 2: Button Variantes, Tamanhos e Estados */}
        <Card variant="default" style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>2. Button — Variantes & Estados</Text>
          <View style={styles.stackGap}>
            <Button
              title="Primário (Primary)"
              variant="primary"
              onPress={() => setLastAction('Botão Primary')}
            />
            <Button
              title="Secundário (Secondary)"
              variant="secondary"
              onPress={() => setLastAction('Botão Secondary')}
            />
            <Button
              title="Contorno (Outline)"
              variant="outline"
              onPress={() => setLastAction('Botão Outline')}
            />
            <Button
              title="Destrutivo (Danger)"
              variant="danger"
              onPress={() => setLastAction('Botão Danger')}
            />
            <Button
              title="Destrutivo Contorno (Danger Outline)"
              variant="dangerOutline"
              onPress={() => setLastAction('Botão DangerOutline')}
            />
            <Button
              title="Fantasma (Ghost)"
              variant="ghost"
              onPress={() => setLastAction('Botão Ghost')}
            />
            <Button
              title="Carregando (Loading)"
              variant="primary"
              loading
              onPress={() => setLastAction('Não deve disparar')}
            />
            <Button
              title="Desabilitado (Disabled)"
              variant="primary"
              disabled
              onPress={() => setLastAction('Não deve disparar')}
            />
            <View style={styles.rowWrap}>
              <Button
                title="Pequeno (SM 36pt / 44pt touch)"
                size="sm"
                fullWidth={false}
                onPress={() => setLastAction('Botão SM')}
              />
              <Button
                title="Médio (MD 44pt)"
                size="md"
                variant="secondary"
                fullWidth={false}
                onPress={() => setLastAction('Botão MD')}
              />
            </View>
            <Button
              variant="outline"
              onPress={() => setLastAction('Botão via children')}
            >
              Conteúdo via Children
            </Button>
          </View>
        </Card>

        {/* Seção 3: InputField */}
        <Card variant="default" style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>3. InputField — Estados</Text>
          <InputField
            label="E-mail do participante"
            required
            value={email}
            onChangeText={setEmail}
            placeholder="Digite seu e-mail"
            hint="Utilize o mesmo e-mail do cadastro."
          />
          <InputField
            label="Senha de acesso"
            required
            value="123"
            onChangeText={() => {}}
            secureTextEntry
            error="A senha deve ter pelo menos 8 caracteres."
          />
          <InputField
            label="Campo bloqueado (Disabled)"
            value="Somente leitura"
            editable={false}
          />
        </Card>

        {/* Seção 4: TagChip */}
        <Card variant="default" style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>4. TagChip — Seleção & Remoção Isoladas</Text>
          <View style={styles.rowWrap}>
            {['Fortnite', 'Valorant', 'Minecraft'].map((game) => {
              const isSelected = selectedGames.includes(game);
              return (
                <TagChip
                  key={game}
                  label={game}
                  selected={isSelected}
                  onPress={() => handleToggleGame(game)}
                  onRemove={isSelected ? () => handleRemoveGame(game) : undefined}
                />
              );
            })}
            <TagChip
              label="Chip Desabilitado"
              selected
              disabled
              onPress={() => setLastAction('Erro: chip desabilitado')}
              onRemove={() => setLastAction('Erro: remoção desabilitada')}
            />
          </View>
        </Card>

        {/* Seção 5: Badge */}
        <Card variant="default" style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>5. Badge — Variantes Semânticas</Text>
          <View style={styles.rowWrap}>
            <Badge label="MARCA" variant="brand" />
            <Badge label="ATIVO" variant="success" />
            <Badge label="ERRO / SAIR" variant="danger" />
            <Badge label="AGUARDANDO" variant="warning" />
            <Badge label="INFO" variant="info" />
            <Badge label="PADRÃO" variant="default" />
          </View>
        </Card>

        {/* Seção 6: Card Variantes */}
        <View style={styles.stackGap}>
          <Card variant="highlight">
            <Text style={styles.cardSampleTitle}>Card Highlight (Borda Roxa #5F33FA)</Text>
            <Text style={styles.cardSampleBody}>
              Utilizado para destacar estações ativas e opções selecionadas.
            </Text>
          </Card>
          <Card
            variant="glass"
            onPress={() => setLastAction('Card clicável acionado')}
            accessibilityLabel="Card interativo de demonstração"
          >
            <Text style={styles.cardSampleTitle}>Card Glass Interativo (Clicável)</Text>
            <Text style={styles.cardSampleBody}>
              Toque para acionar feedback com área mínima de 44pt.
            </Text>
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background.base,
  },
  scrollContent: {
    paddingHorizontal: spacing.layout.screenPaddingHorizontal,
    paddingBottom: spacing.huge,
  },
  actionBanner: {
    ...typography.caption,
    color: colors.brand.primaryLight,
    marginBottom: spacing.md,
  },
  sectionCard: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.titleSmall,
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  stackGap: {
    gap: spacing.sm,
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardSampleTitle: {
    ...typography.bodyLarge,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  cardSampleBody: {
    ...typography.body,
    color: colors.text.secondary,
  },
});

export default DesignSystemPreview;
