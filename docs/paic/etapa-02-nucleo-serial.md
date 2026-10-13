# PAIC — Etapa 02: núcleo de enumeração Serial

Data: 13/10/2026 (America/Manaus). **Somente a enumeração de portas foi extraída.** Trabalho local, sem commit, push ou publicação.

## Referência e preservação das alterações locais

- Branch `main`, HEAD `45e51ecf3d3461ad5792652c4400781cdab3796e` (`fix(mqtt): keep passwords in memory and sanitize saved profiles`).
- Lido [etapa-01-credenciais-mqtt.md](etapa-01-credenciais-mqtt.md) e conferidos `git status --short`, diff completo dos arquivos modificados e estatísticas antes da implementação.
- Nenhum `AGENTS.md` encontrado no repositório ou em seus diretórios ancestrais até `C:\` (dependências, target e `.git` excluídos da busca).
- Ambiente Windows, PowerShell, Node `v24.11.1`, Cargo/Rust `1.93.0`, target `x86_64-pc-windows-msvc`.

Estado inicial:

```text
 M package-lock.json
 M package.json
 M src-tauri/Cargo.toml
 M src-tauri/tauri.conf.json
?? PAIC2026_Proposta-HigorCavalcante.pdf
?? leitor.py
?? leitor_diff.py
?? simulador_iot.py
```

As sete entradas que não precisaram de edição conservaram exatamente os SHA-256 registrados na etapa 1. Em `src-tauri/Cargo.toml`, a alteração anterior (remoção do BOM) foi preservada e apenas a dependência local foi acrescentada. `git apply --reverse --check docs/paic/etapa-01-referencia-local.patch` confirmou que as alterações anteriores continuam presentes; esse comando somente verifica, não aplica o patch. Não foram alterados os arquivos de credenciais da etapa 1 nem os consumidores TypeScript.

## Arquitetura antes

`Sidebar.tsx` chamava `invoke<SerialPort[]>("list_ports")`. O comando em `src-tauri/src/commands/serial_cmd.rs` executava `serialport::available_ports()`, transformava os metadados e retornava seu próprio `SerialPortInfo`, serializado por Serde.

O modelo e a enumeração estavam no módulo de comandos Tauri, junto de aquisição, threads e gravação. Em `src-tauri/src/lib.rs`, uma thread também chamava diretamente `serialport::available_ports()` para detectar alterações e emitir `ports-changed`.

## Arquitetura depois

```text
Sidebar.tsx → invoke("list_ports") → comando Tauri
                                      ↓
                         serialhub_core::list_ports()
                                      ↓
                         serialport::available_ports()

Thread de hotplug Tauri → serialhub_core::list_ports()
                        → comparação dos nomes → evento ports-changed
