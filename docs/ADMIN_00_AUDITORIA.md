# ADMIN-00 — Auditoria técnica inicial do módulo Admin

## 1. Resumo executivo

**Código atual:** autenticação, TOTP, sessão e rota Admin são reais. As 14 telas de gestão usam `AdminDemoProvider`; dados e mutações continuam locais. O backend já implementa contratos para eventos, estrutura, operação e papéis, mas nenhuma tela Admin os consome. ADMIN-01 deve integrar a listagem incrementalmente e manter dados reais separados dos demonstrativos.

## 2. Ambiente e estado inicial

Branch `main`; HEAD `ae2ba16b289daeff21fa09db7ca95613d6d79a6e`; `git status --short --branch` inicial: `## main...origin/main`, sem alterações. Este relatório não existia e foi criado no começo da auditoria. Nenhum código, teste ou configuração foi modificado.

Fontes documentais consultadas: `AGENTS.md`, `docs/PANORAMA_ARENAGO_IMPLEMENTACAO.md` (§3.4), `docs/ARQUITETURA_BACKEND_ARENAGO.md` (§§17–20, 27), `docs/ADMIN_FINAL_IMPLEMENTACAO.md`, `docs/ADMIN_AUTHENTICATED_NAVIGATION_IMPLEMENTACAO.md`, `docs/EXPO_ADMIN_TOTP_IMPLEMENTACAO.md`, `docs/ROLE_ROUTING_STAFF_INTEGRATION_IMPLEMENTACAO.md` e `docs/AUTH_STABLE_SESSION_BINDING_IMPLEMENTACAO.md`. São evidência histórica; implementação foi conferida no código citado abaixo. `docs/PLANEJAMENTO_ARENAGO.md`, `ARENAGO_RASCUNHO_ESCOPO_V0_5.md`, `app/AGENTS.md` e os PNGs indicados para ADMIN-01 não foram encontrados no repositório.

## 3. Inventário do frontend Admin

`app/screens/admin/AdminDemoNavigator.js` registra as telas abaixo. Todas usam `useAdminDemo()` direta ou indiretamente. Nenhuma importa o cliente HTTP.

| Tela / rota | Uso e parâmetros |
| --- | --- |
| `AdminPanelScreen` / `AdminPanel` | Painel, contadores e atalhos; logout real. |
| `AdminEventsScreen` / `AdminEvents` | Lista, busca e filtros locais; abre detalhe com `eventId`. |
| `AdminCreateEventScreen` / `AdminCreateEvent` | Criação local; abre detalhe com `eventId` e `created`. |
| `AdminEventDetailScreen` / `AdminEventDetail` | Resumo e atalhos por `eventId`. |
| `AdminEventScheduleScreen` / `AdminEventSchedule` | Horários locais por `eventId`. |
| `AdminEventQueueScreen` / `AdminEventQueue` | Fila externa local por `eventId`. |
| `AdminEventCloseScreen` / `AdminEventClose` | Encerramento local por `eventId`. |
| `AdminEventExperiencesScreen` / `AdminEventExperiences` | Estrutura local por `eventId`. |
| `AdminExperienceDetailScreen` / `AdminExperienceDetail` | Experiência por `eventId`, `experienceId`. |
| `AdminStationDetailScreen` / `AdminStationDetail` | Estação por `eventId`, `experienceId`, `stationId`. |
| `AdminEventStaffScreen` / `AdminEventStaff` | Concessões Staff locais por `eventId`. |
| `AdminHistoryScreen` / `AdminHistory` | Histórico e busca locais. |
| `AdminEventBiScreen` / `AdminEventBi` | BI local por `eventId`. |
| `AdminOverviewScreen` / `AdminOverview` | Indicadores agregados locais. |

`app/screens/admin/components/` fornece `AdminScreen`, `AdminCard`, `AdminButton`, `AdminField`, `AdminOptions`, `AdminNotice`, `AdminPhaseBadge`, `AdminMissing`, `AdminConfirmDialog`, `AdminDemoTools` e outros componentes de métricas/atalhos, com `adminTheme.js`. `useAdminAction.js` e `useAdminConfirmation.js` fazem feedback e confirmação local. Eventos, Histórico e Visão Geral exibem loading, erro/retry e vazio, mas usam `simulateLoad()` e `adminDemoLatency.js`, não rede.

