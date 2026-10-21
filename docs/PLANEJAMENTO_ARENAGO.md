# ArenaGo — Planejamento geral do produto

**Versão:** v0.7.9 — atualização da C-10 e registro da E01.2B (21/10/2026)
**Status funcional:** decisões D01–D11 e C-01–C-14 preservadas; C-10 detalhada e reafirmada conforme aprovação do responsável.
**Estado da implementação (verificado no repositório):** frontend Expo ainda baseado em simulações nos fluxos de backend; fundação `backend/` NestJS/Drizzle e consulta interna de eventos por UUID/código implementadas; endpoints HTTP de produto não implementados; Neon não criada.
**Documento técnico complementar:** `ARQUITETURA_BACKEND_ARENAGO.md` (v0.6.15).

> **Fonte e limite:** este texto preserva decisões anteriores e registra a decisão C-10 aprovada e a implementação local da E01.2B inspecionada nesta revisão. O serviço de consulta é interno e não cria endpoint HTTP. Isso não implica validação de produção nem autoriza uso de dados pessoais reais.

## 1. Objetivo e escopo

O ArenaGo é um aplicativo Expo/React Native para participantes de eventos com experiências. O backend será a fonte de verdade de identidade, participações, filas, atendimentos e avaliações; a interface deverá consumir os serviços gradualmente, sem transformar mocks em dados reais antes da implementação dos módulos correspondentes.

**Não faz parte do ciclo atual:** implementar endpoints, integração Expo–API, novas telas Staff/Admin, notificações push, BI operacional ou implantação Neon. Esses itens seguem no roadmap, não foram cancelados como objetivos futuros.

## 2. Estado verificado no repositório em 21/10/2026 e limite da etapa atual

| Frente | Situação | Evidência / limite |
|---|---|---|
| Frontend Expo | Fluxos de cadastro, login, evento, filas e avaliações ainda simulados | Auditoria anterior do Codex: 95 testes locais/harness aprovados; não validam API nem operação nativa entre aparelhos. A aba Eventos exibe cartões de histórico mockados. |
| Fundação do backend | `backend/` NestJS, TypeScript, Drizzle/`pg`, configuração de ambiente e testes | **Reportado como implementado pela Task 6.2**; nenhum controller/endpoint de negócio. |
| Consulta de eventos E01.2B | Normalizador C-10 e busca interna por UUID/código em `EventsService` | Código, testes e documentação inspecionados nesta revisão; não cria endpoint HTTP. |
| Esquema PostgreSQL | 23 tabelas, 5 migrações Drizzle versionadas | Relatório da Task 6.2: aplicadas em dois bancos locais vazios; reaplicação não duplicou histórico. |
| Verificações do backend | `build`, `lint`, `db:check`, 1 teste unitário e 21 de integração aprovados; smoke NestJS inicializado com `404` esperado em `/` | Evidência reportada, não auditoria independente. Contagem de catálogo reportada: 35 FKs, 104 constraints, 65 índices, 9 parciais e 5 checks de perfil. |
| Neon e produção | **Não configuradas** | Nenhum banco remoto criado/contatado; nenhuma API funcional pública. |
| Verificações E01.2B | Build, lint, typecheck e diff-check aprovados | Testes unitários interrompidos por `uv_os_get_passwd returned ENOMEM`; integração não executada sem confirmação do banco local descartável. Reproduzir `npm.cmd test` manualmente em PowerShell. |

**Limite de escopo vigente:** E01.2B implementa somente a normalização e consulta interna de evento por código; não cria endpoint. Endpoints HTTP, integração Expo e demais fluxos dependem de priorização própria. O relatório anterior de dependências apontou vulnerabilidades no ferramental, cuja triagem permanece pendente.

## 3. Princípios para a evolução

1. **Backend como autoridade:** autenticação, elegibilidade, filas, chamadas, checks, finalização e avaliações devem ser validados no servidor.
2. **Aplicativo como interface:** estado local continua útil para formulários e apresentação, mas não define a ordem global das filas.
3. **Incrementos verticais pequenos:** implementar uma operação no backend, testar e conectar um fluxo do aplicativo antes de avançar.
4. **Dados identificados:** usar IDs estáveis para usuário, evento, participação, experiência e atendimento.
5. **Operações seguras contra repetição:** um check repetido da mesma ocorrência não pode incrementar duas vezes; uma nova participação legítima na mesma experiência deve contar novamente.
6. **Persistência e recuperação:** reiniciar o aplicativo não deve apagar uma participação válida ou uma avaliação pendente.
7. **Sem simulações apresentadas como produção:** distinguir botões de demonstração, mocks e recursos reais.

