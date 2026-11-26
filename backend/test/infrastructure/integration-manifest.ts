export const integrationProfiles = {
  permanent: { enabled: true, baseline: "canonical", scheduler: "disabled" },
  "isolated-ddl": { enabled: false, baseline: "canonical", scheduler: "disabled" },
  "isolated-scheduler": { enabled: false, baseline: "canonical", scheduler: "deliberate" },
  "isolated-seed": { enabled: false, baseline: "specialized", scheduler: "disabled" },
  "isolated-history": { enabled: false, baseline: "specialized", scheduler: "disabled" },
} as const;

const legacy = {
  operations: ["admin-event-operations-db-guard.ts", "127.0.0.1:55432/arenago_events_test"],
  closureFixture: ["event-closure-fixture.ts / test-db-guard.ts", "127.0.0.1:55432/arenago_events_test"],
  roles: ["admin-role-management-db-guard.ts", "127.0.0.1:55432/arenago_roles_test"],
  bootstrap: ["first-admin-bootstrap-db-guard.ts", "127.0.0.1:55432/arenago_bootstrap_test"],
  admission: ["participant-admission-db-guard.ts", "127.0.0.1:55432/arenago_admission_test"],
  read: ["participations-read-db-guard.ts", "127.0.0.1:55432/arenago_events_test"],
  eventsThree: ["test-db-guard.ts e validações locais", "loopback:55432/arenago_events_test"],
  eventsPair: ["Validação local das duas URLs", "loopback:55432/arenago_events_test"],
  eventsSingle: ["Validação local de EVENTS_TEST_DATABASE_URL", "loopback/arenago_events_test, sem porta fixa"],
  generic: ["test-db-guard.ts", "loopback/arenago_test, arenago_k03_test ou arenago_events_test"],
  externalSchema: ["test-db-guard.ts / assertSafeStaffEntryCallsSchemaDatabase",
    "127.0.0.1:55432/arenago_staff_homolog_20261111"],
} as const;

const exceptions = {
  none: { profile: "permanent", effect: "Fixtures próprias e dados canônicos se houver bootstrap" },
  admin: { profile: "permanent", effect: "Criação temporária de concessões; exige ausência de Admin global histórico" },
  residue: { profile: "permanent", effect: "Pode deixar registros confirmados; requer adaptação ou isolamento" },
  ddl: { profile: "isolated-ddl", effect: "Cria funções e triggers em public para injeção de falhas" },
  job: { profile: "isolated-scheduler", effect: "Scheduler explícito pode varrer todos os eventos elegíveis" },
  seed: { profile: "isolated-seed", effect: "Seed e alterações de catálogo e questionário canônicos" },
  protected: { profile: "isolated-history", effect: "Histórico protegido; rollback obrigatório das fixtures atuais" },
} as const;

type SuiteDefinition = {
  id: string;
  cases: number;
  group: "A" | "B" | "C" | "D";
  legacy: keyof typeof legacy;
  scope: string;
  fixtures: string;
  cleanup: string;
  nest?: true;
  concurrent?: true;
  exception?: keyof typeof exceptions;
};

