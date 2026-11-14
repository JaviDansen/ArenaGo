# ArenaGo — Panorama do produto, requisitos e evidências

**Data de referência:** 14/11/2026 (America/Sao_Paulo). Panorama original de 13/11/2026 preservado como base desta consolidação.

**Base local consultada:** `develop`, commit `a2bd60a9d2efd462da1cbeaac26d4956dae99375`.

**Natureza:** diagnóstico e inventário principal do produto, consolidando o Planejamento antigo no Panorama atual. Revisão documental, sem novo planejamento, distribuição de tarefas ou alteração de decisões aprovadas.

**Marcos futuros informados pelo responsável:** aplicativo pronto, compilado, instalado e validado até **02/12/2026**; apresentação aos clientes na **UNDB em 04/12/2026**. São contexto confirmado desta solicitação, sem cronograma de execução nem declaração de prontidão.

## 1. Para que serve este documento

Este panorama reúne o que o ArenaGo já oferece, a evidência disponível para cada área e o trabalho que falta. O objetivo é distinguir requisitos aprovados, implementação, integração, evidência, demonstração e decisões abertas, servindo de referência para um planejamento novo em outra tarefa.

O núcleo Participante + Staff já possui jornadas conectadas à API e homologações operacionais delimitadas. Há uma base extensa de autenticação, regras de filas, idempotência, encerramento e avaliações no backend. O principal desnível entre interface e persistência está no Admin: o acesso é real, enquanto as 14 telas Heliom de gestão e BI operam em memória. A apresentação em aparelhos independentes do ambiente de desenvolvimento ainda depende de infraestrutura, distribuição e ensaio integrado.

Não foi calculado um percentual de conclusão. Sem uma lista fechada de critérios de entrega, porcentagens misturariam quantidade de telas, integração real, testes e operação.

### Fontes e método

- READMEs da [raiz](../README.md), [aplicativo](../app/README.md), [backend](../backend/README.md) e [QA independente](../qa/regression/README.md).
- [Planejamento do produto](PLANEJAMENTO_ARENAGO.md), [arquitetura do backend](ARQUITETURA_BACKEND_ARENAGO.md) e relatórios por task de `docs/`, relacionados na seção 10.
- O Panorama original cita o documento externo `DIAGNOSTICO_ARENAGO_PLANO_DEMONSTRACAO_2026-12-04.md`, de 13/11/2026. Esse arquivo não foi disponibilizado nesta revisão; seus relatos são preservados com atribuição ao Panorama recebido, sem alegar leitura independente ou executar instruções nele mencionadas.
- O Panorama recebido registra campanha de integração AUTO-QUEUE-01 com 125 testes focados e 822 na suíte completa. O registro é preservado como evidência documental herdada; os logs/conversa de execução não foram disponibilizados nesta revisão. O relatório versionado AUTO-QUEUE comprova documentalmente outra campanha: 87 focados/464 frontend.
- Inspeção estática pontual do histórico Git, configuração do app, serviços de participação, Home/Arena, provedor Admin, inventário de controllers e journal de migrations. Não foi uma auditoria linha a linha de todo o código ou uma revisão exaustiva de cada teste.