## 4. Roadmap e marco de implementação

| Fase | Entrega | Estado |
|---|---|---|
| 0 — Qualidade e auditoria do Expo | Testes locais e avaliação do fluxo atual | **Concluída no relatório de 95 testes**, sem integração real |
| 1 — Planejamento e arquitetura | Regras de produto e esquema unificado | **Decisões consolidadas; documentos atualizados nesta v0.7.9** |
| 2 — Validação relacional | Migrações e testes concorrentes PostgreSQL | **Concluída experimentalmente**; resultados incorporados à Task 6.2 |
| 3 — Fundação do backend | NestJS, schemas Drizzle, 5 migrações locais e testes | **Concluída conforme relato Codex da Task 6.2**; E01.2B acrescenta consulta interna de eventos |
| 4 — Endpoints e segurança | Auth, perfil/jogos, permissões; depois eventos e filas | **Não iniciada — pausada por decisão do responsável pelo projeto** |
| 5 — Integração e operação | Expo↔API, avaliações, Admin/Staff, BI e testes E2E | **Futura; escopo de implementação não autorizado agora** |
| 6 — Piloto público | Infraestrutura, LGPD, segurança, testes em aparelhos/carga | **Bloqueado** até requisitos próprios de privacidade e operação |

A criação da Neon terá autorização e etapa próprias; não é pré-requisito para manter a fundação local concluída. Não confundir a existência das tabelas com a implementação dos serviços que aplicam regras de negócio.

## 5. Arquitetura aprovada e integração

**DA-01 — Aprovada:** Node.js + TypeScript + **NestJS com adaptador HTTP padrão**, em **monólito modular**, usando **PostgreSQL**. O **Neon** é a escolha preferida para hospedar o banco, condicionada à disponibilidade e às cotas do plano gratuito. A hospedagem da API permanece pendente. Não exigir adaptador Fastify nem microsserviços inicialmente.

**DA-02 — Aprovada:** **Drizzle ORM + driver `pg`**, com **migrações SQL versionadas utilizando Drizzle Kit**. A fundação local já possui versões instaladas e migrações. Para conexões PostgreSQL remotas, a política aprovada é TLS com verificação completa do certificado; configuração de conexão/pool para Neon e operação futura permanece pendente. Transações interativas de filas devem usar conexão adequada e o mesmo cliente durante toda a transação; o ORM não substitui restrições e bloqueios do PostgreSQL.

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
PostgreSQL (local na fundação; Neon candidata para hospedagem futura, condicionada às cotas)
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

## 6. Modelo conceitual consolidado — fronteira entre produto e arquitetura

O planejamento estabelece as **entidades e invariantes de negócio**; a arquitetura e os schemas reais de `backend/` são as referências para nomes de tabelas, colunas, tipos, índices e migrations. A arquitetura técnica consolidou **23 tabelas** (22 de domínio e uma tabela técnica de idempotência), implementadas nos schemas/migrações segundo o relatório da Task 6.2. O número de tabelas não é uma regra imutável de produto; mudanças futuras exigirão novas migrações versionadas.

| Domínio | Entidades lógicas | Regra de negócio determinante |
|---|---|---|
| Identidade e permissões | conta, sessão, verificação, recuperação, papéis Staff/Admin, TOTP e auditoria | Uma sessão válida por conta; Admin global; Staff por evento; privilégios revogáveis imediatamente |
| Perfil e catálogo | perfil atual, questionário versionado e catálogo de jogos | Cadastro/login independentes do questionário; **ingresso exige questionário concluído** |
| Eventos | evento, experiências e estações | Uma fila compartilhada por experiência; estações independentes com estado operacional |
| Participações e filas | participação, espera externa e entradas na fila interna | Uma participação corrente por conta; cada repetição/ausência permitida gera nova entrada FIFO |
| Atendimentos | chamada/atendimento e seu resultado | Um resultado terminal por chamada; uma ocorrência pendente por estação |
| Avaliações | avaliação da participação e elegibilidade derivada | No máximo uma avaliação por participação com conclusão confirmada |
| BI e privacidade | snapshot por participação, métricas e agregados seguros | Perfil histórico preservado durante o uso normal; dados identificáveis não são retidos apenas para estatística após exclusão |

**Contrato de integração com a Task 6.1:** a arquitetura deve **reaproveitar** o catálogo `games`/`user_games` e o detalhamento de autenticação compatível com o planejamento, mas **não** manter sistemas duplicados de papéis, sessões, tokens ou auditoria. Contratos futuros de estados/participações da Task 6.1 não substituem as regras posteriores já aprovadas. O trigger proposto naquela tarefa para impedir indiscriminadamente `DELETE` de snapshots **não deverá ser adotado como está**, pois bloquearia o procedimento legítimo de privacidade.

