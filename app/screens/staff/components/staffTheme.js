// Cores e espaçamentos da Área Staff, seguindo os prints de referência
// (referencias_staff/01–05). A identidade visual final ainda será definida.
export const staffColors = {
  background: '#fff',
  text: '#111827',
  muted: '#6b7280',
  divider: '#e5e7eb',
  surface: '#f5f5f6',
  secondary: '#ececee',
  accent: '#8e4585',
  brandStart: '#8e4585',
  brandEnd: '#d0244c',
  brand: '#ae3466',
  onBrand: '#fff',
  danger: '#c9254b',
  dangerSurface: '#fef2f2',
  warning: '#92400e',
  warningSurface: '#fff8e1',
  warningBorder: '#f0b429',
  success: '#15803d',
  successSurface: '#dcfce7',
  successBorder: '#86efac',
  info: '#1e3a8a',
  infoSurface: '#eff6ff',
  infoBorder: '#93c5fd',
};

export const staffSpacing = {
  gutter: 20,
  gap: 12,
  radius: 12,
  buttonRadius: 10,
};

// Degradê dos botões principais (roxo → vermelho). Sem biblioteca extra: o
// React Native novo aplica a propriedade e, se não suportar, vale a cor sólida.
export const staffBrandFill = {
  backgroundColor: staffColors.brand,
  experimental_backgroundImage: `linear-gradient(90deg, ${staffColors.brandStart}, ${staffColors.brandEnd})`,
};
