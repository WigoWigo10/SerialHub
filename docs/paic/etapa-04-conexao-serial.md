# PAIC — Etapa 04: conexão e operações Serial no núcleo

Data: 13/10/2026 (America/Manaus). Trabalho local, **sem commit, push ou publicação**. Esta etapa extrai configuração, abertura, leitura/escrita síncronas, controles e propriedade dos handles. O monitor CLI, batching e otimizações de logging não foram implementados. Não há alegação de ganho de desempenho.

## Referência e alterações preservadas

- Branch `main`; HEAD `2c693e7fb06ad3064ab4beae03eece6f223ca5f7`. Etapa 1 em `45e51ec`; etapas 2/3 continuam sem commit.
- Lidos os registros das etapas 1, 2 e 3; conferidos status e diff antes de editar. Não foi encontrado `AGENTS.md` no repositório ou em ancestrais até `C:\` (dependências, `.git` e target excluídos).
- Estado inicial: modificados `.gitignore`, `package.json`, `package-lock.json`, manifest/lockfile/configuração Tauri e `serial_cmd.rs`/`lib.rs`; não rastreados os dois crates, registros das etapas 2/3, PDF e três scripts Python.
- Registrados SHA-256 de 29 arquivos preexistentes em crates, documentos, backend e arquivos locais. Apenas três precisaram de edição: `crates/serialhub-core/src/lib.rs`, `src-tauri/src/commands/serial_cmd.rs` e `src-tauri/src/lib.rs`. Os outros 26 permaneceram byte a byte idênticos. Enumeração compartilhada, CLI de portas, exclusões de target e dependências anteriores foram preservadas. Nenhum manifest/lockfile foi alterado nesta etapa.
- Ambiente Windows/PowerShell, Rust/Cargo `1.93.0`, target `x86_64-pc-windows-msvc`, Node `v24.11.1`.

## Fluxo anterior examinado

`Sidebar.tsx` enviava nome, baud rate, data bits, parity, stop bits e flow control a `open_port`. Mudanças de configuração em uma conexão ativa chamavam novamente esse comando. O backend convertia os parâmetros da GUI e abria diretamente `serialport::SerialPort` com timeout de 50 ms, limpava entrada, clonava o handle para leitura e tentava baixar DTR/RTS.

`SerialState` possuía `Arc<Mutex<Option<Box<dyn SerialPort>>>>` para escrita/controles e um `Arc<AtomicBool>` global para leitura. A thread recebia o handle clonado, lia até 1024 bytes por chamada, ignorava `TimedOut`, gravava/flushava bytes recebidos e emitia `serial-data`. Erros fatais emitiam `connection-lost`.

`write_serial` convertia a string da GUI em UTF-8, fazia uma chamada `write`, gravava o registro TX e emitia `serial-tx` (quantidade aceita) e `serial-sent` (bytes fornecidos). DTR/RTS e gravação eram comandos separados. Fechar baixava o sinal e descartava somente o handle principal; reabrir usava uma espera fixa de 200 ms, sem guardar/aguardar a thread anterior.

Também foi examinado `start_spy_bridge`: comando não registrado no `invoke_handler` atual, mas compilado e usando o mesmo estado. Seus handles precisaram ser adaptados à nova estrutura; nenhuma funcionalidade de bridge foi habilitada.

## Arquitetura depois

```text
GUI → comandos Tauri → SerialConfig + SerialConnection (núcleo)
                         │
                         ├─ handle principal: sessão do backend
                         └─ clone: thread de leitura do backend

