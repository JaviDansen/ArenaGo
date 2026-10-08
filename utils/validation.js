/**
 * Utilitários de validação para fluxos de autenticação (Login e Cadastro).
 */

/**
 * Valida o formato de um endereço de e-mail.
 * Requisitos: formato com identificador, '@', domínio e extensão.
 *
 * @param {string} email
 * @returns {boolean}
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

/**
 * Valida os campos da tela de Cadastro.
 * Regras da Task 2:
 * - Nome: obrigatório;
 * - E-mail: obrigatório e deve possuir formato válido;
 * - Senha: obrigatória e deve possuir no mínimo 6 caracteres;
 * - Confirmar senha: obrigatório e deve ser igual à Senha.
 *
 * Não são aplicadas regras adicionais de senha (como números, maiúsculas ou símbolos).
 * O campo 'confirmPassword' é estritamente uma validação local e não compõe dados de perfil.
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

  const trimmedName = (name || '').trim();
  const trimmedEmail = (email || '').trim();

  // Nome: obrigatório
  if (!trimmedName) {
    errors.name = 'O nome é obrigatório.';
  }

  // E-mail: obrigatório e formato válido
  if (!trimmedEmail) {
    errors.email = 'O e-mail é obrigatório.';
  } else if (!isValidEmail(trimmedEmail)) {
    errors.email = 'Informe um e-mail com formato válido.';
  }

  // Senha: obrigatória e mínimo de 6 caracteres
  if (!password) {
    errors.password = 'A senha é obrigatória.';
  } else if (password.length < 6) {
    errors.password = 'A senha deve possuir no mínimo 6 caracteres.';
  }

  // Confirmar senha: obrigatório e igual à senha
  if (!confirmPassword) {
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
 * Regras da Task 2:
 * - E-mail: obrigatório e formato válido;
 * - Senha: obrigatória.
 *
 * @param {Object} data
 * @param {string} data.email
 * @param {string} data.password
 * @returns {{ isValid: boolean, errors: Object }}
 */
export function validateLoginForm({ email, password }) {
  const errors = {};

  const trimmedEmail = (email || '').trim();

  // E-mail: obrigatório e formato válido
  if (!trimmedEmail) {
    errors.email = 'O e-mail é obrigatório.';
  } else if (!isValidEmail(trimmedEmail)) {
    errors.email = 'Informe um e-mail com formato válido.';
  }

  // Senha: obrigatória
  if (!password) {
    errors.password = 'A senha é obrigatória.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Valida os campos da Etapa 1 do Questionário de Perfil ("Sobre você").
 * Regras da Task 3:
 * - Idade: campo numérico e obrigatório;
 * - Gênero: obrigatório ('Feminino', 'Masculino', 'Outro', 'Prefiro não informar').
 *   Se 'Outro', o campo adicional 'otherGender' torna-se obrigatório.
 * - Escolaridade: obrigatório ('Fundamental', 'Médio', 'Superior', 'Pós-graduação', 'Prefiro não informar').
 *
 * @param {Object} data
 * @param {string|number} data.age
 * @param {string} data.gender
 * @param {string} [data.otherGender]
 * @param {string} data.education
 * @returns {{ isValid: boolean, errors: Object }}
 */
export function validateAboutYouStep({ age, gender, otherGender, education }) {
  const errors = {};

  const trimmedAge = String(age ?? '').trim();

  // Idade: obrigatória e deve ser um número inteiro positivo
  if (!trimmedAge) {
    errors.age = 'A idade é obrigatória.';
  } else if (!/^\d+$/.test(trimmedAge)) {
    errors.age = 'A idade deve conter apenas números.';
  } else {
    const parsedAge = parseInt(trimmedAge, 10);
    if (isNaN(parsedAge) || parsedAge <= 0) {
      errors.age = 'A idade deve ser um número inteiro positivo.';
    }
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

