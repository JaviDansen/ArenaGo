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
// - enteredAt / exitedAt: entrada e saída registradas (ISO 8601).
// - exitedAt: null quando a saída não foi registrada (ex.: participação
//   finalizada administrativamente ao fim do evento); nesse caso não há
//   permanência válida e ela não deve ser calculada.
// - experiences: ocorrências realizadas, cada uma com id próprio. A mesma
//   experiência pode aparecer mais de uma vez na mesma participação.
// - evaluation: null quando o participante não avaliou.
export const mockParticipations = [
  {
    id: 'participation-004',
    event: {
      id: 'beast-arena-shopping-da-ilha',
      name: 'BEAST Arena — Shopping da Ilha',
      location: 'Shopping da Ilha',
    },
    // Nova entrada no mesmo evento, finalizada sem experiências realizadas.
    enteredAt: '2026-09-28T17:30:00-03:00',
    exitedAt: '2026-09-28T17:55:00-03:00',
    experiences: [],
    evaluation: null,
  },
  {
    id: 'participation-003',
    event: {
      id: 'beast-arena-shopping-da-ilha',
      name: 'BEAST Arena — Shopping da Ilha',
      location: 'Shopping da Ilha',
    },
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
    evaluation: {
      rating: 5,
      comment: 'Muito divertido!',
    },
  },
  {
    id: 'participation-002',
    event: {
      id: 'beast-arena-demo-agosto',
      name: 'BEAST Arena — Evento de demonstração',
      location: 'Evento de demonstração',
    },
    enteredAt: '2026-08-16T14:00:00-03:00',
    exitedAt: '2026-08-16T14:45:00-03:00',
    experiences: [
      {
        id: 'participation-002-experience-1',
        experience: { id: 'virtual-reality', name: 'Realidade Virtual' },
      },
    ],
    evaluation: null,
  },
  {
    id: 'participation-001',
    event: {
      id: 'beast-arena-demo-julho',
      name: 'BEAST Arena — Evento de demonstração',
      location: 'Evento de demonstração',
    },
    enteredAt: '2026-07-05T18:20:00-03:00',
    // Saída não registrada: a participação foi finalizada ao fim do evento.
    exitedAt: null,
    experiences: [
      {
        id: 'participation-001-experience-1',
        experience: { id: 'playstation', name: 'PlayStation' },
      },
    ],
    evaluation: null,
  },
];
