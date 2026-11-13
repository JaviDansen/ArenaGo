// Fonte única dos dados FICTÍCIOS da Área Admin em modo demonstração.
// Nada aqui vem do servidor nem é enviado a ele: são fixtures para validar a
// interface enquanto os contratos administrativos (§16–§20 da arquitetura)
// não estão integrados ao app. Não compartilhar com o fluxo do participante
// (ParticipationContext) nem com a Área Staff.

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
// Tamanhos de §2.3 (experiences.name e stations.label).
export const ADMIN_EXPERIENCE_NAME_MAX_LENGTH = 160;
export const ADMIN_STATION_LABEL_MAX_LENGTH = 120;

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

// Critérios de prontidão (§18.4 / C-05), na ordem exibida. Desde a ADM02 eles
// são CALCULADOS a partir das experiências, estações, contas e vínculos Staff
// abaixo; não existe resumo de prontidão gravado no evento.
export const adminReadinessLabels = deepFreeze({
  NAME_AND_ACCESS_CODE: 'Nome e código de ingresso',
  VALID_SCHEDULE_AND_TIMEZONE: 'Horários válidos e fuso IANA',
  EXTERNAL_QUEUE_CONFIGURED: 'Fila externa configurada',
  EXPERIENCE_WITH_AVAILABLE_STATION: 'Pelo menos uma experiência com estação disponível',
  VERIFIED_ACTIVE_STAFF: 'Pelo menos um Staff autorizado, ativo e verificado',
});

// Atalhos de preenchimento (ADM02). NÃO são catálogo global de experiências
// nem de estações: apenas preenchem o campo de texto. Cada experiência é
// criada dentro de um evento e cada estação dentro de uma experiência.
export const adminExperienceNameSuggestions = deepFreeze([
  'Just Dance',
  'Realidade Virtual',
  'Simulador de Corrida',
  'Fliperama',
]);
export const adminStationLabelPrefixes = deepFreeze(['Estação', 'Mesa', 'Cabine']);

// Eventos fictícios. Os horários são instantes UTC; "participants" é um resumo
// simulado (sem dados pessoais). "firstParticipationAt" marca a primeira
// participação histórica (C-13): depois dela a estrutura fica travada.
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
    firstParticipationAt: '2026-11-05T11:02:00.000Z',
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
    firstParticipationAt: null,
    participants: { externalWaiting: 0, active: 0, finished: 0 },
    audit: [],
  },
  {
    // Início já alcançado, mas as duas estações estão indisponíveis: continua
    // sem aceitar entradas até alguma estação ficar disponível.
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
    firstParticipationAt: null,
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
    firstParticipationAt: '2026-11-04T22:05:00.000Z',
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
    firstParticipationAt: null,
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
    firstParticipationAt: '2026-08-18T17:03:00.000Z',
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
    firstParticipationAt: '2026-11-01T13:04:00.000Z',
    participants: { externalWaiting: 0, active: 0, finished: 50 },
    // Parte das 50 finalizadas foi finalizada pelo encerramento imediato:
    // não conta como experiência concluída nem gera avaliação.
    adminFinalized: 14,
    audit: [],
  },
]);

