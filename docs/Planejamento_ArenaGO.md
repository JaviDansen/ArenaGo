# ArenaGo — Plano de desenvolvimento e arquitetura inicial

**Versão:** 0.6 (regras operacionais consolidadas para participações, filas, encerramentos e BI)  
**Data:** 16/10/2026  
**Status:** Regras principais de negócio D01–D11 consolidadas; modelagem conceitual do banco, detalhes técnicos e implementação do backend ainda pendentes  
**Fontes:** auditorias técnicas do Codex, resultados das etapas de testes e README atualizado relatados na conversa, e decisões de produto aprovadas em discussão até 16/10/2026.  

> Este documento distingue **verificado no código**, **decisão já informada pelo projeto**, **proposta técnica** e **decisão pendente**. Nenhuma tabela, endpoint ou tecnologia sugerida aqui significa que já exista no repositório.

## 1. Objetivo e escopo

O ArenaGo é um aplicativo para participantes de eventos com experiências. O objetivo do próximo ciclo é consolidar os fluxos locais, documentar o produto e substituir gradualmente as simulações por operações centralizadas, persistentes e seguras no backend.

**Fora do escopo imediato:** implementar todas as telas de administração e staff, notificações push, QR Code, relatórios avançados, infraestrutura distribuída ou migração completa do aplicativo de uma só vez. Essas capacidades exigem contratos e decisões próprias.

## 2. Estado atual verificado

- Aplicativo React Native com Expo; navegação Stack e abas Início, Eventos e Perfil.
- `ParticipationContext` mantém **uma participação atual em memória**, sem persistência.
- Cadastro, login e recuperação de senha não realizam autenticação real.
- Questionário de perfil em três etapas, com validações locais.
- Entrada em eventos por código usando mocks `FILA` e `LIVRE`, aceitando variações de maiúsculas/minúsculas e espaços externos. A consulta valida apenas propriedades próprias do objeto, evitando aceitar `toString` como evento.
- Fila externa e filas de experiências simuladas; posições não representam uma fila compartilhada.
- Simulações de chamada, ausência e confirmação do staff; check confirmado incrementa `experienceParticipations`.
- Finalização da participação encaminha à avaliação; envio e “Avaliar mais tarde” não persistem dados.
- Aba Eventos e aba Perfil ainda são placeholders: `EventsScreen` e `ProfileScreen` exibem apenas seus rótulos. O `ProfileQuestionnaireScreen` é separado e já possui interface e validações locais.
- README revisado com instalação reproduzível via `npm.cmd ci`, comandos executados na pasta `app`, funcionalidades e limitações atuais.
- **86 testes automatizados passando**, conforme última execução relatada pelo Codex; `git diff --check` também passou. Commits e push da revisão foram confirmados pelo usuário. Não houve medição percentual de cobertura.

### 2.1 Cobertura automatizada após a revisão

| Área | Situação verificada na revisão |
|---|---|
| Datas e seletor de nascimento | Validações, cancelamento e nova seleção, incluindo diferenças entre iPhone e Android |
| Cadastro e login locais | Validação, correção de erros, navegação e ausência de senhas nos parâmetros |
| Questionário | Obrigatoriedade, correção de respostas, mensagens de erro e preservação entre etapas |
| Entrada e confirmação de evento | `FILA`/`LIVRE`, normalização do código, códigos inválidos, `toString` e estados iniciais |
| Fila externa e Home | Liberação, saída, desativação simulada e escolha de tela por estado |
| Arena | Exclusividade de filas, chamada, ausência, conclusão simulada e preservação de dados |
| Finalização | Confirmação/cancelamento, limpeza de fila ou experiência ativa e ida à avaliação |
| Avaliação | Validação local, envio simulado e opção “Avaliar mais tarde” |
| **Total da suíte** | **86 testes passando; nenhuma falha na última execução informada** |

A revisão partiu de 41 testes e acrescentou **45 testes** ao longo das etapas, além de corrigir a consulta a propriedades herdadas e a diferenciação indevida entre maiúsculas/minúsculas nos códigos. As verificações são locais; não há testes de backend, persistência ou concorrência distribuída.

**Limitação importante:** o harness de testes simula React Native e navegação; ele não comprova a integração nativa real nem o comportamento entre dispositivos. A validação no iPhone deve continuar sendo feita nos fluxos visuais afetados.

### 2.2 Checkpoint de desenvolvimento

- Revisão de testes e README: **concluída**.
- Commits da revisão e envio ao remoto `develop`: **confirmados pelo usuário**.
- Backend, banco de dados, autenticação real e sincronização de filas: **não implementados**.
- A arquitetura mínima e as regras D01–D11 foram aprovadas após esta revisão; permanecem pendentes detalhes operacionais, contratos e implantação.

## 3. Princípios para a evolução

1. **Backend como autoridade:** autenticação, elegibilidade, filas, chamadas, checks, finalização e avaliações devem ser validados no servidor.
2. **Aplicativo como interface:** estado local continua útil para formulários e apresentação, mas não define a ordem global das filas.
3. **Incrementos verticais pequenos:** implementar uma operação no backend, testar e conectar um fluxo do aplicativo antes de avançar.
4. **Dados identificados:** usar IDs estáveis para usuário, evento, participação, experiência e atendimento.
5. **Operações seguras contra repetição:** um check repetido da mesma ocorrência não pode incrementar duas vezes; uma nova participação legítima na mesma experiência deve contar novamente.
6. **Persistência e recuperação:** reiniciar o aplicativo não deve apagar uma participação válida ou uma avaliação pendente.
7. **Sem simulações apresentadas como produção:** distinguir botões de demonstração, mocks e recursos reais.

