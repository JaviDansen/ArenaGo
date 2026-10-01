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
