import { getTodayCivilDate, parseBirthDate } from './birthDate';

/**
 * Utilitários de validação para fluxos de autenticação (Login e Cadastro) e Questionário.
 */

export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 150;
export const EMAIL_MAX_LENGTH = 255;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Valida o formato de um endereço de e-mail.
 * Requisitos: formato com identificador, '@', domínio e extensão, até 255 caracteres.
 *
 * @param {string} email
 * @returns {boolean}
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > EMAIL_MAX_LENGTH) {
    return false;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(trimmed);
}

/**
 * Valida os campos da tela de Cadastro (K02 / Contrato K01):
 * - Nome: obrigatório, entre 2 e 150 caracteres após trim;
 * - E-mail: obrigatório e deve possuir formato válido (até 255 caracteres);
 * - Senha: obrigatória e deve possuir entre 8 e 128 caracteres;
 * - Confirmar senha: obrigatório e deve ser igual à Senha.
 *
 * Não são aplicadas regras arbitrárias de composição (símbolos, números ou maiúsculas).
 * O campo 'confirmPassword' pertence exclusivamente à validação local do frontend.
 *
 * @param {Object} data
 * @param {string} data.name
 * @param {string} data.email
 * @param {string} data.password
 * @param {string} data.confirmPassword
 * @returns {{ isValid: boolean, errors: Object }}
 */