## 4. Roadmap proposto

| Fase | Entrega | Critério de conclusão | Dependência |
|---|---|---|---|
| **0 — Qualidade local** | Ampliação de testes de autenticação, entrada em eventos, fila externa, Arena, finalização e questionário | **Concluída na revisão automatizada: 86 testes passando**; testes manuais no iPhone continuam recomendados quando aplicáveis | Nenhuma |
| **1 — Documentação** | README fiel ao aplicativo; planejamento versionado no repositório | README concluído; planejamento atualizado para v0.6 neste repositório | Fase 0 |
| **2 — Decisões de domínio** | D01–D11 aprovadas/refinadas; preparar glossário/estados e modelo conceitual | Regras operacionais consolidadas em v0.6; detalhes técnicos continuam pendentes | Discussão com responsáveis pelo evento |
| **3 — Fundação do backend** | Repositório/estrutura de API, configuração, banco, migrações e testes básicos | API inicializa, conecta ao banco e aplica migrações em ambiente local | Fase 2 para modelagem de domínio; tecnologia escolhida |
| **4 — Identidade e perfil** | Cadastro, login, sessão, perfil e questionário persistidos | Conta e perfil recuperáveis; permissões e validação no servidor | Fase 3 |
| **5 — Eventos e participações** | Consulta por código, confirmação, entrada e finalização | IDs persistentes; estados recuperáveis após reiniciar o app | Fase 4 |
| **6 — Filas e atendimentos** | Fila externa/interna, chamadas, ausência, check do staff | Ordem compartilhada e consistência em acessos concorrentes; autorização | Fase 5; regras de estações e atendimento |
| **7 — Avaliações e histórico** | Avaliar agora/depois, consulta de pendências na aba Eventos, contagem/histórico | Avaliação vinculada à participação, sem duplicidade, recuperável | Fase 5; encerramento definido |
| **8 — Tempo real e operação** | Atualizações em tempo real, reconexão, controles de staff/admin e notificações conforme escopo | Clientes sincronizados; falhas e reconexão tratadas | Fases 6–7 |
| **9 — Validação integrada** | Testes ponta a ponta, carga/concorrência, segurança e implantação piloto | Fluxos reais validados com múltiplos usuários/dispositivos | Fases anteriores |

**Observação:** fases 6 e 7 podem ter partes desenvolvidas em paralelo, mas nenhuma depende de inventar persistência no Context. A fase 0 deve priorizar os cenários mais críticos, sem exigir cobertura de 100% antes de iniciar o backend.

### 4.1 Resultado da revisão e nova prioridade

As seis frentes de testes e o README foram concluídos. A auditoria de preparação para backend também foi recebida, assim como as análises comparativas de NestJS/Fastify e Prisma/Drizzle/`pg`. **Não repetir essas atividades como pendentes.**

A fase 2 consolidou as principais regras operacionais em v0.6. Permanecem pendentes detalhes técnicos de modelagem, concorrência, API, infraestrutura, BI e LGPD. As regras aprovadas ainda não estão implementadas. A próxima etapa de produto é preparar, em documento separado, a modelagem conceitual do banco de dados.

**Regra de trabalho mantida:** mudanças pequenas, testes de regressão e commits em pontos lógicos.

## 5. Arquitetura aprovada e integração

**DA-01 — Aprovada:** Node.js + TypeScript + **NestJS com adaptador HTTP padrão**, em **monólito modular**, usando **PostgreSQL**. O **Neon** é a escolha preferida para hospedar o banco, condicionada à disponibilidade e às cotas do plano gratuito. A hospedagem da API permanece pendente. Não exigir adaptador Fastify nem microsserviços inicialmente.

**DA-02 — Aprovada:** **Drizzle ORM + driver `pg`**, com **migrações SQL versionadas utilizando Drizzle Kit**. As versões estáveis, configuração TLS/pool, processo de migração e ambientes de teste serão definidos antes da instalação. Transações interativas de filas devem usar conexão adequada e o mesmo cliente durante toda a transação; o ORM não substitui restrições e bloqueios do PostgreSQL.

```text
Aplicativo ArenaGo (Expo / React Native)
  ├─ Telas, formulários, navegação
  ├─ Estado local de interface e cache recuperável
  └─ Cliente HTTPS / sincronização (tempo real posterior)
                   │
                   ▼
API NestJS (Node.js + TypeScript; monólito modular)
  ├─ Identidade, perfil e autorização por evento
  ├─ Eventos, experiências e estações
  ├─ Participações, filas e atendimentos
  ├─ Conclusões, avaliações e histórico
  └─ Integrações opcionais (exportações manuais do BI (sem integração direta com Drive))
                   │
                   ▼
Drizzle ORM + pg + migrações SQL
                   │
                   ▼
PostgreSQL (Neon Free condicionado às cotas)
  ├─ Integridade referencial e unicidade
  ├─ Transações, bloqueios e idempotência
  └─ Histórico persistente
```

**Custo zero:** tecnologias de desenvolvimento sem licenças pagas; isso não garante hospedagem gratuita contínua. Confirmar limites e viabilidade operacional de API, Neon e eventuais serviços externos antes do piloto.