// Experiências (§2.3 #16): cada uma pertence a UM evento e tem UMA fila,
// compartilhada por todas as suas estações. "queue" é o resumo fictício dessa
// fila única (quantas pessoas aguardam); não existe fila por estação.
export const adminDemoExperiences = deepFreeze([
  { id: 'demo-admin-exp-xp-dance', eventId: 'demo-admin-arena-xp', name: 'Just Dance', queue: { waiting: 5 } },
  { id: 'demo-admin-exp-xp-corrida', eventId: 'demo-admin-arena-xp', name: 'Simulador de Corrida', queue: { waiting: 3 } },
  { id: 'demo-admin-exp-xp-vr', eventId: 'demo-admin-arena-xp', name: 'Realidade Virtual', queue: { waiting: 2 } },
  { id: 'demo-admin-exp-d1-luta', eventId: 'demo-admin-beast-d1', name: 'Arena de Luta', queue: { waiting: 0 } },
  { id: 'demo-admin-exp-d1-corrida', eventId: 'demo-admin-beast-d1', name: 'Corrida Virtual', queue: { waiting: 0 } },
  { id: 'demo-admin-exp-kids-pintura', eventId: 'demo-admin-kids', name: 'Pintura Digital', queue: { waiting: 0 } },
  { id: 'demo-admin-exp-noturna-mesa', eventId: 'demo-admin-noturna', name: 'Futebol de Mesa', queue: { waiting: 1 } },
  { id: 'demo-admin-exp-noturna-fliper', eventId: 'demo-admin-noturna', name: 'Fliperama', queue: { waiting: 0 } },
  { id: 'demo-admin-exp-d2-dance', eventId: 'demo-admin-beast-d2', name: 'Just Dance', queue: { waiting: 0 } },
  { id: 'demo-admin-exp-summer-dance', eventId: 'demo-admin-summer', name: 'Just Dance', queue: { waiting: 0 } },
  { id: 'demo-admin-exp-summer-sim', eventId: 'demo-admin-summer', name: 'Simulador', queue: { waiting: 0 } },
  { id: 'demo-admin-exp-summer-vr', eventId: 'demo-admin-summer', name: 'Realidade Virtual', queue: { waiting: 0 } },
  { id: 'demo-admin-exp-teste-fila', eventId: 'demo-admin-teste', name: 'Teste de Fila', queue: { waiting: 0 } },
]);

// Estações (§2.3 #17): cada uma pertence a UMA experiência (e, por ela, a um
// evento). "availability" é a disponibilidade operacional; ocupação é outro
// conceito (chamada pendente) e não fica gravada na estação.
export const adminDemoStations = deepFreeze([
  { id: 'demo-admin-station-xp-dance-1', experienceId: 'demo-admin-exp-xp-dance', label: 'Estação 1', availability: 'available' },
  { id: 'demo-admin-station-xp-dance-2', experienceId: 'demo-admin-exp-xp-dance', label: 'Estação 2', availability: 'available' },
  { id: 'demo-admin-station-xp-corrida-a', experienceId: 'demo-admin-exp-xp-corrida', label: 'Cockpit A', availability: 'available' },
  { id: 'demo-admin-station-xp-corrida-b', experienceId: 'demo-admin-exp-xp-corrida', label: 'Cockpit B', availability: 'unavailable' },
  { id: 'demo-admin-station-xp-vr-1', experienceId: 'demo-admin-exp-xp-vr', label: 'Óculos 1', availability: 'available' },
  { id: 'demo-admin-station-d1-ringue-1', experienceId: 'demo-admin-exp-d1-luta', label: 'Ringue 1', availability: 'available' },
  { id: 'demo-admin-station-d1-sim-1', experienceId: 'demo-admin-exp-d1-corrida', label: 'Simulador 1', availability: 'available' },
  { id: 'demo-admin-station-d1-sim-2', experienceId: 'demo-admin-exp-d1-corrida', label: 'Simulador 2', availability: 'available' },
  { id: 'demo-admin-station-kids-mesa-1', experienceId: 'demo-admin-exp-kids-pintura', label: 'Mesa 1', availability: 'unavailable' },
  { id: 'demo-admin-station-kids-mesa-2', experienceId: 'demo-admin-exp-kids-pintura', label: 'Mesa 2', availability: 'unavailable' },
  { id: 'demo-admin-station-noturna-a', experienceId: 'demo-admin-exp-noturna-mesa', label: 'Mesa A', availability: 'available' },
  { id: 'demo-admin-station-noturna-b', experienceId: 'demo-admin-exp-noturna-mesa', label: 'Mesa B', availability: 'available' },
  { id: 'demo-admin-station-noturna-maquina', experienceId: 'demo-admin-exp-noturna-fliper', label: 'Máquina 1', availability: 'available' },
  { id: 'demo-admin-station-d2-dance-1', experienceId: 'demo-admin-exp-d2-dance', label: 'Estação 1', availability: 'available' },
  { id: 'demo-admin-station-summer-dance-1', experienceId: 'demo-admin-exp-summer-dance', label: 'Estação 1', availability: 'available' },
  { id: 'demo-admin-station-summer-dance-2', experienceId: 'demo-admin-exp-summer-dance', label: 'Estação 2', availability: 'available' },
  { id: 'demo-admin-station-summer-sim-1', experienceId: 'demo-admin-exp-summer-sim', label: 'Cockpit 1', availability: 'available' },
  { id: 'demo-admin-station-summer-vr-1', experienceId: 'demo-admin-exp-summer-vr', label: 'Óculos 1', availability: 'available' },
  { id: 'demo-admin-station-teste-1', experienceId: 'demo-admin-exp-teste-fila', label: 'Estação 1', availability: 'available' },
]);

