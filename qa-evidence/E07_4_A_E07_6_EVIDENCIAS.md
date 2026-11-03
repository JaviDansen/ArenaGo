# Evidencias E07.4 a E07.6

Base real: `893e6c9db54d96e04018f9abd6d6413d9b226d20` (`feature/events-participations`).
Nao existem commits intermediarios dessas tres etapas. A separacao usa os registros
explicitos de criacao/edicao desta conversa, inclusive os estados intermediarios
lidos de EventsModule e da arquitetura. Nao foi inferida apenas por nomes de arquivos.

Aplicar os patches nesta ordem:

1. `e07-4-changes.diff`: base 893e6c9 -> E07.4 (chamada).
2. `e07-5-changes.diff`: resultado da E07.4 -> E07.5 (conclusao).
3. `e07-6-changes.diff`: resultado da E07.5 -> E07.6, incluindo a correcao pontual
   de timestamps e da fixture de FK. Representa a versao atual, nao a inicial defeituosa.

Cada patch inclui os cinco arquivos proprios da etapa (servico, tipos, unitarios,
integracao e documento) e as adicoes registradas no modulo/arquitetura comuns.
Os 17 arquivos resultantes foram comparados ao working tree, normalizando somente
CRLF para LF conforme o Git. Os tres git apply --check e as aplicacoes sequenciais
passaram em repositorio temporario isolado. Indice, HEAD e codigo originais intactos.

| Patch | Arquivos | SHA-256 |
| --- | --- | --- |
| `e07-4-changes.diff` | 7 | `66c58fbdaed405e6d11de40fe0de21b77b649a4dcc510aeac9e1c5c6965febc7` |
| `e07-5-changes.diff` | 7 | `5821352a6ac96f3a339d998afc090af3d7dcdef37d8504e68b02cd2f444e1264` |
| `e07-6-changes.diff` | 7 | `089dd90306b6bde434e2a4c4bdf1a30439b0a18da924a4e2751a88539364227f` |

Evidencias anteriores preservadas. Sem .env, credenciais reais, dependencias
instaladas ou temporarios. Os .diff nao incluem a si mesmos nem outras evidencias.
AGENTS.md registra o procedimento automatico futuro; sua alteracao e esta nota
pertencem a rodada de evidencias, no patch separado procedimento-diffs-changes.diff.

A aprovacao PostgreSQL da E07.6 segue pendente. Esta rodada nao executa testes
de produto nem altera resultados anteriores. Sem commit ou push.
