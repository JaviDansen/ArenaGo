// Fonte única dos dados FICTÍCIOS da Área Staff em modo demonstração.
// Nada aqui vem do servidor nem é enviado a ele: são fixtures para validar a
// interface enquanto os contratos Staff da API não existem.
// Não compartilhar estes dados com o fluxo do participante (ParticipationContext).

export const STAFF_DEMO_LABEL = 'MODO DEMONSTRAÇÃO';

// Código que simula falha de comunicação na verificação do evento.
export const STAFF_DEMO_ERROR_CODE = 'STAFFERRO';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const staffDemoEvents = deepFreeze({
  // Espelha os prints 02–05: mesmos nomes e contadores das referências.
  STAFFDEMO: {
    id: 'demo-staff-beast-arena',
    code: 'STAFFDEMO',
    name: 'BEAST Arena - Shopping XYZ',
    location: 'Local fictício',
    // Enquanto true, uma ausência devolve a pessoa ao final da fila (D05).
    queueEntriesOpen: true,
    entryQueue: {
      active: true,
      insideCount: 73,
      waiting: [
        { entryId: 'demo-entry-1', participantId: 'demo-p-01', name: 'Rafael T.' },
        { entryId: 'demo-entry-2', participantId: 'demo-p-02', name: 'Júlia P.' },
        { entryId: 'demo-entry-3', participantId: 'demo-p-03', name: 'Marcos L.' },
        { entryId: 'demo-entry-4', participantId: 'demo-p-04', name: 'Beatriz N.' },
      ],
    },
    experiences: [
      {
        id: 'playstation',
        name: 'PlayStation',
        icon: '🎮',
        completedCount: 0,
        stations: [
          {
            id: 'ps-1',
            name: 'PlayStation 1',
            available: true,
            call: { entryId: 'demo-q-ps-0', participantId: 'demo-p-10', name: 'Ana C.' },
          },
          { id: 'ps-2', name: 'PlayStation 2', available: false, call: null },
        ],
        queue: [
          { entryId: 'demo-q-ps-1', participantId: 'demo-p-11', name: 'Lucas R.' },
        ],
      },
      {
        id: 'virtual-reality',
        name: 'Realidade Virtual',
        icon: '🥽',
        completedCount: 0,
        stations: [
          {
            id: 'vr-1',
            name: 'Realidade Virtual 1',
            available: true,
            call: { entryId: 'demo-q-vr-0', participantId: 'demo-p-20', name: 'Carla M.' },
          },
          { id: 'vr-2', name: 'Realidade Virtual 2', available: true, call: null },
        ],
        queue: [
          { entryId: 'demo-q-vr-1', participantId: 'demo-p-21', name: 'Maria A.' },
          { entryId: 'demo-q-vr-2', participantId: 'demo-p-22', name: 'Pedro M.' },
          { entryId: 'demo-q-vr-3', participantId: 'demo-p-23', name: 'Tiago V.' },
        ],
      },
      {
        id: 'racing-simulator',
        name: 'Simulador de Corrida',
        icon: '🏎️',
        completedCount: 0,
        stations: [
          {
            id: 'sim-1',
            name: 'Simulador 1',
            available: true,
            call: { entryId: 'demo-q-sim-0', participantId: 'demo-p-30', name: 'Bruno S.' },
          },
        ],
        queue: [
          { entryId: 'demo-q-sim-1', participantId: 'demo-p-31', name: 'Diego N.' },
        ],
      },
    ],
  },
  // Evento após o corte de inscrições: fila de acesso desligada e filas vazias.
  STAFFVAZIO: {
    id: 'demo-staff-beast-encerrando',
    code: 'STAFFVAZIO',
    name: 'BEAST Arena - Demonstração encerrando',
    location: 'Local fictício',
    // Após o corte oficial de novas inscrições a ausência NÃO volta à fila (C-01).
    queueEntriesOpen: false,
    entryQueue: { active: false, insideCount: 18, waiting: [] },
    experiences: [
      {
        id: 'playstation',
        name: 'PlayStation',
        icon: '🎮',
        completedCount: 0,
        stations: [
          {
            id: 'ps-1',
            name: 'PlayStation 1',
            available: true,
            call: { entryId: 'demo-z-ps-0', participantId: 'demo-p-40', name: 'Renata G.' },
          },
        ],
        queue: [],
      },
      {
        id: 'virtual-reality',
        name: 'Realidade Virtual',
        icon: '🥽',
        completedCount: 0,
        stations: [{ id: 'vr-1', name: 'Realidade Virtual 1', available: false, call: null }],
        queue: [],
      },
      {
        id: 'racing-simulator',
        name: 'Simulador de Corrida',
        icon: '🏎️',
        completedCount: 0,
        stations: [{ id: 'sim-1', name: 'Simulador 1', available: true, call: null }],
        queue: [],
      },
    ],
  },
});

export const staffDemoCodes = Object.keys(staffDemoEvents);