**Invariantes de domínio:**

- Chamada de experiências ocorre por **fila FIFO única da experiência**, com estações compartilhando os próximos participantes. Duas estações podem chamar simultaneamente pessoas diferentes, nunca a mesma pessoa.
- `waiting`/`active`/`finished`/`canceled` representam o ciclo da participação; entradas na fila e serviços têm estados separados. Motivos de cancelamento/encerramento são registrados separadamente dos estados.
- Reentrar em experiência ou em evento, quando permitido, gera registro novo, preservando o histórico. Nenhuma ausência é tratada automaticamente como uma conclusão.
- Após o **encerramento oficial**, não há novas participações, reentradas, entradas nas filas internas **nem retorno à fila por ausência**; a janela adicional opcional só permite chamar a fila preexistente.
- Encerramento imediato pelo Admin encerra logicamente **todas** as participações abertas e os atendimentos pendentes. O app não força Home: exibe avaliação elegível e pendente após consultar o backend, com opção “Avaliar mais tarde”.

**Referência técnica atual:** `MODELO_DADOS_ARENAGO_RASCUNHO_v0.4.md` e `ARENAGO_MATRIZ_COMPATIBILIZACAO_ARQUITETURA_v0.1.md`, ambos como **documentos de trabalho**. A arquitetura unificada v0.6.15 é a referência técnica principal; os modelos anteriores permanecem históricos.

## 7. Estados de domínio e operações — regras aprovadas, implementação a especificar

### Participação e encerramento

```text
waiting --[liberação externa]--> active --[finalização voluntária]--> finished
   |                                  |                         |
   +--[saída externa: cancelada]      +--[finalização durante   +-- elegível a avaliar
                                      |   espera: remove fila]      somente se houve
                                      +--[finalização após chamada:  conclusão confirmada
                                          cancela chamada por
                                          desistência]

waiting --[limite operacional D07]--> finalizada automaticamente
active  --[limite operacional D07]--> finalizada automaticamente
```

`waiting`, `active`, `finished` e `canceled` são os **estados de participação aprovados para a modelagem**, sujeitos apenas à codificação técnica exata na arquitetura. D02–D03 definem as regras de reentrada, exclusividade e cancelamento acima. Participação cancelada ao sair da fila externa não é avaliável. Finalização voluntária ou automática de participação ativa não exige experiência concluída, mas avaliação exige ao menos uma conclusão confirmada pelo Staff. O limite oficial bloqueia novas entradas; o limite operacional posterior encerra esperas, chamadas pendentes e participações restantes.

### Fila de experiência e atendimento

```text
Fila da experiência: ABERTA <--> FECHADA_PARA_NOVAS_ENTRADAS
      |                                  |
      |                                  +-- mantém participantes já na fila
      +-- todas as estações da experiência atendem a mesma fila

Aguardando na fila --> Chamado --> Concluído
                          |
                          +--> Ausência --> [fim da fila SOMENTE antes do fechamento oficial, se novas entradas estiverem permitidas; senão encerra entrada]
```

Uma estação pode estar disponível ou indisponível independentemente da abertura da fila. D05 não exige estados separados de chegada e início. **Entre o encerramento oficial e o limite operacional, Staff pode registrar ausência, mas isso NÃO gera reentrada na fila.** Durante operação normal não há timeout individual: Staff resolve manualmente a ocorrência pendente antes de nova chamada da estação. Ao fechamento definitivo, D07 cancela chamadas e encerra esperas no limite operacional, sem ausência ou conclusão.

### Garantias mínimas da API de filas

- Validar elegibilidade, evento e participação atual dentro da operação transacional apropriada.
- Impedir simultaneidade incompatível por participação no banco, não apenas na interface.
- Preservar ordem da fila compartilhada e impedir que duas estações chamem a mesma pessoa.
- Exigir autorização de staff vinculada ao evento em cada chamada, ausência, conclusão e abertura/fechamento de fila.
- Impedir check duplicado do mesmo atendimento, permitindo repetições legítimas da experiência.
- Tratar conflitos entre ausência, conclusão, finalização voluntária e encerramento automático de forma determinística, preservando a regra de que conclusões canceladas no limite não podem ser confirmadas depois.
- Recuperar participação, posições, pendências e avaliações após reinício ou falha de rede.
- Testar concorrência com conexões distintas em PostgreSQL real; mocks não demonstram segurança transacional.

