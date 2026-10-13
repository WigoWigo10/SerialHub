# PAIC — Etapa 05: monitor Serial pela CLI

Data: 13/10/2026 (America/Manaus). Trabalho local, **sem commit, push ou publicação**. Monitor somente de recepção, sem comandos MQTT, gravação em arquivo, batching ou otimizações de desempenho.

## Referência e dependência da etapa 4

- Branch `main`, HEAD inicial/final `2c693e7fb06ad3064ab4beae03eece6f223ca5f7`.
- Lidos os registros das etapas 1–4 e os arquivos de configuração/conexão do núcleo, comandos CLI e testes existentes. Conferidos `git status --short` e diff antes de editar. Não foi encontrado `AGENTS.md` no repositório ou nos ancestrais até `C:\`, excluindo dependências, `.git` e target.
- As etapas 2–4 e alterações anteriores permanecem sem commit. Foram registrados SHA-256 de 33 arquivos preexistentes; somente cinco arquivos CLI foram editados intencionalmente nesta etapa. Os outros 28, incluindo núcleo, backend, registros anteriores, arquivos npm, `.gitignore`, PDF e scripts locais, permaneceram byte a byte idênticos.
- Confirmado antes da implementação: a etapa 4 fornece `SerialConfig::new`, `SerialConnection::open` e `Read` independente de Tauri/WMI. O núcleo configura porta, baud, 8N1, fluxo e timeout e preserva bytes/erros. Não foi necessário concluir ou modificar essa dependência.
- Ambiente Windows/PowerShell, target `x86_64-pc-windows-msvc`, Rust/Cargo `1.93.0`, Node `v24.11.1`. A CLI mantém versão `0.1.0`.

## Comandos e comportamento

Exemplos solicitados (substitua COM3 por uma porta autorizada de teste):

```text
serialhub serial monitor --port COM3 --baud 115200
serialhub serial monitor --port COM3 --baud 115200 --duration 10
serialhub serial monitor --port COM3 --baud 115200 --duration 2.5
serialhub serial monitor --help
```

`--port` e `--baud` são obrigatórios; baud deve ser inteiro positivo representável em `u32`. `--duration` é opcional, aceita segundos positivos finitos, inclusive decimais, representáveis em `Duration` com valor maior que zero. Opções podem ser reordenadas. Valores ausentes, flags desconhecidas/duplicadas e valores inválidos falham antes de abrir uma porta. A ajuda específica também aceita `-h` e mostra parâmetros, exemplos, DTR/RTS e streams.

Sem duração, o monitor executa até Ctrl+C ou falha operacional. Permanecem `ports`, `ports --json`, `--help`/`-h` e `--version`/`-V`.

### Parâmetros e streams

- A CLI usa `SerialConfig`/`SerialConnection` do núcleo, sem duplicar a abertura/configuração nativa e sem introduzir Tauri/WMI.
- Configuração: **8 data bits, parity None, 1 stop bit, flow control None**, baud solicitado e timeout de leitura de **50 ms**.
- Não há calls de escrita Serial, clonagem do handle, clear de entrada ou alterações explícitas de DTR/RTS. O estado inicial das linhas é determinado pelo driver/abertura nativa. Isso difere da política da GUI, que tenta baixar DTR/RTS após abrir; não há promessa de que abrir a porta deixe essas linhas inalteradas no hardware.
- Cada trecho recebido é escrito com `write_all` em stdout e flush, sem decode, newline adicional, prefixo, timestamp, HEX ou filtros. NUL, bytes não UTF-8 e quebras de linha são preservados pelo caminho de bytes.
- Avisos de abertura/recepção/encerramento e erros vão somente para stderr. Ajuda, versão e listagem mantêm suas saídas habituais em stdout, fora do modo monitor.
- A CLI não tem opção de arquivo nem mantém logs. Redirecionar stdout externamente é responsabilidade do chamador. Para binários, use pipe/arquivo que preserve bytes; consoles Windows não representam bytes arbitrários e o stdout Rust pode falhar em sequências não UTF-8 quando ligado ao console. Shells/pipelines de texto também podem reencodar dados. Isso não é conversão implementada pelo monitor; erro de escrita é falha operacional.

### Encerramento e timeouts

Uma conexão pertence ao loop do monitor, sem clones ou thread leitora adicional. A biblioteca `ctrlc` instala um handler que apenas marca uma flag atômica; o loop verifica essa flag antes/depois de ler e libera a conexão por `Drop` em toda saída. O handler não escreve em stdout.

A duração começa depois da abertura bem-sucedida e usa `Instant`/tempo decorrido monotônico. Ao atingir o limite, a leitura encerra e a conexão é liberada. Se o limite vencer durante uma leitura, os bytes retornados por ela ainda são escritos antes de encerrar; nenhuma leitura seguinte é iniciada. No cancelamento, não há drenagem dos dados pendentes. Ctrl+C tem precedência sobre duração; erros de leitura não transitórios continuam falhas operacionais, mesmo se o prazo terminar durante a leitura.

`TimedOut`, `WouldBlock` e `Interrupted` sem cancelamento são transitórios. Leituras de zero bytes também são tratadas como ausência de progresso. Se uma leitura sem dados retornar antes dos 50 ms, o loop dorme o restante desse intervalo, limitado pelo tempo restante da duração. Se o driver já aguardou todo o timeout, não há outra espera desnecessária. Esse mecanismo evita retry contínuo de leituras vazias/timeouts imediatos; não foi feito benchmark de CPU.

O término é observado entre operações bloqueantes. Normalmente pode ultrapassar a duração em até uma leitura, mas não há prazo rígido se o driver ignorar timeout ou stdout ficar bloqueado por um consumidor. Ctrl+C também não interrompe forçadamente uma abertura/escrita nativa bloqueada; a conexão é liberada assim que o controle retorna ao loop.

| Situação | Código |
| --- | --- |
| Término por duração | `0` |
| Ctrl+C/cancelamento | `130` |
| Falha de abertura, leitura, saída ou instalação do handler | `1` |
| Argumentos inválidos | `2` |

## Arquivos da etapa

- `crates/serialhub-cli/Cargo.toml`: descrição e dependência `ctrlc = "3.4"` para sinais de console.
- `crates/serialhub-cli/Cargo.lock`: resolução de `ctrlc 3.5.2` e dependências de plataforma; dependências anteriores mantidas.
- `crates/serialhub-cli/src/main.rs`: inclusão do módulo de monitoramento; mecanismo de código de saída permanece.
- `crates/serialhub-cli/src/cli.rs`: argumentos, ajuda, despacho e três testes novos; listagem anterior preservada.
- `crates/serialhub-cli/src/monitor.rs`: integração com o núcleo, Ctrl+C, loop de leitura, relógio monotônico e encerramento.
- `crates/serialhub-cli/src/monitor/tests.rs`: dez testes determinísticos com fonte somente `Read`, relógio simulado e observação de liberação por Drop.
- `crates/serialhub-cli/tests/commands.rs`: dois testes novos do executável para ajuda e argumentos inválidos do monitor.
- Este documento.

## Compilação e verificações executadas

Comandos na raiz do repositório:

```powershell
cargo fetch --manifest-path crates/serialhub-cli/Cargo.toml
cargo build --offline --locked --manifest-path crates/serialhub-core/Cargo.toml
cargo build --offline --locked --manifest-path crates/serialhub-cli/Cargo.toml
cargo test --offline --locked --manifest-path crates/serialhub-core/Cargo.toml
cargo test --offline --locked --manifest-path crates/serialhub-cli/Cargo.toml
cargo test --offline --locked --manifest-path src-tauri/Cargo.toml
node --test tests/mqtt-credentials.test.mjs tests/theme.test.mjs
cargo fmt --manifest-path crates/serialhub-cli/Cargo.toml --check
cargo tree --offline --locked --manifest-path crates/serialhub-cli/Cargo.toml
git diff --check
```

Builds independentes do núcleo e da CLI passaram. **25 testes CLI (21 unitários + 4 integração), 13 do núcleo, 4 backend e 11 frontend passaram**, total de 53, sem falhas. Formatação e `git diff --check` passaram. `cargo fetch` baixou a nova dependência e pacotes de plataforma necessários ao cache; somente o lockfile da CLI mudou. A árvore Windows da CLI contém `ctrlc`, `serde_json`, núcleo/serialport e dependências nativas; não contém Tauri/WMI. O frontend/backend não foram modificados nesta etapa; seus testes pertinentes foram reexecutados.

Os testes novos cobrem:

- Argumentos reordenados, ausência/presença de duração decimal, campos obrigatórios, zero/overflow de baud, duração negativa/zero/NaN/infinita/overflow, falta de valor, opções duplicadas e ajuda sem abrir portas.
- Encaminhamento dos códigos de saída, configuração 8N1/sem fluxo recebida pela fábrica simulada e abertura usando apenas a API do núcleo em produção.
- Preservação exata da sequência `00 FF 80 0D 0A 1B 41` em stdout, com estado separado em stderr; o transporte simulado só implementa `Read`, impossibilitando transmissão nesse loop.
- Timeouts imediatos com espera explícita, timeout que já consumiu o intervalo, leitura zero e término por relógio monotônico simulado.
- Cancelamento durante leitura/espera, código `130`, cancelamento prévio sem abrir porta e Drop da conexão.
- Falhas de abertura/leitura/escrita, stderr exclusivo para diagnósticos e código `1`; conexão liberada nos caminhos com handle aberto.
- Ajuda e erro de argumentos pelo binário real, sem hardware.

### Execuções reais no Windows

O binário `crates/serialhub-cli/target/debug/serialhub.exe` foi executado via `subprocess.run` com stdout/stderr capturados separadamente e códigos de saída registrados. Equivalentes no PowerShell:

```powershell
.\crates\serialhub-cli\target\debug\serialhub.exe --help
.\crates\serialhub-cli\target\debug\serialhub.exe --version
.\crates\serialhub-cli\target\debug\serialhub.exe ports
.\crates\serialhub-cli\target\debug\serialhub.exe ports --json
.\crates\serialhub-cli\target\debug\serialhub.exe serial monitor --help
.\crates\serialhub-cli\target\debug\serialhub.exe serial monitor --port SERIALHUB_TEST_NO_DEVICE --baud 115200 --duration 0.1
.\crates\serialhub-cli\target\debug\serialhub.exe serial monitor --port COM3 --baud 0
```

| Execução | Resultado | Código |
| --- | --- | --- |
| `--help`, `--version` | Ajuda atualizada; versão `serialhub 0.1.0`; stderr vazio | `0` |
| `ports` | `COM3 (Virtual)`; stderr vazio | `0` |
| `ports --json` | Array no esquema anterior, aceito por parser JSON; stderr vazio | `0` |
| `serial monitor --help` | Parâmetros, exemplos e comportamento documentados; stderr vazio | `0` |
| Monitor com `SERIALHUB_TEST_NO_DEVICE` | stdout vazio; abertura/erro somente stderr (`O sistema não pode encontrar o arquivo especificado.`) | `1` |
| Monitor com baud `0` | stdout vazio; argumento rejeitado antes de qualquer abertura, mesmo com COM3 no texto do argumento | `2` |

Não foi executado monitor válido em `COM3`. A consulta somente de leitura a `Win32_SerialPort` identificou novamente Intel(R) Active Management Technology - SOL, não um par virtual isolado. Não foi encontrado driver/par virtual de teste confirmado; nada foi instalado e nenhum equipamento físico foi aberto automaticamente.

## Pendências e limites da evidência

- **Recepção nativa/portas virtuais:** confirmar sequência conhecida, incluindo binários, com outra extremidade gerando os dados; capturar stdout como bytes e comparar sem pipeline de texto.
- **Sinal real:** pressionar Ctrl+C num terminal Windows, verificar código `130` e reabrir a mesma porta. Os testes automatizados marcam a flag de cancelamento; não equivalem à entrega real de um evento de console Windows em uma conexão ativa.
- **Duração nativa/reabertura:** executar `--duration`, confirmar código `0` e abrir novamente; tempos dos drivers ainda não foram medidos. A verificação determinística usa relógio/transportes simulados.
- **Linhas de controle:** conferir DTR/RTS e eventuais efeitos nativos de abertura no driver virtual usado, sem pressupor que a CLI baixa essas linhas como a GUI.
- Outros sistemas, console com dados não UTF-8, consumidores stdout bloqueados, release/instalador e dispositivos físicos permanecem sem validação.
- Não há gravação interna em arquivo, monitoramento MQTT, formatação de dados ou otimização de throughput. Nenhum ganho de desempenho foi declarado.

## Registro posterior de versionamento

Após as execuções documentadas acima, em 13/10/2026 o usuário autorizou registrar as etapas 2–5 na branch `feature/shared-core-cli`, com a mensagem `feat(serial): add shared core and serial CLI`, e publicar essa branch em `origin`, sem merge na `main`. As referências a trabalho sem commit/publicação nos registros anteriores descrevem o momento original de cada etapa.

A seleção inclui os dois crates, integração Serial do backend, exclusões de target e os registros das etapas 2–5. Ajustes npm/configuração Tauri, remoção preexistente do BOM do manifest Rust, PDF e scripts Python ficam fora desse commit. As validações anteriores usaram essas configurações locais conforme os registros de referência; a publicação não transforma testes simulados em validação com portas virtuais. Não houve alteração de código nem repetição das compilações ou dos 53 testes nesta operação de versionamento.