```

`crates/serialhub-core` é uma biblioteca Rust com manifest e lockfile próprios, sem workspace raiz, build script, Tauri, WMI, estado de aplicação ou eventos. Suas dependências de produção são `serialport` e `serde`; `serde_json` é usado somente nos testes. O lockfile independente resolve `serialport 4.9.0`, também usado no lockfile do backend. A árvore de dependências Windows foi inspecionada e não contém Tauri nem WMI.

A API pública contém `SerialPortInfo` (campos públicos, serializável) e `list_ports() -> serialport::Result<Vec<SerialPortInfo>>`. O núcleo mantém o erro tipado da biblioteca de portas. O adaptador Tauri mantém a assinatura anterior `Result<Vec<SerialPortInfo>, String>` e o texto `Erro: {erro}`.

O monitor de hotplug passa a consumir a mesma enumeração, mas a thread, intervalo de três segundos, comparação de nomes e evento continuam no backend. A dependência direta de `serialport` no backend permanece necessária para aquisição e controle das portas, não extraídos nesta etapa.

## Contrato preservado

| Campo JSON | Comportamento |
| --- | --- |
| `port_name` | Nome retornado pela biblioteca de portas |
| `port_type` | USB → `USB`; Bluetooth → `Bluetooth`; PCI → `Native`; desconhecida → `Virtual` |
| `vid`, `pid` | USB: hexadecimal minúsculo com quatro dígitos; outras portas: string vazia |
| `manufacturer`, `product` | Metadados USB ou string vazia quando ausentes; outras portas: string vazia |

Não foram adicionados campos (inclusive número de série), ordenação, filtros ou abertura de portas. Lista vazia continua válida e a ordem retornada pela biblioteca é mantida. A GUI continua usando esses campos para ícones, agrupamento USB/outras portas, tooltips, identificação e seleção da porta.

## Arquivos da etapa

- `crates/serialhub-core/Cargo.toml`: biblioteca independente e dependências mínimas.
- `crates/serialhub-core/Cargo.lock`: resolução independente reproduzível; não inclui o backend.
- `crates/serialhub-core/src/lib.rs`: modelo, conversão de metadados, enumeração e cinco testes unitários.
- `src-tauri/Cargo.toml`: dependência `serialhub-core = { path = "../crates/serialhub-core" }`, preservando a edição local anterior.
- `src-tauri/Cargo.lock`: pacote local e ligação ao backend; sem atualização dos pacotes existentes.
- `src-tauri/src/commands/serial_cmd.rs`: remoção do modelo/conversão locais; comando delega ao núcleo e mantém erro de apresentação.
- `src-tauri/src/lib.rs`: somente a chamada de enumeração do monitor foi redirecionada; a thread não foi extraída.
- `.gitignore`: ignora `crates/serialhub-core/target/`.
- Este documento.

Consumidores examinados, sem alterações: `src/components/layout/Sidebar.tsx` (`SerialPort`, `scanPorts`, `PortButton`, ícones, filtros USB e listener `ports-changed`) e registro do comando em `src-tauri/src/lib.rs`.

## Validação executada

Comandos executados na raiz do repositório:

| Comando | Resultado |
| --- | --- |
| `cargo build --offline --manifest-path crates/serialhub-core/Cargo.toml` | Sucesso, compilação independente; criou lockfile com dependências disponíveis no cache |
| `cargo build --offline --locked --manifest-path crates/serialhub-core/Cargo.toml` | Sucesso após formatação, lockfile preservado |
| `cargo test --offline --manifest-path crates/serialhub-core/Cargo.toml` | 5 testes passaram, 0 falhas; 0 doctests |
| `cargo tree --offline --locked --manifest-path crates/serialhub-core/Cargo.toml` | Apenas Serde/serialport e suas dependências; serde_json nos testes; sem Tauri/WMI |
| `npm run build` | Sucesso: TypeScript e Vite |
| `cargo check --offline --manifest-path src-tauri/Cargo.toml` | Sucesso |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Sucesso, núcleo e backend verificados juntos |
| `node --test tests/mqtt-credentials.test.mjs` | 7 testes existentes passaram, 0 falhas |
| `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml` | Sucesso; backend contém 0 testes unitários e 0 doctests |
| `npm run tauri dev` | Compilou e abriu a aplicação Windows; listagem inicial e atualização verificadas pela GUI |
| `cargo fmt --manifest-path crates/serialhub-core/Cargo.toml --check` | Detectou dois ajustes de estilo; aplicados com `cargo fmt`; nova checagem passou |
| `git diff --check` | Sucesso |
| `git apply --reverse --check docs/paic/etapa-01-referencia-local.patch` | Sucesso; alterações anteriores preservadas |

Avisos existentes do frontend continuam: Browserslist/caniuse-lite com nove meses e bundle acima de 500 kB. Não houve instalação de dependências nem alteração dos manifests npm. Os testes novos usam enumeração injetada internamente e dados fictícios, sem depender de hardware: contrato JSON USB completo, valores USB ausentes, rótulos dos demais tipos, ordem/lista vazia e preservação do tipo/mensagem de erro.

## GUI e limitações

A aplicação foi compilada e executada com `npm run tauri dev`. A inspeção da janela pela skill `computer-use:computer-use` encontrou `OUTROS DISPOSITIVOS 1` e a porta `COM3 Virtual`, com estado `DESCONECTADO`. Foi acionado o botão `Atualizar Lista`; a mesma porta permaneceu listada. Não foi aberta uma porta nem enviada informação a dispositivo. Essa verificação cobre listagem real pelo comando Tauri na máquina atual; não cobre todos os tipos e metadados.

Pendências manuais: conectar adaptador USB com fabricante/produto/VID/PID conhecidos, conferir tooltip e agrupamento; inserir/remover dispositivo e verificar atualização automática via `ports-changed`; testar ausência de portas e falha real de enumeração em ambiente apropriado. A interface de aquisição não foi exercitada porque permanece fora do escopo.

O núcleo foi compilado e testado somente no Windows. Independência de Tauri/WMI não significa ausência de dependências nativas: `serialport` usa APIs do sistema e seus recursos padrão podem exigir bibliotecas de plataforma (por exemplo, libudev no Linux). Outros sistemas, permissões de acesso, erros reais do driver, inserção/remoção física e metadados de dispositivos reais ainda precisam de validação.

Aquisição Serial, `SerialState`, abertura/fechamento, threads, controle de pinos, gravação/logging, MQTT, telemetria WMI e CLI permanecem fora do núcleo. Próximas etapas deverão definir suas interfaces próprias sem ampliar esta entrega de enumeração.