## 8. Contratos de API — mapa de produto

A Task 6.1 **já propôs contratos REST específicos** de autenticação, perfil, questionário e jogos; eles foram compatibilizados como propostas técnicas na arquitetura unificada, sem implementação de endpoints. A tabela abaixo lista as **capacidades do produto**, não declara que os endpoints de eventos e filas já existem:

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

## 9. Registro de decisões de negócio — D01 a D11 e C-01 a C-14

**Convenção:** *aprovada* = decisão tomada sobre o comportamento do produto; *pendente* = detalhe que não foi decidido; *não implementada* = aprovação não indica existência no código.

| ID | Diretriz aprovada e atualizada | Pontos ainda pendentes |
|---|---|---|
| **D01** | Uma fila compartilhada por experiência e várias estações. Staff autorizado pelo evento e Admin global alteram disponibilidade. Chamada pendente precisa ser resolvida antes de desativar estação; indisponível não chama, não fecha fila nem altera outras estações. Sem transferência, prioridade especial ou cancelamento técnico específico. Ausência pode ser usada presencialmente para problema técnico e não prova falta real. | Regras transacionais de concorrência e registro no BI. |
| **D02** | Saída voluntária da fila externa cancela a participação e perde posição; sem avaliação. Pode ingressar novamente se permitido, criando participação nova sem posição anterior. Serviços de persistência ainda não implementados. Reentrada no mesmo evento cria nova participação sem apagar histórico. | Nenhuma nova regra de negócio definida. |
| **D03** | No máximo uma participação corrente por conta, incluindo espera externa. Pode finalizar participação ativa sem experiência concluída. Finalizar durante espera interna remove da fila sem ausência e mantém conclusões anteriores. Finalizar após chamada cancela por desistência e não conta como ausência ou conclusão; estação fica livre se disponível. Avaliação exige pelo menos uma conclusão confirmada pelo Staff, também para avaliação posterior. | Detalhes técnicos de estados e concorrência. |
| **D04** | Staff autorizado por **evento**, opera todas as experiências daquele evento. **Admin global**, com gestão de eventos, permissões e BI consolidado. Uma conta pode acumular perfis. Admin concede/revoga por busca do e-mail **de conta já existente**; Staff vinculado a eventos, Admin global. | Escopo específico de funções de BI/configuração, níveis de exportação, auditoria detalhada e proteções contra perda dos últimos Admins. |
| **D05** | Staff registra manualmente conclusão ou ausência; sem timeout individual automático em operação normal. Estação aguarda resolução da ocorrência antes de nova chamada. Ausência retorna ao fim da fila **somente antes do corte efetivo de novas inscrições** (encerramento oficial ou antecipação administrativa), enquanto novas entradas na fila forem permitidas; após esse horário, mesmo durante operação residual, **não retorna**. Desistência voluntária pode cancelar chamada. D07 cancela automaticamente chamadas pendentes no limite final. | Concorrência e tratamento técnico das operações. |
| **D06** | Desativar fila externa libera todos os `waiting`; novas participações entram `active` enquanto desligada. **Reativar faz somente novas participações aguardarem**; participantes já liberados continuam `active`. | Detalhes transacionais de ativação/desativação concorrentes. |
| **D07** | No horário oficial vigente, bloqueia definitivamente novas participações, reentradas e inscrições em filas. Margem operacional de até 1h para quem já aguardava, sem obrigação de atendimento até o limite; organização pode encerrar antes via D09. No limite, encerra esperas e cancela chamadas pendentes sem ausência/conclusão; não permite chamadas ou confirmações posteriores das ocorrências canceladas. Preserva conclusões anteriores e finaliza automaticamente participações abertas, inclusive as ainda em `waiting`. Brasil na primeira versão; instantes UTC e fuso IANA local. Admin só altera o horário antes de atingir o horário oficial vigente, nunca durante a hora adicional nem para momento igual ou anterior ao atual; não há reabertura. | Concorrência entre fechamento/confirmação e fuso concreto por localidade. |
| **D08** | **Uma avaliação por participação**, nota obrigatória 1–5 e comentário opcional. Primeiro envio até **30 dias após finalização da participação**; após esse prazo a pendência expira. Edição de nota e comentário até **7 dias após primeiro envio**. Entre dias 8–30 após envio, **somente quem ainda não comentou** pode adicionar comentário uma única vez; após 30 dias tudo é definitivo. Edição não reinicia prazo; BI usa a nota mais recente sem duplicar avaliação; nova participação pode gerar nova avaliação. | Tratamento exato de limites de tempo, moderação de texto, políticas excepcionais de correção e implementação de auditoria. |
| **D09** | Modos imediato e controlado permanecem. **Imediato** encerra naquele instante todas as participações abertas e cancela esperas e chamadas pendentes, preservando conclusões anteriores; não obriga navegação à Home, e avaliação aparece no retorno para quem for elegível e ainda tiver pendência. **Controlado** permite até 1h respeitando limite programado anterior. **Ao iniciá-lo, todas as participações ainda aguardando na fila externa são finalizadas automaticamente naquele instante, sem avaliação e com motivo administrativo específico; participantes `active` e atendimentos internos preexistentes seguem até o limite controlado.** Admin pode antecipar o fim. Justificativa obrigatória; auditar modo, motivo, responsável e horário. No limite, encerrar esperas e chamadas conforme D07. Mensagens automáticas padronizadas no app; sem personalização pelo Admin ou push; justificativa não é mostrada automaticamente. | Nenhuma regra de negócio adicional definida. |
| **D10** | BI prioritariamente **agregado e estatístico**, sem identificação nominal de participantes. Preservar por prazo indeterminado **dados efetivamente anônimos** de participações, experiências, avaliações e indicadores; manter dados pessoais de contas ativas somente enquanto houver finalidade legítima. Registrar o **snapshot das respostas do questionário em cada nova participação**: eventos antigos permanecem com respostas da época, novas participações usam respostas atualizadas. Na exclusão da conta durante evento: encerrar participação e esperas/chamados pendentes, preservar **contribuições estatísticas agregadas seguras** das conclusões anteriores quando possível, revogar sessões e eliminar credenciais e registros pessoais conforme política aplicável. **Não reter históricos individuais apenas pela remoção de identificadores**. **Não excluir automaticamente contas inativas** na primeira versão. | Prazos de retenção identificável, bases legais, responsabilidades, definição/validação de anonimização efetiva, política de exclusão e direitos do titular, proteção de pequenos grupos e comentários, permissões e auditoria de exportações. |
| **D11** | Avisos dentro do aplicativo inicialmente; push posteriormente; servidor é fonte oficial da posição/chamada. | Frequência e mecanismo de atualização, reconexão, apresentação de avisos. |

