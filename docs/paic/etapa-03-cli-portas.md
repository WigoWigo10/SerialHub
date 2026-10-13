# PAIC — Etapa 03: CLI mínima de portas

Data: 13/10/2026 (America/Manaus). Trabalho local, **sem commit, push ou publicação**. A CLI apenas enumera dispositivos: ainda não realiza aquisição Serial, abertura de portas, transmissão de dados nem comunicação MQTT.

## Referência e preservação

- Branch: `main`; HEAD inicial e final: `2c693e7fb06ad3064ab4beae03eece6f223ca5f7` (melhoria da troca de tema).
- Etapa 1 registrada em `45e51ec`; etapa 2 continua sem commit.
- Lidos [etapa-01-credenciais-mqtt.md](etapa-01-credenciais-mqtt.md), [etapa-02-nucleo-serial.md](etapa-02-nucleo-serial.md), manifests, modelo e enumeração de `serialhub-core`.
- Nenhum `AGENTS.md` encontrado no repositório ou nos ancestrais até `C:\`, excluindo dependências, `.git` e saídas `target`.
- Conferidos `git status --short`, estatísticas e diff antes de editar. Havia alterações em `.gitignore`, manifests npm, manifest/lockfile/configuração Tauri e adaptação Serial/hotplug. Também havia o núcleo, registro da etapa 2, PDF e scripts Python não rastreados.
- SHA-256 de 15 arquivos preexistentes conferidos antes/depois: manifests npm, cinco arquivos de backend/configuração, três arquivos do núcleo, documento da etapa 2, PDF e três scripts Python; todos permaneceram idênticos. Em `.gitignore`, remover apenas a nova linha de exclusão da CLI reproduz o SHA-256 inicial. Nenhuma alteração anterior foi descartada ou incorporada em commit.

Ambiente: Windows, PowerShell, Rust/Cargo `1.93.0`, Node `v24.11.1`, target `x86_64-pc-windows-msvc`. A versão da CLI é `0.1.0`, independente da versão `1.2.1` da aplicação gráfica.

## Implementação e arquivos

```text
serialhub (CLI) → serialhub_core::list_ports() → serialport::available_ports()
                         ↑
                 GUI Tauri já existente
