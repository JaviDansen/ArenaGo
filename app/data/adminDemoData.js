// Fonte única dos dados FICTÍCIOS da Área Admin em modo demonstração.
// Nada aqui vem do servidor nem é enviado a ele: são fixtures para validar a
// interface enquanto os contratos administrativos (§17.8–17.10 e §18 da
// arquitetura) não existem como API. Não compartilhar com o fluxo do
// participante (ParticipationContext) nem com a Área Staff.

export const ADMIN_DEMO_LABEL = 'MODO DEMONSTRAÇÃO';

// Relógio de teste controlado: a demonstração começa sempre neste instante
// (UTC), para que fases e cortes sejam determinísticos.
export const ADMIN_DEMO_CLOCK_START = '2026-11-05T12:00:00.000Z';

// Limites do contrato §18.3 / C-02 usados nas validações locais.
export const ADMIN_MAX_MARGIN_MINUTES = 60;
export const ADMIN_MAX_CONTROLLED_MINUTES = 60;
export const ADMIN_NAME_MAX_LENGTH = 180;
export const ADMIN_CODE_MAX_LENGTH = 64;
export const ADMIN_REASON_MIN_LENGTH = 5;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// Fusos IANA reais do Brasil (D07: Brasil na primeira versão). O Brasil não
// tem horário de verão desde 2019, então o deslocamento é fixo para as datas
// aceitas pela demonstração (2020 em diante). A conversão NÃO usa o fuso do
// aparelho; a validação definitiva do fuso caberá ao backend (§2.3).
export const adminTimezones = deepFreeze([
  { id: 'America/Noronha', label: 'Fernando de Noronha', offsetMinutes: -120 },
  { id: 'America/Sao_Paulo', label: 'São Paulo / Brasília', offsetMinutes: -180 },
  { id: 'America/Fortaleza', label: 'Fortaleza / São Luís', offsetMinutes: -180 },
  { id: 'America/Recife', label: 'Recife', offsetMinutes: -180 },
  { id: 'America/Bahia', label: 'Salvador', offsetMinutes: -180 },
  { id: 'America/Belem', label: 'Belém', offsetMinutes: -180 },
  { id: 'America/Maceio', label: 'Maceió / Aracaju', offsetMinutes: -180 },
  { id: 'America/Araguaina', label: 'Palmas / Araguaína', offsetMinutes: -180 },
  { id: 'America/Santarem', label: 'Santarém', offsetMinutes: -180 },
  { id: 'America/Manaus', label: 'Manaus', offsetMinutes: -240 },
  { id: 'America/Cuiaba', label: 'Cuiabá', offsetMinutes: -240 },
  { id: 'America/Campo_Grande', label: 'Campo Grande', offsetMinutes: -240 },
  { id: 'America/Porto_Velho', label: 'Porto Velho', offsetMinutes: -240 },
  { id: 'America/Boa_Vista', label: 'Boa Vista', offsetMinutes: -240 },
  { id: 'America/Rio_Branco', label: 'Rio Branco', offsetMinutes: -300 },
  { id: 'America/Eirunepe', label: 'Eirunepé', offsetMinutes: -300 },
]);

// Fases exibidas (estados persistidos aprovados: scheduled → open → closing →
// closed). Não existe "archived": arquivamento não está contratado.
export const ADMIN_PHASES = deepFreeze(['scheduled', 'open', 'closing', 'closed']);

export const adminPhaseLabels = deepFreeze({
  scheduled: 'Agendado',
  open: 'Aberto',
  closing: 'Encerrando',
  closed: 'Encerrado',
});

// Critérios de prontidão (§18.4 / C-05), na ordem exibida.
export const adminReadinessLabels = deepFreeze({
  NAME_AND_ACCESS_CODE: 'Nome e código de ingresso',
  VALID_SCHEDULE_AND_TIMEZONE: 'Horários válidos e fuso IANA',
  EXTERNAL_QUEUE_CONFIGURED: 'Fila externa configurada',
  EXPERIENCE_WITH_AVAILABLE_STATION: 'Pelo menos uma experiência com estação disponível',
  VERIFIED_ACTIVE_STAFF: 'Pelo menos um Staff autorizado, ativo e verificado',
});