**Google Drive / RA-01 — decisão de produto atualizada:** o BI administrativo será a principal interface de análise e o PostgreSQL será a fonte de verdade. Não haverá integração direta com Google Drive nem OAuth Google no escopo atual. O Admin poderá baixar exportações manuais de dados autorizados, inicialmente priorizando CSV e XLSX; PDF permanece formato possível, não confirmado como entrega. O arquivo baixado poderá ser enviado manualmente ao Drive pela organização. Formatos exatos, filtros exportáveis, controles e trilha de exportações ainda precisam de especificação.

### 5.1 Fronteiras de responsabilidade

| Regra/ação | Cliente | Servidor |
|---|---|---|
| Seleção de estrelas e digitação de comentário | Controla interface | — |
| Validação rápida de formulário | Feedback imediato | Revalida dados recebidos |
| Login | Coleta credenciais | Autentica e autoriza |
| Entrar em evento | Solicita | Valida código, elegibilidade e cria participação |
| Posição de fila | Exibe estado recebido | Mantém ordenação compartilhada |
| Chamada e ausência | Mostra e solicita ação permitida | Autoriza, transiciona e registra |
| Check do staff | Interface própria autorizada | Registra uma conclusão por atendimento |
| Avaliar mais tarde | Navega sem envio | Mantém elegibilidade/pendência consultável |
| Enviar avaliação | Envia nota e comentário | Valida, persiste e confirma sucesso |

## 6. Modelo conceitual inicial do banco de dados

**Abaixo estão entidades candidatas, não um esquema SQL aprovado.**

| Entidade | Finalidade | Relacionamentos principais |
|---|---|---|
| `users` | Identidade do participante e/ou operador | 1:N participações; 1:1 ou 1:N perfis conforme versão |
| `profiles` | Respostas de perfil e questionário | N:1 usuário |
| `events` | Edição operacional do evento, código, situação e período | 1:N experiências e participações |
| `experiences` | Atividade ofertada em determinado evento | N:1 evento; 1:N entradas de fila e atendimentos |
| `participations` | Vínculo de usuário com evento e estado da participação | N:1 usuário; N:1 evento |
| `queue_entries` | Registro de entrada, ordem e estado na fila | N:1 participação; fila externa ou fila de experiência conforme modelagem escolhida |
| `service_sessions` (ou `attendances`) | Ocorrência identificada de chamada/atendimento | N:1 participação; N:1 experiência; possivelmente N:1 estação |
| `experience_completions` | Confirmação única de uma ocorrência concluída | 1:1 atendimento concluído, ou campo de conclusão na própria ocorrência — decidir |
| `evaluations` | Avaliação submetida, associada à participação | N:1 participação, com unicidade por participação (D08) |
| `event_roles` / `staff_assignments` | Permissões de staff e gestão por evento | N:1 usuário; N:1 evento |
| `stations` **(prevista conceitualmente)** | Dispositivos/posições de atendimento | N:1 experiência; atributos operacionais a definir |

### 6.1 Relações centrais

```text
Usuário 1 ── N Participação N ── 1 Evento
                                  │
                                  └── N Experiência
Participação 1 ── N Entrada de fila
Participação 1 ── N Atendimento N ── 1 Experiência
Atendimento 1 ── 0..1 Conclusão
Participação 1 ── 0..1 Avaliação  [D08 aprovada]
```

### 6.2 Decisões de modelagem especialmente importantes

