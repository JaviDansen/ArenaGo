# Staff A2 — reconhecimento terminal automático

## Escopo e protocolo

Antes da A2, as telas reais exigiam **Entendi** para reconhecer uma intenção terminal e liberar a próxima operação. Esse toque fazia uma transição persistida no Controle de Entrada; nas Estações, limpava a intenção e reconhecia o recibo pelo `receiptId` com marcador `.ack`.

O reconhecimento de resultados confirmados e recusas definitivas agora começa automaticamente quando a tela encontra uma intenção terminal pertencente à conta, sessão, evento e, na Estação, estação atuais. O feedback permanece visível depois de concluído o reconhecimento. Não há alteração de endpoint, backend, migration, envio HTTP ou política de retry.

## Controle de Entrada

O store conserva `reserved → dispatching → terminal → acknowledged`. `acknowledge` agora confirma por nova leitura que a mesma chave chegou a `acknowledged`, inclusive se o SecureStore gravar a fase e depois rejeitar a promessa. Enquanto não houver comprovação, a intenção terminal ou o erro de armazenamento bloqueia novas mutações. A tela inicia uma tentativa por chave terminal, mostra o resultado após a confirmação segura e permite nova tentativa por atualização manual ou remontagem. Resultado `dispatching` e resultado incerto nunca são reconhecidos automaticamente.

## Estações

A tela captura o `receiptId` terminal, chama `cleanupTerminal` e `acknowledgeTerminal` com o escopo original e rele o coordenador antes de liberar ações. A operação só é tratada como encerrada quando a leitura confiável retorna `none`; o marcador `.ack` pendente mantém o recibo recuperável após exclusão ambígua. Um callback antigo não reconhece outro `receiptId`. A tentativa é única por recibo em cada montagem; a atualização manual ou nova montagem permite recuperar uma falha transitória. A tela preserva o resultado visual de sucesso ou recusa enquanto a intenção persistida deixa de bloquear.

Em ambos os fluxos, logout e troca de contexto invalidam publicações antigas. Dois toques continuam protegidos pelos bloqueios e pela serialização dos adaptadores. Falhas de armazenamento, `dispatching` e resultados incertos permanecem bloqueados, sem reenvio automático de POST ou PATCH.

## Validação automatizada

Luna Medium executou os testes focados: **119 aprovados, 0 falhos, 0 ignorados, exit code 0**. A regressão completa do aplicativo teve **524 aprovados, 0 falhos, 0 ignorados, exit code 0**. Foram executados com `NODE_ENV=test`, sem URLs de banco herdadas.

Os cenários automatizados relevantes incluem reconhecimento automático, confirmação de persistência antes da liberação, recusa definitiva, remontagem, falhas de gravação e exclusão ambíguas, proteção do recibo posterior, logout, troca de contexto e ausência de reenvio para resultado incerto. `git diff --check` e a conferência reversa da evidência passaram, ambos com código 0.

## Homologação funcional no Expo Go

O responsável informou uma campanha manual no banco local isolado `arenago_staff_homolog_geral_20261111`, no evento ArenaGo — Homologação Geral, na Experiência de Homologação Geral e Estação 01, usando conta Staff sintética e participantes fictícios P1, P2 e P5. As contas já existiam; nenhuma fixture de contas, migration ou seed foi repetida.

Na Estação 01, P1 entrou pela API oficial, foi chamado sem confirmação prévia e teve feedback sem **Entendi**. O atendimento foi concluído com confirmação prévia; P2 pôde ser chamado em seguida. A ausência de P2 também manteve a confirmação prévia e terminou sem reconhecimento manual.

No Controle de Entrada, P5 teve participação anterior encerrada pela API oficial com autorização do responsável, entrou novamente no evento e apareceu na fila externa. Foi chamado sem confirmação prévia; as resoluções ficaram disponíveis sem **Entendi**. A entrada foi confirmada com diálogo prévio, e o controle voltou a permitir novas operações.

Esta foi homologação funcional manual no Expo Go. Não foram provocadas falhas físicas do SecureStore nem resultados incertos, e os cenários observados não demonstram exaustivamente concorrência real, recuperação de falhas ou todo o protocolo. A validação do protocolo de intenções depende também da suíte automatizada; não se afirma homologação técnica exaustiva do backend ou do PostgreSQL.

O reconhecimento automático só libera a operação seguinte após comprovação do encerramento persistido correto. Resultados incertos, `dispatching` e falhas de armazenamento permanecem bloqueados. Não foram informados horários, capturas ou logs da campanha, e este relatório não os presume. O estado final conhecido limita-se aos resultados descritos; nenhum estado posterior dos participantes foi fornecido.

O protocolo continua limitado à serialização no mesmo runtime; não oferece recuperação histórica nem coordenação entre dispositivos.