Nesta revisão, o único item inicial do working tree era o próprio Panorama, não rastreado (`?? docs/PANORAMA_ARENAGO_IMPLEMENTACAO.md`), fornecido localmente após a primeira tentativa bloqueada por sua ausência. Seu conteúdo foi preservado como baseline; o índice e os arquivos rastreados estavam sem alterações. O histórico local confirma o merge da AUTO-QUEUE-01 por `a2bd60a` (PR #12) e a integração anterior de `develop` na feature por `2a3c404`. Portanto, o merge pendente mencionado em conversas e relatórios antigos já foi concluído antes deste levantamento.

Nenhum teste, build, lint, typecheck, inicialização da API ou operação de banco foi realizado para produzir este panorama. Arquivos `.env` reais não foram consultados. As verificações desta entrega são documentais e estáticas.

## 2. Como ler o estado de uma funcionalidade

| Classificação | Significado |
| --- | --- |
| Prevista | Requisito/funcionalidade aprovado, ainda não implementado no recorte descrito. Aprovação de negócio não é evidência de execução. |
| Implementada | Existe código correspondente na base consultada, com referência de implementação; relato histórico isolado é identificado como tal. Não implica funcionamento comprovado em qualquer ambiente. |
| Integrada à API | O fluxo utiliza contratos reais e persistência do backend. A existência isolada de um endpoint não comprova integração da tela. |
| Validada automaticamente | Uma campanha identificada executou testes com resultado conhecido. O resultado vale para seu escopo, ambiente e versão. |
| Homologada funcionalmente (operacionalmente) | Há evidência ou relato atribuído de operação real em cenários definidos, por exemplo Expo Go/API com banco real. O tipo de prova e o ambiente devem ser explícitos. |
| Demonstrativa | Comportamento e dados locais/simulados apresentados pela interface. Pode estar bem testada sem operar dados reais. |
| Pendente de validação | Implementada, mas sem comprovação específica suficiente para o cenário/ambiente indicado. |
| Pendente de evidência | Não foi encontrada confirmação suficiente nas fontes consultadas; pode haver apenas relato herdado. Não implica ausência de implementação. |
| Pendente de decisão | Depende de definição do responsável; não permite inventar requisito ou flexibilizar regra aprovada. |
| Pendente de implementação/integração | Uma fonte atual identifica explicitamente a lacuna, ou a inspeção delimitada confirma o mecanismo ainda ausente. |

Campanhas diferentes não devem ser somadas. Testes preparados não são testes executados; exportação Metro não é build nativo instalado; homologação de um fluxo não aprova todos os cenários do módulo. Resultados antigos permanecem úteis como histórico, mas podem precisar de nova confirmação após mudanças relevantes.

## 3. Inventário funcional consolidado

### 3.1 Base comum, identidade e perfil

| Capacidade | O que existe | Evidência e limite | Lacuna ou limite atual |
| --- | --- | --- | --- |
| Aplicativo e API | Expo SDK 58, React Native 0.88.1, React 19.3.0; API NestJS 12 com Drizzle/PostgreSQL sob `/api/v1` | Versões declaradas nos READMEs/manifests; migração SDK documentada | Confirmar ambiente do build candidato, sem presumir disponibilidade em todas as plataformas |
| Cadastro e login | Cadastro real, validações, login e recuperação de erros; senha não é substituída por acesso demo | Integrações Expo e suíte frontend; autenticações reais relatadas | Ensaio no build distribuído, restauração, perda de rede e troca de conta |
| Sessão e identidade | Access token em memória; refresh em SecureStore no nativo; rotação, `/auth/me`, logout e descarte de respostas antigas | [Sessão estável](AUTH_STABLE_SESSION_BINDING_IMPLEMENTACAO.md); regressões de identidade | Múltiplos aparelhos, revogação durante operação e recuperação em ambiente remoto |
| Papéis e navegação | Precedência Admin, Staff, Participante; rotas protegidas e concessão Staff por evento | [Integração de papéis](ROLE_ROUTING_STAFF_INTEGRATION_IMPLEMENTACAO.md); backend revalida autorização | Homologar perda de papel/concessão e nova sessão nos aparelhos escolhidos |
| Verificação de e-mail | Backend com token e integração de envio Resend | READMEs; confirmação real no Neon relatada no diagnóstico-base | Confirmar envio e links acessíveis externamente no ambiente final |
| Admin e TOTP | Login com segundo fator, bootstrap restrito do primeiro Admin, ativação e códigos de recuperação no backend | Série T6.1; login/TOTP e abertura do painel homologados conforme README | Onboarding/reset de outros Admins e recuperação operacional continuam pendentes |
| Recuperação de senha | Tela informa indisponibilidade de recuperação automática por e-mail | Limitação explícita no README do app | Definir prioridade; não apresentar recuperação como funcionalidade pronta |
| Questionário e jogos | Três etapas persistidas, retomada/edição, catálogo e versionamento; edição do nome no Perfil | Integrações Expo, T6/backend e testes; catálogo inicial documentado com 20 jogos e questionário 1.0.0 | Revisar jornadas incompletas, datas e reabertura no build candidato |
| Estatísticas do Perfil | Contagem de participações que entraram na Arena; minutos de participações finalizadas, sem espera externa | [Perfil](PROFILE_REAL_STATISTICS_IMPLEMENTACAO.md): zero em conta vazia e 2 participações/41min em histórico | Casos SQL extremos ainda sem campanha física própria; essas métricas não são BI de eventos |
| Identidade visual e acessibilidade | Design system, fundos, componentes, telas de participante e Splash; cobertura de renderização | [UI](UI_PARTICIPANT_INTEGRATION_IMPLEMENTACAO.md), [Splash](SPLASH_01_IMPLEMENTACAO.md), testes frontend | Revisão visual do build final, telas pequenas, fontes ampliadas e acessibilidade em aparelho |

### 3.2 Participante

| Capacidade | O que existe | Evidência e limite | Lacuna ou limite atual |
| --- | --- | --- | --- |
| Entrada por código/QR | Lookup autenticado, validação do código, câmera, confirmação e ingresso idempotente | [QR](ENTRY_QR_01_IMPLEMENTACAO.md); QR físico observado em [C-04/D09](RETURN_AFTER_CLOSURE_C04_D09_IMPLEMENTACAO.md); regressão integrada passou | Permissões/câmera em aparelhos distintos, iluminação, retorno das configurações e erros |
| Fila externa | Participação aguardando, posição real e transição para Arena após confirmação/liberação | API real, homologações Staff/C-04 e AUTO-QUEUE | Ensaio conjunto com Staff em outro dispositivo e conexão remota |
| Arena e fila interna | Catálogo real, posição, inscrição, chamada por estação e saída isolada da fila conforme C-15 | Série E07/E08, integração Expo e homologações operacionais | Concorrência entre participantes/estações, cortes de horário e operação incerta |
| Atualização automática | Polling de 5s, foco/primeiro plano, recuperação de conexão, aviso discreto e descarte por geração/sessão | [AUTO-QUEUE-01](AUTO_QUEUE_01_IMPLEMENTACAO.md); campanha integrada 125/822 relatada no Panorama original | Confirmar comportamento no build distribuído e rede externa |
| Alerta de chamada | Vibração local única para chamada nova nas condições permitidas; supressão de chamada antiga na retomada | Testes automatizados passaram | Vibração física individual não tem aprovação explícita no resumo da homologação AUTO-QUEUE |
| Finalização, histórico e avaliação | Saída real, histórico/detalhes, elegibilidade, envio e conferência de tentativa incerta; edição implementada no backend, sem integração encontrada na UI real | [Finalização/avaliação](EXPO_PARTICIPACAO_FINALIZACAO_AVALIACAO_IMPLEMENTACAO.md), E08.10–12 e C-04 | Confirmar erros, prazos e recuperação no ambiente candidato |
| Retorno após encerramento | Reconsulta ao retomar, correlação da finalização com pendência, histórico/elegibilidade antes de navegar | C-04/D09: fluxo principal após encerramento imediato homologado no Expo Go | Fechamento automático pelo scheduler e casos negativos não foram homologados fisicamente nessa campanha |
| Avaliação uma vez por ciclo | `returnStateVersion`, claim antes da navegação, adiamento preservado; nova retomada pode oferecer novamente | Contratos da develop preservados na AUTO-QUEUE; testes de retorno e sessão passaram | Manter o critério por ciclo de retomada: não significa nunca reapresentar a avaliação |

### 3.3 Staff

| Capacidade | O que existe | Evidência e limite | Lacuna ou limite atual |
| --- | --- | --- | --- |
| Eventos e painel | Descoberta de eventos autorizados, seleção, experiências e acesso direto às estações reais | Relatórios de descoberta/seleção/painel; [A4](STAFF_A4_IMPLEMENTACAO.md) homologou agrupamento e navegação | Conferir permissões, fases e troca de evento no ambiente remoto |
| Controle de Entrada | Fila nominal, chamada persistente por `callId`, confirmar entrada, ausência, remoção e controle da fila externa | [Staff 02](STAFF_ENTRY_CALL_FLOW_IMPLEMENTACAO.md): 10 cenários relatados | Desativação foi relatada com fila vazia, sem GET/captura final independente; não extrapolar para fila ocupada/chamada pendente |
| Estações e atendimento | Fila compartilhada por experiência, chamada, conclusão, ausência/remoção e liberação da estação | Staff 01: 10 cenários relatados no mesmo relatório; A4 e AUTO-QUEUE complementam atendimentos | Múltiplos operadores e aparelhos, concorrência física e resultados incertos |
| Atualização automática | Leituras operacionais de 5s; eventos/fase de 60s; controles de foco, sessão e primeiro plano | [B1](STAFF_B1_IMPLEMENTACAO.md): regressão 533 e homologação funcional | Pausa de rede não foi medida instrumentalmente na homologação; polling não repete POST nem resolve automaticamente intenção incerta |
| Persistência de intenções | Intenções/recibos, bloqueio de resultado desconhecido, isolamento e proteção contra reenvio indevido | Relatórios de operações, cutoff e testes simulados | Prova de origem, retenção e reconciliação segura continuam com dependências; serialização local não prova exclusão entre dispositivos |
| Estado operacional/histórico | Projeções e consultas para conferir situação atual e registros | [B2](STAFF_B2_IMPLEMENTACAO.md), [reconciliação histórica](STAFF_HISTORICAL_RECONCILIATION_IMPLEMENTACAO.md) | Consulta histórica/replay não é autorização para reenviar operação desconhecida |

### 3.4 Admin, backend e operação

| Capacidade | O que existe | Evidência e limite | Lacuna ou limite atual |
| --- | --- | --- | --- |
| Acesso Admin no app | Senha/TOTP, identidade confirmada, rota exclusiva e logout reais | [Navegação Admin](ADMIN_AUTHENTICATED_NAVIGATION_IMPLEMENTACAO.md) e READMEs; homologação Expo Go relatada | Revalidar conta preparada no ambiente final |
| Gestão Admin no app | 14 telas: Painel, Eventos, Criar, Detalhe, Horários, Fila Externa, Encerramento, Experiências, Experiência, Estação, Staff, Histórico, BI e Visão Geral | [Admin final](ADMIN_FINAL_IMPLEMENTACAO.md); `AdminDemoProvider` confirmado por inspeção | Persistência administrativa ausente nas telas; escopo futuro depende do responsável |
| Gestão Admin no backend | Eventos, experiências, estações, horários, filas, encerramento e concessões de papéis | Controllers reais, E08.6–8/13–14, T6.1D; uso Neon relatado no diagnóstico-base | Não tratar API pronta como tela integrada; mapear operações e erros antes da integração |
| Encerramento automático | Scheduler e regras transacionais de encerramento/regularização, preservação de instantes lógicos | E08.9 e correções E08-EST; arquitetura consolidada | Homologação física da jornada completa após encerramento automático; processo da API precisa estar operacional |
| Banco e integridade | Journal com migrations 0001–0008; constraints, auditoria, chamadas externas e mecanismos de idempotência | Relatórios PostgreSQL por campanha; inspeção do journal | Estado aplicado deve ser confirmado por ambiente; não inferir aplicação remota do conteúdo do repositório |
| BI e exportações | Telas/fixtures de indicadores, histórico e visão geral; estatísticas reais do Perfil são separadas | ADM03 e planejamento | BI agregado real/exportação pendentes; indicadores A/B já aprovados, contratos e controles ainda por especificar (§3.8) |
| Distribuição | App roda no Expo Go; há registros de exportação de bundles | SDK58/Admin final; `app.json` ainda com name/slug `app`; `app/eas.json` ausente | Definir identificadores, assinatura, distribuição e primeiro build instalável |
| Infraestrutura | API local e ambientes de homologação documentados; Neon remoto relatado no documento-base | Não foi verificado serviço remoto acessível nesta análise | Confirmar hospedagem HTTPS, banco alvo, e-mail, logs, disponibilidade, backup e restauração |


### 3.5 Regras aprovadas de participação e operação — D01–D11

O ArenaGo organiza eventos presenciais de games, com ingresso, experiências atendidas em estações, filas compartilhadas e avaliação da participação. O Participante acompanha sua jornada; Staff opera os eventos para os quais recebeu concessão; Admin global administra estrutura, permissões e análise agregada. O backend é a autoridade de identidade, posição, elegibilidade, relógio, conclusão e persistência. O estado local serve à interface e à recuperação, sem definir ordem global.

A fonte normativa desta seção é o [Planejamento antigo, §§1, 3, 6–9](PLANEJAMENTO_ARENAGO.md). As decisões abaixo continuam aprovadas; a coluna de estado distingue implementação de integração e comprovação. Detalhes SQL, DTOs e campanhas permanecem na [Arquitetura, §§15–20 e 27](ARQUITETURA_BACKEND_ARENAGO.md) e nos relatórios indicados. Código divergente não revoga uma decisão.

| Decisão | Regra preservada, incluindo condições e exceções | Estado e limite atual |
| --- | --- | --- |
| D01 — Experiência e estações | Uma fila FIFO por experiência, compartilhada por várias estações; duas estações podem chamar pessoas diferentes, nunca a mesma entrada. Staff do evento/Admin global controlam disponibilidade. Resolver chamada pendente antes de desativar estação. Indisponibilidade não fecha a fila nem altera outras estações. Sem transferência, prioridade especial ou resultado técnico específico; ausência usada presencialmente por problema técnico não comprova falta real. | Implementada no domínio e integrada na operação Staff; homologações delimitadas na §4. A interpretação de ausências no BI continua relevante. |
| D02 — Saída externa | Sair voluntariamente da fila externa cancela a participação, perde a posição e não permite avaliação. Novo ingresso, se ainda permitido, cria outra participação sem apagar histórico nem recuperar a posição anterior. | Backend implementa `cancel`; não confundir com ausência/remoção Staff nem com C-15. A existência da rota não comprova oferta de todo comando na UI. |
| D03 — Exclusividade e saída da Arena | No máximo uma participação corrente por conta, incluindo espera externa. Pode finalizar uma participação ativa sem conclusão. Finalizar durante espera retira da fila; após chamada, cancela por desistência e libera a estação se disponível, sem ausência/conclusão. Preserva conclusões anteriores. Avaliação exige pelo menos uma conclusão Staff. C-15 permite sair apenas da fila interna e continuar ativo. | Finalização integrada; exclusividades e transições implementadas. Não equiparar finalização, cancelamento externo e retirada interna. |
| D04 — Papéis | Staff é autorizado por evento e pode operar suas experiências; Admin é global. Uma conta pode acumular papéis. Admin busca pelo e-mail uma conta existente para conceder/revogar Staff por evento ou Admin global. | Gestão de papéis real no backend (T6.1-D); tela Heliom demonstrativa. Participação de conta Admin como jogador continua pendente de decisão; navegação exclusiva não resolve a regra de produto. |
| D05 — Atendimento | Conclusão e ausência são manuais, sem timeout individual em operação normal e sem exigir fases separadas de chegada/início. A estação aguarda resolução antes de chamar novamente. Ausência gera nova entrada ao fim da fila interna somente enquanto admissões forem permitidas, antes do corte oficial ou administrativo; na janela residual não reingressa. D07 cancela pendências no limite final. | Chamada/conclusão/ausência integradas. Remoção Staff tem motivo próprio e não deve contar como ausência ou conclusão. Concorrência física geral permanece pendente. |
| D06 — Alternância externa | Desativar a fila externa libera todos os `waiting`; novas participações entram `active` enquanto desligada. Reativar afeta apenas novas participações; não recolhe quem já entrou. | Backend Admin/Staff e Controle de Entrada implementados. Ensaio manual registrado desligou fila vazia; não comprova desligamento ocupado ou com chamada pendente. |
| D07 — Horários | No horário oficial vigente, bloquear definitivamente ingressos, reentradas e novas inscrições internas. Margem opcional de 0–60 minutos atende apenas filas preexistentes, sem garantia de atendimento. No limite operacional, encerrar esperas, cancelar chamadas sem ausência/conclusão e finalizar participações abertas, inclusive externas; preservar conclusões anteriores e impedir confirmação tardia. Brasil inicialmente; instantes UTC e fuso IANA local. Admin só altera horário antes do corte vigente, para horário futuro; sem alteração na margem residual nem reabertura. | Horários, guardas e scheduler implementados. Integração das telas Admin e homologação física completa do fechamento automático continuam pendentes. |
| D08 — Avaliação | Uma por participação `finished` com conclusão Staff, nota inteira 1–5 e comentário opcional. Primeiro envio até 30 dias após finalização. Nota/comentário editáveis até 7 dias após primeiro envio; depois, até 30 dias após envio, apenas quem nunca comentou pode adicionar um primeiro comentário uma vez. Após isso, definitiva. Edição não reinicia prazos; BI usa a última nota sem duplicar. Nova participação pode gerar nova avaliação. | Envio/consulta integrados; edição existe no backend, sem integração encontrada no fluxo real do app inspecionado. Precisão e restrições adicionais abaixo. |
| D09 — Fechamento Admin | Imediato finaliza todas as participações abertas e cancela esperas/chamadas no instante devido, preservando conclusões. Controlado admite prazo de até 1h, limitado pelo prazo programado anterior; finaliza imediatamente a espera externa sem avaliação e mantém somente filas/atendimentos internos preexistentes até o limite. Prevê antecipar o fim; exige justificativa e auditoria de modo, motivo, ator e instante. Mensagens padronizadas no app, sem personalização ou push; justificativa não é exibida automaticamente. Retorno segue C-04, sem mandar indiscriminadamente à Home. | Encerramento inicial implementado; fluxo principal de retorno homologado após imediato. Segunda intenção para antecipar controlado é recusada atualmente: divergência delimitada na §5. Operação pelas telas Heliom ainda demonstrativa. |
| D10 — Histórico e privacidade | Snapshot das respostas em cada nova participação; atualizar perfil não reescreve passado. BI agregado, sem identificação nominal por padrão. Retenção indeterminada só para dados efetivamente anônimos; contas ativas apenas enquanto houver finalidade legítima. Exclusão durante evento deve encerrar participação/pendências, revogar sessões e eliminar credenciais/dados pessoais conforme política, preservando somente contribuições estatísticas seguras quando possível. Remover identificadores não basta para reter históricos individuais. Sem exclusão automática de contas inativas na primeira versão. | Snapshots implementados; fluxo completo de exclusão, anonimização, retenção e BI permanece previsto/pendente. Proteções da migration 0008 exigem compatibilização, não remoção automática. |
| D11 — Avisos | Avisos dentro do app inicialmente, push posterior; servidor informa posição e chamada oficiais. | Polling Participante/Staff e vibração local implementados; não são push nem WebSocket. Mecanismo/frequência antes pendentes têm implementação (5s operacional e 60s para eventos Staff); vibração física individual continua sem confirmação específica. |

**Avaliações: dois relógios, sem prorrogação por edição.** A [E08.11, “Elegibilidade e prazos exatos”](E08_11_IMPLEMENTACAO.md) implementa primeiro envio até `finished_at + 720h`, inclusive; edição integral até `submitted_at + 168h`, inclusive; primeiro comentário tardio acima de 168h e até 720h, inclusive. Na janela tardia não se aceita o campo nota, mesmo com valor inalterado. Remover comentário na primeira semana não apaga que já houve comentário nem recupera o direito tardio. Avaliação expirada deixa de ser pendência. Os textos são limitados tecnicamente a 2.000 pontos de código Unicode; isso não implementa moderação, detecção de dados pessoais ou política de comentários. O backend verifica titularidade: Staff/Admin não ganham acesso às avaliações individuais de terceiros por seu papel. Fontes: [E08.10](E08_10_IMPLEMENTACAO.md), E08.11 e [controller de escrita](../backend/src/evaluations/evaluation-write.controller.ts).

**Retomada e história:** estados de participação são `waiting/active/finished/canceled`; fila interna e atendimento têm ciclos próprios. Reingresso legítimo cria registros novos. Perda de sessão não muda posição nem registra ausência. Histórico, participação atual e elegibilidade são recuperados da API; “Avaliar mais tarde” mantém a pendência consultável, sem tabela extra. O ciclo de retomada do app limita reapresentação automática, não altera prazos do domínio.

### 3.6 Complementos de negócio — C-01–C-15

Fonte integral: [Planejamento, §9.3.1](PLANEJAMENTO_ARENAGO.md). Esta matriz completa as condições que antes estavam apenas mencionadas no inventário.

| Decisão | Condição ou restrição preservada | Situação e referência atual |
| --- | --- | --- |
| C-01 | Ausência depois do corte não recoloca na fila, mesmo durante atendimento residual. | Implementada nas guardas/ausência; complementa D05/D07. |
| C-02 | Margem adicional entre zero e 60 minutos; nunca presumir uma hora obrigatória. | Horários e prazo efetivo implementados; E08.7–9. |
| C-03 | Imediato encerra todas as participações abertas e pendências, preservando conclusões. | E08.8; não depende de app aberto. |
| C-04 | No retorno, avaliação só com conclusão, sem envio anterior e dentro do prazo; senão informar encerramento. Oferecer “Avaliar mais tarde”, inclusive após limite automático. | Retomada implementada e integrada; homologação física do imediato, com scheduler/casos negativos pendentes (§4). |
| C-05 | Abertura automática no horário apenas com nome, código, horários/fuso válidos, configuração da fila externa, experiência com estação disponível e Staff autorizado. Não exige Staff conectado nem fixo numa estação. Prontidão não depende da passagem do job. | Readiness e admissão no backend; E08.13/Arquitetura §27. Tela Admin não o integra. |
| C-06 | Conta criada antes das três etapas do questionário, sem botão “Preencher depois”. Login posterior continua possível após interrupção; ingressar exige questionário integral. Não repete por evento. | Questionário integrado; ingresso valida perfil/snapshot atomicamente. Admin/Staff seguem destino por papel, sem redefinir elegibilidade de participante. |
| C-07 | Exclusão privilegia agregados seguros; histórico individual só com anonimização efetivamente validada. Snapshot imutável no uso normal não é indelével. | Política e procedimento completos pendentes antes do piloto. |
| C-08 | FIFO real, chamada atômica, resultado terminal único, relógio do servidor, idempotência e limpeza reexecutável. | Implementação transacional e campanhas específicas; mocks não comprovam locks ou segurança entre dispositivos. |
| C-09 | Perfil mutável e questionário versionado, congelados por participação; pendência de avaliação derivada, sem tabela específica. | Perfil, snapshot e leituras de avaliação implementados. |
| C-10 | Código único em todo o histórico, imutável desde criação e não reutilizável. Após `String.trim()`, 4–64 caracteres ASCII alfanuméricos com hífen apenas entre grupos; sem hífens consecutivos/nas pontas, espaços internos, acentos ou Unicode não ASCII. Consulta ignora caixa e whitespace externo reconhecido por `trim()`. | Normalizador compartilhado de criação/consulta implementado. UNIQUE e CHECK SQL de maiúscula/trim ASCII não cobrem integralmente a validação JavaScript; preservar códigos arquivados. Restrição SQL adicional depende de auditoria e eventual migration incremental. |
| C-11 | Refresh consumido reapresentado revoga sessão mesmo após resposta legítima perdida; pode exigir login novo, sem encerrar participação, retirar da fila ou registrar ausência. Sem tolerância improvisada por IP/User-Agent. | Sessão/rotação e single-flight implementados; testar conectividade física continua necessário. |
| C-12 | Controlado antecipado finaliza todos os `waiting` externos no início, com motivo administrativo e sem avaliação. Somente `active` e filas/atendimentos internos preexistentes continuam; ausência não reingressa após o corte antecipado. | E08.8 implementada; distinguir de cancelamento voluntário externo. |
| C-13 | Primeiro ingresso, inclusive externo, bloqueia renomear experiências/estações e cadastrar experiências. Pode adicionar estações a experiências existentes durante operação, compartilhando sua fila. Não excluir fisicamente recursos já usados. Disponibilidade e concessões/revogações continuam operacionais; horários obedecem D07/D09; código permanece imutável. | Configuração backend E08.13 implementada; renomear o próprio evento também é bloqueado conservadoramente no código, sem converter essa extensão em decisão nova. |
| C-14 | Sem Staff autorizado ou sem estação disponível no evento, bloquear só novos ingressos, preservando participações/posições/conclusões. Sem estação numa experiência, bloquear novas entradas apenas nela. Não criar ausências, cancelamentos ou fechamento automático por falta de capacidade. Restaurar admissões apenas antes dos cortes. Revogar último Staff por segurança continua permitido. | Prontidão dinâmica/admissão e papéis implementados; sem tabela nova de prontidão. |
| C-15 | Titular sai da fila interna `waiting/called` e permanece `active`, sem ausência/conclusão. Resolver `pending` e liberar estação atomicamente, sem mudar disponibilidade nem conclusões/posições alheias ou sobrescrever resultado terminal. Próximo ingresso exige nova intenção/chave/FIFO e todas as guardas. Desistir após corte pode ser permitido; reingressar não. | Serviço E07.3, rota HTTP `withdraw` E08.2 e retirada integrada. Anotação antiga “sem rota” superada. Expurgo/reconciliação e concorrência física não são certificados por essa integração. |

**Controle de Entrada externo tem contrato próprio:** chamada persistida por `callId`, uma pendente por evento e por participação. Confirmar usa a ocorrência chamada; a rota legada por participação não cria nova confirmação, preserva somente replay compatível. Ausência antes do corte mantém a mesma participação `waiting` com nova ordem externa; após o corte e antes do limite final, finaliza sem reinserção. Remover cancela com motivo próprio, sem conclusão, ausência, avaliação ou banimento novo. Desligar fila/encerrar cancela chamadas pendentes coerentemente, sem reabrir registros terminais. Esses efeitos não se confundem com a nova `queue_entry` da ausência interna. Fonte: [Staff 02, contrato/efeitos](STAFF_ENTRY_CALL_FLOW_IMPLEMENTACAO.md).

### 3.7 Identidade, segurança e requisitos de acesso preservados — DA-03

Fonte: [Planejamento, §§9.2 e 9.3.2](PLANEJAMENTO_ARENAGO.md); implementação e limites em [Arquitetura §27.1](ARQUITETURA_BACKEND_ARENAGO.md).

- Cadastro público cria conta comum; Participante tem acesso inicial sem confirmação de e-mail. Conceder Staff/Admin exige e-mail verificado; mudança de e-mail privilegiado exige confirmar o novo endereço. O app atualmente edita nome, não e-mail/papéis.
- Senha aprovada: mínimo de oito caracteres, sem composição obrigatória, bloqueio de senhas muito comuns/comprometidas e hash adaptativo. Cadastro atual limita 8–128 caracteres e usa Argon2id/política local; isso não certifica cobertura universal de senhas comprometidas. Transporte de verificação de e-mail via Resend existe; não equivale à recuperação de senha.
- **Recuperação de senha prevista e pendente:** token aleatório de uso único por e-mail, válido por 30 minutos; nova solicitação válida invalida anteriores; redefinição revoga todas as sessões e exige login. Respostas não enumeram contas. Limites aprovados: uma solicitação por conta a cada dois minutos e até cinco por hora, com proteção adicional por IP sem penalização indevida de redes compartilhadas.
- **Sessão implementada:** access de 15 minutos, limite absoluto de 30 dias sem extensão por refresh, novo login substitui sessão anterior e revoga inclusive access ainda não vencido. Reabrir preserva sessão válida. Logout tenta revogar remotamente e limpa localmente; falha remota não pode ser declarada revogação confirmada. Tokens ficam em memória, exceto refresh no SecureStore nativo; web mantém ambos em memória.
- **Admin:** primeiro bootstrap restrito exige conta existente/ativa/verificada e auditoria; sem endpoint público. TOTP e códigos de recuperação de uso único precedem acesso administrativo; desafio temporário não é sessão. Staff/Participante não exigem 2FA inicial. Promover outro Admin não resolve a autorização de ativação TOTP, hoje restrita à proveniência do primeiro.
- **Recuperação TOTP prevista:** outro Admin verifica identidade e autoriza reset auditado, invalidando segredos/códigos anteriores e exigindo novo TOTP. Não há mecanismo emergencial aprovado para ausência de segundo Admin. Antes de evento real são exigidos **dois Admins ativos, verificados e com TOTP**; um é permitido em desenvolvimento. A proteção implementada impede retirar o último apto, não garante o mínimo de dois (T6.1-D).
- Identidade, sessão, fator, concessão e evento são revalidados no servidor; precedência visual `admin > staff > participante` não substitui autorização. Respostas/callbacks e intenções são isolados por conta/sessão e descartados quando o contexto muda. Revogação afeta ações futuras, sem promessa de cancelar retroativamente operação já autorizada entre última leitura e commit.
- Questionário reúne nascimento, gênero/outro gênero, escolaridade, jogos, conhecimento e interesse no mercado. Datas civis reais e não futuras são validadas pelo backend/PostgreSQL, sem idade mínima presumida; fuso civil configurável com padrão `America/Sao_Paulo`. Perfil/jogos podem mudar, snapshots da participação preservam a versão/respostas da época. Proteção de menores e bases de tratamento ainda exigem definição antes de uso real.

### 3.8 BI, estatísticas, exportações e privacidade

**BI administrativo é requisito aprovado do produto e parte importante do futuro planejamento.** As 14 telas Heliom apresentam fixtures, e o backend ainda não entrega o BI agregado completo. A definição dos dois indicadores abaixo já existe; não deve ser reaberta como se nada tivesse sido decidido. Faltam detalhamento dos contratos, filtros/gráficos, controles e integração. Fontes: [Planejamento, §§5 (RA-01), 9.3 e D10/C-07/C-09](PLANEJAMENTO_ARENAGO.md).

| Medida | População e cálculo preservados | Disponibilidade |
| --- | --- | --- |
| Indicador A — tempo até última experiência | Entrada efetiva na Arena até a última conclusão Staff; exige ao menos uma conclusão, qualquer que seja o modo de encerramento. | Previsto para BI; não confundir com tempo total do Perfil. |
| Indicador B — tempo até saída voluntária | Entrada efetiva até “Sair da Arena”; somente finalizações voluntárias. | Previsto para BI; não usar horário de limpeza/finalização automática como saída voluntária. |
| Atividade após encerramento automático | Com conclusão, usar tempo até última conclusão como atividade observada. Sem conclusão nem saída voluntária, duração indeterminada, nunca zero. Manter as populações separadas. | Diretriz aprovada; não representa prova de presença física. |
| Perfil — participações | Conta participações com `arena_entered_at`, inclusive ainda ativas ou canceladas após ingresso. | Implementado e integrado por titular; não conta somente eventos distintos ou pessoas únicas. |
| Perfil — minutos | Soma intervalos válidos de entrada até fim das participações `finished`, inclusive automáticas; exclui espera externa e intervalos negativos/não finitos. Arredonda para baixo uma vez após somar segundos. Sem registros retorna zero. | Implementado/integrado e homologado em cenários delimitados. Esse zero não substitui a duração indeterminada do BI. |

O Admin global deve analisar eventos e períodos, experiências, avaliações e perfil agregado do público: idade/faixa etária, jogos e interesse no mercado. Não há ficha nominal por padrão nem banco separado obrigatório de BI; PostgreSQL permanece fonte de verdade. Snapshot é por participação, não por evento ou pessoa única: reentrar pode gerar novo snapshot com respostas atualizadas. Regras de deduplicação de público, granularidade temporal, filtros e apresentação precisam de especificação quando não definidas nas fontes; não inventar denominadores ou períodos.

Avaliações editadas contribuem com a nota mais recente sem duplicar contagem. Preservar entrada efetiva, conclusões, finalização lógica e motivo permite separar os indicadores; fechamento automático não mede a saída física. O histórico deve continuar interpretável após mudanças do perfil.

**Exportação RA-01:** download manual de resultados autorizados, sem OAuth Google, sincronização direta com Drive ou Drive como armazenamento operacional. A organização pode enviar o arquivo manualmente ao Drive. CSV/XLSX têm prioridade sugerida; formatos definitivos, filtros exportáveis e níveis de acesso/auditoria ainda pendentes. PDF é possibilidade, não entrega confirmada. Não existe exportação real demonstrada pelas telas de BI.

**Privacidade prevista, procedimento completo pendente:** definir bases/finalidades, direitos dos titulares, menores, retenção identificável, backups/expurgo e auditoria; validar anonimização e eventual supressão de grupos pequenos/faixas etárias/comentários. Não inferir anonimato pela remoção de nome/e-mail. Snapshots e histórico técnico devem ser compatibilizados com exclusão legítima, inclusive durante evento, preservando agregados seguros quando possível. Não há aprovação de nova tabela de agregados nem política automática de exclusão de contas inativas. Essas lacunas são condições antes de piloto com dados pessoais, não homologações concedidas por esta revisão.

### 3.9 Backend, persistência e requisitos não funcionais

**DA-01/DA-02 aprovadas e implementadas:** monólito modular Node.js/TypeScript, NestJS com Express padrão, Drizzle ORM/`pg` e migrations SQL via Drizzle Kit, PostgreSQL. Não exigem Fastify, microsserviços ou Redis inicialmente. Neon é a escolha preferida condicionada às cotas; tecnologias sem licença paga não garantem hospedagem gratuita contínua. A escolha/apresentação de fornecedor não comprova implantação.

| Domínio/contratos reais sob `/api/v1` | Estado e fronteira |
| --- | --- |
| Identidade, sessões, verificação de e-mail, TOTP, papéis; perfil/questionário/jogos | Módulos e controllers registrados; recuperação de senha/onboarding/reset TOTP geral continuam incompletos. |
| Lookup, `POST /participations`, participação atual, cancelamento/finalização, experiências e fila/withdraw | API real integrada nos percursos descritos; ingresso devolve `{participationId}`, não o envelope antigo. Não há GET genérico de evento do Participante equivalente à proposta histórica. |
| Histórico, return-state, elegibilidade, pending e leitura/escrita de avaliação | GET/POST/PATCH reais; edição ainda sem integração encontrada na UI real. Pendência derivada, sem tabela extra. |
| Configuração Admin de eventos/experiências/estações/readiness, horários, fila externa, encerramento e papéis | Backend real, distinto das 14 telas locais. PATCH genérico não altera códigos, horários ou outros campos de comandos específicos. |
| Descoberta Staff, entrada externa/callId, filas/estações, chamadas/conclusão/ausência/remoção, disponibilidade e pausa | Backend real integrado nos fluxos Staff. Consultas de histórico não habilitam reconciliação geral de intenção desconhecida. |
| BI agregado, exportação e exclusão/anonimização integral | Requisitos/diretrizes previstos; não declarar implementados por haver entidades persistidas. |

Inventário exato de métodos, DTOs e diferenças: [Arquitetura §27.1–2](ARQUITETURA_BACKEND_ARENAGO.md) e [README backend](../backend/README.md). Registro dos módulos conferido em [AppModule](../backend/src/app.module.ts); erros seguem Problem Details. Identidade nunca vem de parâmetros livres enviados pelo cliente.

**Modelo físico:** 26 declarações de tabelas e oito migrations no [journal](../backend/drizzle/meta/_journal.json). A fundação 0001–0005 cobre identidade/perfil, eventos/código imutável, credenciais/papéis/auditoria, estrutura/participações/filas/atendimentos/avaliações/snapshots e idempotência. A 0006 acrescenta desafios Admin/2FA e antirreuso TOTP; 0007 prepara campos de origem/retenção e epochs Staff, ainda desativados; 0008 persiste chamadas externas, unicidades e proteção de terminais. Versões, SQL, snapshots e journal formam um único histórico; sua presença não prova aplicação num destino.

**Integridade e concorrência:** uma participação corrente por conta, uma fila corrente por participação, uma chamada pendente por estação e um resultado por ocorrência; repetir legitimamente experiência cria nova entrada/atendimento. FKs compostas impedem cruzamento de evento/experiência; UNIQUEs parciais protegem exclusividades. Operações usam transações, ordem de locks, revalidação após espera e relógio PostgreSQL; não saltam o primeiro FIFO com `SKIP LOCKED`. Chamadas de experiências distintas não implicam lock exclusivo global, mas finalizações/configuração serializam conservadoramente o evento. Não há promessa de ausência de deadlocks, vazão ou atomicidade entre a última revalidação de autorização e commit. Ver Arquitetura §27.4 e relatórios E07/E08/EST.

**Idempotência e recuperação:** TTLs independentes para Admin, Staff, fila Participante e avaliação; não há expurgo automático seguro inferido do vencimento. Mesma intenção preserva chave/fingerprint; nova ação legítima exige nova intenção. Resultado histórico exige autorização atual e não prova estado corrente. Refresh tem política própria e não entra nesse replay. A 0007 mantém assurance `legacy`, demais campos de origem/resultado nulos e epochs `pending`; não ativa prova de origem/reconciliação. O trigger parcial não protege DELETE nem substitui grants/ownership. O app bloqueia `dispatching` incerto; GET, TTL, polling, remount ou renovação de sessão não autorizam reenvio. SecureStore/runtime não garantem exclusão entre aparelhos, e web não tem a mesma persistência operacional. Fonte: [desenho de origem/retenção](STAFF_IDEMPOTENCY_ORIGIN_RETENTION_DESIGN.md) e [preparação de schema](STAFF_IDEMPOTENCY_SCHEMA_PREPARACAO.md).

**Scheduler e operação:** regulariza no bootstrap e periodicamente, sem sobreposição, por transação e preservando instantes lógicos. Padrão 30s, intervalo configurável 1s–1h. Em `NODE_ENV=test`, somente habilita com opção explícita; fora de test, essa opção falsa não o desliga. Leituras projetam o fechamento lógico sem depender de limpeza física. Inicializar API também pode inserir catálogo/versão de questionário, portanto não é inspeção somente leitura. TLS remoto exige certificado validado; disponibilidade, pool/conexão adequada a transações, backup/restauração, logs sanitizados, monitoramento, limites entre instâncias e ensaios de carga continuam requisitos operacionais. Rate limits atuais são locais ao processo. Não houve auditoria atual de vulnerabilidades; quatro moderadas no ferramental são relato histórico, não diagnóstico renovado.


## 4. O que efetivamente foi validado e homologado

### Campanhas automatizadas de referência

| Campanha | Resultado registrado | Proveniência e limite |
| --- | --- | --- |
| AUTO-QUEUE antes da integração | 87 focados e 464 frontend, sem falhas; exit 0 | Relatório AUTO-QUEUE, execução autorizada atribuída ao Codex/Luna Medium; versão da feature |
| Primeira validação da integração | 122 aprovados e 3 falhos de 125; exit 1 | Panorama original relata a execução: mocks de Home deixavam AuthContext JSX chegar ao require real; suíte completa não executada naquela tentativa. Logs originais não disponíveis nesta revisão |
| Revalidação após corrigir os mocks | **125/125 focados e 822/822 frontend**, 0 falhos/cancelados/ignorados; exit 0 nos dois comandos | Panorama original atribui a Luna Medium uma execução autorizada durante o merge ainda aberto na feature. Registro herdado, sem logs/conversa originais nesta revisão; não foi execução no SHA final da develop |
| C-04/D09 | 99/99 focados e 773/773 frontend | Relatório próprio; anterior à campanha AUTO-QUEUE integrada |
| Perfil + navegação Admin | 755 frontend, 0 falhos/ignorados | Resultado do responsável consolidado nos READMEs |
| Perfil isolado | 117 focados e 745 frontend na última campanha descrita | Relatório Perfil; casos SQL simulados não comprovam todas as bordas físicas |
| Staff B1 | 141 focados; regressão final 533 aprovados, 0 falhos/ignorados | Relatório B1; falhas intermediárias de fixtures/inventário foram documentadas |
| QA independente recuperado | 51/51 em duas cópias; guarda existente 14 aprovados | QA_RECOVERY; transporte/SQL simulados em partes, sem PostgreSQL real |
| Backend por etapas | Campanhas unitárias e PostgreSQL documentadas em E05/E06/E07/E08/T6.1; por exemplo T6.1B2 registra 32/32 PostgreSQL dedicados e 1.255/1.255 na regressão compartilhada excluindo B1/B2 | Referências históricas com bancos e exclusões próprios. Não há nova execução integral do backend atual neste levantamento |

Comandos registrados no Panorama original como usados na revalidação da integração, no diretório `app` (transcrição histórica, não executada nesta revisão):

```text
node --test tests/autoQueueSync.test.cjs tests/homeFlow.test.cjs tests/participationService.test.cjs tests/participationProvider.test.cjs tests/arenaQueueService.integration.test.cjs tests/participationActionScreens.test.cjs tests/homeReturnEvaluation.test.cjs tests/eventEntry.test.cjs
npm.cmd test
```

Os 125 focados são parte da cobertura da suíte completa, não um total adicional a somar aos 822. O teste de integração da fila usa dependências simuladas. Houve avisos de módulos ES e depreciação de `react-test-renderer`, sem falhas. Nenhum desses comandos foi reexecutado para esta documentação.

### Homologações operacionais identificadas

| Registro | Confirmado | Limite explícito |
| --- | --- | --- |
| Perfil | Conta vazia com 0/0min; histórico de duas participações com 41min | Não é campanha SQL exaustiva nem BI |
| Admin | Login/TOTP e abertura da área Heliom no Expo Go | Não homologa persistência das ações das 14 telas |
| Staff 01/02 | Vinte cenários relatados de fila externa, chamada, remoção, confirmação, retorno à tela e estações | Preparação de participantes por API; evidências materiais finais e concorrência física têm ressalvas no relatório |
| Staff A4 | Agrupamento por experiência, estações e navegação Voltar | Não equivale a carga/múltiplos operadores |
| Staff B1 | Atualização automática de entrada/retirada, preservação visual e retorno do segundo plano | Inspector de rede indisponível; suspensão de requisições não medida |
| C-04/D09 | QR físico, confirmação Staff e jornada principal de retomada/avaliação após encerramento imediato Admin | Scheduler e todos os cenários negativos não homologados fisicamente |
| AUTO-QUEUE | A4 real + Expo Go, evento Multiestações 2; conclusão nas duas estações Just Dance, estações livres, fila interna vazia e atualização automática observada | Staff operado por PowerShell; vibração física individual sem confirmação explícita; evento permaneceu aberto naquela ocasião |
| Neon | Panorama original atribui ao documento-base configuração, autenticação, Admin/TOTP, dois Staff, evento, três experiências, quatro estações e readiness aprovado em 13/11 | Relato herdado; fonte externa não disponível nesta revisão, sem acesso ou revalidação, nem atribuição às telas Admin |

### Ambiente Neon informado no diagnóstico-base

O Panorama original atribui ao documento-base um banco dedicado de testes `arenago_develop_test`, migrations 0001–0008, 26 tabelas de aplicação, catálogo de 20 jogos e questionário 1.0.0. Esses dados são relato herdado, sem acesso à fonte externa ou consulta ao banco nesta entrega. A existência do banco remoto não confirma que a API esteja hospedada ou acessível aos aparelhos fora da rede local.

O evento de homologação Neon descrito tem término em **27/11/2026 às 19h04 no fuso de Fortaleza**, anterior à apresentação proposta de 04/12. Portanto, esse registro não confirma evento aberto no dia da apresentação. Um evento válido para essa data permanece dependência operacional sem comprovação; nenhum evento foi criado ou alterado aqui. IDs operacionais, códigos de acesso, links de confirmação e credenciais não são necessários neste panorama e não foram copiados.

## 5. Divergências documentais, atualizações e limites não resolvidos

| Informação antiga/incompleta | Leitura consolidada |
| --- | --- |
| AUTO-QUEUE relata integração com develop e encerramento Git pendentes | O histórico local já contém a integração e o PR #12 em `a2bd60a`; o relatório de origem preserva o estado anterior |
| Diagnóstico-base indica ausência de regressão combinada AUTO-QUEUE + retorno/avaliação | O Panorama original relata 125/125 e 822/822 após correção dos mocks, antes do commit final do merge; logs originais não disponíveis nesta revisão. Preservado o relato sem nova certificação do HEAD |
| READMEs citam 755/773 como campanhas mais recentes nas respectivas seções | São resultados históricos válidos; 822 é campanha posterior relatada no Panorama original, com limite de proveniência explícito |
| Relatórios antigos descrevem Staff sem polling/botões operacionais liberados | Entregas posteriores B1/Staff 01/02/A4 documentam atualização e homologações; limites de operação incerta permanecem |
| Relatórios iniciais Expo/QR/UI dizem não haver ingresso ou homologação ponta a ponta | Etapas posteriores e C-04/D09 demonstram avanço do fluxo principal; permissões/câmera e cenários negativos continuam delimitados |
| Relatório Admin original fala em rota demonstrativa sem autorização real | Navegação autenticada posterior acrescenta controle real de identidade/papel; operações internas continuam demonstrativas |
| QA README contém diagnósticos RED históricos | QA_RECOVERY documenta a recuperação para 51/51; não é nova execução da base atual |
| Referências antigas indicam Neon não preparada | O documento-base relata preparação posterior. Falta incorporar uma evidência operacional portátil desse relato ao repositório, se desejado |
| D/C antigos dizem serviços futuros, C-15 “sem rota”, catálogo/idade civil indefinidos, 23 tabelas/cinco migrations | Contratos e integração posteriores, normalizador reutilizado, fuso civil configurável e 26 tabelas/oito migrations estão documentados na Arquitetura §27. Não converter notas antigas em pendências atuais. |
| Panorama tratava “envio/edição” de avaliação como conjunto integrado | Controller E08.11 implementa POST/PATCH, mas serviços/telas reais inspecionados (`participationActionService`, `RealEvaluationScreen`, detalhes) oferecem envio/consulta, sem chamada PATCH de avaliação encontrada. Edição e comentário tardio permanecem lacuna de integração, sem nova homologação. |
| D09 prevê antecipar fim; E08.8 recusa novo encerramento após início | [E08.8](E08_8_IMPLEMENTACAO.md) delimita a entrega ao encerramento inicial/replay e considera a semântica da segunda intenção ainda não aprovada. [AdminCloseService](../backend/src/events/admin-close.service.ts) recusa evento já `closing`/com fechamento registrado. Preservar D09 e registrar a divergência para esclarecimento do responsável, sem inventar resolução ou alegar antecipação disponível. |
| Mínimo de dois Admins aptos versus proteção do último | [T6.1-D, “Decisões sobre Admins”](T6_1_D_IMPLEMENTACAO.md) explica a proteção implementada de um e a ausência de distinção operacional automática. Requisito de dois antes de evento real continua vigente; credenciamento do segundo e controles precisam ser resolvidos. |
| D10/C-07 versus histórico externo protegido | 0008 bloqueia DELETE/TRUNCATE e preserva vínculo com participação; anonimizar apenas ator não implementa exclusão completa. Política e procedimento compatíveis continuam pendentes, sem autorização para retirar proteções. |
| Estatísticas do Perfil versus indicadores A/B | Perfil inclui finalização automática no tempo somado; BI separa última conclusão e saída voluntária. Não há equivalência nem nova definição de negócio (§3.8). |
| Documento antigo chama Planejamento de fonte de verdade; pedido atual define Panorama principal | Panorama passa a ser diagnóstico/inventário principal. Planejamento histórico continua fonte das decisões aprovadas; Arquitetura/código/DDL indicam contratos/implementação e relatórios comprovam campanhas. Não modificar nem apagar documentos históricos. |
| Panorama original tinha P01–P11, prioridades e janelas de 13/11 a 04/12 | Esses elementos eram propostas, não regras aprovadas. Os temas de escopo, ambiente, build, contas, Admin, validação, contingência, acabamento, acesso, privacidade e BI foram preservados nas §§6–9; sequência/prioridades/calendário não são adotados nesta consolidação. |

Os documentos históricos não foram reescritos nesta entrega. Para próximas atualizações, acrescentar data, base, resultado e escopo ao documento correspondente; evitar substituir indiscriminadamente toda ocorrência de “pendente”.

## 6. O que falta: implementação, integração, comprovação e operação

### Lacunas de produto e integração

1. **Admin operacional no aplicativo:** configuração de eventos, experiências, estações e Staff tem contratos backend; as 14 telas ainda não persistem suas ações. O inventário preserva essa lacuna sem escolher recorte ou prioridade de implementação.
2. **BI real e exportação:** implementar os indicadores/populações já aprovados na §3.8, após especificação dos detalhes ainda abertos de contratos, filtros, formatos, acesso e privacidade. Fixtures e estatísticas do Perfil não substituem o BI administrativo.
3. **Ciclo de acesso:** recuperação de senha e onboarding/reset TOTP geral de Admins, incluindo o segundo Admin apto exigido no planejamento antes de evento real.
4. **Operações Staff incertas:** concluir desenho e implementação segura de prova de origem, retenção e recuperação. Não liberar reenvio só porque o TTL passou ou a consulta de fila mudou.
5. **Privacidade e retenção:** conciliar exclusão/anonimização, histórico protegido, comentários, pequenos grupos, dados de menores e backups. Há decisões de produto e segurança além da codificação.
6. **Avaliação e encerramento:** integrar edição/primeiro comentário tardio no app e esclarecer a semântica de antecipação de encerramento controlado já iniciado (§5); contratos existentes não comprovam essas jornadas.
7. **Push:** previsto para etapa posterior por D11; os avisos internos e a vibração local existentes não o implementam.

### Lacunas de comprovação

- Vibração física individual, suspensão/retomada e alertas em aparelhos escolhidos.
- Jornadas de fila e estação com múltiplos operadores/dispositivos, inclusive respostas incertas e perda de rede.
- Encerramento automático e retorno/avaliação no fluxo completo, além do fechamento imediato homologado.
- Câmera/QR, permissões, falhas, acessibilidade e diferentes condições de uso.
- Regressão backend atual, campanhas PostgreSQL delimitadas e casos SQL extremos de estatísticas, conforme autorização e ambiente próprio.
- Ensaio da versão distribuída com API remota, sem dependência do Metro/notebook.

### Lacunas operacionais

- Confirmar hospedagem da API, HTTPS, URL usada pelo build, envio de e-mail e disponibilidade do scheduler.
- Identidade final do aplicativo, assinatura e estratégia de distribuição Android/iOS. A inspeção confirma ausência de `app/eas.json` e identificadores definitivos em `app.json`; não conclui que inexista configuração externa em contas de serviço.
- Contas e concessões para a apresentação, evento com período correto, QR definitivo e massa sintética coerente.
- Backup/restauração, proteção e recuperação de chaves, logs sanitizados, monitoramento, responsáveis e plano de contingência.

Não foi realizada pesquisa de fornecedores nesta entrega. As sugestões Railway/Render/EAS do diagnóstico-base permanecem alternativas a avaliar; preços, limites e condições de distribuição deverão ser conferidos antes de contratar ou implantar.

## 7. Contexto da apresentação e dependências conhecidas

O responsável informou apresentação aos clientes na **UNDB em 04/12/2026** e aplicativo **pronto, compilado, instalado e validado até 02/12/2026**. São marcos futuros conhecidos. Esta seção não distribui tarefas, estabelece prioridades ou aprova um cronograma intermediário.

Admin e BI são partes importantes do produto e devem ser considerados no planejamento futuro; não estão automaticamente adiados para depois da apresentação. O recorte de demonstração ainda depende do responsável, sem reduzir os requisitos conhecidos do produto.

| Dependência | O que o inventário permite afirmar |
| --- | --- |
| Hospedagem do backend e acesso remoto à API | Sem evidência de serviço HTTPS acessível aos aparelhos fora da rede local nesta revisão. A URL do Expo e a API são serviços distintos. |
| Conexão com Neon | Há relato herdado de preparação de banco; não houve acesso ou comprovação operacional nova. Confirmar ambiente/migrations/TLS é atividade futura autorizada separadamente. |
| Build instalável e distribuição | Expo Go e bundles não comprovam artefato instalado sem Metro. Plataforma, identificadores, assinatura e canal de distribuição permanecem abertos. |
| Evento, contas e permissões | O evento relatado termina antes da apresentação; não há comprovação de evento pronto no período final, contas/concessões adequadas ou QR definitivo. |
| Aparelhos físicos e jornada conjunta | Existem homologações delimitadas, sem ensaio integral comprovado do candidato distribuído com API remota, múltiplos operadores, rede e contingência. |
| Recuperação e operação | Backup/restauração, logs, disponibilidade do scheduler, rede/dispositivo alternativos e critérios de aceite ainda não estão comprovados para o ambiente final. |

Os antigos itens P01–P11 tratavam desses temas e das lacunas de §§6/8/9. Seu conteúdo de diagnóstico foi preservado; prioridades, sequência e janelas intermediárias não são um novo plano aprovado.

## 8. Pontos que dependem de decisão futura do responsável

Estas pendências não reabrem D01–D11/C-01–C-15 nem autorizam execução.

1. **Produto/papéis:** definir o comportamento de conta Admin como participante/jogador, preservando permissões acumuláveis e sem inferir decisão da navegação exclusiva atual.
2. **Encerramento D09:** esclarecer a semântica de segunda intenção para antecipar um controlado já iniciado, diante da recusa atual; preservar a diretriz aprovada sem implementar transição nesta tarefa.
3. **Acesso administrativo:** definir onboarding/reset geral, verificação de identidade e controles para cumprir dois Admins aptos em operação real. Não há recuperação emergencial sem segundo Admin aprovada.
4. **Privacidade:** bases/finalidades, menores, retenção identificável, direitos/exclusão, anonimização comprovada, pequenos grupos, comentários e backups; compatibilizar com snapshots e proteções da 0008. Moderação e políticas excepcionais de correção também permanecem abertas.
5. **BI/exportações:** especificar gráficos/dimensões, granularidade e filtros por evento/período, populações ainda não detalhadas, formatos finais e permissões/auditoria; manter indicadores A/B e download manual já aprovados.
6. **Idempotência/operação incerta:** aprovar retenção de prova, expurgo, origem e reconciliação segura antes de desbloquear reenvio; TTL técnico não é decisão suficiente.
7. **Apresentação:** definir roteiro e quais ações Admin/BI serão reais, demonstrativas ou não exibidas, critérios de aceite e dispositivos Android/iOS, quantidade de aparelhos/operadores/participantes. As datas de 02/12 e 04/12 já foram informadas, não precisam ser reinventadas como pendência.
8. **Infraestrutura/distribuição:** selecionar ambiente/API/banco, orçamento, identidade/assinatura/canal do app e condições de recuperação. Nenhuma contratação, publicação ou escolha operacional foi feita nesta revisão.
9. **Uso posterior:** esclarecer se haverá nova demonstração, piloto controlado ou público real; os requisitos próprios de privacidade, segurança, carga e operação permanecem aplicáveis conforme esse contexto.

## 9. Evidências de prontidão ainda necessárias e manutenção do panorama

### Evidências para apresentação controlada — sem confirmação do candidato

- [ ] SHA/versão do build e ambiente registrados.
- [ ] Aplicativo instalado e funcional nos aparelhos escolhidos, sem Metro.
- [ ] API remota acessível e evento aberto/pronto durante toda a apresentação.
- [ ] Contas, papéis, QR, experiências e estações preparados e ensaiados.
- [ ] Jornada Participante → entrada Staff → fila interna → chamada → conclusão → histórico/avaliação aprovada no ambiente final.
- [ ] Retomada, rede e feedback testados; vibração física marcada separadamente.
- [ ] Toda ação Admin apresentada como real comprovadamente integrada à API.
- [ ] Campanhas autorizadas do candidato registradas com resultados, falhas/skips e limites.
- [ ] Responsáveis, rede/dispositivo alternativos e recuperação definidos.
- [ ] Roteiro aceito e funcionalidades demonstrativas explicitamente identificadas.

### Não confundir com pronto para produção

Aceitar a demonstração não certifica capacidade de carga, segurança integral, retenção/LGPD, recuperação de desastre ou operação com público real. Esses critérios devem compor uma etapa própria, com responsáveis e evidências.

### Como atualizar sem perder o histórico

Para cada nova entrega, registrar: funcionalidade, estado anterior e novo, SHA/branch, ambiente, comando e exit code quando houver, executor da validação, cenário manual observado, limitações e fonte. Atualizar este panorama por área e manter os relatórios originais como evidência. Não atribuir automaticamente “homologado” a uma funcionalidade que apenas ganhou testes.

## 10. Mapa das fontes para aprofundamento

| Grupo | Fontes principais | Uso neste panorama |
| --- | --- | --- |
| Visão consolidada | [README raiz](../README.md), [app](../app/README.md), [backend](../backend/README.md), [QA](../qa/regression/README.md) | Organização, integrações, ambiente, limites e campanhas históricas |
| Contratos e decisões | [Planejamento](PLANEJAMENTO_ARENAGO.md), [Arquitetura](ARQUITETURA_BACKEND_ARENAGO.md), especialmente consolidação §27 | Regras e divergências; distinguir propostas antigas de entregas posteriores |
| Identidade/Admin | [Sessão estável](AUTH_STABLE_SESSION_BINDING_IMPLEMENTACAO.md), [TOTP Expo](EXPO_ADMIN_TOTP_IMPLEMENTACAO.md), [T6.1B2](T6_1_B2_IMPLEMENTACAO.md), [T6.1C](T6_1_C_IMPLEMENTACAO.md), [T6.1D](T6_1_D_IMPLEMENTACAO.md), [Admin autenticado](ADMIN_AUTHENTICATED_NAVIGATION_IMPLEMENTACAO.md), [Admin final](ADMIN_FINAL_IMPLEMENTACAO.md) | Acesso real, operações demonstrativas, limites de onboarding e recuperação |
| Participante | [Etapa 1](EXPO_BACKEND_ETAPA1_IMPLEMENTACAO.md), [Etapa 2](EXPO_BACKEND_ETAPA2_IMPLEMENTACAO.md), [Etapa 3](EXPO_BACKEND_ETAPA3_IMPLEMENTACAO.md), [Etapa 4](EXPO_BACKEND_ETAPA4_IMPLEMENTACAO.md), [QR](ENTRY_QR_01_IMPLEMENTACAO.md), [Perfil](PROFILE_REAL_STATISTICS_IMPLEMENTACAO.md), [Avaliação](EXPO_PARTICIPACAO_FINALIZACAO_AVALIACAO_IMPLEMENTACAO.md), [C-04/D09](RETURN_AFTER_CLOSURE_C04_D09_IMPLEMENTACAO.md), [AUTO-QUEUE](AUTO_QUEUE_01_IMPLEMENTACAO.md) | Evolução da integração, campanhas e homologações |
| Visual | [UI Participante](UI_PARTICIPANT_INTEGRATION_IMPLEMENTACAO.md), [Splash](SPLASH_01_IMPLEMENTACAO.md), [SDK58](EXPO_SDK_58_MIGRACAO.md) | Implementação visual, validação e distribuição ainda distinta de exportação |
| Staff | [Entrada/chamadas](STAFF_ENTRY_CALL_FLOW_IMPLEMENTACAO.md), [Estação](STAFF_STATION_OPERATIONAL_IMPLEMENTACAO.md), [A4](STAFF_A4_IMPLEMENTACAO.md), [B1](STAFF_B1_IMPLEMENTACAO.md), [B2](STAFF_B2_IMPLEMENTACAO.md), [Histórico](STAFF_HISTORICAL_RECONCILIATION_IMPLEMENTACAO.md), [Retenção/origem](STAFF_IDEMPOTENCY_ORIGIN_RETENTION_DESIGN.md), [Schema](STAFF_IDEMPOTENCY_SCHEMA_PREPARACAO.md), [Cutoff](STAFF_TERMINAL_CUTOFF_FIX_IMPLEMENTACAO.md) | Operação atual, evidências e recuperação ainda delimitada |
| Backend por etapa | E05/E06; E07.1–6; E08.1–14; E08-EST01–05; T6.1A1/A2/B1/B2/C/D em `docs/` | Inventário de domínio/HTTP e campanhas históricas; sem alegação de nova regressão completa |
| QA | [Recuperação independente](QA_RECOVERY_IMPLEMENTACAO.md) | Resultado posterior aos diagnósticos RED históricos |
| Fonte externa herdada | `DIAGNOSTICO_ARENAGO_PLANO_DEMONSTRACAO_2026-12-04.md`, citado no Panorama recebido | Relato Neon e contexto original; arquivo não disponível nesta revisão. Proposta antiga de cronograma não adotada como planejamento vigente |

### Registro desta entrega documental

Consolidação documental em 14/11/2026 sobre a develop `a2bd60a9d2efd462da1cbeaac26d4956dae99375`, incorporando conhecimento do Planejamento antigo ao Panorama fornecido. O Panorama original não estava rastreado; a comparação desta tarefa usa seu snapshot local anterior à edição (SHA-256 `072664bb96b37e7565c081793d9026ff66058fd4b7a3d94948bb9199b886ba3f`). Preservados inventário, campanhas/contagens, ressalvas, fontes e contexto relevantes; o antigo plano P01–P11/calendário foi convertido em lacunas e dependências, sem adotar suas prioridades.

As decisões D01–D11, C-01–C-15, DA-01–03 e RA-01 foram recuperadas com condições/exceções; os limites de integração, proveniência e divergências permanecem explícitos. Os resultados históricos não foram reexecutados. Inspeções estáticas são distintas de validações automatizadas autorizadas do Codex e de homologações/validações manuais do responsável. Nenhum teste, lint, typecheck, build, serviço, banco ou arquivo `.env` foi executado/consultado nesta revisão.

Relatório desta consolidação: [CONSOLIDACAO_PANORAMA_IMPLEMENTACAO.md](CONSOLIDACAO_PANORAMA_IMPLEMENTACAO.md). Evidência única: `qa-evidence/CONSOLIDACAO_PANORAMA-changes.diff`, incremental sobre o snapshot original do Panorama e incluindo o relatório novo, excluída a própria evidência. A referência antiga a `PANORAMA-ARENAGO-changes.diff` pertencia à criação original e não comprova existência de patch nesta revisão. Não foram modificados Planejamento, Arquitetura, READMEs, instruções, código, testes, configurações, dependências, migrations ou índice/histórico Git. Nenhum planejamento novo foi criado; documento aguarda revisão do responsável.