- **D01 aprovada/refinada:** cada experiência tem **uma fila compartilhada** por todas as suas estações. Staff autorizado pelo evento e Admin global podem alterar a disponibilidade operacional disponível/indisponível; ela é separada da ocupação. Uma chamada pendente precisa ser resolvida antes de desativar a estação. Estações indisponíveis não fazem chamadas novas; desativá-las não fecha a fila nem afeta outras estações. Não há transferência, prioridade especial ou cancelamento técnico específico. Problemas técnicos podem ser tratados presencialmente pelo fluxo atual de ausência quando necessário; ausência não prova falta real. `stations` integra o modelo conceitual.
- **D02 aprovada:** saída voluntária da fila externa cancela aquela participação, perde definitivamente a posição e não dá direito a avaliar. É permitido ingressar novamente enquanto o evento permitir entradas; cada ingresso cria nova participação, sem recuperar a posição anterior. A interface de saída já existe, mas a persistência não está implementada. Reentrada no mesmo evento cria nova participação identificada, sem apagar histórico anterior.
- **D03 aprovada:** no máximo **uma participação não finalizada/ativa por usuário** entre eventos; inclui espera externa. O participante pode finalizar participação ativa sem concluir experiências. Finalizar enquanto aguarda experiência remove a inscrição da fila interna, não registra ausência e preserva conclusões anteriores. Finalizar após chamada cancela a chamada por desistência, libera a estação para novas chamadas se disponível, e não conta como ausência nem conclusão. Só participação com ao menos uma experiência concluída e confirmada pelo Staff é elegível para avaliação, inclusive posterior. A navegação atual restringe entrada, mas não garante exclusividade entre dispositivos.
- **D04 aprovada:** autorização de Staff **por evento**, válida para operar todas as experiências desse evento; autorização não se transfere para outros eventos. A concessão e revogação de permissões seguem a regra de identidade/perfis da seção 9.2; detalhes de auditoria e primeiro Admin permanecem no escopo técnico.
- **D05 aprovada:** atendimento simplificado **aguardando → chamado → concluído**, com registro manual pelo Staff de conclusão ou ausência. Não há timeout automático individual durante operação normal; a estação não faz nova chamada enquanto houver ocorrência pendente. Ausência retorna o participante ao fim da fila compartilhada enquanto a janela de chamadas estiver aberta; depois dela não há retorno. Finalização voluntária pode cancelar chamada como desistência. Encerramento definitivo do evento cancela automaticamente chamadas pendentes conforme D07.
- **D06 aprovada:** ao desativar fila externa, **todos os participantes `waiting` são liberados para `active`**, sem alterar filas internas; novos ingressos passam diretamente ao estado ativo enquanto desativada. Se reativada, **apenas novas participações** voltam a aguardar, sem retirar estado `active` de quem foi liberado.
- **D07 aprovada (detalhada):** sem lotação controlada pelo app. No horário oficial, bloquear definitivamente novas participações, reentradas e inscrições em filas. Há margem operacional de até uma hora para chamadas de quem já aguardava, sem obrigação de continuar atendendo o público; a organização pode encerrar antes pelas ações administrativas autorizadas. Ao final da janela, encerrar automaticamente esperas e cancelar chamadas ainda pendentes, sem registrar ausência ou conclusão. Depois do limite, não permitir novas chamadas nem confirmar conclusão de ocorrência cancelada. Preservar conclusões anteriores e finalizar automaticamente participações ainda abertas, mesmo com o aplicativo fechado. Backend deve resolver concorrência entre confirmações e encerramentos de forma consistente. Não reabrir após fechamento definitivo. Eventos somente no Brasil na primeira versão; instantes em UTC e fuso IANA da localidade. Admin pode antecipar ou prolongar horário oficial somente antes do fechamento definitivo e nunca para momento igual ou anterior ao atual; encerramento imediato usa D09.
- **D08 aprovada:** **zero ou uma avaliação por participação**, nota de 1 a 5 obrigatória e comentário opcional; primeiro envio em até 30 dias após finalização; edição completa em até 7 dias do primeiro envio; dias 8–30 permitem um comentário se ainda não houver nenhum; depois, definitiva. Nova participação no mesmo evento pode gerar nova avaliação.
- **D09 aprovada (detalhada):** mantém modo **imediato**, que interrompe operações pendentes, e modo **controlado**, que permite margem de até uma hora respeitando o limite programado anterior quando aplicável. Admin pode encerrar antes do limite, sem manter filas abertas até o máximo. Encerramentos antecipados exigem justificativa; auditar modo, motivo, responsável e horário. Ao limite operacional aplicável, encerrar esperas e chamadas conforme D07. Participantes recebem mensagens automáticas padronizadas no aplicativo; sem mensagens personalizadas pelo Admin ou push nesta versão. Justificativa não é exibida automaticamente. Não definir comportamentos além destes.
- **D10 aprovada/refinada:** BI prioritariamente **agregado e estatístico**, sem identificação nominal de participantes. Preservar por prazo indeterminado **dados efetivamente anônimos** de participações, experiências, avaliações e indicadores; manter dados pessoais de contas ativas somente enquanto houver finalidade legítima. Registrar o **snapshot das respostas do questionário em cada nova participação**: eventos antigos permanecem com respostas da época, novas participações usam respostas atualizadas. Na exclusão da conta durante evento: encerrar participação e esperas/chamados pendentes, preservar conclusões, revogar sessões, eliminar credenciais e anonimizar histórico quando aplicável. **Não excluir automaticamente contas inativas** na primeira versão.
- **D11 aprovada:** avisos **dentro do aplicativo** primeiro; push fica para avaliação posterior. O servidor é a fonte oficial das posições e chamadas.
- **Repetição de experiências:** permitida, com nova entrada no fim da fila e nova ocorrência de atendimento; conclusão única **por atendimento**, não por par participante/experiência. Contadores são derivados de conclusões persistidas.
- **Integridade:** impedir ocupação simultânea de filas/atendimentos incompatíveis, duplicidade por retry e inconsistência em chamadas concorrentes. Índices em tabelas distintas podem não assegurar exclusividade global: definir ponto comum de controle por participação ou ocupação unificada.
- **Avaliação pendente:** pode ser derivada de participação finalizada sem avaliação; a implementação será definida na modelagem.

## 7. Estados e operações a especificar antes da API

### Participação e encerramento

```text
waiting --[liberação externa]--> active --[finalização voluntária]--> finished
   |                                  |                         |
   +--[saída externa: cancelada]      +--[finalização durante   +-- elegível a avaliar
                                      |   espera: remove fila]      somente se houve
                                      +--[finalização após chamada:  conclusão confirmada
                                          cancela chamada por
                                          desistência]

active --[limite operacional D07]--> finalizada automaticamente
```

`waiting`, `active` e `finished` são nomes usados no frontend, **não um esquema de banco aprovado**. D02–D03 definem as regras de reentrada, exclusividade e cancelamento acima. Participação cancelada ao sair da fila externa não é avaliável. Finalização voluntária ou automática de participação ativa não exige experiência concluída, mas avaliação exige ao menos uma conclusão confirmada pelo Staff. O limite oficial bloqueia novas entradas; o limite operacional posterior encerra esperas, chamadas pendentes e participações restantes.

