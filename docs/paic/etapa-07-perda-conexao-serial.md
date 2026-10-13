# PAIC — Etapa 07: perda de conexão Serial independente da página

Data: 13/10/2026 (America/Manaus). Branch `feature/shared-core-cli`, HEAD `36b53ae019a1bf3e2809725df624c05a4ce97218`. Trabalho local, sem commit, push ou merge.

## Problema e referência

Lido [etapa-04-conexao-serial.md](etapa-04-conexao-serial.md), especialmente propriedade dos handles, encerramento e o problema de `connection-lost` associado à Sidebar. Examinados `serial_session.rs`, `serial_cmd.rs`, `SerialState`, `Sidebar.tsx`, `App.tsx`, store e monitor global de dados. Não foi encontrado AGENTS.md no repositório nem nos ancestrais até C:\. Conferidos branch, status e diff.

Antes, uma falha fatal encerrava o leitor e emitia `connection-lost`, mas o handle principal permanecia na sessão. A Sidebar recebia esse evento e chamava `close_port`; fora do Monitor Serial esse componente desmontava, deixando estado conectado e recursos pendentes. O frontend também marcava conectado após resolver `open_port`, podendo sobrescrever uma falha emitida imediatamente após abrir.

Havia 26 arquivos preexistentes modificados/não rastreados, incluindo ajustes npm/Tauri, Dashboard, configurações de atualização, etapa 6, PDF e scripts. Registrados SHA-256 antes da edição em `%TEMP%\serialhub-etapa07-baseline.json`. Somente `src-tauri/src/lib.rs` e `src/stores/settingsStore.ts` precisaram receber novas alterações dentre esses arquivos; os outros 24 conservaram exatamente os hashes. As alterações anteriores desses dois arquivos foram mantidas. Nenhum manifest, lockfile, núcleo ou CLI mudou nesta etapa.

## Solução no backend

```text
Leitor: read_loop → falha fatal/panic → canal de falhas por sessão → termina
                                                          ↓
Supervisor serial-cleanup → mutex da sessão → verifica token atual
                         → cancelamento → join dos leitores → Drop do principal
                         → connection-lost + serial-connection-state

Comandos abrir/fechar → mesmo mutex → snapshot ordenado
App React → listener global + consulta inicial → store → qualquer página
```

`SerialState` compartilha `Arc<Mutex<SerialSession>>` com um supervisor criado no setup Tauri. O supervisor não é um worker da sessão. O leitor nunca toma esse mutex para reportar falha: envia ao canal, libera seu clone e termina. Assim, fechar pode manter o mutex e aguardar o leitor, enquanto o supervisor só toma o mutex depois de receber a falha. Não há caminho de leitura tentando aguardar a própria thread.

Cada abertura recebe um novo `Arc<AtomicBool>`. A falha carrega esse mesmo token; `fail_if_current` exige identidade com `Arc::ptr_eq` e uma conexão principal ainda existente. Uma falha enfileirada antes de close/reopen não encerra a sessão nova. Mensagens duplicadas após a limpeza são ignoradas. O supervisor cancela, aguarda todos os workers e descarta o principal antes de publicar desconexão.

`spawn_reader` executa o loop usado em produção, preservando bytes, callbacks de RX e logging do backend. Timeouts, WouldBlock e Interrupted são transitórios; demais erros de leitura são fatais. Erro de emissão de dados e panic do callback/leitor também passam pela limpeza. Falhas não transitórias de `write_serial` usam o mesmo canal; o retorno `Erro escrita: ...` continua disponível ao chamador. Erros de configuração/controle de pinos continuam com os retornos existentes e não são interpretados indiscriminadamente como perda de conexão.

`close_port` permanece idempotente e retorna `Desconectado.` sem recursos ativos. Continua aguardando os workers antes de liberar o principal, inclusive se um worker termina com panic. Abrir/fechar e notificações de limpeza são ordenados pelo mutex; os callbacks de notificação não devem adquirir esse mesmo mutex. No encerramento normal da aplicação (`RunEvent::Exit`), a sessão é fechada e o supervisor recebe Shutdown e é aguardado separadamente.

### Contratos