Testes localizados: `app/tests/adminScreens.test.cjs`, `adminNavigation.test.cjs`, `adminDemoState.test.cjs`, `adminStructureScreens.test.cjs`, `adminStructureState.test.cjs`, `adminInsightsScreens.test.cjs`, `adminInsightsState.test.cjs`, `adminAuditFixes.test.cjs`, `authNavigation.test.cjs` e `authVisualIntegration.test.cjs`. Não executados.

## 4. Navegação e dependências compartilhadas

`app/App.js` registra `AdminArea` como pilha exclusiva quando `resolveInitialRouteForAuthState()` permite. `app/screens/auth/AuthSessionGate.js` bloqueia interação durante revalidação/recuperação. `AdminDemoNavigator` é stack sem abas, começa em `AdminPanel` e recusa montagem sem `getAdminDemoOwnerKey()`. `app/navigation/MainTabs.js` pertence ao Participante. `eventId` já identifica evento nas rotas internas; experiências e estações usam IDs adicionais.

Comparação com organização aprovada: faltam abas Admin `Home | Histórico | BI`. Home atual tem Gerenciar, Histórico e Visão Geral; faltam atalhos diretos Criar Evento, Catálogo e Usuários/Permissões. Gerenciar inclui encerrados, que deverão aparecer em Histórico. Detalhe tem atalhos dispersos e deverá agrupar exatamente cinco áreas: Informações e horários; Experiências e estações; Equipe Staff; Operação do evento; BI do evento. Catálogo global e usuários/permissões não têm tela própria.

## 5. AdminDemoProvider

`AdminDemoContext.js` é montado no navegador Admin e isolado por usuário, `sessionId`, epoch e revisão da identidade. `createAdminDemoSession()` copia fixtures de `app/data/adminDemoData.js`: eventos, experiências, estações, chamadas, contas, vínculos Staff, avaliações, conclusões, métricas e relógio fictício. `adminDemoState.js` implementa transições puras para lista, criação, horários, estrutura, disponibilidade, Staff, fila e encerramento. `adminInsights.js` deriva histórico, BI e visão geral. `run()`, `simulateLoad()`, relógio e falha forçada só alteram estado local; `discard()` o limpa. **Nenhuma ação de gestão usa a API.** `auth.logout()` é real. Componentes visuais e padrões de estado são reaproveitáveis; contadores, rótulos e ferramentas da demo não podem aparecer como informação real.

## 6. Contratos administrativos do backend

Prefixo global `/api/v1` em `backend/src/main.ts`. Controllers usam `@RequireSessionAuth()`; serviços Admin exigem papel global ativo, sessão válida e TOTP confirmado. Disponibilidade aceita também Staff apto do evento. Mutações Admin validam chave de idempotência. Esta inspeção não comprova migrations aplicadas ou API em operação.

