# ArenaGo — regressões independentes

Base examinada: `77381cf00f435f63063ef1d558c932aad5f9c472`.
Esta pasta adiciona apenas testes, infraestrutura de teste e documentação.
Nenhum arquivo de produção ou teste de integração existente precisa ser alterado
para reproduzir os resultados registrados em [EXECUTION.md](EXECUTION.md).

## Execução em uma cópia de revisão

Requisitos: Node.js 24.15.0 ou superior; dependências de `app` e `backend`
instaladas conforme seus lockfiles. Estes testes não carregam `.env`, não
inicializam Nest, não criam Pool/Client e não executam seed/migração.

Antes de aplicar o patch, use outra cópia do commit de referência:

```powershell
git apply --check C:\caminho\arenago-regression-tests.patch
git apply C:\caminho\arenago-regression-tests.patch
npm.cmd --prefix qa/regression ci --ignore-scripts --no-audit --no-fund
Set-Location qa/regression
node run.cjs
```

Se as dependências de app/backend ainda não estiverem instaladas, execute
`npm ci --ignore-scripts --no-audit --no-fund` separadamente nessas duas pastas.
Isso instala os lockfiles existentes; não execute `audit fix`.

Para uma cópia temporária sem seus próprios `node_modules`, é possível reutilizar
dependências já instaladas, somente para leitura:

```powershell
$env:ARENAGO_REFERENCE_DEPENDENCIES = 'C:\DoJob\ProgramacaoMobile'
node run.cjs
```

Esse override afeta apenas a resolução de Babel, TypeScript e do parser pg.
Todo código sob teste continua sendo lido da cópia onde esta pasta está.
React, react-test-renderer e React Navigation vêm do pacote de testes local.

`node run.cjs` escreve `artifacts/results.tap`, `results.jsonl` e
`runner-stderr.txt`, e preserva o exit code do test runner. Na base examinada,
o exit code esperado é 1: há regressões reproduzidas, não são testes TODO/skipped.
Uma falha futura de importação, fixture ou pré-condição deve ser investigada
como infraestrutura/BLOQUEADO, nunca contabilizada automaticamente como RED.

Alternativas:

```powershell
npm.cmd test
node --test --test-name-pattern="^B01 " tests/navigation.test.cjs
node --test --test-name-pattern="^C10 |^C11 " tests/session-isolation.test.cjs
npm.cmd run test:existing-guard
```

O último comando executa somente o arquivo unitário existente da guarda,
transpilado em memória, sem importar o módulo de integração.

## O que é real e o que é simulado

| Área | Código real executado | Substituições e limites |
|---|---|---|
| A — guarda | `assertSafeTestDatabase` do commit e `pg-connection-string` instalado no backend | Apenas strings de configuração fictícias; nenhuma conexão ou consulta DNS. |
| B — conclusão | `AppNavigation`, `ProfileQuestionnaireScreen`, `AuthProvider`, `createAuthSessionManager`, React 19.2.3, core do React Navigation 7.22.1, StackRouter 7.6.4 | Transporte HTTP e armazenamento em memória. Navigator de teste usa o `useNavigationBuilder`, dispatch, reconciliação e descriptors reais; substitui a view do native-stack por renderização do descriptor focado. Não cobre animações, native-screens nem aparelho. MainTabs e telas alheias ao questionário são marcadores de destino. |
| C — sessões | Mesmo componente, AuthContext/manager e ciclo de hooks reais | C01–C09 e C12–C13 mantêm intencionalmente a instância montada para testar seu contrato de reset. C10–C11 usam AppNavigation real e exercitam desmontagem/remontagem por logout. Esses dois modelos não são equivalentes. |
| D/E — formulário | Componente real renderizado com React, eventos e atualizações reais | Views React Native e BirthDateInput são hosts de teste. As asserções consultam textos, inputs e controles da árvore renderizada; não capturam hooks ou valores internos. |
| F — restauração | Corpos exatos dos callbacks K03-F.1 e K03-F.2 extraídos por AST do arquivo de integração | Executor SQL em memória e serviços de suporte simulados. Testa o código de preparação/finally existente, sem testar o comportamento de PostgreSQL/Nest. Não importa o arquivo de integração nem seus hooks. |

As versões React/core/router são confrontadas com o lockfile do app antes dos
testes: uma divergência impede a execução em vez de testar outra implementação
silenciosamente. O react-test-renderer emite seu aviso de depreciação; ele
continua usando React real. Não há simulação própria de `useState/useEffect`
como no harness anterior. Estes testes não equivalem a E2E num dispositivo.

As respostas HTTP são Promises controladas individualmente. O runner usa
`act` para terminar o trabalho React; nenhum teste depende de sleeps de 20/30 ms.

## Política de segurança exercitada pela seção A

Há dois grupos distintos: divergências objetivas entre URL/driver (host,
parâmetros repetidos/codificados e protocolo socket) e requisitos conservadores
de autorização (nomes ambíguos, protocolos incompatíveis e aliases não atestados).

As fixtures só atestam `localhost`/`127.0.0.1` e os bancos
`arenago_test`/`arenago_k03_test`. Um alias com nome sugestivo não comprova
localidade, e conter `test`/`k03`/`descarta` não comprova descartabilidade.
Os RED de aliases não afirmam que o DNS local real aponta para a nuvem.
Se a futura guarda ganhar uma allowlist explícita de containers, configure
uma fixture autorizada e mantenha também os testes de aliases não autorizados.
Nem mesmo uma string local comprova operacionalmente que um banco é descartável;
os testes aprovam a configuração da fixture, sem acessar um banco real.

A19 é um controle: `?database=production` sozinho não redireciona o banco
no parser instalado. Ele evita inventar uma vulnerabilidade pelo nome do parâmetro.

## Manutenção após as correções

Incorpore permanentemente A01–A19, B01–B02, C01–C13, D01–D04, E01–E03 e F01–F08.
Preserve os controles GREEN: eles impedem correções que simplesmente bloqueiem
toda conexão, eliminem preload ou impeçam persistência legítima.

Os testes C de instância retida verificam robustez do componente. Caso o contrato
definitivo passe a exigir remontagem por identidade, mantenha C10–C11 no nível do
navegador e teste explicitamente essa remontagem; não apresente os RED de instância
retida como vazamento confirmado no fluxo normal que hoje passa.

Para K03-F, prefira futuramente extrair helpers de snapshot/restauração dos testes
de integração e testá-los diretamente. Até isso acontecer, o adaptador de AST
executa o callback existente. Se nomes ou SQL forem refatorados, ajuste apenas
o adaptador/fixture; preserve as expectativas NULL, FALSE e exceção principal.
SQL não suportado pela fixture é falha de infraestrutura, não prova do defeito.

Não substitua expectativas por resultados atuais, não marque os RED como skip
e não aceite somente o contador de testes aprovados como prova. Após as correções,
todos os testes comportamentais devem ficar GREEN pelo resultado correto.
