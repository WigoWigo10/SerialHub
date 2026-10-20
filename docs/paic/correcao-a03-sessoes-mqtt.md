# Correção A03 — cancelamento e isolamento de sessões MQTT

Data: 20/10/2026, America/Manaus. Branch `feature/shared-core-cli`, HEAD `d3c95ec` (A01 local, sem push). A02, etapa 8 e este A03 continuam sem commit. Não houve commit, push ou merge nesta tarefa.

## Referência e preservação

Lidos AGENTS.md quando existente (nenhum encontrado no repositório/ancestrais até C:\), a auditoria e os registros A01/A02. Conferidos branch, status e diff antes das alterações.

Registrados hashes de 50 arquivos modificados/não rastreados preexistentes em `%TEMP%\serialhub-a03-baseline-h49bst9i\hashes.json`, com cópias dos arquivos de integração que precisariam ser editados. Ao final, **43 arquivos conservaram exatamente os hashes**. Os sete alterados intencionalmente são `Cargo.toml`, `mqtt_cmd.rs`, `lib.rs`, `App.tsx`, `MqttPage.tsx`, `translations.ts` e o teste de credenciais. Comparação com as cópias confirma que as alterações em lib/App/traduções são somente inserções: conteúdo da etapa 8 e A02 não foi removido. Nos demais, alterações limitadas à coordenação MQTT/testes dessa integração.

Construtor TLS, fixtures/testes A02, perfis persistidos, migração, remoção de senhas, lockfile, árvore/testes A01 e arquivos Serial anteriores permaneceram idênticos. Os testes de todas essas correções continuam aprovados. PDF e scripts locais não foram editados nem adicionados ao índice.

## Problema anterior

Cancelar e o timer de cinco segundos alteravam apenas o estado local da página. A tentativa no backend continuava. A cada conexão, o cliente era substituído e uma task sem JoinHandle era iniciada; eventos não tinham identidade. Assim, CONNACK, erro ou desconexão antigos podiam atualizar a interface de uma sessão posterior. A validação TLS síncrona também ocorria antes de haver identidade cancelável. Publicar/assinar tomava o mutex e aguardava a fila do cliente, e falhas não limpavam o cliente numa transição ordenada.

## Ciclo e contratos atuais

O novo `MqttService` (`src-tauri/src/mqtt_session.rs`) é independente do Tauri. Ele possui identidade monotônica, snapshot, cliente, canal de configuração, sinal de encerramento e JoinHandle do supervisor. O backend de comandos traduz IPC e configuração; a raiz React acompanha o serviço.

```text
Reserva de tentativa → identidade + deadline → aguarda configuração
                    → validação TLS em job rastreado → DNS/TCP/TLS/WS → CONNACK aceito
                                                                    ↓
                                                                connected

cancelar / deadline / erro / desconectar → invalida → encerra/junta trabalho
                                                   → libera cliente e rede
                                                   → estado terminal da mesma identidade
```

| Estado | Significado / saída |
|---|---|
| `idle` | Serviço inicial, sem sessão |
| `connecting` | Identidade reservada; inclui espera da configuração, validação e handshake até MQTT CONNACK |
| `connected` | Exclusivamente após CONNACK aceito, ainda dentro do prazo e da tentativa válida |
| `stopping` | Tentativa invalidada; novas operações recusadas; aguardando liberação efetiva |
| `cancelled` | Cancelamento concluído, recursos liberados |
| `disconnected` | Fechamento explícito/substituição concluído |
| `timed_out` | Prazo esgotado; trabalho encerrado e resultado tardio descartado |
| `failed` | Configuração, rejeição MQTT, erro fatal ou panic do worker; cliente limpo |

### Reserva e cancelamento desde o início