```

A estrutura de crates independentes foi mantida, sem workspace raiz. O backend e o núcleo não foram editados. A CLI tem apenas `serialhub-core` como dependência local e `serde_json` para saída estruturada. Sua árvore de dependências Windows não contém Tauri, WMI, React ou componentes gráficos.

- `crates/serialhub-cli/Cargo.toml`: pacote `serialhub-cli`, binário `serialhub`, versão e dependências.
- `crates/serialhub-cli/Cargo.lock`: resolução independente; `serialport 4.9.0`, como no núcleo/backend, e `serde_json 1.0.150`.
- `crates/serialhub-cli/src/main.rs`: argumentos do processo, chamada exclusiva ao núcleo, stdout/stderr e código de saída.
- `crates/serialhub-cli/src/cli.rs`: validação estrita de argumentos, apresentação textual, serialização direta do modelo do núcleo e oito testes unitários. A função de enumeração pode ser substituída somente pela chamada interna dos testes; produção sempre chama o núcleo.
- `crates/serialhub-cli/tests/commands.rs`: dois testes de integração que executam o binário para ajuda, versão e argumentos inválidos.
- `.gitignore`: acrescentado somente `crates/serialhub-cli/target/`, preservando a exclusão do núcleo e as demais linhas.
- Este documento.

Comandos suportados: `serialhub --help`, `serialhub --version`, `serialhub ports` e `serialhub ports --json`. Também existem aliases `-h` e `-V`. Opções desconhecidas, argumentos extras, duplicação de `--json`, comando ausente e combinações não suportadas falham antes de enumerar portas.

O texto mostra nome e tipo, seguidos por VID, PID, fabricante e produto quando disponíveis. O JSON serializa diretamente `Vec<serialhub_core::SerialPortInfo>`: array com `port_name`, `port_type`, `vid`, `pid`, `manufacturer` e `product`, sem cabeçalho, logs ou mensagens em stdout. Ordem e valores retornados pelo núcleo são preservados.

| Situação | stdout | stderr | Código |
| --- | --- | --- | --- |
| Ajuda/versão | Texto solicitado | Vazio | `0` |
| Portas encontradas | Texto ou array JSON | Vazio | `0` |
| Nenhuma porta, modo texto | `Nenhuma porta serial encontrada.` | Vazio | `0` |
| Nenhuma porta, modo JSON | `[]` | Vazio | `0` |
| Falha de enumeração | Vazio | Diagnóstico com erro do núcleo | `1` |
| Argumentos inválidos/ausentes | Vazio | Diagnóstico e indicação de `--help` | `2` |
| Falha ao escrever saída | Pode haver saída parcial se o destino falhar | Diagnóstico, quando stderr estiver disponível | `1` |

## Compilação e execução

Todos os caminhos abaixo são relativos à raiz `C:\Users\higor\Documents\VSCode\Pessoal\SerialHub`.

Primeira compilação executada, gerando o lockfile a partir do cache:

```powershell
cargo build --offline --manifest-path crates/serialhub-cli/Cargo.toml
```

Compilação reproduzível executada após gerar o lockfile:

```powershell
cargo build --offline --locked --manifest-path crates/serialhub-cli/Cargo.toml
```

Em outra máquina, pode-se omitir `--offline` para baixar as dependências; preserve `--locked`. Não é necessário compilar o backend, iniciar Vite ou instalar WebView2 para executar esta CLI.

O binário compilado foi executado no Windows com os argumentos abaixo, usando `subprocess.run(..., capture_output=True, encoding='utf-8')` para capturar separadamente stdout, stderr e código de saída. A forma equivalente de execução direta no PowerShell é:

```powershell
.\crates\serialhub-cli\target\debug\serialhub.exe --help
.\crates\serialhub-cli\target\debug\serialhub.exe --version
.\crates\serialhub-cli\target\debug\serialhub.exe ports
.\crates\serialhub-cli\target\debug\serialhub.exe ports --json
.\crates\serialhub-cli\target\debug\serialhub.exe ports --invalid
.\crates\serialhub-cli\target\debug\serialhub.exe
```

| Execução real | Resultado | Código |
| --- | --- | --- |
| `--help` | Ajuda com uso, opções e aviso de enumeração apenas; stderr vazio | `0` |
| `--version` | `serialhub 0.1.0`; stderr vazio | `0` |
| `ports` | `COM3 (Virtual)`; stderr vazio | `0` |
| `ports --json` | Array com uma porta; parser Python aceitou e confirmou os seis campos; stderr vazio | `0` |
| `ports --invalid` | stdout vazio; diagnóstico somente em stderr | `2` |
| Sem argumentos | stdout vazio; indicação para usar ajuda em stderr | `2` |

JSON observado, sem outro conteúdo em stdout:

```json
[{"port_name":"COM3","port_type":"Virtual","vid":"","pid":"","manufacturer":"","product":""}]
```

A validação do parser usou `json.loads(result.stdout)`, confirmou que o resultado era uma lista e que cada item continha exatamente os seis campos. A saída capturada é UTF-8. O cabeçalho PE do executável também foi inspecionado: subsistema `3` (Windows Console/CUI). A execução usa console/streams, sem iniciar a interface Tauri nem janela gráfica da aplicação.

## Testes e verificações executados

```powershell
cargo test --offline --locked --manifest-path crates/serialhub-cli/Cargo.toml
cargo test --offline --locked --manifest-path crates/serialhub-core/Cargo.toml
node --test tests/mqtt-credentials.test.mjs tests/theme.test.mjs
cargo tree --offline --locked --manifest-path crates/serialhub-cli/Cargo.toml
cargo fmt --manifest-path crates/serialhub-cli/Cargo.toml
cargo fmt --manifest-path crates/serialhub-cli/Cargo.toml --check
git diff --check
```

Resultados: compilação inicial e compilação com lockfile passaram; **10 testes CLI, 5 testes do núcleo e 11 testes existentes passaram**, sem falhas. Formatação e `git diff --check` passaram. A inspeção das dependências confirmou ausência de Tauri/WMI. Nenhuma dependência nova foi baixada; manifests/lockfiles anteriores não foram alterados.

Os testes da CLI são determinísticos e independem de dispositivos reais:

- Argumentos aceitos e inválidos; ajuda/versão/erro de argumentos não invocam enumeração.
- Array JSON exclusivo, esquema da GUI e escape de aspas, quebra de linha e Unicode nos metadados.
- Lista vazia nos dois modos: texto claro ou `[]`, com código zero e stderr vazio.
- Erro de enumeração simulado nos dois modos: stdout vazio, diagnóstico stderr e código `1`.
- Texto com nome/tipo/metadados disponíveis, omitindo campos vazios e preservando ordem.
- Destino stdout com falha de escrita: diagnóstico e código de erro.
- Execução do binário real para ajuda/versão e confirmação do código `2` por argumentos inválidos.

O frontend e backend não foram recompilados nesta etapa: seus arquivos permaneceram idênticos e a CLI foi compilada independentemente. Os testes existentes de credenciais e tema foram reexecutados.

## Limitações e pendências

- Enumeração real verificada somente no Windows e com `COM3 Virtual`. Dispositivos USB com metadados, Bluetooth/PCI, ausência física de portas e falha real do driver ainda precisam de verificação; lista vazia e falhas já estão cobertas deterministicamente.
- Outros sistemas operacionais não foram compilados/testados. A dependência `serialport` usa APIs nativas e seus recursos padrão podem exigir bibliotecas de plataforma, conforme registrado na etapa 2.
- Não foram produzidos instalador, pacote de distribuição ou build release. O executável está em `target/debug`, ignorado pelo Git.
- A CLI apenas apresenta um snapshot da enumeração. Não monitora hotplug, não abre portas, não lê/escreve dados, não grava logs e não oferece comandos MQTT. Aquisição Serial e comunicação MQTT permanecem para etapas futuras.
- A estrutura depende do núcleo local ainda não commitado. Para transportar a etapa, leve ambos os crates e suas alterações/documentos, preservando os caminhos relativos.
