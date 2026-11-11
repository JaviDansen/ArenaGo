# ArenaGo — Evidência de validação local das correções Staff

Data: 2026-11-10  
Branch: `feature/role-routing-staff-integration`

## Resultados registrados

### Aplicativo — campanha anterior

- 103 aprovados, 0 falhos, 0 ignorados.
- Passaram os cenários de recibo terminal, recuperação após reinício, proteção contra callback antigo e bloqueio da fase `dispatching`.
- Não houve alteração posterior no aplicativo.

### Backend — campanha final

- `external-queue.test.ts` isolado: 6 aprovados, 0 falhos, 0 ignorados.
- Cinco arquivos focados: 61 aprovados, 0 falhos, 0 ignorados. O resultado isolado de 6 testes está incluído nessa contagem.
- Typecheck de produção: aprovado.
- Typecheck de testes: aprovado.
- `git diff --check`: aprovado.

O teste E05 simula as avaliações temporais antes e no corte para ativação e desativação. Verifica o UPDATE decisivo e sua condição temporal, o resultado `blocked` e que nenhuma participação seja atualizada.

## Comandos e ambiente

O comando `tsx` falhou antes de iniciar os testes com `uv_os_get_passwd / ENOMEM`. Foi usado o procedimento aprovado: compilar os testes com `tsc --project tsconfig.test.json --noEmit false --incremental false --declaration false --outDir <diretório-temporário> --rootDir .` e executar os arquivos JavaScript compilados com `node --test`.

Primeiro foi executado o teste isolado:

```text
node --test <diretório-temporário>/test/unit/external-queue.test.js
```

Depois foram executados os cinco arquivos focados:

```text
node --test <diretório-temporário>/test/unit/external-queue.test.js <diretório-temporário>/test/unit/admin-external-queue.test.js <diretório-temporário>/test/unit/staff-entry.test.js <diretório-temporário>/test/unit/admin-external-queue-http.test.js <diretório-temporário>/test/unit/staff-entry-http.test.js
```

O procedimento definiu `NODE_ENV=test`, removeu variáveis de conexão herdadas e não carregou `.env`. A compilação ocorreu fora do repositório e preservou `backend/dist`.

Os typechecks executados foram:

```text
tsc --project tsconfig.json --noEmit --incremental false
tsc --project tsconfig.test.json
```

## Limites e pendências

- Nenhum PostgreSQL ou Neon foi acessado. Os testes backend usaram persistência simulada e não comprovam locks, relógio ou rollback em banco real.
- Os testes de armazenamento do app simularam SecureStore; não comprovam restauração da sessão autenticada real em dispositivo.
- Concorrência entre dispositivos, prova de origem, reconciliação segura de `dispatching` e ensaio físico PostgreSQL continuam pendentes.
- Esta evidência registra validação automatizada local. Não representa homologação operacional e não libera operações Staff reais.
- `qa-evidence/STAFF_TERMINAL_CUTOFF_FIX-changes.diff` permanece como patch histórico da implementação; esta evidência documenta a validação posterior e não o substitui.