### Fila de experiência e atendimento

```text
Fila da experiência: ABERTA <--> FECHADA_PARA_NOVAS_ENTRADAS
      |                                  |
      |                                  +-- mantém participantes já na fila
      +-- todas as estações da experiência atendem a mesma fila

Aguardando na fila --> Chamado --> Concluído
                          |
                          +--> Ausência --> [fim da fila, se janela de chamadas aberta; senão encerramento da entrada]
```

Uma estação pode estar disponível ou indisponível independentemente da abertura da fila. D05 não exige estados separados de chegada e início. Durante operação normal não há timeout individual: Staff resolve manualmente a ocorrência pendente antes de nova chamada da estação. Ao fechamento definitivo, D07 cancela chamadas e encerra esperas no limite operacional, sem ausência ou conclusão.

### Garantias mínimas da API de filas

- Validar elegibilidade, evento e participação atual dentro da operação transacional apropriada.
- Impedir simultaneidade incompatível por participação no banco, não apenas na interface.
- Preservar ordem da fila compartilhada e impedir que duas estações chamem a mesma pessoa.
- Exigir autorização de staff vinculada ao evento em cada chamada, ausência, conclusão e abertura/fechamento de fila.
- Impedir check duplicado do mesmo atendimento, permitindo repetições legítimas da experiência.
- Tratar conflitos entre ausência, conclusão, finalização voluntária e encerramento automático de forma determinística, preservando a regra de que conclusões canceladas no limite não podem ser confirmadas depois.
- Recuperar participação, posições, pendências e avaliações após reinício ou falha de rede.
- Testar concorrência com conexões distintas em PostgreSQL real; mocks não demonstram segurança transacional.

## 8. Contratos de API — apenas mapa de operações

Ainda **não** são endpoints definidos. A lista abaixo indica capacidades necessárias:

| Módulo | Operações candidatas |
|---|---|
| Identidade | cadastrar, autenticar, renovar/encerrar sessão, recuperar conta |
| Perfil | obter/atualizar perfil, enviar questionário |
| Eventos | consultar evento por código, consultar detalhes e situação |
| Participações | entrar, consultar atual/histórico, finalizar/cancelar conforme regras |
| Filas | entrar, sair, consultar posição, receber atualização |
| Staff | chamar próximo, registrar ausência, confirmar atendimento |
| Avaliações | enviar, consultar avaliação existente, listar pendências elegíveis |
| Administração | configurar eventos, experiências, estações e operações de fila |

**Critério para detalhar endpoints:** estados, papéis, regras de reentrada, unicidade e estações precisam estar definidos. Depois desenhar contratos de request/response, códigos de erro, autenticação e idempotência.

## 9. Registro consolidado de decisões de negócio — D01 a D11 (16/10/2026)

**Convenção:** *aprovada* = decisão tomada sobre o comportamento do produto; *pendente* = detalhe que não foi decidido; *não implementada* = aprovação não indica existência no código.