### 9.1 Arquitetura e requisitos complementares

| ID | Decisão | Situação |
|---|---|---|
| **DA-01** | Node.js + TypeScript + NestJS (adaptador HTTP padrão), monólito modular, PostgreSQL; Neon preferido condicionado às cotas | **Aprovada; fundação implementada localmente (Task 6.2)** |
| **DA-02** | Drizzle ORM + `pg` + migrações SQL versionadas com Drizzle Kit | **Aprovada; fundação implementada localmente (Task 6.2)** |
| **DA-03** | Identidade e sessões com e-mail/senha, access token e refresh token, regras detalhadas abaixo | **Produto aprovado; endpoints/serviços não implementados** |
| **RA-01** | BI como experiência principal do Admin; exportação **manual por download**, sem conexão direta com Google Drive. Prioridade sugerida CSV/XLSX; formatos definitivos ainda não aprovados. | **Diretriz aprovada; exportação não implementada** |

### 9.2 Identidade, permissões e autenticação — decisões aprovadas

- **Perfis:** Participante (papel `participante`), Staff (opera eventos autorizados) e Admin (**global**). Uma conta pode acumular permissões. Cadastro público cria apenas conta comum.
- **Concessões:** Admin localiza conta existente pelo e-mail e concede/revoga Staff por evento ou Admin global. Alterações são autorizadas pelo backend e auditadas; revogação interrompe imediatamente futuras ações privilegiadas.
- **Bootstrap:** primeiro Admin é uma conta comum existente, com e-mail confirmado, promovida por comando restrito no backend, sem endpoint público. Auditoria e proteção contra erros são obrigatórias.
- **Continuidade da operação:** antes de eventos reais, pelo menos **dois Admins ativos com e-mail verificado e TOTP configurado**; durante desenvolvimento, um único Admin é permitido. Evitar revogação que deixe operação real abaixo desse mínimo.
- **Verificação de e-mail:** Ciente tem acesso imediato sem verificação; **Staff e Admin devem verificar e-mail antes da concessão**. Alteração de e-mail privilegiado exige confirmação do novo endereço. Serviço e fluxo de verificação ainda pendem de especificação.
- **Senha:** mínimo **8 caracteres**, sem exigência de composição de maiúsculas, números ou símbolos; bloquear senhas muito comuns ou comprometidas; hash adaptativo seguro no servidor. Parâmetros e lista/serviço de bloqueio são decisões técnicas pendentes.
- **Recuperação:** link por e-mail com token aleatório de uso único, validade **30 minutos** a partir da emissão. Nova solicitação válida invalida links anteriores; após redefinir a senha, revogar todas as sessões e exigir novo login. Respostas não revelam existência de conta. Limitar a **uma solicitação por conta a cada 2 minutos e até 5 por hora**, com proteção adicional por IP sem penalizar indevidamente redes compartilhadas. Serviço de envio ainda pendente.
- **Sessões:** token de acesso dura **15 minutos**; sessão dura **até 30 dias**, com renovação automática, armazenamento seguro e rotação do refresh token. Renovar acesso **não** prolonga o limite fixo de 30 dias. Logout revoga a sessão. **Política aprovada:** reapresentação de refresh token consumido revoga a sessão; falha definitiva na resposta pode exigir novo login. O cliente deve serializar a renovação e não repetir cegamente solicitações com resultado de rede incerto. Implementação e testes pendentes.
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

