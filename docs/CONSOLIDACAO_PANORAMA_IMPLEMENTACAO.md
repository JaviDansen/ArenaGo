# Consolidação do Panorama ArenaGo — relatório documental

Data: 14/11/2026 (America/Sao_Paulo). Branch: `develop`. HEAD: `a2bd60a9d2efd462da1cbeaac26d4956dae99375`.

Consolidação do Planejamento antigo no Panorama atual, sem novo planejamento, implementação ou alteração de decisões aprovadas.

## Base e escopo

Na retomada, o único item local era `?? docs/PANORAMA_ARENAGO_IMPLEMENTACAO.md`; índice e arquivos rastreados estavam limpos. O primeiro atendimento havia ficado bloqueado pela ausência desse original. A versão fornecida foi lida integralmente e preservada em memória antes da edição.

SHA-256 dos bytes originais: `072664bb96b37e7565c081793d9026ff66058fd4b7a3d94948bb9199b886ba3f` (34.712 bytes). A evidência é incremental sobre esse arquivo fornecido, não uma inclusão do zero sobre HEAD. Sua aplicação requer a versão original no caminho indicado e o relatório ainda ausente. Os trechos substituídos também permanecem no patch para revisão.

Arquivos desta entrega:

- `docs/PANORAMA_ARENAGO_IMPLEMENTACAO.md`: consolidação.
- Este relatório, conforme obrigação de `AGENTS.md`, §5.
- `qa-evidence/CONSOLIDACAO_PANORAMA-changes.diff`: evidência única, excluindo a si própria.

Nenhum documento histórico, instrução, código, teste, configuração, dependência ou migration foi alterado. Sem staging, commit, push, reset, merge ou rebase.

## Comparação sistemática com o Planejamento

| Fonte antiga | Cobertura anterior / esclarecimento | Destino no Panorama |
| --- | --- | --- |
| §§1–3 — objetivo e princípios | Inventário presente; invariantes de produto pouco explícitas. Retrato de outubro não é estado atual. | §§1/3.5/3.9: objetivo por papel, backend como autoridade, intenção, persistência e isolamento. |
| §4 — roadmap histórico | Não transpor fases ou transformar módulos entregues em pendências. | Estados atuais nas §§3–6; nenhum novo roadmap. |
| §§5/9.1 — DA-01/02 e RA-01 | Stack presente; fronteiras/exportação/Drive incompletos. | §§3.8–3.9: monólito/Express, Drizzle/pg, TLS, cotas/custos e download manual. |
| §6 — entidades/invariantes | Distinguir 23 tabelas históricas de 26 atuais. | §§3.5/3.9: participação, fila, atendimento, snapshot e migrations 0001–0008. |
| §7 — estados/operações | Saída externa, retirada interna e finalização pouco diferenciadas. | §§3.5–3.6: estados, FIFO, resultado único, reentrada, ausência/cortes e C-15. |
| §8 — capacidades/contratos | Endpoints não comprovam integração. | §§3.4/3.9: proposta versus HTTP vigente; Admin/edição de avaliação delimitados. |
| §9 — D01–D11 | Referências fragmentadas e condições ausentes. | §3.5: onze decisões com condições, exceções e estado. |
| §§9.2/9.3.2 — DA-03 | Sessão/TOTP presentes; recuperação, segundo Admin e concessões incompletos. | §3.7: requisitos, implementação e lacunas de recuperação/onboarding. |
| §9.3 — BI/histórico/privacidade | “Definir métricas” omitia indicadores aprovados. | §3.8: A/B, indeterminação, Perfil distinto, períodos/público/snapshots/retenção/exportação. |
| §9.3.1 — C-01–C-15 | Menções parciais; notas antigas como “sem rota” superadas. | §3.6: quinze complementos com cortes, exceções, prontidão, estrutura e capacidade. |
| §10 — pendências | E-mail, catálogo, fuso civil, ingresso e escritores Staff tiveram entregas posteriores. | §§5–6/8: lacunas vigentes sem perpetuar pendências históricas. |
| §11 — documentação | Planejamento guarda decisões; pedido atual muda documento principal do diagnóstico. | §§1/5/10: hierarquia explicitada, histórico intacto. |
| §12 — campanhas | Contagens não se somam nem certificam HEAD atual. | §4 preservada com proveniência; histórico E07 continua nas fontes, sem cópia extensa. |

Foram lidos integralmente os dois documentos principais e consultados os READMEs raiz/app/backend/QA e as seções pertinentes da Arquitetura, especialmente §§1, 3–8 e 27. Relatórios usados para esclarecer divergências: AUTO-QUEUE, E08.6/8/10/11, finalização/avaliação Expo, T6.1-D, chamadas externas Staff, preparação de idempotência e QA_RECOVERY. As demais referências do inventário original permanecem fontes históricas, sem alegação de releitura integral de todos os relatórios.

