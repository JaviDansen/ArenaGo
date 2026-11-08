# Expo ↔ Backend — Etapa 1: configuração HTTP

## Escopo

Na branch `feature/events-participations`, base `c3494e0868ea7e3ce0d56fe0cc7ff257b9ba8028`, a leitura de `EXPO_PUBLIC_API_BASE_URL` e do alias `EXPO_PUBLIC_API_URL` passou a usar referências estáticas `process.env.*`, conforme o mecanismo de substituição do Expo. A injeção de ambiente usada nos testes, o override explícito, o fallback local e a adição única de `/api/v1` foram preservados.

URLs malformadas, com credenciais, consulta ou fragmento agora produzem erro de configuração explícito. A restrição existente de HTTPS para origem não local em produção permanece. O cliente HTTP, o armazenamento de tokens, o refresh de sessão, a autenticação e as telas não foram modificados.

## Validação local

- `node.exe --test tests/apiConfig.test.cjs`: 7/7 aprovados, exit code 0.
- `npm.cmd test` em `app/`: 208/208 aprovados, exit code 0.
- `git diff --check`: sem erros.

Não foram executados testes PostgreSQL, migrations, SQL ou conexão real com celular. A configuração manual de host, URL e comandos para Expo Go está em `app/README.md`.

## Pendências

Validar manualmente cadastro, login, restauração de sessão e logout no Expo Go com backend local alcançável. A integração da branch visual e os endpoints de ingresso permanecem fora desta etapa.