// Chamadas (service_sessions) FICTÍCIAS e FIXAS. A Área Admin não processa
// chamadas: não chama, não conclui e não marca ausência. Elas existem só para
// mostrar a ocupação e o bloqueio de desativação (§16.7). Sem dados pessoais.
export const adminDemoServiceCalls = deepFreeze([
  {
    id: 'demo-admin-call-xp-dance-1',
    experienceId: 'demo-admin-exp-xp-dance',
    stationId: 'demo-admin-station-xp-dance-1',
    status: 'pending',
    calledAt: '2026-11-05T11:58:00.000Z',
  },
]);

// Contas fictícias JÁ EXISTENTES (D04: o Admin concede Staff buscando o e-mail
// de uma conta existente; nada aqui cria conta). Domínio reservado ".example".
export const adminDemoAccounts = deepFreeze([
  { id: 'demo-admin-account-ana', email: 'ana.lima@arenago.example', active: true, emailVerified: true },
  { id: 'demo-admin-account-bruno', email: 'bruno.costa@arenago.example', active: true, emailVerified: true },
  { id: 'demo-admin-account-carla', email: 'carla.mendes@arenago.example', active: true, emailVerified: true },
  { id: 'demo-admin-account-diego', email: 'diego.rocha@arenago.example', active: true, emailVerified: true },
  { id: 'demo-admin-account-elisa', email: 'elisa.martins@arenago.example', active: true, emailVerified: false },
  { id: 'demo-admin-account-fabio', email: 'fabio.nunes@arenago.example', active: false, emailVerified: true },
  { id: 'demo-admin-account-gabriela', email: 'gabriela.alves@arenago.example', active: false, emailVerified: false },
  { id: 'demo-admin-account-heitor', email: 'heitor.ramos@arenago.example', active: true, emailVerified: true },
]);

// ─── BI da demonstração (ADM03) ──────────────────────────────────────────
// Fixtures PEQUENAS e FICTÍCIAS, presas aos IDs estáveis acima. Não repetem os
// contadores de participação dos eventos (a fonte deles continua sendo
// "participants"); medem populações diferentes, sempre agregadas (D10).

// Atendimentos encerrados pelo Staff, POR ESTAÇÃO (service_sessions
// "completed" e ausências marcadas). Ausência não prova falta real (D01).
// Estação sem linha aqui = nenhum atendimento registrado.
export const adminDemoStationCompletions = deepFreeze([
  { stationId: 'demo-admin-station-xp-dance-1', completed: 20, absences: 1 },
  { stationId: 'demo-admin-station-xp-dance-2', completed: 18, absences: 2 },
  { stationId: 'demo-admin-station-xp-corrida-a', completed: 15, absences: 0 },
  // Ficou indisponível depois de atender: os atendimentos anteriores contam.
  { stationId: 'demo-admin-station-xp-corrida-b', completed: 3, absences: 1 },
  { stationId: 'demo-admin-station-xp-vr-1', completed: 9, absences: 0 },
  { stationId: 'demo-admin-station-noturna-a', completed: 12, absences: 1 },
  { stationId: 'demo-admin-station-noturna-b', completed: 10, absences: 0 },
  { stationId: 'demo-admin-station-noturna-maquina', completed: 14, absences: 2 },
  { stationId: 'demo-admin-station-summer-dance-1', completed: 80, absences: 5 },
  { stationId: 'demo-admin-station-summer-dance-2', completed: 62, absences: 4 },
  { stationId: 'demo-admin-station-summer-sim-1', completed: 96, absences: 4 },
  { stationId: 'demo-admin-station-summer-vr-1', completed: 4, absences: 0 },
  { stationId: 'demo-admin-station-teste-1', completed: 38, absences: 6 },
]);