const suites: readonly SuiteDefinition[] = [
  { id: "absent", cases: 25, group: "B", legacy: "eventsThree",
    scope: "Ausência em atendimento e reentrada", fixtures: "Operação por evento, fila e estação", cleanup: "Dependências por UUID", concurrent: true },
  { id: "admin-close-http", cases: 70, group: "A", legacy: "operations",
    scope: "Encerramento imediato e controlado, auditoria e idempotência", fixtures: "Evento, filas e atendimentos", cleanup: "Transação de limpeza por UUID", nest: true, concurrent: true },
  { id: "admin-configuration", cases: 188, group: "B", legacy: "closureFixture",
    scope: "Configuração administrativa, experiências, estações e prontidão", fixtures: "Fixtures compartilhadas e eventos criados por HTTP", cleanup: "Limpeza por UUID com eventos adicionais", nest: true, concurrent: true },
  { id: "admin-external-queue-http", cases: 41, group: "A", legacy: "operations",
    scope: "Controle administrativo da fila externa e liberação", fixtures: "Evento, Staff e participantes", cleanup: "Transação de limpeza por UUID", nest: true, concurrent: true },
  { id: "admin-role-management", cases: 53, group: "B", legacy: "roles",
    scope: "Grant, GET e revoke de Staff, auditoria e idempotência", fixtures: "Contas, eventos e concessões", cleanup: "Transação por UUID, ator e alvo", nest: true, concurrent: true, exception: "admin" },
  { id: "admin-schedule-http", cases: 61, group: "B", legacy: "eventsThree",
    scope: "Programação, concorrência com ingresso e precisão, incluindo ADMIN-03", fixtures: "Evento, Admin, sessões e participantes", cleanup: "Transação de limpeza por UUID", nest: true, concurrent: true },
  { id: "admin-two-factor-login", cases: 16, group: "D", legacy: "bootstrap",
    scope: "Login Admin, TOTP, recovery e falha no commit", fixtures: "Contas, credenciais, funções e triggers de erro", cleanup: "Remoção dirigida de dados e DDL", nest: true, concurrent: true, exception: "ddl" },
  { id: "auth", cases: 20, group: "C", legacy: "generic",
    scope: "Cadastro, login, refresh, logout e sessões", fixtures: "Contas e sessões criadas via HTTP", cleanup: "Limpeza de cenário específico e fechamento de recursos", nest: true, concurrent: true, exception: "residue" },
  { id: "call-next", cases: 22, group: "B", legacy: "eventsThree",
    scope: "Chamada da fila interna e atomicidade", fixtures: "Fila, estação e Staff", cleanup: "Dependências por UUID", concurrent: true },
  { id: "complete", cases: 20, group: "B", legacy: "eventsThree",
    scope: "Conclusão de atendimento e efeitos na fila", fixtures: "Participações, filas e atendimentos", cleanup: "Dependências por UUID", concurrent: true },
  { id: "database", cases: 22, group: "C", legacy: "generic",
    scope: "Constraints, integridade, unicidade, snapshots e locks", fixtures: "DDL pré-existente e registros confirmados por SQL", cleanup: "Rollback localizado e fechamento do pool", concurrent: true, exception: "residue" },
  { id: "email-verification", cases: 25, group: "B", legacy: "read",
    scope: "Emissão, confirmação, expiração e rollback de tokens", fixtures: "Contas e tokens sintéticos", cleanup: "Exclusão dirigida por conta/token", concurrent: true },
  { id: "email-verification-http", cases: 1, group: "B", legacy: "read",
    scope: "Contrato HTTP de verificação, com entrega simulada", fixtures: "Usuário e tokens reais, e-mail em memória", cleanup: "Exclusão dirigida por conta/token", nest: true },
  { id: "evaluation-read", cases: 69, group: "B", legacy: "closureFixture",
    scope: "Elegibilidade, avaliações pendentes e histórico", fixtures: "Fixture de encerramento com avaliações", cleanup: "Dependências por UUID", nest: true },
  { id: "evaluation-write", cases: 103, group: "B", legacy: "closureFixture",
    scope: "Submissão, edição, idempotência e rollback", fixtures: "Fixture de encerramento com avaliações", cleanup: "Dependências por UUID", nest: true, concurrent: true },
  { id: "event-availability", cases: 1, group: "B", legacy: "eventsPair",
    scope: "Prontidão, janela e capacidade", fixtures: "Evento, estações e Staff", cleanup: "Dependências por UUID" },
  { id: "event-closure", cases: 50, group: "D", legacy: "closureFixture",
    scope: "Regularização, scheduler, reinício e concorrência", fixtures: "Fixture de encerramento e scheduler explícito", cleanup: "Dependências por UUID, varredura exige sandbox", nest: true, concurrent: true, exception: "job" },
  { id: "event-operational-capacity", cases: 1, group: "B", legacy: "eventsSingle",
    scope: "Capacidade operacional por Staff e estação", fixtures: "Eventos, experiências e estações", cleanup: "Dependências por UUID" },
  { id: "events", cases: 1, group: "B", legacy: "eventsSingle",
    scope: "Leitura de evento por UUID e código, janela temporal", fixtures: "Evento sintético", cleanup: "Remoção pelo UUID" },
  { id: "experience-queue-control", cases: 99, group: "B", legacy: "closureFixture",
    scope: "Pausa e reabertura, fila, autorização e auditoria", fixtures: "Fixture de encerramento e operações concorrentes", cleanup: "Dependências por UUID", nest: true, concurrent: true },
  { id: "experiences", cases: 9, group: "B", legacy: "eventsThree",
    scope: "Consulta de experiências e capacidade", fixtures: "Pools de serviço e fixtures de evento", cleanup: "Dependências por UUID" },
  { id: "experiences-http", cases: 23, group: "B", legacy: "eventsThree",
    scope: "Contrato HTTP de experiências e persistência", fixtures: "Usuários, sessões e estrutura", cleanup: "Dependências por UUID", nest: true },
  { id: "external-entry-calls-schema", cases: 1, group: "D", legacy: "externalSchema",
    scope: "Constraints e histórico protegido da migration 0008", fixtures: "Cliente transacional, savepoints e observador", cleanup: "Rollback integral testado com observador", concurrent: true, exception: "protected" },
  { id: "external-queue", cases: 11, group: "B", legacy: "eventsThree",
    scope: "Liberação da fila externa e rollback", fixtures: "Evento, participações e sentinela independente", cleanup: "Dependências por UUID, preserva sentinela", concurrent: true },
  { id: "first-admin-bootstrap", cases: 4, group: "B", legacy: "bootstrap",
    scope: "Primeiro Admin, exclusividade histórica e corrida", fixtures: "Contas sintéticas e sessões via módulo Nest", cleanup: "Exclusão dirigida por usuário", nest: true, concurrent: true, exception: "admin" },
  { id: "mutation-session", cases: 98, group: "B", legacy: "closureFixture",
    scope: "Revogação e expiração da sessão durante mutações", fixtures: "Fixture de encerramento e advisory locks do cenário", cleanup: "Dependências por UUID", nest: true, concurrent: true },
  { id: "participant-admission-http", cases: 10, group: "B", legacy: "admission",
    scope: "Admissão por HTTP, elegibilidade e rollback", fixtures: "Conta, evento e ingresso", cleanup: "Dependências por UUID", nest: true, concurrent: true },
  { id: "participant-queue-http", cases: 22, group: "B", legacy: "eventsThree",
    scope: "Contrato HTTP da fila do participante", fixtures: "Usuário, sessão, fila e estação", cleanup: "Dependências por UUID", nest: true, concurrent: true },
  { id: "participation-lifecycle", cases: 89, group: "B", legacy: "closureFixture",
    scope: "Cancelamento, finalização, idempotência e rollback", fixtures: "Fixture de encerramento, filas e atendimentos", cleanup: "Dependências por UUID", nest: true, concurrent: true },
  { id: "participations-creation", cases: 9, group: "B", legacy: "eventsPair",
    scope: "Primeiro ingresso, snapshot e concorrência", fixtures: "Pools independentes de serviço e fixtures", cleanup: "Dependências por UUID", concurrent: true },
  { id: "participations-eligibility", cases: 1, group: "B", legacy: "eventsPair",
    scope: "Matriz de elegibilidade", fixtures: "Contas, perfis, jogos, concessões e estrutura", cleanup: "Dependências por UUID" },
  { id: "participations-idempotency", cases: 1, group: "B", legacy: "eventsPair",
    scope: "Reserva, replay, conflito e rollback", fixtures: "Contas e eventos com intenções persistidas", cleanup: "Por IDs de fixture e ator", concurrent: true },
  { id: "participations-read", cases: 7, group: "B", legacy: "read",
    scope: "Leitura e isolamento de participações", fixtures: "Pools de serviço e fixture", cleanup: "Dependências por UUID" },
  { id: "participations-transactional-eligibility", cases: 2, group: "B", legacy: "eventsPair",
    scope: "Reavaliação de elegibilidade sob lock", fixtures: "Pools independentes com fixture operacional", cleanup: "Dependências por UUID", concurrent: true },
  { id: "profile-games", cases: 24, group: "D", legacy: "generic",
    scope: "Perfil, catálogo, questionário e seed idempotente", fixtures: "Catálogo compartilhado, seed e alteração de publicação", cleanup: "Restaurações pontuais com risco de resíduo canônico", nest: true, exception: "seed" },
  { id: "queue-entry", cases: 21, group: "B", legacy: "eventsThree",
    scope: "Entrada, FIFO e ponteiros de fila", fixtures: "Pools de serviço e fixtures operacionais", cleanup: "Dependências por UUID", concurrent: true },
  { id: "queue-state", cases: 20, group: "B", legacy: "eventsThree",
    scope: "Estado persistido da fila e consistência", fixtures: "Eventos, participações e filas", cleanup: "Dependências por UUID" },
  { id: "queue-withdrawal", cases: 27, group: "B", legacy: "eventsThree",
    scope: "Retirada, ponteiros e corridas", fixtures: "Pools independentes e fixtures operacionais", cleanup: "Dependências por UUID", concurrent: true },
  { id: "staff-http", cases: 20, group: "B", legacy: "eventsThree",
    scope: "Operações de Staff, autorização e rollback", fixtures: "Contas, concessões e eventos de teste", cleanup: "Dependências por UUID", nest: true, concurrent: true },
  { id: "staff-idempotency-schema-preparation", cases: 1, group: "B", legacy: "eventsThree",
    scope: "Legado e prova de origem da migration 0007", fixtures: "Fixture SQL transacional", cleanup: "Rollback integral" },
  { id: "staff-queries-http", cases: 33, group: "B", legacy: "eventsThree",
    scope: "Consultas Staff, identidade e isolamento", fixtures: "Contas, concessões e operação via HTTP", cleanup: "Dependências por UUID", nest: true },
  { id: "station-availability-http", cases: 35, group: "B", legacy: "eventsThree",
    scope: "Disponibilidade de estação e concorrência", fixtures: "Evento, estação, fila e atendimento", cleanup: "Dependências por UUID", nest: true, concurrent: true },
  { id: "totp-activation", cases: 32, group: "B", legacy: "bootstrap",
    scope: "Ativação de TOTP, revogação e atomicidade", fixtures: "Contas, tokens de ativação e chaves sintéticas", cleanup: "Exclusão dirigida por usuário", nest: true, concurrent: true, exception: "admin" },
];