| ID | Diretriz aprovada e atualizada | Pontos ainda pendentes |
|---|---|---|
| **D01** | Uma fila compartilhada por experiência e várias estações. Staff autorizado pelo evento e Admin global alteram disponibilidade. Chamada pendente precisa ser resolvida antes de desativar estação; indisponível não chama, não fecha fila nem altera outras estações. Sem transferência, prioridade especial ou cancelamento técnico específico. Ausência pode ser usada presencialmente para problema técnico e não prova falta real. | Regras transacionais de concorrência e registro no BI. |
| **D02** | Saída voluntária da fila externa cancela a participação e perde posição; sem avaliação. Pode ingressar novamente se permitido, criando participação nova sem posição anterior. Persistência ainda não implementada. Reentrada no mesmo evento cria nova participação sem apagar histórico. | Nenhuma nova regra de negócio definida. |
| **D03** | No máximo uma participação corrente por conta, incluindo espera externa. Pode finalizar participação ativa sem experiência concluída. Finalizar durante espera interna remove da fila sem ausência e mantém conclusões anteriores. Finalizar após chamada cancela por desistência e não conta como ausência ou conclusão; estação fica livre se disponível. Avaliação exige pelo menos uma conclusão confirmada pelo Staff, também para avaliação posterior. | Detalhes técnicos de estados e concorrência. |
| **D04** | Staff autorizado por **evento**, opera todas as experiências daquele evento. **Admin global**, com gestão de eventos, permissões e BI consolidado. Uma conta pode acumular perfis. Admin concede/revoga por busca do e-mail **de conta já existente**; Staff vinculado a eventos, Admin global. | Escopo específico de funções de BI/configuração, níveis de exportação, auditoria detalhada e proteções contra perda dos últimos Admins. |
| **D05** | Staff registra manualmente conclusão ou ausência; sem timeout individual automático em operação normal. Estação aguarda resolução da ocorrência antes de nova chamada. Ausência retorna ao fim da fila enquanto a janela de chamadas estiver aberta; após, não retorna. Desistência voluntária pode cancelar chamada. D07 cancela automaticamente chamadas pendentes no limite final. | Concorrência e tratamento técnico das operações. |
| **D06** | Desativar fila externa libera todos os `waiting`; novas participações entram `active` enquanto desligada. **Reativar faz somente novas participações aguardarem**; participantes já liberados continuam `active`. | Detalhes transacionais de ativação/desativação concorrentes. |
| **D07** | No horário oficial, bloqueia definitivamente novas participações, reentradas e inscrições em filas. Margem operacional de até 1h para quem já aguardava, sem obrigação de atendimento até o limite; organização pode encerrar antes via D09. No limite, encerra esperas e cancela chamadas pendentes sem ausência/conclusão; não permite chamadas ou confirmações posteriores das ocorrências canceladas. Preserva conclusões anteriores e finaliza automaticamente participações abertas. Brasil na primeira versão; instantes UTC e fuso IANA local. Admin altera horário apenas antes do fechamento, para momento futuro; não há reabertura. | Concorrência entre fechamento/confirmação e fuso concreto por localidade. |
| **D08** | **Uma avaliação por participação**, nota obrigatória 1–5 e comentário opcional. Primeiro envio até **30 dias após finalização da participação**; após esse prazo a pendência expira. Edição de nota e comentário até **7 dias após primeiro envio**. Entre dias 8–30 após envio, **somente quem ainda não comentou** pode adicionar comentário uma única vez; após 30 dias tudo é definitivo. Edição não reinicia prazo; BI usa a nota mais recente sem duplicar avaliação; nova participação pode gerar nova avaliação. | Tratamento exato de limites de tempo, moderação de texto, políticas excepcionais de correção e implementação de auditoria. |
| **D09** | Modos imediato e controlado permanecem. Controlado permite até 1h respeitando limite programado anterior. Admin pode antecipar o fim. Justificativa obrigatória; auditar modo, motivo, responsável e horário. No limite, encerrar esperas e chamadas conforme D07. Mensagens automáticas padronizadas no app; sem personalização pelo Admin ou push; justificativa não é mostrada automaticamente. | Nenhuma regra de negócio adicional definida. |
| **D10** | BI prioritariamente **agregado e estatístico**, sem identificação nominal de participantes. Preservar por prazo indeterminado **dados efetivamente anônimos** de participações, experiências, avaliações e indicadores; manter dados pessoais de contas ativas somente enquanto houver finalidade legítima. Registrar o **snapshot das respostas do questionário em cada nova participação**: eventos antigos permanecem com respostas da época, novas participações usam respostas atualizadas. Na exclusão da conta durante evento: encerrar participação e esperas/chamados pendentes, preservar conclusões, revogar sessões, eliminar credenciais e anonimizar histórico quando aplicável. **Não excluir automaticamente contas inativas** na primeira versão. | Prazos de retenção identificável, bases legais, responsabilidades, definição/validação de anonimização efetiva, política de exclusão e direitos do titular, proteção de pequenos grupos e comentários, permissões e auditoria de exportações. |
| **D11** | Avisos dentro do aplicativo inicialmente; push posteriormente; servidor é fonte oficial da posição/chamada. | Frequência e mecanismo de atualização, reconexão, apresentação de avisos. |

### 9.1 Arquitetura e requisitos complementares

| ID | Decisão | Situação |
|---|---|---|
| **DA-01** | Node.js + TypeScript + NestJS (adaptador HTTP padrão), monólito modular, PostgreSQL; Neon preferido condicionado às cotas | **Aprovada; não implementada** |
| **DA-02** | Drizzle ORM + `pg` + migrações SQL versionadas com Drizzle Kit | **Aprovada; não implementada** |
| **DA-03** | Identidade e sessões com e-mail/senha, access token e refresh token, regras detalhadas abaixo | **Produto aprovado; desenho técnico/implementação pendentes** |
| **RA-01** | BI como experiência principal do Admin; exportação **manual por download**, sem conexão direta com Google Drive. Prioridade sugerida CSV/XLSX; formatos definitivos ainda não aprovados. | **Diretriz aprovada; exportação não implementada** |

### 9.2 Identidade, permissões e autenticação — decisões aprovadas