### 9.3.1 Complementos aprovados após a v0.6 — comportamento do produto

Os itens a seguir refinam D01–D11. **Não** são novas funcionalidades implementadas e **não** autorizam mudanças de escopo por mera escolha de tabela.

| Referência | Decisão aprovada | Efeito sobre a arquitetura |
|---|---|---|
| **C-01 — Ausência em operação residual** | Depois do encerramento oficial, registrar ausência **não recoloca** o participante no fim da fila, ainda que a estação possa atender pessoas que já estavam esperando. | Nova `queue_entry` por ausência somente enquanto ingressos em fila forem permitidos. Substitui trechos antigos que mencionavam apenas “janela de chamadas”. |
| **C-02 — Margem opcional** | O limite operacional adicional pode ser de **zero a 60 minutos** após o horário oficial, não é sempre uma hora. | Registrar e validar o limite efetivamente autorizado; proteger transações também no limite exato. |
| **C-03 — Encerramento administrativo imediato** | Cancela pendências e finaliza **todas as participações abertas imediatamente**, preservando conclusões anteriores. | Finalização no backend; estado recuperável mesmo com app fechado. |
| **C-04 — Navegação após fechamento automático** | **Não enviar diretamente à Home**. Quando o usuário retornar, exibir fluxo de avaliação **somente se houve conclusão Staff, ainda não avaliou e está no prazo**; caso contrário informar encerramento sem oferecer avaliação indevida. Permitir “Avaliar mais tarde”. | Elegibilidade e pendência derivadas de participações, serviços e avaliações; sem tabela extra. Mesmo princípio no limite operacional automático. |
| **C-05 — Abertura automática** | Evento torna-se apto à entrada **automaticamente no horário configurado**, **somente** se estiver pronto: nome, código de ingresso, horários válidos, fuso horário IANA, configuração da fila externa, pelo menos uma experiência com estação disponível e pelo menos um Staff autorizado para o evento. | Avaliar prontidão no backend sem depender da tarefa agendada; não exige Staff conectado no instante da abertura nem Staff vinculado permanentemente à estação. |
| **C-06 — Questionário antes de ingressar** | Cadastro cria a conta antes do questionário e encaminha diretamente para suas três etapas, **sem botão “Preencher depois”**. Login posterior permanece possível mesmo se o questionário tiver sido interrompido. **Participar de evento exige conclusão integral do questionário**; preenchimento não se repete por evento e snapshots históricos não mudam com atualização do perfil. | Transação de ingresso valida o perfil e cria snapshot correspondente; catálogo de jogos pertence ao perfil atual. |
| **C-07 — Privacidade conservadora** | Na exclusão, preferir **agregados estatísticos efetivamente seguros** e eliminar dados individuais identificáveis quando aplicável; eventual preservação de históricos individuais requer anonimização validada. | Snapshots imutáveis por atualização comum, **não** indeléveis; desenho de retenção, bases legais e anonimização ainda pendente antes do piloto. |
| **C-08 — Concorrência e retries** | FIFO real por experiência, chamada atômica, um resultado por atendimento, horários como autoridade do servidor, idempotência de ações críticas e limpeza reexecutável. | Índices, locks, transações e testes PostgreSQL real; detalhes SQL ficam na arquitetura. |
| **C-09 — Questionário versionado e avaliação pendente** | Perfil atual mutável; congelar respostas/versão em cada participação. Avaliação pendente calculada por elegibilidade, **sem tabela separada de pendências**. | Colunas tipadas para campos conhecidos, `JSONB` quando justificado e tabela de versões no esquema técnico candidato. |
| **C-10 — Código de ingresso [APROVADO]** | Código único em todo o histórico, **imutável desde a criação** e **não reutilizável**. Aceita somente ASCII `A–Z`, `0–9` e hífen; após `String.trim()` deve ter 4–64 caracteres. Hífen somente entre grupos alfanuméricos, sem hífen inicial, final ou consecutivo. Pesquisa ignora maiúsculas/minúsculas e whitespace externo reconhecido por `String.trim()`; espaços internos, acentos, símbolos e demais caracteres Unicode não ASCII são rejeitados. | Uma função TypeScript reutilizável do backend é a autoridade canônica para criação futura e consulta. O índice `UNIQUE` e o `CHECK upper(btrim(...))` atuais cobrem unicidade e forma maiúscula/trim ASCII, mas **não** validam integralmente alfabeto, comprimento, padrão de hífens ou whitespace Unicode do JavaScript. Preservar eventos/códigos arquivados. Restrição SQL adicional poderá exigir migração incremental após auditoria dos dados existentes; nenhuma migração adicional foi criada nesta etapa. |
| **C-11 — Refresh e continuidade da Arena** | Reuso de refresh token consumido revoga a sessão, mesmo após perda de resposta legítima; se necessário, novo login. Isso **não encerra a participação, não tira da fila e não registra ausência**. | Rotação atômica, linhagem de tokens, mutex no cliente, atenção a rede instável, retomada da participação após login e testes específicos antes do piloto. |
| **C-12 — Fila externa no fechamento controlado** | Ao iniciar encerramento administrativo **controlado antecipado**, encerrar imediatamente todas as participações ainda `waiting` na fila externa com motivo administrativo específico, sem avaliação. Manter filas e atendimentos internos preexistentes das participações `active` até o limite controlado; sem admitir novas entradas/inscrições. | Alterar `waiting → finished` de modo atômico com o fechamento, preservar histórico, não confundir com desistência voluntária. Ausência após corte Admin antecipado não reingressa em fila, mesmo antes do horário oficial. |
| **C-13 — Edições durante o evento [APROVADO]** | Após o **primeiro ingresso/participação criada** no evento (inclusive na espera externa), bloquear alteração dos nomes/identificações de experiências e estações e cadastro de novas experiências; antes desse marco essas operações podem ser realizadas. **Adicionar estações a experiências já existentes durante a operação é permitido**, mantendo a mesma fila da experiência. Não excluir fisicamente experiências ou estações que já tenham sido usadas. A disponibilidade das estações e as concessões/revogações de Staff seguem operacionais durante o evento; horários e encerramentos seguem D07/D09. | Distinguir mutações **estruturais** (bloqueadas quando já houver participação) de ações **operacionais** (estações/Staff/filas). Impedir corrida entre primeiro ingresso e edição estrutural; preservar referências históricas. A regra não cria permissão para mudar o código de ingresso imutável. |
| **C-14 — Perda de capacidade operacional [APROVADO]** | Se o evento aberto ficar **sem Staff autorizado** ou **sem nenhuma estação disponível**, bloquear **novos ingressos no evento**, mantendo participações, esperas, posições e conclusões existentes. Se uma experiência ficar sem estação disponível, bloquear **novas entradas na fila dessa experiência**, sem afetar outras experiências aptas. Não registrar ausências, cancelar esperas nem encerrar evento automaticamente por essa perda de capacidade. Após restaurar Staff/estação, novas entradas voltam a ser possíveis **somente antes dos cortes oficial e administrativo**. A revogação de Staff por segurança nunca é impedida por ele ser o último. | Calcular elegibilidade dinamicamente no backend, sem falso encerramento e sem nova tabela de prontidão. Respeitar pendência antes de desativar estação; nenhum usuário perde posição por indisponibilidade de recursos. |


