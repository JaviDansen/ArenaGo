/**
 * Mecanismo verificável e documentado de bloqueio de senhas comuns ou comprometidas.
 *
 * Regras aplicadas:
 * 1. Bloqueio de lista canônica de senhas vazadas/comuns (top OWASP/SecLists + padrões PT-BR e contexto do projeto).
 * 2. Bloqueio de sequências triviais ou caracteres inteiramente repetidos (ex.: "aaaaaaaa", "1234567890", "qwertyuiop").
 * 3. Bloqueio de senha idêntica ao próprio nome ou e-mail/identificador local do usuário.
 */

const COMMON_COMPROMISED_PASSWORDS = new Set<string>([
  "12345678",
  "123456789",
  "1234567890",
  "12345678910",
  "00000000",
  "11111111",
  "22222222",
  "33333333",
  "44444444",
  "55555555",
  "66666666",
  "77777777",
  "88888888",
  "99999999",
  "87654321",
  "0987654321",
  "12341234",
  "11223344",
  "123123123",
  "password",
  "password1",
  "password123",
  "passw0rd",
  "p@ssw0rd",
  "qwertyui",
  "qwertyuiop",
  "qwerty123",
  "1q2w3e4r",
  "1q2w3e4r5t",
  "asdfghjk",
  "asdfghjkl",
  "zxcvbnm1",
  "abc12345",
  "abcd1234",
  "abcdefgh",
  "abcdefghij",
  "iloveyou",
  "iloveyou1",
  "admin123",
  "admin1234",
  "administrator",
  "welcome1",
  "welcome123",
  "letmein1",
  "letmein123",
  "monkey123",
  "dragon123",
  "master123",
  "sunshine",
  "sunshine1",
  "princess",
  "football",
  "baseball",
  "superman",
  "trustno1",
  "starwars",
  "whatever",
  "computer",
  "security",
  "internet",
  "senha123",
  "senha1234",
  "senha12345",
  "minhasenha",
  "minhasenha123",
  "mudar123",
  "trocar123",
  "brasil123",
  "flamengo",
  "corinthians",
  "palmeiras",
  "arenago1",
  "arenago123",
  "beast123",
  "beast1234",
  "maragames",
  "participante",
]);

const SEQUENTIAL_PATTERNS = [
  "01234567890",
  "9876543210",
  "abcdefghijklmnopqrstuvwxyz",
  "zyxwvutsrqponmlkjihgfedcba",
  "qwertyuiopasdfghjklzxcvbnm",
];

export interface PasswordContext {
  email?: string;
  name?: string;
}

export interface PasswordStrengthEvaluation {
  compromised: boolean;
  reason?: string;
}

export function evaluatePasswordSecurity(
  password: string,
  context?: PasswordContext,
): PasswordStrengthEvaluation {
  const normalized = password.trim().toLowerCase();

  if (normalized.length === 0) {
    return {
      compromised: true,
      reason: "A senha não pode ser composta apenas por espaços em branco.",
    };
  }

  if (COMMON_COMPROMISED_PASSWORDS.has(normalized)) {
    return {
      compromised: true,
      reason: "Esta senha é muito comum ou consta em listas de credenciais comprometidas.",
    };
  }

  // Todos os caracteres idênticos (ex.: "aaaaaaaa", "11111111")
  if (new Set(normalized).size <= 2) {
    return {
      compromised: true,
      reason: "Esta senha utiliza padrões repetitivos triviais e facilmente adivinháveis.",
    };
  }

  // Sequência direta do teclado ou alfabética/numérica
  for (const seq of SEQUENTIAL_PATTERNS) {
    if (normalized.length <= seq.length && seq.includes(normalized)) {
      return {
        compromised: true,
        reason: "Esta senha utiliza uma sequência simples e previsível.",
      };
    }
  }

  // Verificação contextual contra e-mail e nome do próprio usuário
  if (context?.email) {
    const cleanEmail = context.email.trim().toLowerCase();
    const localPart = cleanEmail.split("@")[0] ?? "";
    if (
      normalized === cleanEmail ||
      (localPart.length >= 4 && normalized === localPart)
    ) {
      return {
        compromised: true,
        reason: "A senha não pode ser igual ao seu endereço de e-mail.",
      };
    }
  }

  if (context?.name) {
    const cleanName = context.name.trim().toLowerCase();
    const compactName = cleanName.replace(/\s+/g, "");
    if (
      cleanName.length >= 4 &&
      (normalized === cleanName || normalized === compactName)
    ) {
      return {
        compromised: true,
        reason: "A senha não pode ser igual ao seu nome.",
      };
    }
  }

  return { compromised: false };
}
