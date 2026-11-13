# Seleção de eventos autorizados para Staff

## Implementação

- A rota interna `StaffPending` mantém o isolamento por papel já existente e agora abre uma pilha Staff própria. Admin e participante conservam suas entradas anteriores.
- A tela consulta `GET /staff/events` pelo cliente autenticado do `AuthContext`. A resposta é validada conforme o contrato: lista de eventos com UUID, nome e status `scheduled`, `open`, `closing` ou `closed`. IDs duplicados ou resposta inválida geram erro sem mostrar dados antigos.
- São apresentados carregamento, lista vazia, falha de rede, sessão inválida e atualização manual. O cliente HTTP e o gerenciador de sessão existentes continuam responsáveis por renovação e invalidação de credenciais.
- A seleção guarda o objeto e seu `id` somente em memória. A tela inicial do evento obtém esse objeto do estado da área Staff, não de parâmetros de navegação; uma tentativa de acessar a tela sem seleção válida exibe a orientação para voltar à lista.
- O estado e as requisições são vinculados ao usuário, à geração da sessão e à revisão da identidade. Logout, troca de conta, mudança de papel ou revalidação descartam seleção e respostas antigas. Retornar da tela do evento também limpa a seleção.
- A seleção é apenas contexto de navegação. Cada operação futura deve enviar o `eventId` e ter sua autorização por evento verificada novamente pelo backend. A lista pode ficar desatualizada após revogação até atualização manual ou revalidação; não há polling nesta etapa.
- A tela do evento informa que a área operacional virá depois. Nenhuma fila, chamada, conclusão, ausência ou fixture demonstrativa é apresentada como dado real. Os componentes da demonstração foram preservados.

## Validação preparada

- `app/tests/staffEventDiscovery.test.cjs`: contrato da lista, resposta inválida, consulta autenticada, seleção, lista vazia, atualização, 401, rede, troca de identidade e respostas fora de ordem.
- `app/tests/roleRoutingIntegration.test.cjs`: cenários adicionais com gerenciador de sessão, cliente HTTP, provedores e roteadores reais; seleção e retorno, rota manual com ID, lista vazia, rede, troca de conta, revalidação/revogação, 401 terminal e 401 recuperável.
- Os testes de integração usam as dependências isoladas de `qa/regression`; um teste ignorado por dependência indisponível deve ser reportado como pendente.
- Sugestão para Luna Medium, após inspecionar os scripts e o ambiente: na pasta `app`, com `NODE_ENV=test`, executar `node --test tests/staffEventDiscovery.test.cjs tests/roleRoutingIntegration.test.cjs tests/authNavigation.test.cjs tests/staffNavigation.test.cjs tests/staffRealNavigation.test.cjs`, seguido da suíte `npm.cmd --prefix app test` na raiz se os focados estiverem sem falhas. Revisar também `git diff --check` e o estado Git.

## Evidências e limites

- Inspeção estática realizada sobre roteamento, gerenciamento de identidade, cliente HTTP, contrato do endpoint e diferenças locais.
- Testes, lint, typecheck, build e verificações automatizadas não foram executados nesta implementação; estão reservados à validação por Luna Medium.
- O responsável informou a homologação HTTP anterior do endpoint com contas Staff, participante e Admin; ela não foi repetida nesta etapa.
- A apresentação no Expo Go, a navegação nativa de retorno e o comportamento em rede real ainda precisam de validação. O endpoint não é paginado e a lista é um retrato do momento da consulta.