### 9.3.2 Alinhamento de escopo com a Task 6.1

A especificação da Task 6.1 (v1.1, 16/10/2026) fornece contratos e sugestões para **identidade, autenticação, sessões, perfil, questionário e catálogo de jogos**; não possui implementação de eventos e filas no escopo dessa task. É compatível com cadastro/login antes do questionário, sessão única, tokens de 15 minutos, janela de 30 dias, autorização Admin com TOTP e Staff por evento.

**Harmonização técnica já definida na arquitetura e modelada no esquema da fundação:** `user_roles`, `sessions`, `refresh_tokens`, tokens de recuperação/TOTP e `audit_logs`, `games`/`user_games`, snapshots versionados e estados `waiting/active/finished/canceled`. A implementação dos respectivos serviços e dos fluxos de privacidade ainda está pendente. Os contratos propostos pela Task 6.1 de `registered/in_queue/attending/completed/cancelled` para participações **não substituem** os estados aprovados posteriormente. Nenhum destes conflitos deve gerar módulos duplicados.

**Segurança x experiência — DECISÃO APROVADA:** segue a política estrita de reuso da Task 6.1: reapresentar refresh token já consumido revoga a sessão, mesmo após perda legítima da resposta da renovação. O aplicativo realiza renovação coordenada (*mutex/single-flight*), pode renovar preventivamente quando online e distingue falha de rede de `401` confirmado; não repete automaticamente renovação cujo resultado seja desconhecido. Quando o token renovado é perdido, pode exigir novo login. **A perda de sessão/autenticação nunca cancela a participação, muda a posição na fila ou registra ausência; após login, recuperar estado pelo backend.** Sem janela de tolerância por IP/User-Agent ou mecanismo improvisado de replay. Exigir testes de conectividade de evento antes do piloto.