| Área | Contrato real, responsável, DTO, retorno e limite |
| --- | --- |
| Eventos | `GET /admin/events`, `GET /admin/events/:eventId` em `admin-configuration.controller.ts` → `AdminConfigurationQueryService`, `configurationQuery`/`configurationEventViewSchema`. Lista `{items,nextCursor}`, detalhe `{event}`; nome, código, período, status, fase e prontidão. Lista aceita `limit` (1–50, padrão 20), `cursor`, `phase`, `statusStored`; sem busca textual. |
| Criação | `POST /admin/events` → `AdminConfigurationService`, `createEventBody` (nome, código, fuso, três horários, fila externa, motivo opcional). Retorna visão do evento. |
| Informações/horários | `PATCH /admin/events/:eventId` (`updateEventBody`: nome, motivo opcional) e `PATCH /admin/events/:eventId/schedule` em `AdminScheduleController` → `AdminScheduleService`, `adminScheduleBody` (fim oficial, limite operacional, motivo). Este retorna horários e eventual `changedAt`; início, fuso e código não são editáveis nesses contratos. |
| Prontidão | `GET /admin/events/:eventId/readiness` → `AdminConfigurationQueryService`; status, fase, `ready`, `missing`, `checks`, aceitação de entradas e `observedAt`. A lista já inclui prontidão. |
| Experiências/estações | `GET /admin/events/:eventId/experiences`, `POST /admin/events/:eventId/experiences`, `PATCH /admin/events/:eventId/experiences/:experienceId`, `POST /admin/events/:eventId/experiences/:experienceId/stations`, `PATCH /admin/events/:eventId/experiences/:experienceId/stations/:stationId` em `AdminConfigurationController` → query/write services, `experienceBody`/`stationBody`. Consulta `{eventId,items}` com estações, disponibilidade e chamada pendente. Sem catálogo global. |
| Disponibilidade | `PATCH /staff/events/:eventId/stations/:stationId/availability` em `station-availability.controller.ts` → `StationAvailabilityService`, Zod local `{availability}`. Retorna `stationId`, estado e `pendingServiceSessionId`. Autoriza Admin global com TOTP ou Staff apto do evento. |
| Papéis | `POST /admin/roles/grant`, `POST /admin/roles/revoke` em `admin-role-management.controller.ts` → `AdminRoleManagementService`, `grantAdminRoleBody`/`revokeAdminRoleBody`. Grant aceita Staff com `eventId` ou Admin global; alvo por e-mail existente, ativo e verificado. Revoke por `grantId`; resposta `{grant}`. Sem GET de contas/concessões para lista/pesquisa/revogação UI. Proteção de último Admin no serviço. |
| Fila externa | `PATCH /admin/events/:eventId/external-queue` em `AdminExternalQueueController` → `AdminExternalQueueService`, `{enabled,reason}`. Retorna estado, `releasedCount` e eventual `changedAt`. |
| Encerramento | `POST /admin/events/:eventId/close` em `AdminCloseController` → `AdminCloseService`, modo `immediate` ou `controlled` com `controlledUntilAt`, sempre motivo. Retorna status, modo, cortes e quantidade finalizada na espera externa. |
| Histórico | Sem controller Admin específico. `GET /admin/events` permite `phase=closed` ou `statusStored=closed`, critérios que podem divergir pelo relógio. Sem resultados históricos agregados. |
| BI | Nenhum endpoint Admin de indicadores gerais ou por evento encontrado nos controllers. `adminInsights.js` usa fixtures. |

`backend/src/events/admin-configuration.projection.ts` calcula prontidão/fase em snapshot. Fases reais: `scheduled`, `not_ready`, `open`, `closing`, `closed`; `not_ready` não existe nos filtros da demo. `admin-configuration.dto.ts` fecha parâmetros: busca textual requer mudança de contrato ou busca local limitada aos itens carregados. `admin-operation-auth.ts` e `admin-configuration-query.service.ts` verificam papel global, sessão e segundo fator em transação.

## 7. Autenticação e segurança

`backend/src/auth/auth.controller.ts`: `POST /auth/login`, `POST /auth/2fa/verify`, `POST /auth/refresh`, `GET /auth/me`, `POST /auth/logout`. `totp-activation.controller.ts`: setup/confirm sob autorização própria. `app/screens/auth/LoginScreen.js` conduz TOTP; `app/services/authService.js`, `httpClient.js`, `tokenStorage.js` e `app/context/AuthContext.js` gerem sessão compartilhada. `app/context/adminAccess.js` exige identidade verificada, `sessionId`, papel Admin e nenhum desafio pendente. `AuthSessionGate` prioriza Admin, bloqueia durante checagem e oferece recuperação; expiração/revogação retorna ao login. `AdminDemoProvider` invalida callbacks antigos ao mudar conta/geração.

ADMIN-01 deve manter pilha exclusiva e bloqueios durante `/auth/me` incerto. A API pode devolver 401/403 após revogação; limpar dados anteriores e seguir tratamento compartilhado de sessão. Parâmetros de rota ou mocks não concedem permissão. O backend confere `admin_2fa_verified_at`.

## 8. Matriz de funcionalidades

| Capacidade | Estado |
| --- | --- |
| Login/TOTP, sessão, roteamento protegido, logout | Implementada no app e backend. |
| Lista, consulta, criação, horários, prontidão, estrutura, fila, encerramento, papéis | Backend implementado; telas Admin demonstrativas. |
| Disponibilidade | Backend em rota Staff compartilhada; tela Admin demonstrativa. |
| Busca por nome/código | Demonstrativa na UI; ausente na listagem backend. |
| Histórico | Parcial: fase/status filtráveis; métricas demonstrativas. |
| BI, catálogo global, leitura de contas/concessões | Demonstrativos ou ausentes como contratos Admin de leitura. |
| Abas Home/Histórico/BI e cinco áreas agrupadas | Ausentes na navegação atual. |