1. `mqtt_begin_attempt` encerra/junta a tentativa anterior e reserva um `session_id` antes de validar arquivos ou abrir rede. Retorna um snapshot `connecting`.
2. `connect_mqtt` exige `expectedSessionId` e aceita uma única configuração para essa reserva. Retorna ao enfileirá-la; **não confirma conexão**. Validação e conexão são feitas pela task daquela identidade.
3. `cancel_mqtt` exige essa identidade, invalida a sessão e aguarda o supervisor terminar. A task de configuração/event loop também é aguardada; o retorno de cancelamento não deixa esse trabalho rodando em segundo plano.
4. Se o usuário clica Cancelar enquanto a resposta de reserva ainda está pendente, o controlador global registra essa intenção. Assim que recebe a identidade, cancela no backend sem enviar configuração. Não há conexão sem identidade nem cancelamento genérico capaz de atingir outra sessão.

O controlador permite uma reserva pendente, impede duplicação de cliques e protege seus resultados por identidade. Cancelamento durante o IPC de configuração é enviado imediatamente, sem esperar essa promessa resolver. Uma rejeição tardia desse IPC não altera uma tentativa posterior. A página não decide que uma conexão terminou apenas fechando o overlay.

### Prazo e limites de cancelamento

O prazo único é **10 segundos monotônicos**, iniciado ao reservar a nova identidade, depois de aguardar a limpeza da anterior. Cobre espera pelo envio da configuração, leitura/validação de CA/certificado/chave, construção TLS, DNS, TCP, handshake TLS, upgrade WebSocket e espera por MQTT CONNACK aceito. Não limita a duração de uma conexão já estabelecida e não reinicia a cada fase. O timer de segurança frontend foi removido.

Ao expirar, a tentativa é invalidada. O CONNACK só pode publicar `connected` depois de nova verificação do deadline **dentro do mutex de estado**, além da identidade/status. Uma confirmação atrasada não reativa a tentativa. O frontend acompanha snapshots do backend, inclusive `stopping` enquanto a liberação não terminou.

**Limite real:** leitura de arquivo/trust store e criptografia usam job `spawn_blocking`. Tokio não pode interromper à força um job desses já iniciado. Cancelamento/timeout impedem instalação/uso do resultado e tentam abortar um job ainda não iniciado, mas **aguardam o job em execução** antes do estado terminal e do retorno de cancelar. Portanto 10 s é o prazo de validade da tentativa, não promessa de liberação física em exatamente 10 s se o sistema operacional bloquear I/O. Chamadas internas de resolução/I/O do SO também não oferecem preempção rígida; os futuros de conexão/event loop são descartados e não podem publicar resultados nem reativar a sessão. Não foi simulado travamento permanente de driver, resolver ou filesystem.

### Propriedade, locks e término

- Um mutex assíncrono serializa reserva/substituição/cancelamento/desconexão/shutdown. Workers não o adquirem.
- Um mutex curto protege snapshot, cliente e canais. Nenhum join ou operação de fila potencialmente bloqueante é aguardado segurando esse mutex.
- O supervisor rastreado aguarda seu worker e converte panic em falha terminal. Cancelar/fechar aguarda o supervisor; nenhuma task aguarda a si mesma.
- O job bloqueante de validação também é aguardado em cancelamento/timeout. Resultado preparado depois da invalidação é descartado antes da notificação terminal, sem iniciar rede.
- Em erro fatal, o event loop é descartado, o cliente correspondente é removido e só então é publicado o estado terminal. Um JoinHandle já concluído pode ficar retido, no máximo um, até o próximo begin/close/shutdown, que o recolhe. Não representa task ativa nem socket aberto.
- Toda transição de limpeza verifica a identidade. Uma task antiga não remove cliente nem publica mensagens de uma nova sessão.
- Fechar repetidamente é idempotente: depois da limpeza mantém o snapshot terminal, sem repetir a transição nem acessar cliente inexistente.
- Desconexão de sessão conectada tenta MQTT DISCONNECT pela fila e dá até 200 ms para flush do protocolo. Depois libera a rede mesmo se o peer/fila não permitir a tentativa. Não há promessa de entrega desse pacote; cancelamento de tentativa ainda não conectada fecha diretamente.
- `RunEvent::Exit` solicita shutdown e aguarda suas tasks. O serviço passa a rejeitar novas reservas/configurações/operações durante shutdown.