// Avaliações (D08): no máximo UMA por participação. "revisions" guarda as
// edições; vale a mais recente. O id é anônimo (não aponta para conta nem
// participação identificável). Sem comentários.
export const adminDemoEvaluations = deepFreeze([
  { id: 'demo-admin-eval-xp-01', eventId: 'demo-admin-arena-xp', revisions: [{ score: 5, at: '2026-11-05T11:40:00.000Z' }] },
  { id: 'demo-admin-eval-xp-02', eventId: 'demo-admin-arena-xp', revisions: [{ score: 4, at: '2026-11-05T11:45:00.000Z' }] },
  { id: 'demo-admin-eval-xp-03', eventId: 'demo-admin-arena-xp', revisions: [{ score: 2, at: '2026-11-05T11:47:00.000Z' }, { score: 4, at: '2026-11-05T11:55:00.000Z' }] },
  { id: 'demo-admin-eval-xp-04', eventId: 'demo-admin-arena-xp', revisions: [{ score: 5, at: '2026-11-05T11:50:00.000Z' }] },
  { id: 'demo-admin-eval-xp-05', eventId: 'demo-admin-arena-xp', revisions: [{ score: 3, at: '2026-11-05T11:52:00.000Z' }] },
  { id: 'demo-admin-eval-summer-01', eventId: 'demo-admin-summer', revisions: [{ score: 5, at: '2026-08-18T19:00:00.000Z' }] },
  { id: 'demo-admin-eval-summer-02', eventId: 'demo-admin-summer', revisions: [{ score: 5, at: '2026-08-18T19:10:00.000Z' }] },
  { id: 'demo-admin-eval-summer-03', eventId: 'demo-admin-summer', revisions: [{ score: 4, at: '2026-08-18T19:20:00.000Z' }] },
  // Editada duas vezes: conta uma vez, com a nota mais recente (2).
  { id: 'demo-admin-eval-summer-04', eventId: 'demo-admin-summer', revisions: [{ score: 5, at: '2026-08-18T19:30:00.000Z' }, { score: 3, at: '2026-08-19T10:00:00.000Z' }, { score: 2, at: '2026-08-20T09:00:00.000Z' }] },
  { id: 'demo-admin-eval-summer-05', eventId: 'demo-admin-summer', revisions: [{ score: 4, at: '2026-08-18T20:00:00.000Z' }] },
  { id: 'demo-admin-eval-summer-06', eventId: 'demo-admin-summer', revisions: [{ score: 5, at: '2026-08-18T20:15:00.000Z' }] },
  // Revisões fora de ordem: a vigente é a de instante mais recente (4).
  { id: 'demo-admin-eval-summer-07', eventId: 'demo-admin-summer', revisions: [{ score: 4, at: '2026-08-21T12:00:00.000Z' }, { score: 1, at: '2026-08-18T21:00:00.000Z' }] },
  { id: 'demo-admin-eval-summer-08', eventId: 'demo-admin-summer', revisions: [{ score: 3, at: '2026-08-18T21:30:00.000Z' }] },
  { id: 'demo-admin-eval-summer-09', eventId: 'demo-admin-summer', revisions: [{ score: 5, at: '2026-08-18T22:00:00.000Z' }] },
  { id: 'demo-admin-eval-summer-10', eventId: 'demo-admin-summer', revisions: [{ score: 4, at: '2026-08-18T22:30:00.000Z' }] },
  // Poucas avaliações de propósito: abaixo do mínimo do grupo.
  { id: 'demo-admin-eval-teste-01', eventId: 'demo-admin-teste', revisions: [{ score: 4, at: '2026-11-01T14:30:00.000Z' }] },
  { id: 'demo-admin-eval-teste-02', eventId: 'demo-admin-teste', revisions: [{ score: 3, at: '2026-11-01T14:50:00.000Z' }] },
  { id: 'demo-admin-eval-teste-03', eventId: 'demo-admin-teste', revisions: [{ score: 5, at: '2026-11-01T15:00:00.000Z' }] },
]);

