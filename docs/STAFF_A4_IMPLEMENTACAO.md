# Task A4 — seleção direta das estações Staff

## Alteração

O Painel Operacional passou a mostrar as estações diretamente abaixo de Controle de Entrada. As experiências retornadas pelo backend formam grupos; cada estação aparece no grupo de seu `experienceId`, com label, disponibilidade e indicação de atendimento pendente. Experiências sem estação e eventos sem experiências ou estações mantêm mensagens próprias. O botão intermediário “Estações” e a seção de listagem foram removidos.

O painel continua usando `createStaffDashboardStore` para carregar e atualizar experiências e estações. A seleção exige que ambos os conjuntos estejam prontos e que a estação pertença a uma experiência retornada. A seleção abre a seção de atendimento da estação e consulta sua fila compartilhada. Não é enviada nenhuma mutação ao abrir a seção.

O texto visível do botão continua “Selecionar estação {label}”. O nome acessível acrescenta “da experiência {nome}”, usando os dados reais do grupo. Assim, estações com o mesmo label em experiências diferentes têm controles distinguíveis para leitores de tela. A ação continua usando o ID da estação selecionada, sem expor UUIDs no rótulo.

No refinamento visual posterior, “Estações do evento” permanece sempre visível. O título de grupo é exibido somente quando o backend retorna duas ou mais experiências. Com uma experiência, as estações continuam associadas por `experienceId` e seus nomes acessíveis continuam incluindo a experiência. A `ScrollView`, a SafeArea e o fundo compartilhado permanecem inalterados.

O botão “Voltar ao painel” limpa a fila e a estação selecionada. O `beforeRemove` da rota também retorna diretamente ao painel quando o Staff está no atendimento ou no Controle de Entrada. As mudanças de evento, conta ou sessão continuam reinicializando o contexto do store e descartando resultados antigos. O `AuthBackground` da A3 permanece nas duas rotas; os cartões continuam dentro da `ScrollView` e da SafeArea existentes.

Na primeira validação focada, 28 testes passaram e um falhou (0 ignorados; exit code 1). O cenário de 403 durante a atualização da fila demonstrou uma regressão de feedback: o store limpava as estações e experiências, mas a mensagem de erro ficava dentro de `section === 'panel'` e desaparecia enquanto a seção ativa era `station`. A tela agora apresenta os erros de carregamento no painel e no atendimento. Erros iguais dos dois conjuntos são mostrados uma única vez. A limpeza dos dados, o bloqueio das ações e o botão de retorno permanecem. O teste mantém as asserções do 403, da ausência dos dados antigos e do retorno, e acrescenta a ausência da ação de chamar após a recusa.

## Arquivos

- `app/screens/staff/StaffEventsNavigator.js`
- `app/tests/roleRoutingIntegration.test.cjs`
- `docs/STAFF_A4_IMPLEMENTACAO.md`
- `qa-evidence/STAFF_A4-changes.diff`

Os testes de integração foram adaptados para selecionar diretamente a estação, conferir ausência do botão intermediário, duas estações na mesma experiência, uma estação em outra experiência, uma experiência vazia, retorno por botão e por ação de voltar, troca de evento, 401/403 e operações Staff anteriores. Os testes de navegação real e de fundo compartilhado não precisaram de alteração.

Após o refinamento visual, a validação automatizada registrou 29 testes focados aprovados e 525 na regressão completa, sem falhas ou ignorados. O cenário de integração usa duas experiências com estações de mesmo label, confere os nomes acessíveis distintos e verifica a consulta operacional pelo ID da estação da segunda experiência. O teste também exige que o título redundante não apareça no painel com uma única experiência.

## Cenário local de homologação

O cenário foi preparado em um banco local isolado A4, separado do evento de homologação anterior. No evento sintético Multiestações, Just Dance possui duas estações e PlayStation possui uma. Os três labels foram corrigidos e confirmados posteriormente por GET na API A4. A prontidão consultada retornou `ready=true` e `effectivePhase=open`. A fixture isolada A4 foi preservada como ferramenta de QA; a instrumentação temporária de diagnóstico TOTP foi removida.

## Homologação funcional

O responsável confirmou a homologação no Expo Go: agrupamento das duas experiências, seleção direta com identificação correta das três estações e navegação Voltar. Esses resultados são observações funcionais manuais e complementam a validação automatizada; não comprovam comportamento em todos os dispositivos ou sob concorrência real.
