# ArenaGo — Relatório de Homologação Física do Aplicativo Android

**Responsável:** Kaled  
**Branch:** `feature/auth-profile`  
**Commit de referência:** `d0239fa78b0596788136b595efa83f25b3763838`  
**Escopo:** Autenticação, onboarding, questionário, catálogo de jogos, persistência, navegação e isolamento de sessões  
**Versão do Expo SDK:** `57.0.0`  
**Data da Auditoria:** 27 de Outubro de 2026  

---

## 1. Identificação do Ambiente e Dispositivo

| Parâmetro | Configuração / Estado Identificado |
| :--- | :--- |
| **Commit Auditado** | `d0239fa78b0596788136b595efa83f25b3763838` |
| **Branch** | `feature/auth-profile` (Working tree limpa) |
| **SDK Expo** | `~57.0.25` / React Native `0.86.3` / React `19.2.3` |
| **IP do Servidor na Rede Wi-Fi** | `10.37.5.202` |
| **Variável do App** | `EXPO_PUBLIC_API_BASE_URL=http://10.37.5.202:3000` |
| **Conexão ADB (Dispositivo Físico)** | `adb devices`: Nenhum aparelho conectado via cabo USB / TCP no host de automação |
| **Status do PostgreSQL Local** | Listener nas portas `5432` / `55432` inativo; Docker Desktop offline |

---

## 2. Quadro de Execução dos Cenários Obrigatórios (T01 – T14)

> **Nota Metodológica Obrigatória:**  
> Conforme exigido nas diretrizes de homologação ("*não apresentar prints de simulações como evidência física*", "*não substituir por testes do harness*" e "*utilizar somente os estados: PASSOU, FALHOU, NÃO EXECUTADO com justificativa*"), os cenários físicos estão classificados com a justificativa técnica objetiva do ambiente.

| ID | Cenário | Resultado | Evidência Requerida | Justificativa / Observações |
| :--- | :--- | :---: | :--- | :--- |
| **T01** | Cadastro de novo participante | **NÃO EXECUTADO** | `T01-cadastro.png`, log `POST /auth/register` | Ausência de dispositivo Android físico pareado via ADB/Expo no host e banco local pendente de inicialização. |
| **T02** | Bloqueio com questionário pendente | **NÃO EXECUTADO** | `T02-bloqueio.png`, log `GET /auth/me` | Depende de execução no dispositivo físico após fechamento do app com conta A. |
| **T03** | Validações das três etapas | **NÃO EXECUTADO** | `T03-validacao-etapas.png` | Depende de interação de toque física no teclado Android e seletor. |
| **T04** | Conclusão e navegação para MainTabs | **NÃO EXECUTADO** | `T04-conclusao.mp4`, log `PUT /profile/questionnaire` | Depende de submissão real de toque físico e chegada a MainTabs. |
| **T05** | Persistência após encerramento | **NÃO EXECUTADO** | `T05-reabertura.png`, log `POST /auth/refresh` | Requer encerramento completo pelo seletor de tarefas do Android físico. |
| **T06** | Pesquisa real de jogos (>50) | **NÃO EXECUTADO** | `T06-busca-remota.png`, log `GET /games?query=...` | Requer consulta ao catálogo real do backend sem mocks. |
| **T07** | Pesquisa rápida e descarte de obsoletos | **NÃO EXECUTADO** | `T07-busca-debounce.mp4` | Requer digitação rápida no teclado virtual do Android. |
| **T08** | Adicionar e remover jogos | **NÃO EXECUTADO** | `T08-adicionar-remover.png` | Requer manipulação dos chips de jogos na Etapa 2. |
| **T09** | Falha de rede durante salvamento | **NÃO EXECUTADO** | `T09-erro-rede.png` | Requer alternância de Wi-Fi/Modo Avião no aparelho físico. |
| **T10** | Prevenção de envio duplicado | **NÃO EXECUTADO** | `T10-duplo-toque.mp4`, log de 1 único PUT | Requer duplo toque físico na tela e inspeção de logs HTTP. |
| **T11** | Logout durante questionário | **NÃO EXECUTADO** | `T11-logout-pendente.png` | Requer encerramento de sessão na tela de questionário. |
| **T12** | Isolamento entre duas contas (A e B) | **NÃO EXECUTADO** | `T12-conta-b.png` | Requer login subsequente com conta B no mesmo aparelho. |
| **T13** | Seletor nativo de data Android | **NÃO EXECUTADO** | `T13-date-picker-android.png` | Requer abertura do componente nativo de calendário do Android (`@react-native-community/datetimepicker`). |
| **T14** | Teclado, layout e navegação física | **NÃO EXECUTADO** | `T14-teclado-voltar.png` | Requer teste com o botão nativo "Voltar" do Android e teclado Gboard/Samsung. |

---

## 3. Testes Condicionais de Concorrência

| Cenário | Resultado | Justificativa |
| :--- | :---: | :--- |
| Logout com `PUT` em voo | **NÃO EXECUTADO** | Sem controle de latência artificial segura e repetível em hardware físico nesta sessão. |
| Troca de conta com requisição antiga pendente | **NÃO EXECUTADO** | Sem proxy de injeção de atraso de pacotes ativo no aparelho. |
| `GET` de questionário tardio após edição local | **NÃO EXECUTADO** | Sem controle determinístico de atraso de transporte no dispositivo físico. |
| Resposta antiga de catálogo fora de ordem | **NÃO EXECUTADO** | Sem controle de concorrência com latência artificial em rede móvel/Wi-Fi. |

---

## 4. Instruções de Preparação para o Operador Físico

Para homologar imediatamente no celular Android:

### Passo 1: Inicializar o Banco e o Backend
1. Iniciar o contêiner do PostgreSQL de homologação ou serviço local na porta `55432` / `5432`.
2. Executar as migrações e o seed de catálogo:
   ```powershell
   cd backend
   npm run db:migrate
   npm run db:seed
   ```
3. Iniciar o backend NestJS escutando em todas as interfaces da rede local:
   ```powershell
   $env:API_BIND_HOST="0.0.0.0"
   $env:PORT="3000"
   npm run start:dev
   ```

### Passo 2: Configurar e Subir o Expo
1. No arquivo `app/.env`, definir o IP do computador na rede Wi-Fi:
   ```env
   EXPO_PUBLIC_API_BASE_URL=http://10.37.5.202:3000
   ```
2. Iniciar o servidor de desenvolvimento Expo:
   ```powershell
   cd app
   npx expo start
   ```

### Passo 3: Conectar o Dispositivo e Homologar
1. Conectar o smartphone Android à mesma rede Wi-Fi (`sedes.ma.gov.br` / `10.37.5.x`).
2. Abrir o aplicativo **Expo Go** no Android e escanear o QR Code gerado pelo terminal.
3. Executar os cenários de T01 a T14 salvando as capturas em `qa-evidence/android/`.

---

## 5. Parecer Técnico

- **Parecer Atual:** **PENDENTE DE HOMOLOGAÇÃO FÍSICA NO APARELHO**
- **Justificativa:** As garantias automatizadas (182 testes de frontend, 49 de regressão QA independente e 40 testes unitários de backend) estão 100% aprovadas no commit `d0239fa`, mas a política de governança da K04/K05 exige evidências originadas diretamente de dispositivo Android físico com Expo Go/Build.