export const integrationManifest = suites.map(suite => {
  const exception = suite.exception ?? "none";
  const [legacyGuard, legacyTarget] = legacy[suite.legacy];
  return {
    id: suite.id,
    file: `backend/test/integration/${suite.id}.integration.test.ts`,
    scope: suite.scope,
    cases: suite.cases,
    group: suite.group,
    legacyGuard,
    legacyTarget,
    profile: exceptions[exception].profile,
    schema: {
      baseline: "checkout-migrations" as const,
      specificMigration: exception === "protected" ? "0008_external_entry_calls"
        : suite.id === "staff-idempotency-schema-preparation" ? "0007_staff_idempotency_preparation" : null,
    },
    nest: suite.nest === true,
    scheduler: exception === "job" ? "deliberate" as const : "disabled" as const,
    ddl: exception === "ddl",
    seed: exception === "seed",
    preconditions: {
      noHistoricalAdmin: exception === "admin",
      noOperationalRows: true,
      noUnexpectedDdl: true,
      canonicalCatalog: exceptions[exception].profile !== "isolated-seed" && exception !== "protected",
      protectedHistory: exception === "protected",
    },
    fixtures: suite.fixtures,
    cleanup: suite.cleanup,
    concurrent: suite.concurrent === true,
    baselineEffect: exceptions[exception].effect,
    specializedIsolation: suite.group === "D",
    migration: suite.group === "A" ? "legacy-compatible" as const : "legacy-pending" as const,
  };
});

export type IntegrationSuite = typeof integrationManifest[number];