- **Perfis:** Ciente (participante), Staff (opera eventos autorizados) e Admin (**global**). Uma conta pode acumular permissões. Cadastro público cria apenas conta comum.
- **Concessões:** Admin localiza conta existente pelo e-mail e concede/revoga Staff por evento ou Admin global. Alterações são autorizadas pelo backend e auditadas; revogação interrompe imediatamente futuras ações privilegiadas.
- **Bootstrap:** primeiro Admin é uma conta comum existente, com e-mail confirmado, promovida por comando restrito no backend, sem endpoint público. Auditoria e proteção contra erros são obrigatórias.
- **Continuidade da operação:** antes de eventos reais, pelo menos **dois Admins ativos com e-mail verificado e TOTP configurado**; durante desenvolvimento, um único Admin é permitido. Evitar revogação que deixe operação real abaixo desse mínimo.
- **Verificação de e-mail:** Ciente tem acesso imediato sem verificação; **Staff e Admin devem verificar e-mail antes da concessão**. Alteração de e-mail privilegiado exige confirmação do novo endereço. Serviço e fluxo de verificação ainda pendem de especificação.
- **Senha:** mínimo **8 caracteres**, sem exigência de composição de maiúsculas, números ou símbolos; bloquear senhas muito comuns ou comprometidas; hash adaptativo seguro no servidor. Parâmetros e lista/serviço de bloqueio são decisões técnicas pendentes.
- **Recuperação:** link por e-mail com token aleatório de uso único, validade **30 minutos** a partir da emissão. Nova solicitação válida invalida links anteriores; após redefinir a senha, revogar todas as sessões e exigir novo login. Respostas não revelam existência de conta. Limitar a **uma solicitação por conta a cada 2 minutos e até 5 por hora**, com proteção adicional por IP sem penalizar indevidamente redes compartilhadas. Serviço de envio ainda pendente.
- **Sessões:** token de acesso dura **15 minutos**; sessão dura **até 30 dias**, com renovação automática, armazenamento seguro e rotação do refresh token. Renovar acesso **não** prolonga indefinidamente o limite de 30 dias. Logout revoga a sessão. Implementação de rotação, armazenamento e detecção de reutilização ainda pendente.
- **Um dispositivo/sessão por conta:** novo login revoga sessão anterior, inclusive token de acesso antes do vencimento; reabrir app no mesmo aparelho preserva sessão válida. Troca de aparelho recupera a participação e fila do banco, sem alterar posição ou histórico. Backend valida revogação efetivamente.
- **2FA Admin:** TOTP com aplicativo autenticador e códigos de recuperação de uso único. Exigido antes de acessar funções administrativas; conta com papel Admin não pode acessar tais funções apenas com autenticação por senha. Ciente e Staff não exigem 2FA inicial.
- **Perda de TOTP e códigos:** **outro Admin** verifica identidade e autoriza redefinição, com auditoria, invalidação de segredos/códigos antigos e obrigatoriedade de configurar novo TOTP. **Não foi aprovado um mecanismo de recuperação técnica emergencial** quando não houver segundo Admin; mitigação aprovada é manter dois Admins na operação real.
- **Escopo de autorização:** servidor valida identidade, papéis, verificação de e-mail, fator de autenticação e evento a cada operação pertinente. Controle visual sozinho não concede segurança.

### 9.3 BI, privacidade e histórico: diretrizes de produto

- Preservar conceitualmente horário de entrada efetiva na Arena (após liberação da fila externa), horários das experiências concluídas, horário real de encerramento no sistema e motivo de finalização (voluntária/automática). Nomes definitivos dos campos ficam para a modelagem do banco.
- **Indicador A — tempo até última experiência concluída:** intervalo entre a entrada efetiva e a última conclusão confirmada; aplica-se a participações com ao menos uma conclusão, qualquer que seja o modo de encerramento.
- **Indicador B — tempo até finalização voluntária:** intervalo entre a entrada efetiva e o momento em que a pessoa seleciona “Sair da Arena”; aplica-se somente a encerramentos voluntários.
- Encerramento automático não usa o horário da limpeza como saída real. Se houve conclusão, usar o tempo até a última conclusão como atividade observada. Sem conclusão nem saída voluntária, duração é indeterminada, nunca zero. Manter métricas e populações separadas; não apresentar intervalo como prova de presença física.

- PostgreSQL armazena participações, atendimentos, perfil e avaliações, sem banco separado obrigatório para BI na primeira versão; indicadores podem ser calculados a partir dos registros persistentes.
- Admin global analisa eventos e períodos por filtros, incluindo perfil do público (idade/faixa etária, jogos, interesse no mercado), experiências e avaliações, preferindo resultados **agregados**, sem fichas identificáveis e sem exposição nominal por padrão.
- Snapshot de questionário por **participação** impede que uma atualização posterior reescreva resultados antigos. Como uma mesma pessoa pode participar novamente, a próxima participação usa seu novo perfil.
- O objetivo é manter resultados históricos por prazo indeterminado **somente se efetivamente anônimos**, e não presumir que remover nome/e-mail anonimiza dados finos. Faixa etária, supressão de pequenos grupos e tratamento de comentários poderão ser necessários.
- Exportação manual dos resultados autorizados do BI por arquivo baixável. Não implementar login Google, sincronização automática com Drive ou armazenamento operacional em Drive no escopo atual.
- Painel BI completo é **objetivo do produto**, não uma interface já implementada. Escopo de gráficos, dimensões, cálculo de métricas, filtros, formatos e acesso/exportação deverá ser especificado numa etapa própria.

### 9.4 Pendências restantes — não preencher por suposição

**Regras de negócio/operacionais:** as regras centrais D01–D11 estão consolidadas. Permanecem definições detalhadas de BI (indicadores, filtros, agregação, exportações e formatos) e requisitos operacionais da LGPD (bases legais, papéis, prazos, direitos, comentários e anonimização efetiva); não devem ser presumidos.

**Detalhes técnicos e infraestrutura antes da implementação/piloto:**

8. Modelo relacional, IDs, estados e invariantes transacionais, migrações, idempotência e concorrência com PostgreSQL real; preparar a modelagem conceitual em documento separado.
9. Serviço de e-mail de custo compatível, verificação, recuperação, limites antiabuso e entregabilidade.
10. Tokens de acesso/refresh, rotação, reutilização, sessões, guarda no iOS/Android, criação/recuperação de TOTP e códigos reserva.
11. Procedimento de primeiro Admin, auditoria e requisito operacional de pelo menos dois Admins para eventos reais.
12. Hospedagem de API, disponibilidade e limites Neon, pool/TLS, logs, backups, ambientes e custos reais.
13. Contratos HTTP, atualização em tempo real, reconexão, tratamento de indisponibilidade e testes de segurança/carga.

**Estado:** regras aprovadas registradas como decisões de produto, não como funcionalidades implementadas. Esta atualização é exclusivamente documental; não valida implementação de código.

## 10. Estratégia de testes do backend (futura)