## 9. Arquivos compartilhados e riscos de conflito

Admin pode alterar com menor risco `app/screens/admin/`, preservando acesso. Exigem coordenação com Kaled (Staff) e Heliom (Participante): `app/App.js`, `app/screens/auth/*`, `app/context/AuthContext.js`, `adminAccess.js`, `app/services/authService.js`, `httpClient.js`, `tokenStorage.js`, `app/config/apiConfig.js`, `app/theme/`, `app/context/ParticipationContext.js`, `backend/src/auth/*`, `backend/src/events/admin-configuration*`, `station-availability*`, filas/estações e `backend/src/database/schema*`. `MainTabs.js` é do Participante; navegador Staff é exclusivo. Papéis, estação e status afetam os três perfis. Nada foi alterado preventivamente.

## 10. Preparação técnica da ADMIN-01

**Menor conjunto seguro proposto:** manter `AdminArea`, `AuthSessionGate` e `canAccessAdminArea`; adaptar `AdminDemoNavigator.js` para abas Admin e reaproveitar `AdminPanelScreen.js`, `AdminEventsScreen.js`, `AdminHistoryScreen.js` e `AdminOverviewScreen.js` no recorte aprovado. Criar serviço de leitura Admin sobre cliente HTTP autenticado, usando `GET /admin/events` paginado e tratamento de 401/403, rede, vazio e retry. Usar `event.id` UUID na navegação. Reaproveitar `AdminScreen`, `AdminCard`, `AdminButton`, `AdminField`, `AdminOptions`, `AdminNotice` e `AdminPhaseBadge` com rótulos das fases reais. Preservar provider para subtelas demonstrativas. Evento real não pode ser procurado silenciosamente nas fixtures: abrir `AdminEventDetail` requer detalhe real ou estado explícito de função pendente.

Gerenciar deve separar `effectivePhase=closed` para Histórico, inclusive quando `statusStored` divergir. Usar `effectivePhase` para filtros e decidir onde entra `not_ready`. `readiness` já vem em cada item. Busca por nome/código não está no DTO: alternativas são extensão backend paginada (coordenação e escopo adicional) ou busca local explicitamente limitada ao conjunto carregado; esta não satisfaz busca global. Atalhos Criar, Catálogo, Usuários/Permissões e BI não devem prometer operação real enquanto destinos não estiverem integrados.

Arquivos prováveis: `app/screens/admin/AdminDemoNavigator.js`, `AdminPanelScreen.js`, `AdminEventsScreen.js`, componentes Admin pertinentes, novo serviço em `app/services/`, testes `app/tests/adminNavigation.test.cjs`, `adminScreens.test.cjs`, `authNavigation.test.cjs` e integração de roteamento. `AdminEventDetailScreen.js` precisa tratar UUID real se card abrir Painel Individual na ADMIN-01. Busca global exigiria também `backend/src/events/admin-configuration.dto.ts` e `admin-configuration-query.service.ts` com testes de contrato; não presumir autorização desse aumento de escopo.

## 11. Riscos, lacunas e decisões pendentes

1. Definir `not_ready` nos filtros Agendados/Todos e encerramento em Histórico (`effectivePhase` versus status armazenado).
2. Definir busca global paginada; busca parcial não deve ser apresentada como global.
3. Lista real e detalhe demonstrativo têm IDs/fontes distintos; misturá-los pode produzir dados errados ou tela inexistente.
4. Catálogo global, leitura de usuários/permissões e BI exigem contratos próprios ou destinos pendentes claramente marcados.
5. Ativação TOTP de Admin promovido depende de autorização específica conforme relatório histórico; não examinada operacionalmente.
6. Mockups não estavam disponíveis aqui; implementação visual futura deve consultá-los quando acessíveis.

## 12. Conclusão

ADMIN-01 deve começar pela listagem real e navegação Admin isolada, preservando autoridade de sessão e separação entre dados reais e demonstrativos. Busca, detalhe real e destinos dos novos atalhos exigem decisão antes de afirmar cobertura funcional completa. Apenas inspeção estática: sem testes, lint, typecheck, build, API, migrations, banco ou serviços externos. Nenhum resultado automatizado é atribuído a esta auditoria. ADMIN-01 aguarda revisão e aprovação deste relatório.