Inspeção pontual do código: módulos, controller de avaliações, serviço de encerramento Admin, normalizador e seu uso, serviços/telas reais de avaliação, provedor/navegador Admin, polling, configuração pública do app, schemas, journal e trechos das migrations 0007/0008. Nenhum código foi importado/executado para essa inspeção.

## Conclusões e divergências

- Admin tem senha/TOTP reais; as 14 telas Heliom seguem demonstrativas. Contratos administrativos não significam integração da UI.
- D08 tem dois relógios independentes. POST/PATCH backend existem; fluxo real inspecionado oferece envio/consulta, sem PATCH de edição encontrado. Corrigida a generalização anterior.
- D09 prevê antecipar encerramento; E08.8 e o serviço recusam segunda intenção após início. Regra e divergência preservadas, sem inventar transição.
- Dois Admins aptos antes de evento real continuam exigidos; proteção do último/bootstrap do primeiro não bastam.
- BI A/B, estatísticas do Perfil e presença física não são equivalentes; não foram definidos novos cálculos ou denominadores.
- Exclusão/anonimização e histórico protegido pela 0008 exigem compatibilização futura.
- 125/822 testes e tentativa 122/125 são relatos do Panorama recebido, sem logs/conversa originais nesta revisão. O relatório AUTO-QUEUE versionado registra 87/464 de outra campanha. Neon também é relato herdado, sem fonte externa disponibilizada.
- Merge AUTO-QUEUE consta do histórico local; lacunas antigas de HTTP, catálogo/fuso e C-15 foram atualizadas.

## Preservação e limites da reorganização

Preservados inventários das quatro áreas, campanhas/contagens, comandos históricos, homologações/ressalvas, contexto Neon (inclusive término do evento antes da apresentação), fontes, riscos, distribuição e critérios de comprovação. Não houve perda de informação relevante de produto ou evidência; afirmações imprecisas foram qualificadas.

As prioridades P01–P11, sequência sugerida e calendário intermediário eram propostas incompatíveis com o pedido atual. Seus temas/critérios foram absorvidos nas §§6–9; os trechos anteriores estão no patch. Marcos de 02/12 e 04/12 permanecem contexto confirmado. Admin/BI não foram automaticamente relegados ao pós-apresentação.

## Requisitos pendentes e decisões futuras

Permanecem incompletos: persistência Admin, BI/exportações, recuperação de senha/onboarding/reset TOTP, edição de avaliação no app, procedimento LGPD, recuperação de operações incertas e push posterior. Homologação física, build instalável e infraestrutura do candidato não foram declarados concluídos.

Decisões separadas na §8: Admin como jogador; segunda intenção D09; fluxos/controles administrativos; privacidade/moderação/retenção; detalhes de BI e formatos/permissões; origem/expurgo/reconciliação; roteiro/plataformas/aceite; ambiente/orçamento/distribuição; contexto de uso posterior. Regras aprovadas não são reabertas.

## Validações desta revisão

- **Não executadas:** testes unitários/HTTP/integração/regressão, lint, typecheck, build, SQL, migrations, seeds, Expo/backend ou acesso remoto. Arquivos `.env` reais não foram lidos.
- **Executadas pelo Codex com autorização nesta tarefa:** apenas inspeções estáticas documentais/arquivos/Git; nenhum resultado de teste novo.
- **Executadas manualmente pelo responsável nesta tarefa:** nenhuma nova execução informada. Campanhas históricas continuam atribuídas às fontes.
- **Inspeções estáticas:** branch/HEAD/status, histórico, comparação, contratos/schema e diff. Whitespace, links e aplicabilidade de patch são verificações estáticas, sem execução do produto.
- **Resultados estáticos:** `git diff --check` sem erros; `git apply --reverse --check qa-evidence/CONSOLIDACAO_PANORAMA-changes.diff` sem erros na versão documental conferida. Links locais sem destinos ausentes e nenhum whitespace final nos dois Markdown; matriz contém 11 decisões D e 15 complementos C. HEAD/branch inalterados, índice sem alterações e somente os três arquivos autorizados no status.
- **Limite:** Panorama não rastreado não é coberto por `git diff --check` isolado; a conferência reversa verifica a evidência incremental contra os documentos presentes. Não substitui testes de produto nem é aplicação do patch no repositório.

Não é necessária campanha funcional para esta alteração documental. Qualquer campanha futura seguirá executor confirmado e autorizações do repositório; nenhum acesso a banco foi autorizado aqui. Aguarda revisão do responsável. Novo planejamento permanece para outra tarefa.
