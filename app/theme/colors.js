/**
 * ArenaGo Design System — Cores Oficiais
 * Extraídas diretamente do Figma BEAST MARAGAMES (File: dtq9QnekCuhc6tVeoLzk7R)
 */

export const colors = {
  // Planos de fundo e superfícies
  background: {
    canvas: '#05050A',    // Fundo profundo do Figma (Node 74013:129)
    base: '#0B0B12',      // Fundo padrão de telas
    surface: '#161626',   // Superfície de cards e modais (Node 74013:195)
    elevated: '#1F1F35',  // Superfície elevada para inputs e cards ativos (Node 74014:211)
  },

  // Identidade de Marca / Destaques
  brand: {
    primary: '#5F33FA',       // Roxo elétrico oficial (Nodes 74013:25, 74013:41, 74013:88)
    primaryHover: '#724CFB',  // Estado pressionado / ativo
    primaryLight: '#8A68FF',  // Destaques e halos
    primaryDim: 'rgba(95, 51, 250, 0.15)', // Fundo de seleções e chips ativos
  },

  // Tipografia e Contrastes
  text: {
    primary: '#FFFFFF',    // Títulos e destaques principais (Nodes 74013:26, 74013:42)
    secondary: '#A0A0B8',  // Rótulos, descritivos e textos de apoio (Node 74013:24)
    muted: '#6C6C8A',      // Placeholders, timestamps e microcopy
    disabled: '#43435B',   // Textos e ações inativas
    onBrand: '#FFFFFF',    // Texto em botões e badges primários
  },

  // Bordas e Divisores
  border: {
    subtle: '#24243A',     // Divisores e bordas de cards passivos
    input: '#2E2E48',      // Contorno de campos de texto
    focus: '#5F33FA',      // Borda com foco ativo
    glass: 'rgba(255, 255, 255, 0.08)', // Efeito de relevo em bordas superiores
  },

  // Cores Semânticas / Estados
  semantic: {
    success: '#00E676',                  // Status ativo, timers, conclusão (Node 74002:37)
    successBg: 'rgba(0, 230, 118, 0.12)',
    danger: '#E11D48',                   // Sair da fila, erros (Node 74013:179)
    dangerBg: 'rgba(225, 29, 72, 0.12)',
    warning: '#FFB800',                  // Estrelas de avaliação, alertas
    warningBg: 'rgba(255, 184, 0, 0.12)',
    info: '#38BDF8',                     // Informações adicionais
    infoBg: 'rgba(56, 189, 248, 0.12)',
  },
};

export default colors;