### Eventos e operações

`mqtt-state` contém `{revision, session_id, status, error}`. Erro é parte do mesmo snapshot ordenado; os antigos eventos soltos `mqtt-status`/`mqtt-error` deixaram de ser usados. Mensagens `mqtt-message` contêm `{session_id, sequence, topic, payload, qos}`. `sequence` é monotônico por sessão; revisões de estado são globais no serviço.

Publicação, assinatura, cancelamento e desconexão exigem `expectedSessionId`. Publish/subscribe/unsubscribe só são aceitos na identidade atual com estado `connected`. Usam operações `try_*` da fila sob o mutex curto, sem await: fila cheia retorna erro em vez de bloquear fechamento. Sucesso significa aceitação pela fila local, **não PUBACK/SUBACK nem entrega ao broker**. O tratamento de ACK de operações não foi implementado nesta correção.

No frontend, resultados e erros de operações são aplicados apenas se a mesma sessão continua conectada. Assinaturas visuais são globais e limpas quando a sessão sai de conectado ou muda de identidade. Uma confirmação/erro antigo não repopula as assinaturas nem altera o estado novo.

## Acompanhamento global no frontend

- `useMqttSession`, na raiz `App`, inscreve estado e mensagens, depois consulta `mqtt_connection_state`. Cancela ambos os listeners, inclusive inscrições que terminam tardiamente; snapshots/callbacks não atualizam após desmontagem.
- `mqttSessionStore` não usa persistência. Rejeita revisão antiga, identidade anterior e sequência duplicada. Mensagens só entram no histórico para a sessão atual conectada. Mensagens recebidas durante a reconciliação inicial aguardam o snapshot e depois passam pelo mesmo filtro.
- `MqttPage` consome o estado global; não tem mais listeners de conexão, boolean conectado otimista nem timer de conexão local. O botão Cancelar chama o controlador/backend. Durante `stopping`, os controles aguardam liberação.
- A apresentação dos gráficos processa todas as mensagens novas aceitas pelo monitor global, preservando consultas próprias A01 e timestamps de recebimento. Trocar de página não é cancelamento e não perde a propriedade da sessão.
- O histórico foi movido para memória global mantendo a política anterior: continua sem limite de retenção e é limpo manualmente. Isso **não corrige A04** nem acrescenta captura binária (A05). O payload continua com a conversão textual existente. Não há reconexão automática.

A02 foi preservado: transporte explícito, CA personalizada/sistema, mTLS opcional, hostname/SNI e validação de certificados. A configuração segura não faz fallback. Senhas permanecem somente em memória, fora de perfis e snapshots; testes de persistência continuam aprovados. O teste estático de credenciais foi adaptado para verificar a delegação ao controlador e o IPC com identidade, preservando as verificações contra logs de credenciais.

## Verificações executadas

| Comando | Resultado final |
|---|---|
| `node --test tests/*.test.mjs` | **99 aprovados**, zero falhas; 15 novos testes MQTT de sessão, mais A01/A02/credenciais/Serial/temas/Dashboard |
| `cargo test --locked --offline --manifest-path src-tauri/Cargo.toml` | **41 aprovados**, zero falhas; 13 novos testes de sessão, regressões TLS A02 e Serial anteriores |
| `npm run build` | **Aprovado**; avisos anteriores de Browserslist desatualizado e chunk acima de 500 kB |
| `cargo check --locked --offline --manifest-path src-tauri/Cargo.toml` | **Aprovado** |
| `rustfmt --check --edition 2021 --config skip_children=true src-tauri/src/mqtt_session.rs src-tauri/src/mqtt_session/tests.rs src-tauri/src/commands/mqtt_cmd.rs` | **Aprovado** |
| `git diff --check` | **Aprovado**, avisos informativos LF/CRLF |
| Hashes preexistentes | 43/50 idênticos; sete arquivos de integração alterados intencionalmente; TLS, perfis/migração, fixtures e lockfile A02 idênticos |