// Métricas temporais AGREGADAS (planejamento): populações próprias, nunca
// deduzidas de horários do evento nem de finalização administrativa.
// lastCompletion = entrada efetiva → última experiência "completed";
// voluntaryExit = entrada efetiva → saída voluntária registrada.
// Evento ausente aqui = dados insuficientes.
export const adminDemoTimeMetrics = deepFreeze([
  { eventId: 'demo-admin-arena-xp', lastCompletion: { sampleSize: 22, averageMinutes: 38 }, voluntaryExit: { sampleSize: 6, averageMinutes: 25 } },
  { eventId: 'demo-admin-summer', lastCompletion: { sampleSize: 180, averageMinutes: 46 }, voluntaryExit: { sampleSize: 3, averageMinutes: 31 } },
]);

// Proteção de pequenos grupos (D10): abaixo deste tamanho de população a
// métrica aparece como "Dados insuficientes". Valor da demonstração; a
// política real ainda será definida.
export const ADMIN_MIN_GROUP_SIZE = 5;

// Períodos do BI: janela que termina no relógio da demonstração e considera
// o INÍCIO do evento. "all" inclui também eventos futuros.
export const adminBiPeriods = deepFreeze([
  { id: 'all', label: 'Todo o período', days: null },
  { id: '7d', label: 'Últimos 7 dias', days: 7 },
  { id: '30d', label: 'Últimos 30 dias', days: 30 },
  { id: '90d', label: 'Últimos 90 dias', days: 90 },
]);

// Vínculos Staff POR EVENTO (D04 / user_roles com event_id), nunca por
// estação. "revokedAt" nulo = vínculo vigente; revogar grava o instante.
export const adminDemoStaffGrants = deepFreeze([
  { id: 'demo-admin-grant-xp-ana', eventId: 'demo-admin-arena-xp', accountId: 'demo-admin-account-ana', grantedAt: '2026-11-04T18:00:00.000Z', revokedAt: null },
  { id: 'demo-admin-grant-xp-bruno', eventId: 'demo-admin-arena-xp', accountId: 'demo-admin-account-bruno', grantedAt: '2026-11-04T18:05:00.000Z', revokedAt: null },
  { id: 'demo-admin-grant-d1-carla', eventId: 'demo-admin-beast-d1', accountId: 'demo-admin-account-carla', grantedAt: '2026-11-04T19:00:00.000Z', revokedAt: null },
  { id: 'demo-admin-grant-kids-bruno', eventId: 'demo-admin-kids', accountId: 'demo-admin-account-bruno', grantedAt: '2026-11-04T19:10:00.000Z', revokedAt: null },
  // Concedido antes de a conta ser desativada: o vínculo segue vigente, mas
  // não conta para a prontidão (conta inativa).
  { id: 'demo-admin-grant-kids-fabio', eventId: 'demo-admin-kids', accountId: 'demo-admin-account-fabio', grantedAt: '2026-11-04T19:15:00.000Z', revokedAt: null },
  { id: 'demo-admin-grant-noturna-diego', eventId: 'demo-admin-noturna', accountId: 'demo-admin-account-diego', grantedAt: '2026-11-04T20:00:00.000Z', revokedAt: null },
  { id: 'demo-admin-grant-summer-ana', eventId: 'demo-admin-summer', accountId: 'demo-admin-account-ana', grantedAt: '2026-08-17T12:00:00.000Z', revokedAt: null },
  { id: 'demo-admin-grant-summer-heitor', eventId: 'demo-admin-summer', accountId: 'demo-admin-account-heitor', grantedAt: '2026-08-17T12:05:00.000Z', revokedAt: null },
  { id: 'demo-admin-grant-teste-heitor', eventId: 'demo-admin-teste', accountId: 'demo-admin-account-heitor', grantedAt: '2026-10-31T12:00:00.000Z', revokedAt: null },
]);