- Preservados os argumentos frontend/retornos de `open_port`, `close_port`, escrita e controles, configuração Serial, DTR/RTS, timeout, bytes de RX/TX e logging. `close_port` recebe agora AppHandle injetado pelo Tauri, sem parâmetro novo enviado pela GUI.
- Preservado `connection-lost` como string de erro. Passa a ser emitido depois da limpeza, não como pedido para a Sidebar fechar a porta.
- Acrescentados evento `serial-connection-state` e comando `serial_connection_state`, com `{revision, session_id, connected, port_name, error}`. `revision` cresce nas mudanças da sessão; `session_id` cresce em cada abertura. Snapshot desconectado só indica recursos liberados após stop; repetir stop sem recursos não cria outra sessão.
- Um erro de abertura continua sendo retornado ao chamador; o estado anterior já foi fechado/notificado. Falha de spawn desfaz a sessão e notifica desconexão.
- O arquivo de gravação pertence ao estado de logging e mantém seu ciclo explícito start/stop, como antes. A perda encerra a conexão e os workers, não desativa silenciosamente uma gravação que o usuário deixou habilitada.

## Solução no frontend

`useSerialConnection` está montado no App, fora dos componentes de página. Inscreve no evento de estado e só então consulta o snapshot. O store aplica revision mais recente, atomicamente atualizando connected, activePort, início da conexão e erro. Uma resposta de snapshot antiga ou evento atrasado não sobrescreve uma conexão mais nova. As informações de sessão/erro não são persistidas em localStorage; preferências anteriores, incluindo temas e taxa do Dashboard, continuam preservadas.

O helper `startSerialConnectionMonitor` ignora callbacks e snapshots depois do cleanup e cancela inscrições que só terminam após desmontar. Cleanup repetido não desinscreve duas vezes. Isso cobre o padrão de montagem/cleanup/remontagem do StrictMode.

Removido o listener de perda da Sidebar e suas atribuições otimistas de conexão após open/close/reconfiguração. A Sidebar continua fazendo os comandos e mostrando erros retornados, mas a fonte de estado é o backend. Resolver uma chamada open antiga não volta a marcar conectado depois de uma falha. Hotplug/listagem continuam com seu listener existente.

## Arquivos da etapa

- `src-tauri/src/serial_session.rs`: snapshot, token de sessão, loop/leitor reutilizáveis no backend e supervisor de limpeza.
- `src-tauri/src/serial_session/failure_tests.rs`: transporte simulado, contagem de Drop, cenários de falha/reabertura/isolamento.
- `src-tauri/src/commands/serial_cmd.rs`: delegação do leitor, notificações de estado, consulta e encaminhamento de falhas de TX; bridge não registrado recebeu somente a adaptação da assinatura start.
- `src-tauri/src/lib.rs`: compartilhamento da sessão, criação/encerramento do supervisor e registro da consulta; mantidos os ajustes locais anteriores de hardware/display.
- `src/lib/serialConnection.ts` e `src/hooks/useSerialConnection.ts`: ciclo de inscrição global e reconciliação inicial.
- `src/stores/settingsStore.ts`: aplicação ordenada/atômica do estado sem persistir dados de sessão.
- `src/App.tsx` e `src/components/layout/Sidebar.tsx`: acompanhamento na raiz e remoção da dependência da Sidebar.
- `tests/serial-connection.test.mjs`: store real com eventos/consulta simulados e conferência estática da montagem do hook.
- Este documento.

## Verificações executadas

Comandos na raiz, usando a árvore local com alterações preexistentes:

```powershell
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path crates/serialhub-core/Cargo.toml
cargo test --locked --manifest-path crates/serialhub-cli/Cargo.toml
node --test tests/serial-connection.test.mjs tests/dashboard-refresh.test.mjs tests/theme.test.mjs tests/mqtt-credentials.test.mjs
npm run build
cargo check --locked --manifest-path src-tauri/Cargo.toml
rustfmt --check --edition 2021 src-tauri/src/serial_session.rs src-tauri/src/commands/serial_cmd.rs
git diff --check
```

| Verificação | Resultado final |
| --- | --- |
| Backend | 11 testes aprovados, incluindo 4 novos; 0 falhas; 0 doctests |
| Núcleo | 13 testes aprovados; 0 falhas; 0 doctests |
| CLI | 21 unitários + 4 de integração aprovados; 0 falhas |
| Frontend | 28 testes aprovados, incluindo 7 novos de conexão; 0 falhas |
| Total Rust/Node | **77 aprovados** |
| Build frontend | exit 0; avisos preexistentes de Browserslist antigo e chunk >500 kB |
| Cargo check backend | exit 0, com --locked |
| Rustfmt / whitespace | Aprovados; arquivos novos conferidos também com diff --no-index --check |
| Preservação | 24 dos 26 arquivos locais preexistentes byte a byte iguais; 2 ampliados intencionalmente |