Os testes Rust usam canais/barreiras e relógio virtual Tokio para cancelamento antes de configuração, validação bloqueada, deadline antes/durante configuração/rede, CONNACK tardio, sessão nova após cancelamento, erros/mensagens/operações de identidade anterior, fechamento repetido, erro fatal/panic, CONNACK recusado, fila cheia e shutdown. Conferem drops, ausência do cliente/configuração e JoinHandle concluído/recolhido, além do snapshot. Panic intencional no transporte simulado é capturado pelo supervisor e faz parte de um teste aprovado.

Os testes Node usam store/controlador/monitor reais com adaptadores determinísticos: Cancelar antes da resposta da reserva, durante IPC de configuração, resposta antiga após timeout, nova tentativa após cancelamento, resultados/erros antigos de publish/subscribe/cancel/disconnect, snapshots/mensagens obsoletos, listeners pendentes e resoluções após unmount/remount, inscrição parcialmente falha e buffering inicial. Verificações estáticas de wiring são identificadas como tais e não equivalem a renderizar a GUI.

### Integração real local e pendências

Não foi encontrado Mosquitto/broker completo instalado. O teste `loopback_real_mqtt_connect_cancel_and_reconnect` usa servidor MQTT mínimo controlado, em TCP `127.0.0.1` com porta efêmera. O cliente é o AsyncClient/EventLoop real e usa o construtor de transporte A02:

1. Servidor recebe CONNECT, retém CONNACK; cliente cancela e a sessão é recolhida. Servidor comprova EOF do socket.
2. Nova identidade abre outra conexão; servidor aceita CONNECT com CONNACK de sucesso.
3. Servidor envia PUBLISH textual; serviço emite mensagem com a identidade nova, sequência 1 e payload esperado.
4. Desconexão envia MQTT DISCONNECT; servidor verifica o pacote, e ambos os lados são aguardados/fechados.

Esse teste passou em sockets reais de loopback. É uma fixture de protocolo, não um broker completo nem uma inspeção da GUI. Os testes TLS reais de loopback do A02 também foram repetidos pela suíte Rust e passaram.

Permanecem pendentes: interação manual do botão Cancelar e troca de páginas na aplicação Tauri; integração com broker completo para autenticação, PUBACK/SUBACK, LWT, TLS/WSS e upgrade WebSocket; erros de DNS/OS/FS permanentemente bloqueados; encerramento forçado do processo. Falha de inscrição IPC é reportada e limpa listeners; reconexão/retry da ponte de eventos não foi acrescentada. Sem replay backend, mensagens emitidas enquanto nenhum frontend estiver inscrito não são recuperadas por snapshot de estado.

Nenhum equipamento físico/porta Serial foi aberto, driver instalado ou trust store alterado.

## Arquivos desta entrega

Novos: `src-tauri/src/mqtt_session.rs`, `src-tauri/src/mqtt_session/tests.rs`, `src/lib/mqttSession.ts`, `src/lib/mqttCommands.ts`, `src/stores/mqttSessionStore.ts`, `src/hooks/useMqttSession.ts`, `tests/mqtt-session.test.mjs` e este registro.

Integração: `commands/mqtt_cmd.rs`, `lib.rs`, `App.tsx`, `MqttPage.tsx`, traduções e teste de credenciais. No Cargo.toml, somente a feature de desenvolvimento `tokio/test-util` foi acrescentada para relógio virtual nos testes; nenhuma versão ou lockfile foi atualizado. Retenção, payload binário, reconexão automática e otimizações de desempenho permanecem fora do escopo.