export function validateRegisterForm({ name, email, password, confirmPassword }) {
  const errors = {};

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const trimmedEmail = typeof email === 'string' ? email.trim() : '';

  // Nome: obrigatório, entre 2 e 150 caracteres após trim
  if (!trimmedName) {
    errors.name = 'O nome é obrigatório.';
  } else if (trimmedName.length < NAME_MIN_LENGTH || trimmedName.length > NAME_MAX_LENGTH) {
    errors.name = 'O nome deve possuir entre 2 e 150 caracteres.';
  }

  // E-mail: obrigatório e formato válido
  if (!trimmedEmail) {
    errors.email = 'O e-mail é obrigatório.';
  } else if (!isValidEmail(trimmedEmail)) {
    errors.email = 'Informe um e-mail com formato válido.';
  }

  // Senha: obrigatória, entre 8 e 128 caracteres
  if (!password || typeof password !== 'string') {
    errors.password = 'A senha é obrigatória.';
  } else if (password.length < PASSWORD_MIN_LENGTH) {
    errors.password = 'A senha deve possuir no mínimo 8 caracteres.';
  } else if (password.length > PASSWORD_MAX_LENGTH) {
    errors.password = 'A senha deve possuir no máximo 128 caracteres.';
  }

  // Confirmar senha: obrigatório e igual à senha
  if (!confirmPassword || typeof confirmPassword !== 'string') {
    errors.confirmPassword = 'A confirmação de senha é obrigatória.';
  } else if (confirmPassword !== password) {
    errors.confirmPassword = 'As senhas não coincidem.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Valida os campos da tela de Login.
 * - E-mail: obrigatório e formato válido;
 * - Senha: obrigatória (até 128 caracteres).
 *
 * @param {Object} data
 * @param {string} data.email
 * @param {string} data.password
 * @returns {{ isValid: boolean, errors: Object }}
 */
export function validateLoginForm({ email, password }) {
  const errors = {};

  const trimmedEmail = typeof email === 'string' ? email.trim() : '';

  // E-mail: obrigatório e formato válido
  if (!trimmedEmail) {
    errors.email = 'O e-mail é obrigatório.';
  } else if (!isValidEmail(trimmedEmail)) {
    errors.email = 'Informe um e-mail com formato válido.';
  }

  // Senha: obrigatória
  if (!password || typeof password !== 'string') {
    errors.password = 'A senha é obrigatória.';
  } else if (password.length > PASSWORD_MAX_LENGTH) {
    errors.password = 'A senha deve possuir no máximo 128 caracteres.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Valida os campos da Etapa 1 do Questionário de Perfil ("Sobre você").
 * Regras da Task 3:
 * - Data de nascimento: obrigatória, completa, real e não futura;
 * - Gênero: obrigatório ('Feminino', 'Masculino', 'Outro', 'Prefiro não informar').
 *   Se 'Outro', o campo adicional 'otherGender' torna-se obrigatório.
 * - Escolaridade: obrigatório ('Fundamental', 'Médio', 'Superior', 'Pós-graduação', 'Prefiro não informar').
 *
 * @param {Object} data
 * @param {string} data.birthDate Data apresentada em DD/MM/AAAA.
 * @param {string} data.gender
 * @param {string} [data.otherGender]
 * @param {string} data.education
 * @returns {{ isValid: boolean, errors: Object }}
 */
export function validateAboutYouStep(
  { birthDate, gender, otherGender, education },
  todayISO = getTodayCivilDate()
) {
  const errors = {};

  const trimmedBirthDate = typeof birthDate === 'string' ? birthDate.trim() : '';

  if (!trimmedBirthDate) {
    errors.birthDate = 'A data de nascimento é obrigatória.';
  } else if (!/^\d{2}\/\d{2}\/\d{4}$/.test(trimmedBirthDate)) {
    errors.birthDate = 'Informe a data completa no formato DD/MM/AAAA.';
  } else if (!parseBirthDate(trimmedBirthDate, todayISO)) {
    const isRealDate = parseBirthDate(trimmedBirthDate, '9999-12-31') !== null;
    errors.birthDate = isRealDate
      ? 'A data de nascimento não pode estar no futuro.'
      : 'Informe uma data de nascimento válida.';
  }

  // Gênero: obrigatório
  if (!gender) {
    errors.gender = 'Selecione uma opção de gênero.';
  } else if (gender === 'Outro') {
    const trimmedOther = (otherGender ?? '').trim();
    if (!trimmedOther) {
      errors.otherGender = 'Por favor, especifique o seu gênero.';
    }
  }

  // Escolaridade: obrigatória
  if (!education) {
    errors.education = 'Selecione seu nível de escolaridade.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Valida a Etapa 2 do Questionário de Perfil ("Seus jogos").
 * Regras da Task 4:
 * - O participante deve selecionar pelo menos um jogo para avançar.
 *
 * @param {Object} data
 * @param {Array<string>} data.selectedGames
 * @returns {{ isValid: boolean, errors: Object }}
 */
export function validateYourGamesStep({ selectedGames }) {
  const errors = {};

  if (!selectedGames || !Array.isArray(selectedGames) || selectedGames.length === 0) {
    errors.selectedGames = 'É necessário selecionar ao menos um jogo para continuar.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Valida a Etapa 3 do Questionário de Perfil ("Mercado de games").
 * Regras da Task 5:
 * - marketKnowledge: obrigatório ('Sim, conheço.', 'Conheço um pouco.', 'Não conheço.');
 * - marketInterest: obrigatório ('Sim, tenho interesse.', 'Talvez — quero conhecer melhor.', 'Não tenho interesse.').
 *
 * @param {Object} data
 * @param {string} data.marketKnowledge
 * @param {string} data.marketInterest
 * @returns {{ isValid: boolean, errors: Object }}
 */
export function validateGamesMarketStep({ marketKnowledge, marketInterest }) {
  const errors = {};

  const trimmedKnowledge = typeof marketKnowledge === 'string' ? marketKnowledge.trim() : '';
  if (!trimmedKnowledge) {
    errors.marketKnowledge = 'Selecione uma opção sobre seu conhecimento do mercado de games.';
  }

  const trimmedInterest = typeof marketInterest === 'string' ? marketInterest.trim() : '';
  if (!trimmedInterest) {
    errors.marketInterest = 'Selecione uma opção sobre seu interesse no mercado profissional de games.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}
