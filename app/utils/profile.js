import { civilDateToLocalDate, getTodayCivilDate } from './birthDate';

function displayText(value, fallback = 'Não informado') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function displayAge(birthDate, referenceDate) {
  const birth = civilDateToLocalDate(birthDate);
  const today = civilDateToLocalDate(referenceDate);
  if (!birth || !today || birthDate > referenceDate) return 'Não informada';
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth()
    || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) {
    age -= 1;
  }
  return `${age} ${age === 1 ? 'ano' : 'anos'}`;
}

function displayMinutes(value) {
  if (!Number.isSafeInteger(value) || value < 0) return '—';
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return hours ? `${hours}h${minutes ? ` ${minutes}min` : ''}` : `${minutes}min`;
}

// Recebe dados da conta e o formato do GET de questionário, sem buscar dados.
export function getProfileViewData({
  user, statistics, questionnaire, referenceDate = getTodayCivilDate(),
} = {}) {
  const aboutYou = questionnaire?.aboutYou;
  const market = questionnaire?.gamesMarket;
  const games = Array.isArray(questionnaire?.yourGames)
    ? questionnaire.yourGames.map(game => displayText(
      typeof game === 'string' ? game : game?.name, ''
    )).filter(Boolean)
    : [];
  const education = displayText(aboutYou?.education, 'Não informada');

  return {
    name: displayText(user?.name, 'Participante'),
    email: displayText(user?.email, 'E-mail não disponível'),
    participationCount: Number.isSafeInteger(statistics?.participationCount) && statistics.participationCount >= 0
      ? String(statistics.participationCount) : '—',
    totalTime: displayMinutes(statistics?.totalMinutes),
    questionnaireRows: [
      { label: 'Idade', value: displayAge(aboutYou?.birthDate, referenceDate) },
      { label: 'Gênero', value: displayText(
        aboutYou?.gender === 'Outro' ? aboutYou.otherGender : aboutYou?.gender
      ) },
      { label: 'Escolaridade', value: education === 'Superior' ? 'Ensino Superior' : education },
      { label: 'Jogos', value: games.length ? games.join(', ') : 'Não informados' },
      { label: 'Conhece o mercado de games', value: displayText(market?.marketKnowledge) },
      { label: 'Interesse no mercado profissional', value: displayText(market?.marketInterest) },
    ],
  };
}
