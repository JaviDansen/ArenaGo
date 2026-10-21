export const mockExperiences = [
  {
    id: 'playstation',
    name: 'PlayStation',
    queueSize: 1,
  },
  {
    id: 'virtual-reality',
    name: 'Realidade Virtual',
    queueSize: 3,
  },
  {
    id: 'racing-simulator',
    name: 'Simulador de Corrida',
    queueSize: 1,
  },
];

export const mockEvents = {
  FILA: {
    id: 'beast-arena-queue',
    name: 'BEAST Arena',
    location: 'Evento de demonstração',
    hasArenaQueue: true,
    experiences: mockExperiences,
  },
  LIVRE: {
    id: 'beast-arena-free',
    name: 'BEAST Arena',
    location: 'Evento de demonstração',
    hasArenaQueue: false,
    experiences: mockExperiences,
  },
};

export const mockGames = [
  'Apex Legends',
  'Call of Duty: Warzone',
  'Counter-Strike 2',
  'Cyberpunk 2077',
  'Dota 2',
  'EA Sports FC 24',
  'Elden Ring',
  'Fortnite',
  'Free Fire',
  'Genshin Impact',
  'Grand Theft Auto V',
  'League of Legends',
  'Minecraft',
  'Overwatch 2',
  'PUBG: Battlegrounds',
  'Rainbow Six Siege',
  'Roblox',
  'Rocket League',
  'The Witcher 3',
  'Valorant',
];

// Histórico de participações do usuário (aba Eventos → Minhas Participações
// e Detalhes da Participação). Temporário enquanto não há integração com backend.
// - id: identifica a participação. O mesmo evento pode aparecer em mais de
//   uma participação, pois cada nova entrada cria uma participação.
// - status: estado da participação ('waiting', 'active', 'finished' ou 'canceled').
// - enteredAt / exitedAt: entrada e saída registradas (ISO 8601).
// - exitedAt: null quando a saída não foi registrada (ex.: participação
//   finalizada administrativamente ao fim do evento); nesse caso não há
//   permanência válida e ela não deve ser calculada.
// - experiences: ocorrências realizadas, cada uma com id próprio. A mesma
//   experiência pode aparecer mais de uma vez na mesma participação.
// - completedServicesCount: evidência simulada de conclusões confirmadas pelo
//   Staff; a elegibilidade continua vindo pronta em evaluation, sem cálculo aqui.
// - evaluation: situação da avaliação como o backend a informaria
//   ({ eligible, submitted, pending }); o aplicativo não calcula prazos nem
//   elegibilidade. Ausente enquanto a participação não foi finalizada.
export const mockParticipations = [
  {
    id: 'participation-006',
    event: {
      id: 'beast-arena-demo-outubro',
      name: 'BEAST Arena — Evento de demonstração',
      location: 'Evento de demonstração',
    },
    status: 'active',
    completedServicesCount: 1,
    // Participação em andamento: ainda sem saída e sem avaliação disponível.
    enteredAt: '2026-10-18T14:00:00-03:00',
    exitedAt: null,
    experiences: [
      {
        id: 'participation-006-experience-1',
        experience: { id: 'playstation', name: 'PlayStation' },
      },
    ],
  },
  {
    id: 'participation-005',
    event: {
      id: 'beast-arena-shopping-da-ilha',
      name: 'BEAST Arena — Shopping da Ilha',
      location: 'Shopping da Ilha',
    },
    status: 'finished',
    completedServicesCount: 1,
    // Outra entrada no mesmo evento, ainda dentro do prazo e sem avaliação.
    enteredAt: '2026-09-28T18:10:00-03:00',
    exitedAt: '2026-09-28T19:00:00-03:00',
    experiences: [
      {
        id: 'participation-005-experience-1',
        experience: { id: 'virtual-reality', name: 'Realidade Virtual' },
      },
    ],
    evaluation: { eligible: true, submitted: false, pending: true },
  },
  {
    id: 'participation-004',
    event: {
      id: 'beast-arena-shopping-da-ilha',
      name: 'BEAST Arena — Shopping da Ilha',
      location: 'Shopping da Ilha',
    },
    status: 'finished',
    completedServicesCount: 0,
    // Nova entrada no mesmo evento, finalizada sem experiências realizadas;
    // sem conclusão confirmada pelo Staff, não é elegível para avaliação (D03).
    enteredAt: '2026-09-28T17:30:00-03:00',
    exitedAt: '2026-09-28T17:55:00-03:00',
    experiences: [],
    evaluation: { eligible: false, submitted: false, pending: false },
  },
  {
    id: 'participation-003',
    event: {
      id: 'beast-arena-shopping-da-ilha',
      name: 'BEAST Arena — Shopping da Ilha',
      location: 'Shopping da Ilha',
    },
    status: 'finished',
    completedServicesCount: 3,
    enteredAt: '2026-09-28T15:10:00-03:00',
    exitedAt: '2026-09-28T16:52:00-03:00',
    experiences: [
      {
        id: 'participation-003-experience-1',
        experience: { id: 'playstation', name: 'PlayStation' },
      },
      {
        id: 'participation-003-experience-2',
        experience: { id: 'racing-simulator', name: 'Simulador de Corrida' },
      },
      {
        id: 'participation-003-experience-3',
        experience: { id: 'playstation', name: 'PlayStation' },
      },
    ],
    evaluation: { eligible: true, submitted: true, pending: false },
  },
  {
    id: 'participation-002',
    event: {
      id: 'beast-arena-demo-agosto',
      name: 'BEAST Arena — Evento de demonstração',
      location: 'Evento de demonstração',
    },
    status: 'finished',
    completedServicesCount: 1,
    enteredAt: '2026-08-16T14:00:00-03:00',
    exitedAt: '2026-08-16T14:45:00-03:00',
    experiences: [
      {
        id: 'participation-002-experience-1',
        experience: { id: 'virtual-reality', name: 'Realidade Virtual' },
      },
    ],
    // Elegível, não avaliada e não mais pendente: prazo de primeira avaliação encerrado.
    evaluation: { eligible: true, submitted: false, pending: false },
  },
  {
    id: 'participation-001',
    event: {
      id: 'beast-arena-demo-julho',
      name: 'BEAST Arena — Evento de demonstração',
      location: 'Evento de demonstração',
    },
    status: 'finished',
    completedServicesCount: 1,
    enteredAt: '2026-07-05T18:20:00-03:00',
    // Saída não registrada: a participação foi finalizada ao fim do evento.
    exitedAt: null,
    experiences: [
      {
        id: 'participation-001-experience-1',
        experience: { id: 'playstation', name: 'PlayStation' },
      },
    ],
    evaluation: { eligible: true, submitted: true, pending: false },
  },
];

// Avaliações enviadas, ligadas à participação pelo participationId
// (no máximo uma por participação, nota de 1 a 5 e comentário opcional, D08).
// Temporário enquanto não há integração com backend.
export const mockEvaluations = [
  {
    id: 'evaluation-001',
    participationId: 'participation-003',
    rating: 5,
    comment: 'Muito divertido!',
  },
  {
    id: 'evaluation-002',
    participationId: 'participation-001',
    rating: 4,
    comment: null,
  },
];
