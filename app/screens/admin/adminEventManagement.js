export const adminEventAreas = Object.freeze({
  schedule: { title: 'Informações e horários', description: 'Dados do evento, horários e QR Code', icon: 'calendar' },
  experiences: { title: 'Experiências e estações', description: 'Organize as experiências e suas estações', icon: 'folder' },
  staff: { title: 'Equipe Staff', description: 'Concessões e autorizações deste evento', icon: 'users' },
  operation: { title: 'Operação do evento', description: 'Fila externa, funcionamento e encerramento', icon: 'gauge' },
  analytics: { title: 'BI do evento', description: 'Indicadores e resultados deste evento', icon: 'chart' },
});

const requirements = {
  EVENT_NAME_OR_ACCESS_CODE_INVALID: ['Confira o nome e o código de acesso do evento.', 'schedule'],
  EVENT_SCHEDULE_INVALID: ['Revise os horários e o fuso do evento.', 'schedule'],
  EVENT_EXTERNAL_QUEUE_NOT_CONFIGURED: ['Defina a configuração da fila externa.', 'operation'],
  EXPERIENCE_WITH_AVAILABLE_STATION: ['Cadastre pelo menos uma experiência com estação disponível.', 'experiences'],
  VERIFIED_ACTIVE_STAFF: ['Autorize pelo menos um integrante Staff ativo e com e-mail verificado neste evento.', 'staff'],
};

export function adminReadinessRequirements(missing) {
  const items = [...new Set(missing)].filter(code => Object.hasOwn(requirements, code)).map(code => ({
    message: requirements[code][0], area: requirements[code][1],
  }));
  if (!missing.length || missing.some(code => !Object.hasOwn(requirements, code))) {
    items.push({ message: 'Há requisitos de configuração pendentes que não puderam ser detalhados.' });
  }
  return items;
}