// Eventos fictícios. Os horários são instantes UTC; "readiness" e
// "participants" são resumos simulados (sem dados pessoais).
export const adminDemoEvents = deepFreeze([
  {
    // Aberto e pronto: status armazenado coerente com o relógio.
    id: 'demo-admin-arena-xp',
    name: 'Arena Experience — Shopping',
    accessCode: 'ARENA-XP',
    timezone: 'America/Fortaleza',
    startsAt: '2026-11-05T11:00:00.000Z',
    officialEndsAt: '2026-11-05T20:00:00.000Z',
    operationalDeadlineAt: '2026-11-05T21:00:00.000Z',
    statusStored: 'open',
    externalQueueEnabled: true,
    closureMode: null,
    closureRequestedAt: null,
    adminDeadlineAt: null,
    readiness: { experiencesWithAvailableStation: 3, verifiedActiveStaff: 2 },
    participants: { externalWaiting: 6, active: 18, finished: 41 },
    audit: [],
  },
  {
    // Pronto, ainda antes do início (abre sozinho ao avançar o relógio).
    id: 'demo-admin-beast-d1',
    name: 'BEAST MARAGAMES — Dia 1',
    accessCode: 'BEAST-D1',
    timezone: 'America/Sao_Paulo',
    startsAt: '2026-11-05T13:00:00.000Z',
    officialEndsAt: '2026-11-05T21:00:00.000Z',
    operationalDeadlineAt: '2026-11-05T21:30:00.000Z',
    statusStored: 'scheduled',
    externalQueueEnabled: true,
    closureMode: null,
    closureRequestedAt: null,
    adminDeadlineAt: null,
    readiness: { experiencesWithAvailableStation: 2, verifiedActiveStaff: 1 },
    participants: { externalWaiting: 0, active: 0, finished: 0 },
    audit: [],
  },
  {
    // Início já alcançado, mas sem estação disponível: continua sem aceitar entradas.
    id: 'demo-admin-kids',
    name: 'Arena Kids',
    accessCode: 'KIDS-01',
    timezone: 'America/Belem',
    startsAt: '2026-11-05T11:30:00.000Z',
    officialEndsAt: '2026-11-05T19:00:00.000Z',
    operationalDeadlineAt: '2026-11-05T19:00:00.000Z',
    statusStored: 'scheduled',
    externalQueueEnabled: false,
    closureMode: null,
    closureRequestedAt: null,
    adminDeadlineAt: null,
    readiness: { experiencesWithAvailableStation: 0, verifiedActiveStaff: 1 },
    participants: { externalWaiting: 0, active: 0, finished: 0 },
    audit: [],
  },
  {
    // Status armazenado defasado ("open"), mas o horário oficial já passou:
    // a fase efetiva é "closing" (janela operacional até 12:15 UTC).
    id: 'demo-admin-noturna',
    name: 'Copa Noturna',
    accessCode: 'NOTURNA',
    timezone: 'America/Manaus',
    startsAt: '2026-11-04T22:00:00.000Z',
    officialEndsAt: '2026-11-05T11:30:00.000Z',
    operationalDeadlineAt: '2026-11-05T12:15:00.000Z',
    statusStored: 'open',
    externalQueueEnabled: true,
    closureMode: null,
    closureRequestedAt: null,
    adminDeadlineAt: null,
    readiness: { experiencesWithAvailableStation: 2, verifiedActiveStaff: 1 },
    participants: { externalWaiting: 0, active: 4, finished: 27 },
    audit: [],
  },
  {
    // Ainda não pronto (sem Staff) e em outro dia.
    id: 'demo-admin-beast-d2',
    name: 'BEAST MARAGAMES — Dia 2',
    accessCode: 'BEAST-D2',
    timezone: 'America/Sao_Paulo',
    startsAt: '2026-11-06T13:00:00.000Z',
    officialEndsAt: '2026-11-06T21:00:00.000Z',
    operationalDeadlineAt: '2026-11-06T21:00:00.000Z',
    statusStored: 'scheduled',
    externalQueueEnabled: true,
    closureMode: null,
    closureRequestedAt: null,
    adminDeadlineAt: null,
    readiness: { experiencesWithAvailableStation: 1, verifiedActiveStaff: 0 },
    participants: { externalWaiting: 0, active: 0, finished: 0 },
    audit: [],
  },
  {
    // Encerrado no horário: o código continua reservado para sempre.
    id: 'demo-admin-summer',
    name: 'Summer Arena',
    accessCode: 'SUMMER-24',
    timezone: 'America/Fortaleza',
    startsAt: '2026-08-18T17:00:00.000Z',
    officialEndsAt: '2026-08-18T23:00:00.000Z',
    operationalDeadlineAt: '2026-08-18T23:30:00.000Z',
    statusStored: 'closed',
    externalQueueEnabled: true,
    closureMode: null,
    closureRequestedAt: null,
    adminDeadlineAt: null,
    readiness: { experiencesWithAvailableStation: 3, verifiedActiveStaff: 2 },
    participants: { externalWaiting: 0, active: 0, finished: 275 },
    audit: [],
  },
  {
    // Encerrado antecipadamente pelo Admin (modo imediato).
    id: 'demo-admin-teste',
    name: 'Teste Interno',
    accessCode: 'TESTE-01',
    timezone: 'America/Fortaleza',
    startsAt: '2026-11-01T13:00:00.000Z',
    officialEndsAt: '2026-11-01T18:00:00.000Z',
    operationalDeadlineAt: '2026-11-01T18:00:00.000Z',
    statusStored: 'closed',
    externalQueueEnabled: false,
    closureMode: 'immediate',
    closureRequestedAt: '2026-11-01T15:20:00.000Z',
    adminDeadlineAt: '2026-11-01T15:20:00.000Z',
    readiness: { experiencesWithAvailableStation: 1, verifiedActiveStaff: 1 },
    participants: { externalWaiting: 0, active: 0, finished: 50 },
    audit: [],
  },
]);
