# Correção A06 — classificação de portas desconhecidas

Data: 20/10/2026, America/Manaus. Branch `feature/shared-core-cli`, HEAD `e7a8235`. Trabalho local, sem commit, push, merge ou atualização de dependências.

## Referência e preservação

Lidos a auditoria e os registros das etapas 2, 3 e 6, incluindo a identificação histórica de COM3 como Intel AMT SOL. Inspecionados núcleo, CLI, comando Tauri, monitor de hotplug, Sidebar e persistência. Não foi encontrado AGENTS.md no repositório/ancestrais até `C:\`. Conferidos status, branch e diff.

Registrados hashes SHA-256 de 199 arquivos iniciais em `%TEMP%\serialhub-a06-baseline.json`. Ao final, **195 permaneceram idênticos**; somente os quatro arquivos existentes de núcleo, CLI, Sidebar e traduções receberam alterações A06. Todas as correções MQTT, retenção/fila A04, bytes A05, arquivos Serial da etapa 8 fora da Sidebar, documentos/evidências anteriores, PDF e scripts foram preservados. Na Sidebar, os fluxos anteriores de sessão, gravação e varredura ordenada continuam intactos. Traduções anteriores preservadas, exceto a correção intencional do texto `serial_native` em três idiomas e a inclusão de dois rótulos. Índice vazio.

## Causa e percurso

`SerialPortInfo::from` no núcleo convertia `serialport::SerialPortType::Unknown` para a string **Virtual**. Era uma suposição: o tipo significa que a biblioteca não conseguiu determinar a conexão, não que reconheceu virtualização.

```text
serialport::available_ports
  → serialhub_core::list_ports / SerialPortInfo::from
  → comando Tauri list_ports → Sidebar
  → monitor de hotplug → ports-changed → nova consulta list_ports
  → CLI ports / ports --json
