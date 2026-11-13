# Evidência de QA — ensaio local das migrations 0006 e 0007

**Data da campanha:** 10/11/2026

**Branch:** `feature/role-routing-staff-integration`
**Escopo:** validação local reportada pelo responsável; esta atualização documental não repetiu comandos.

## Ambiente e migrations

- PostgreSQL 18.6 em `127.0.0.1:55432`, banco `arenago_events_test`.
- Migrations `0006_admin_2fa_login` e `0007_staff_idempotency_preparation` aplicadas e validadas localmente.
- Journal Drizzle com sete entradas e hashes compatíveis.
- SHA-256 do arquivo SQL da migration `0007`: `ad6e28f3bc1bf235986a66fefab201da05512acf58f875307918567e2917a00c`.
- Nenhuma migration aplicada no Neon.

## Backup

Um backup local em formato customizado PostgreSQL foi produzido antes das migrations. O arquivo tinha 1.179.941 bytes e SHA-256 `1D7D4A93499DD6E706008DB459945E620347CD3A240FAB12503ABDDECE1F1D38`. O catálogo e o conteúdo do dump foram lidos com sucesso. Não houve ensaio de restauração; recuperação não comprovada.

## Testes reportados

- `backend/test/integration/staff-idempotency-schema-preparation.integration.test.ts`: 1 aprovado, 0 falhas.
- `backend/test/unit/schema.test.ts` e `backend/test/unit/staff-idempotency-schema-preparation.test.ts`: 6 aprovados, 0 falhas.
- Total desta campanha: **7 aprovados, 0 falhas**.
- A suíte anterior de 1.173 testes unitários e os typechecks pertencem a outra campanha; não foram repetidos.

## Preservação dos dados e rollback

- 3.316 usuários e 604 operações de idempotência preservaram as impressões MD5 anteriores.
- Zero linhas em `staff_idempotency_epochs`.
- Zero operações com campos preparatórios ativados.
- Rollback das fixtures conferido por consulta independente; resultado reportado: `ROLLBACK_FIXTURES_VALIDADO`.

## Limitações e estado

A expansão está aplicada somente no banco local ensaiado. O trigger é preparatório: não impede `DELETE` ou `TRUNCATE` e não substitui controles completos de privilégios. Permanecem desabilitados ou pendentes `verified_v1`, ativação de epochs, tombstones, compactação, reconhecimento/reconciliação automática e operações Staff reais. Não houve ensaio de restauração nem aplicação ou acesso ao Neon.

O snapshot `0005_snapshot.json` está ausente. `0006_snapshot.json` representa o estado após `0006` e `0007`, encadeia a partir de `0004_snapshot.json`, e a comparação recursiva descrita pelo responsável retornou `SNAPSHOT_DELTA_ESPERADO`. A validação offline anterior com Drizzle Kit permanece documentada no relatório de implementação. Não foram criados nem alterados snapshots nesta atualização.