Uma primeira compilação dos novos testes detectou um helper de transporte sombreado por uma variável local. O helper foi renomeado e a compilação/testes finais passaram. Não foi identificada dependência nova ou falha de compilação preexistente nesta execução. Os builds usam os ajustes npm/Tauri locais: **não revalidam o checkout publicado d72fcbf**, cuja falha de BOM documentada anteriormente permanece fora desta etapa.

### Evidência simulada

Os testes backend executam o leitor/supervisor reais sobre `SerialConnection::from_transport` com um `SerialPort` simulado. Verificam sequência `00 FF 80 0D 0A`, progresso através de timeouts, falha BrokenPipe, liberação dos dois handles antes de receber a notificação e IDs de thread diferentes para leitor/supervisor. Verificam dois fechamentos, nova abertura com novo ID/revision, panic do receptor e erro antigo enfileirado antes do fechamento e processado após a nova sessão, sem descartá-la. Uma barreira no canal torna o teste de mensagem atrasada determinístico; ela existe somente em builds de teste.

Os testes frontend usam o store Zustand real e callbacks/Promises controlados. Cobrem atualização em SERIAL/DASHBOARD/SETTINGS/MQTT/BLUETOOTH/SPY, desconexão global, resposta inicial antiga, evento atrasado, cleanup antes da inscrição terminar, snapshot após cleanup, remontagem, erros de consulta/listener, revisão duplicada e contadores. A presença do hook no App e a remoção das atribuições na Sidebar são conferidas estaticamente; esses testes não montam uma árvore React por um framework de testes.

### Verificação na aplicação Tauri

Executado `npm run tauri dev` com `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` para instrumentação do WebView local. A aplicação compilou/iniciou. Via IPC, `serial_connection_state` retornou revision/session_id 0, connected false, port_name/error null; duas chamadas `close_port` retornaram `Desconectado.`.

Com a aplicação real nas páginas Dashboard, Configurações e MQTT, foram emitidos eventos **simulados** de conexão/desconexão, com porta fictícia `SIMULATED-NOT-OPENED`. Em todas, a Sidebar estava ausente do DOM, connected passou de true para false e activePort ficou null. Isso valida os componentes montando/desmontando na navegação e o listener global, **não uma perda nativa de porta**. Estado e armazenamento de preferências anteriores foram restaurados ao fim. Nenhum open_port foi executado, nenhuma porta física/virtual foi aberta e nenhuma mensagem Serial/MQTT foi transmitida.

## Pendências e limitações

1. **Portas virtuais:** permanece pendente provocar perda nativa em um par confirmado durante RX com Dashboard/Configurações/MQTT abertos, conferir desconexão e reabrir a mesma ponta. O último inventário da [etapa 6](etapa-06-integracao-serial.md) não confirmou um par e excluiu COM3 Intel AMT SOL. Nada foi instalado automaticamente.
2. Conferir close/reopen e erros de escrita nativos, inclusive durante tráfego e logging, e saída normal da aplicação com uma porta virtual ativa. A nova rota de TX foi inspecionada/compilada, mas não exercitada por IPC com transporte nativo. Os testes de supervisor Shutdown não substituem fechamento da GUI com driver ativo.
3. Logging/disco bloqueado e driver que ignore timeout ainda podem atrasar join/limpeza. Não há cancelamento forçado de I/O, prazo rígido nem ganho de desempenho medido. Questões de TX parcial e bridge desabilitado da etapa 4 não foram resolvidas.
4. Eventos Tauri são necessários para atualização imediata da GUI. Snapshot inicial reconcilia eventos anteriores à inscrição/remontagem; se a inscrição falhar, o erro é reportado, e esta etapa não adiciona polling/retry permanente. A limpeza nativa continua independente desses listeners.
5. Não foram testados equipamentos físicos, outros sistemas, instalador/release, broker MQTT nem bridge. Nenhuma funcionalidade de CLI foi acrescentada.

Esta etapa resolve a dependência da Sidebar para encerramento da sessão normal GUI no backend e acompanhamento do estado global; a confirmação nativa com par virtual continua necessária.