```

Os três consumidores já usam o mesmo núcleo. O comando Tauri conserva o modelo e traduz somente erros para `Erro: ...`; o hotplug compara nomes e solicita nova enumeração quando eles mudam. Não havia uma classificação independente nesses caminhos. CLI JSON serializa diretamente o modelo do núcleo.

A Sidebar também usava texto **Porta Serial Nativa/Virtual** como tooltip de qualquer dispositivo não USB, incluindo Bluetooth. Isso foi corrigido para mostrar o tipo recebido, traduzido, junto aos metadados disponíveis. O grupo não USB continua aceitando todos esses tipos, inclusive desconhecidos.

## Classificação atual

| Tipo informado pela biblioteca | JSON/núcleo | GUI pt-BR | CLI texto |
|---|---|---|---|
| `UsbPort` | `USB` | USB + produto quando disponível | USB |
| `BluetoothPort` | `Bluetooth` | Bluetooth | Bluetooth |
| `PciPort` | `Native` | Porta serial nativa (PCI) | Native |
| `Unknown` | **`Unknown`** | **Desconhecida** | **Desconhecida** |

Não há inferência por nome COM, descrição contendo “Virtual”, ausência de VID/PID/produto, Intel AMT SOL ou nome contendo Bluetooth. Uma porta Bluetooth identificada como `Unknown` pela biblioteca continua desconhecida neste contrato. PCI só recebe `Native` quando a biblioteca informa `PciPort`.

O núcleo continua independente de Tauri/WMI e não ganhou heurísticas, consultas de hardware adicionais, suporte Bluetooth, dependências, drivers ou operações de comunicação. Nenhuma porta foi aberta nesta correção.

### Metadados e descrições

Na biblioteca instalada/lockada, `serialport 4.9.0`, `SerialPortInfo` contém nome e enum de tipo; metadados de fabricante/produto/VID/PID pertencem à variante USB. `Unknown` não fornece descrição genérica/friendly name por esse modelo. Por isso as portas reais desconhecidas podem continuar com esses campos vazios: não foi removida uma descrição anteriormente fornecida pelo núcleo, nem inventada uma descrição Intel/AMT a partir do número da porta.

Os campos existentes permanecem: `port_name`, `port_type`, `vid`, `pid`, `manufacturer`, `product`. USB continua com VID/PID hexadecimal de quatro dígitos e strings vazias quando fabricante/produto estiverem ausentes. A ordem da enumeração, resultado vazio e tipos/mensagens de erro foram preservados.

Quando há `product`/`manufacturer` no modelo entregue ao consumidor, eles são mantidos literalmente na CLI e na GUI. A GUI mostra **tipo + descrição**, sem trocar a classificação pela descrição. Exemplo simulado: `Desconhecida — Intel(R) Active Management Technology - SOL`. O tooltip inclui os demais metadados disponíveis. Esses casos simulados não significam que a enumeração real retornou essa descrição.

## Compatibilidade

**Mudança observável no JSON:** somente o valor da classificação de entradas desconhecidas muda de `"Virtual"` para `"Unknown"`. As seis chaves, seus tipos string e os demais valores não mudam. Não foi acrescentado campo nem alterado formato de array/erros/códigos de saída.

Antes:

```json
{"port_name":"COM3","port_type":"Virtual","vid":"","pid":"","manufacturer":"","product":""}
```

Agora:

```json
{"port_name":"COM3","port_type":"Unknown","vid":"","pid":"","manufacturer":"","product":""}
```

Consumidores externos que tratavam `Virtual` como enum fixo devem aceitar `Unknown` como ausência de classificação. Relatórios/JSON antigos não foram regravados nem convertidos: são evidências históricas do comportamento anterior e não comprovam virtualização.

Não foi encontrada persistência de classificação de portas: a lista é estado local da Sidebar, atualizada por enumeração; `settingsStore.partialize` persiste preferências visuais e não a lista nem `port_type`; perfis MQTT não armazenam essa classificação. Portanto não foi necessária migração de configurações nem exclusão de campos.

Para compatibilidade de apresentação com backend/dados antigos, a GUI aceita explicitamente `Virtual` e mostra **Virtual (classificação legada não verificada)**, com ícone de classificação desconhecida. Não reescreve o objeto para `Unknown` nem o apresenta como uma porta virtual confirmada. Valores futuros não reconhecidos ficam visíveis como `Desconhecida (valor recebido)`. Uma nova enumeração do núcleo atualizado fornece o tipo atual.

## Arquivos alterados

- `crates/serialhub-core/src/lib.rs`: mapeamento Unknown, documentação e testes.
- `crates/serialhub-cli/src/cli.rs`: tradução de Unknown no modo texto e testes dos dois modos; JSON continua serialização direta do núcleo.
- Novo `src/lib/serialPorts.ts`: contrato TypeScript e apresentação de tipo/metadados/compatibilidade legada.
- `src/components/layout/Sidebar.tsx`: usa o contrato/helper, rótulos/tooltip corretos e ícone `HelpCircle` para tipo não confirmado; preserva filtros USB/outros e lógica anterior de conexão/gravação.
- `src/i18n/translations.ts`: desconhecida e legado não verificado em pt-BR/en-US/es; `serial_native` agora descreve somente PCI nativa.
- Novo `tests/fixtures/serial-ports.json`: fixture compartilhada de tipos/metadados, conferida contra a conversão real do núcleo.
- Novo `tests/serial-ports.test.mjs`: apresentação real e contratos dos consumidores.
- Este documento.

Não foi necessário editar comandos Tauri, hotplug ou persistência: já delegam ao núcleo/não armazenam classificação. Não foram alterados manifests/lockfiles.

## Testes simulados e compilação

| Comando | Resultado final |
|---|---|
| `cargo test --locked --offline --manifest-path crates/serialhub-core/Cargo.toml` | **15 aprovados**, incluindo dois novos A06 e contrato de erros/ordem/USB sem metadados |
| `cargo test --locked --offline --manifest-path crates/serialhub-cli/Cargo.toml` | **27 aprovados**: 23 unitários + 4 de processo; dois novos testes A06 |
| `cargo build --locked --offline --manifest-path crates/serialhub-cli/Cargo.toml` | **Aprovado** |
| `node --test tests/*.test.mjs` | **160 aprovados**, incluindo sete novos A06 e todas as regressões MQTT/Serial anteriores |
| `cargo test --locked --offline --manifest-path src-tauri/Cargo.toml` | **42 aprovados** |
| `npm run build` | **Aprovado**, após corrigir nome do ícone; avisos anteriores de Browserslist/chunk |
| `cargo check --locked --offline --manifest-path src-tauri/Cargo.toml` | **Aprovado** |
| `git diff --check` | **Aprovado**, avisos informativos LF/CRLF |

Na primeira compilação frontend, `CircleHelp` não existia na versão instalada de lucide-react. Corrigido para `HelpCircle`, já disponível; nenhuma dependência foi atualizada. Compilação final aprovada.

Casos determinísticos: Unknown com nomes COM/Linux/genéricos; USB com e sem metadados; Bluetooth; PCI; descrições Intel AMT SOL/Virtual/Bluetooth que não autorizam inferência; campos preservados; rótulo legado não verificado; tipo futuro; filtros USB/outros; classificações não persistidas; erros de enumeração e resultado vazio dos testes existentes.

A fixture JSON compartilhada é verificada byte/campo a campo contra a conversão de `serialport::SerialPortInfo` no núcleo. CLI e GUI usam a mesma fixture nos testes de consumidores. Frontend renderiza as funções reais `portIcon`/`PortButton` por React DOM Server em VM, com traduções reais e adaptadores para ícones. Não executa cliques nem conecta dispositivos. Verificações de delegação Tauri/hotplug/CLI e persistência são identificadas como estáticas; não substituem teste visual/native hotplug.

## Enumeração real no Windows — somente leitura

Executado o binário recém-compilado, capturando stdout/stderr por `subprocess.run` Python e decodificando UTF-8. JSON validado com `json.loads`; códigos de saída e seis chaves de cada objeto conferidos. Comandos:

```powershell
crates/serialhub-cli/target/debug/serialhub.exe ports
crates/serialhub-cli/target/debug/serialhub.exe ports --json
```

Ambos retornaram **0**, com stderr vazio. Resultado em texto, na ordem informada pelo sistema:

```text
COM24 (Desconhecida)
COM16 (Desconhecida)
COM3 (Desconhecida)
COM23 (Desconhecida)
COM17 (Desconhecida)
```

JSON: cinco objetos, todos com `port_type: "Unknown"`; VID/PID/fabricante/produto vazios. Isso é a classificação realmente disponível pela biblioteca, não prova que sejam todos dispositivos do mesmo tipo. O inventário anterior identifica COM3 como Intel AMT SOL e outras portas como BTHMODEM, mas esses dados não estão disponíveis neste modelo portátil; não foram usados como heurística nova.

**COM3 não foi aberta. Nenhuma dessas portas foi aberta, lida ou usada para transmissão. Não foi confirmado par virtual nem executado monitor Serial real.** Testes de leitura/escrita da suíte utilizam transportes simulados; testes MQTT de loopback anteriores continuam separados disso.

## Pendências e limites

- Inspeção visual no WebView Windows e hotplug físico real ainda pendentes; SSR/wiring não equivalem à operação visual completa.
- USB/Bluetooth/PCI foram cobertos por entradas simuladas da biblioteca, não por equipamentos adicionais conectados nesta tarefa.
- Não há detecção positiva de virtualização nesta correção. Um par virtual precisa ser confirmado pelas duas portas e por sua ferramenta/driver, conforme etapa 6; o rótulo de enumeração não basta.
- Descrições genéricas/friendly names de dispositivos não USB exigiriam outra fonte/API e projeto separado. Não foram acrescentados WMI nem heurísticas ao núcleo.
- Sem commit, push, merge, instalação de drivers ou atualização de dependências. Correções MQTT e demais alterações locais preservadas.