Núcleo: configuração tipada, abertura, Read/Write, clone, clear, DTR/RTS, Drop
Backend: mutex da sessão, cancelamento, JoinHandle, eventos, logging e mensagens
CLI: continua oferecendo somente help/version/ports/ports --json
```

O núcleo não importa `AppHandle`, `State`, `Emitter` ou qualquer tipo Tauri/WMI. A nova API oferece:

- `SerialConfig`: nome, baud rate, enums tipados de data bits/flow/parity/stop e `Duration` de timeout. `new` fornece 8N1, sem fluxo e 50 ms, mantendo os defaults da GUI; todos os campos podem ser configurados.
- `SerialConnection::open(&config)`: constrói o transporte com todos esses parâmetros; erros continuam `serialport::Error`, com kind e descrição.
- `Read` e `Write`: operam sobre bytes brutos. Erros continuam `std::io::Error`, inclusive `TimedOut`. Escritas parciais mantêm a semântica de `Write`; `write_all` também fica disponível pelo trait.
- `try_clone`, `clear_input`, `set_dtr` e `set_rts`: delegam ao transporte e preservam seus erros tipados.
- `from_transport`: adota um transporte já configurado, permitindo testes sem hardware. Não altera configuração/linhas de controle implicitamente.
- `close(self)`/`Drop`: liberam o handle possuído. Um clone continua sendo responsabilidade de seu proprietário; a porta só fica totalmente liberada após liberar todos os handles.

A conversão dos valores textuais da GUI permanece no backend (`gui_config`). Foram mantidos os fallbacks anteriores: data bits não reconhecido → 8, parity não reconhecida → None, stop bits diferente de 2 → 1 e fluxo diferente de Hardware → None. O núcleo também representa Software, mas isso não altera o comportamento anterior da GUI.

Continuam iguais as assinaturas dos comandos, textos de sucesso, prefixos de erros de abertura/escrita/pino, timeout normal de 50 ms, buffer de 1024 bytes, tentativas de clear/DTR/RTS e payloads `serial-data`, `serial-tx`, `serial-sent` e `connection-lost`. Gravação, marcador TX, adição de newline e flush por pacote continuam no backend. Não foi implementada conversão de texto dentro do núcleo.

## Encerramento e concorrência

### Problema corrigido nesta etapa

O sinal compartilhado anterior podia voltar para `true` enquanto uma thread antiga ainda estava em uma leitura. Como as threads eram destacadas e os clones não eram aguardados, reabertura podia manter leitor antigo ativo, emitir dados de sessões antigas ou falhar por handle ainda aberto. Uma espera fixa não confirmava liberação.

`SerialSession`, mantida exclusivamente no backend, agora possui conexão principal, sinal por sessão e handles das threads. Operações de abrir/fechar/escrever/controles são serializadas pelo mutex da sessão. Fechar/reconfigurar baixa o sinal, faz `join` de todas as threads e só então descarta a conexão principal. Abrir cria um novo sinal, sem reativar o sinal antigo. O leitor verifica cancelamento antes e depois da leitura; timeouts permanecem recuperáveis. Após `close_port` retornar, as threads daquela sessão já terminaram e seus handles foram liberados. Uma operação já em processamento pode concluir antes do retorno da desconexão.

Workers não adquirem o mutex da sessão, evitando um deadlock de `join` esperando o mesmo mutex. Mesmo se um worker entrar em panic, os demais são aguardados, a conexão principal é descartada e o backend retorna erro. `Drop` da sessão também chama o encerramento. Falha de criação da thread normal desfaz a conexão instalada. A API do núcleo não escolhe política de threads ou de cancelamento.

### Questões preexistentes que exigem trabalho mais amplo

1. **Logging síncrono e driver bloqueado:** o leitor mantém write/flush e o lock do arquivo. O novo encerramento espera a thread, portanto I/O de disco bloqueado, um driver que não respeite timeout ou processamento externo bloqueado pode atrasar `close_port`. Não existe prazo rígido de encerramento nem cancelamento forçado de I/O. Separar logging, definir backpressure/cancelamento e medir latência fica para etapa própria. Não há promessa de desconexão em exatamente 50 ms.
2. **Tratamento de perda de conexão ligado à Sidebar:** o listener frontend de `connection-lost` chama `close_port`, mas está em um componente que pode desmontar ao trocar de página. Em erro fatal, o clone leitor termina; o handle principal permanece no estado até close/reopen/Drop. Se o listener estiver ausente, a GUI pode continuar indicando conexão e o handle principal ficar retido. Uma rotina global de eventos/estado e limpeza automática independente da página merece mudança separada. O leitor desta etapa não tenta adquirir o mutex da sessão para limpar o principal, pois isso poderia competir com o `join`.
3. **TX parcial:** o comportamento anterior registra/emite os bytes fornecidos em `serial-sent`/log mesmo quando `write` aceita menos bytes; `serial-tx` e o retorno mostram a quantidade aceita. Essa diferença foi preservada para não mudar o contrato da GUI durante a extração. Estratégia de escrita completa e representação de TX parcial devem ser tratadas explicitamente depois.
4. **Spy/bridge não habilitado:** o código existente foi apenas adaptado ao núcleo/estado e ao encerramento de seus dois workers. Seus caminhos de erro e comportamento com duas portas reais continuam sem validação. Os eventos de bridge e o intervalo de timeout de 10 ms foram mantidos.

## Arquivos desta etapa

- `crates/serialhub-core/src/lib.rs`: exporta configuração/conexão; enumeração anterior permanece.
- `crates/serialhub-core/src/connection.rs`: configuração, handles e operações sem dependência de GUI.
- `crates/serialhub-core/src/connection/tests.rs`: transporte simulado e oito testes novos.
- `src-tauri/src/lib.rs`: `SerialState` passa a possuir uma sessão; preserva enumeração compartilhada/hotplug das etapas anteriores.
- `src-tauri/src/serial_session.rs`: coordenação/encerramento no backend e dois testes de threads simuladas.
- `src-tauri/src/commands/serial_cmd.rs`: adaptação ao núcleo, conversão da configuração GUI e dois testes dessa fronteira; eventos/logging permanecem aqui.
- Este documento.

## Verificações executadas

Comandos na raiz do repositório:

```powershell
cargo build --offline --locked --manifest-path crates/serialhub-core/Cargo.toml
cargo build --offline --locked --manifest-path crates/serialhub-cli/Cargo.toml
npm run build
cargo build --offline --locked --manifest-path src-tauri/Cargo.toml
cargo check --offline --locked --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --offline --locked --manifest-path crates/serialhub-core/Cargo.toml
cargo test --offline --locked --manifest-path crates/serialhub-cli/Cargo.toml
cargo test --offline --locked --manifest-path src-tauri/Cargo.toml
node --test tests/mqtt-credentials.test.mjs tests/theme.test.mjs
cargo fmt --manifest-path crates/serialhub-core/Cargo.toml --check
rustfmt --check --edition 2021 src-tauri/src/commands/serial_cmd.rs src-tauri/src/serial_session.rs
git diff --check
```

Todos passaram. Resultado dos testes: **13 núcleo (5 anteriores + 8 novos), 10 CLI, 4 backend e 11 frontend**, total de 38, sem falhas. As compilações ocorreram com dependências existentes, sem atualização de manifests/lockfiles. Avisos frontend anteriores continuam: base Browserslist/caniuse-lite antiga e bundle acima de 500 kB.

Os testes simulados verificam: defaults e configuração tipada recebida pela fábrica do transporte, bytes de controle/não UTF-8, leituras em partes, escrita parcial, erro `TimedOut`, preservação de erros de abertura/leitura/escrita/clonagem/controles, clear de entrada, liberação de cada handle/clones, conversão dos parâmetros GUI e encerramento idempotente que aguarda o leitor (inclusive quando outro worker falha). O teste de timeout valida o tipo retornado, **não mede tempo real de driver**. O transporte simulado não substitui uma validação nativa de configuração/controles no Windows.

Também executado:

```powershell
.\crates\serialhub-cli\target\debug\serialhub.exe ports --json
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223'
npm run tauri dev
```

A CLI continuou listando `COM3` no esquema anterior. A aplicação Tauri compilou e abriu; seus comandos foram exercitados por IPC no WebView local de teste: `list_ports` retornou a mesma porta; duas chamadas `open_port` com nome deliberadamente inexistente `SERIALHUB_TEST_NO_DEVICE` retornaram `Falha ao abrir: O sistema não pode encontrar o arquivo especificado.`; duas chamadas `close_port` retornaram `Desconectado.`. Isso valida integração e caminhos de falha/fechamento sem porta aberta, **não recepção ou reabertura de conexão real**. Nenhum comando foi enviado a equipamento físico.

## Verificações manuais pendentes

A consulta somente de leitura a `Win32_SerialPort`/PnP identificou `COM3` como **Intel(R) Active Management Technology - SOL**, de origem PCI, apesar do rótulo `Virtual` produzido pela enumeração existente. Não foi aberto esse dispositivo. Não foi encontrado driver/par de teste com0com/virtual serial confirmado; nada foi instalado. A tentativa de inspeção visual encontrou o desktop Windows bloqueado e a automação da interface foi interrompida. A evidência IPC acima é distinta de uma inspeção visual completa.

Com um par virtual isolado, ainda é necessário:

1. Abrir uma extremidade pela GUI e gerar bytes na outra; conferir recepção ASCII/HEX e preservação de bytes brutos/log RX.
2. Desconectar durante recepção/timeout e reabrir repetidamente; confirmar liberação dos handles, ausência de leitores antigos e comportamento dos eventos.
3. Alterar baud/data/parity/stop/flow com conexão ativa e conferir parâmetros suportados pelo driver.
4. Conferir DTR/RTS em transporte virtual compatível e distinguir drivers sem suporte a essas linhas.
5. Gravar RX/TX em arquivo temporário, verificar marcadores e encerramento; exercitar perda da porta e alternância de páginas.
6. Medir encerramento com tráfego e logging se houver requisito de latência. Nenhum benchmark foi executado nesta etapa.

Outros sistemas, dispositivos físicos, release/instalador e bridge permanecem sem validação. O próximo monitor CLI poderá usar `SerialConfig`, `SerialConnection` e os traits `Read`/`Write`, definindo sua própria política de cancelamento e saída; nenhum comando de monitoramento foi adicionado agora.

## Verificação visual complementar após desbloqueio

Em 13/10/2026, após o usuário desbloquear o Windows e após concluir a etapa 5, a GUI foi novamente iniciada com `npm run tauri dev`. A inspeção visual confirmou o Monitor Serial em estado `DESCONECTADO`, a lista com um dispositivo `COM3 Virtual` e o botão `Atualizar Lista`. Foi acionada a atualização e confirmado que ela terminou, mantendo o mesmo dispositivo e o estado desconectado. O nome/rótulo exibido não muda a identificação física Intel AMT registrada acima.

Essa inspeção resolve a pendência de inicialização/listagem visual; não valida recepção, conexão ou reabertura. Nenhuma porta foi aberta, nenhum comando foi transmitido e o par virtual continua necessário para os testes de comunicação. Somente este complemento documental foi alterado nessa retomada; código e alterações locais anteriores foram preservados.