- **Unitários:** validações, transições e autorização de regras isoladas.
- **Integração com banco real de testes:** migrações, unicidade, transações, idempotência e integridade referencial.
- **API:** autenticação, erros, contratos e permissões por papel/evento.
- **Concorrência:** duas entradas simultâneas na fila, chamadas concorrentes, dois checks da mesma ocorrência, ausência versus conclusão.
- **Fluxos ponta a ponta:** app entra no evento, acompanha fila, recebe chamada, conclui experiência, finaliza e avalia depois.
- **Falhas/reconexão:** requisição repetida, perda de conexão e recuperação de estado.

Não confundir os **86 testes locais** com testes de API ou testes de concorrência: estes ainda não existem.

## 11. README e documentação do repositório

**README:** documento curto de onboarding — objetivo, pré-requisitos verificados, instalação, execução, testes, estrutura, fluxos, mocks, limitações e link para este planejamento.

**Este arquivo:** decisões, roadmap, arquitetura, modelo de dados e critérios de entrega. Evitar duplicar aqui todas as instruções de execução.

Este planejamento está versionado no repositório em `app/docs/PLANEJAMENTO_v5.md`. A modelagem conceitual do banco será documentada separadamente.

## 12. Próximas ações propostas — pré-implementação

1. **Preparar documento separado de modelagem conceitual do banco**, derivando entidades, relações e invariantes das regras aprovadas, sem confundir o modelo com esquema implementado.
2. **Detalhar invariantes técnicos e concorrência** para entradas, chamadas, confirmações, cancelamentos e fechamento automático, incluindo execução confiável do fechamento mesmo sem aplicativo aberto.
3. **Detalhar implementação de autenticação e segurança** conforme a seção 9.2: provedores, segredo TOTP, tokens, rotação/revogação, auditoria, dispositivos e bloqueios de acesso.
4. **Validar infraestrutura de custo zero:** API, PostgreSQL Neon, pool/TLS, migrações, backup e testes com PostgreSQL real; confirmar cotas antes de implantação pública.
5. **Iniciar a fundação do backend em incrementos pequenos**, depois de aprovar o modelo mínimo, com testes e integração vertical; não substituir mocks em massa.
6. **Planejar BI e exportação manual** de resultados autorizados, sem integração Google Drive no escopo atual.
**Situação atual:** planejamento v0.6 versionado no repositório. Esta atualização alterou somente documentação; regras novas não foram declaradas implementadas. Hospedagem da API continua pendente; integração direta com Google Drive está fora do escopo atual.

### Política de commits

- Commits pequenos, por grupo de testes ou funcionalidade vertical.
- `npm.cmd test` e `git diff --check` em cada etapa.
- Teste no iPhone quando o fluxo visual ou de navegação for afetado.
- Nenhum código do backend antes de aprovar as decisões efetivamente bloqueantes e os invariantes do modelo mínimo.

---

### Histórico de revisão

- **v0.6 — 16/10/2026:** consolidadas regras D01–D03, D05, D07 e D09 para saída e finalização de participações, elegibilidade de avaliação, chamadas sem timeout individual, estações, encerramento definitivo, justificativa e comunicação administrativa. Atualizados estados, modelo conceitual, roadmap, pendências e próximas ações; incluídas regras de duração observada para BI. Planejamento já registrado no repositório. **Somente documentação; sem alteração de código, testes ou arquitetura.**

- **v0.5 — 14/10/2026:** incorporadas decisões posteriores à v0.4: BI agregado e exportação manual sem integração Drive; snapshots históricos do questionário; diretrizes de anonimização e exclusão de contas; restrição inicial a eventos no Brasil; alteração de horário antes do fechamento definitivo; reativação da fila externa apenas para novas participações; prazos e edições de avaliações; operação de estações com dois estados; Admin global, concessões por e-mail cadastrado, primeiro Admin por promoção controlada; confirmação de e-mail para privilegiados, senhas de 8 caracteres, recuperação por link de 30 min com limites, sessões de até 30 dias e access token de 15 min, uma sessão por conta, TOTP Admin e dois Admins antes de eventos reais. Pendências remanescentes separadas de decisões aprovadas. **Sem mudanças no código.**

- **v0.4 — 11/10/2026 (histórico, regras de D07/D09 posteriormente substituídas pela v0.6):** detalhadas D05, D07 e D09: ausência retorna ao fim da fila; fechamento automático definitivo das filas no horário oficial com uma hora exclusiva para atender quem aguardava; encerramento administrativo imediato ou controlado, com até uma hora sem ultrapassar o limite programado. Aprovados três perfis (Ciente, Staff e Admin), conta única com permissões adicionais, concessão/revogação por Admin autorizado, login por e-mail e senha, acesso imediato sem confirmação de e-mail na primeira fase de testes e estratégia de tokens de acesso/renovação. Pendências remanescentes organizadas na seção 9.3.

- **v0.1 — 10/10/2026:** consolidação inicial das duas auditorias e propostas de roadmap, arquitetura e modelo conceitual.
- **v0.2 — 10/10/2026:** incorporados 86 testes passando, correções de código de evento, estado das abas Eventos/Perfil, README revisado e commits/push confirmados; fases 0 e README da fase 1 concluídos; próximas ações redirecionadas para decisões de domínio e preparação do backend. **À época, stack, modelo e D01–D11 ainda pendiam de aprovação.**