## 10. Pendências reais — por momento

**Antes de implementar serviços ou integrar o Expo:** especificar o comportamento de contas Admin como participantes (ainda sem decisão de produto); definir timezone civil de referência para nascimento até hoje, inclusive; catálogo de erros/DTOs e fluxos de autorização; tempo de retenção/expurgo de idempotência e de metadados técnicos; confirmar contratos com as telas reais quando a implementação for retomada. A C-10 e sua normalização no backend foram definidas; a criação de eventos ainda deverá reutilizar a função já implementada. Nenhum desses pontos por si só autoriza endpoints agora.

**Antes do piloto com dados pessoais reais:** base legal, direitos dos titulares, proteção de crianças e adolescentes, retenção, backups/expurgo, snapshots, segurança de comentários e grupos pequenos, agregados de BI efetivamente anônimos, auditoria de exportações, serviço de e-mail, TOTP de pelo menos dois Admins, TLS/infraestrutura, testes de concorrência e dispositivos físicos. A fundação local não libera operação real.

**Qualidade e manutenção:** investigar as quatro vulnerabilidades moderadas reportadas em dependências de desenvolvimento; não reescrever o histórico das cinco migrações já aplicadas; adicionar migrations incrementais se o esquema evoluir. Confirmar `git status` e histórico de commits antes de publicar qualquer documentação.

## 11. Organização da documentação e próximo trabalho autorizado

- Este **Planejamento** é a fonte de verdade das **decisões de negócio** (D01–D11 e C-01–C-14), escopo e prioridades.
- A **Arquitetura Backend v0.6.15** (`ARQUITETURA_BACKEND_ARENAGO.md`) descreve as estruturas, contratos candidatos e resultados técnicos. Os endpoints HTTP seguem propostos e não implementados; a E01.2B adiciona a normalização de código e consulta interna no `EventsService`.
- O `backend/README.md` é a referência operacional de execução local; o README do Expo descreve o aplicativo. Não repetir aqui comandos completos de instalação.
- Os relatórios experimentais v0.6.11/v0.6.12 e a Task 6.1 são **fontes históricas**, não documentos concorrentes que substituam estas duas fontes canônicas.
- **Trabalho atual:** revisão da E01.2B e documentação canônica; Git é controlado manualmente pelo responsável. Sem criar Neon, endpoints HTTP ou modificar Expo.

## 12. Registro sintético desta revisão

**v0.7.9 (21/10/2026)** — C-10 atualizada com alfabeto ASCII, comprimento, hífens e whitespace de `String.trim()` aprovados; registrado que a consulta E01.2B usa uma função TypeScript compartilhada e que as garantias SQL existentes são parciais. Build, lint, typecheck e diff-check passaram; a suíte unitária encontrou `uv_os_get_passwd returned ENOMEM` e não foi aprovada, e a integração não foi executada sem URL do banco descartável. Sem migração adicional; futura restrição SQL exige auditoria e migração incremental.

**v0.7.8 (19/10/2026)** — atualização do estado relatado após a Task 6.2 e consolidação das pendências. Regras de produto não alteradas; C-13/C-14 e imutabilidade do código permanecem vigentes.

**v0.7.7 e anteriores (histórico):** aprovações de D01–D11, C-01–C-14, privacidade, autenticação, encerramentos, eventos, filas e operacionalidade; auditoria do frontend e planejamento da fundação. O histórico completo permanece no Git/documentos anteriores, não precisa ser copiado a cada revisão.
