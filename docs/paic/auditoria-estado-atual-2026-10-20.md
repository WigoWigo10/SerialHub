# Auditoria do estado atual do SerialHub

Data: 20/10/2026 (America/Manaus). Auditoria local, sem commit, push ou alterações na implementação.

## Conclusão

O estado local compila e passa em 112 testes automatizados. O núcleo e a CLI continuam independentes de Tauri/WMI. Isso não comprova integração nativa Serial ou confiabilidade de todos os fluxos MQTT. Foram identificados problemas ainda não corrigidos no processamento de tópicos, seleção de TLS, cancelamento/isolamento de sessões MQTT, retenção de mensagens, apresentação HEX e classificação das portas.

Esta é uma auditoria do **diretório de trabalho atual**, que inclui a etapa 8 ainda sem commit. Os resultados não devem ser atribuídos integralmente ao checkout limpo de `fc4bf32`.

## Estado Git e escopo

- Branch: `feature/shared-core-cli`.
- HEAD e `origin/feature/shared-core-cli`: `fc4bf32b9012804cdc7d212354099c961fa2d506`. `git fetch origin` funcionou; divergência 0/0 e nenhum arquivo não mesclado (`git ls-files -u` vazio).
- Permanecem 11 arquivos rastreados modificados pela etapa 8, além de módulos, testes e documentos novos dessa etapa. O diff rastreado é de 272 inserções e 314 remoções; esse número não inclui arquivos novos.
- PDF, `leitor.py`, `leitor_diff.py` e `simulador_iot.py` continuam locais e não rastreados. Não foram incluídos em commit ou modificados nesta auditoria.
- Documentação examinada: registros das etapas 4 a 8 e evidência do inventário da etapa 6; referências das etapas anteriores já disponíveis no repositório. Não há AGENTS.md identificado no repositório/ancestrais examinados.
- Revisados comandos Serial e MQTT, ciclo de sessão Serial, gravação, estado global, árvore MQTT, configuração Tauri/Vite, manifests, enumeração e monitor CLI. Temas, credenciais e Dashboard foram cobertos também pelos testes existentes. Não foi realizada revisão exaustiva de cada componente, benchmark ou pentest.

## Achados prioritários

### A01 — Alta: tópicos MQTT podem provocar exceção e alterar o protótipo de objetos

**Confirmado por execução das funções reais em VM isolada.** `src/components/mqtt/TopicTree.tsx:35` cria dicionários com `{}`; linhas 45–48 consultam propriedades herdadas como se fossem nós. `buildTree` é chamado pelo `useMemo` na linha 248 durante renderização.

Com tópico `__proto__`, a função acessa `Object.prototype`, escreve metadados nele e lança `Cannot convert undefined or null to object` ao acessar os filhos. Com `constructor`, também ocorre exceção. Um tópico comum `sensor/temperature` funciona. O processamento de campos JSON usa o mesmo padrão de dicionário nas linhas 86–96 e precisa ser revisado junto.

Impacto: entrada MQTT pode interromper a renderização da árvore; não há ErrorBoundary em `App` para isolar esse erro. A mutação de protótipo foi comprovada dentro da VM. Não foi demonstrada execução de código nem exploração na aplicação em execução.

Correção sugerida: dicionários sem protótipo ou `Map`, consulta de propriedades próprias e testes para chaves herdadas tanto em tópicos quanto em JSON. Um ErrorBoundary pode limitar impacto visual, mas não corrige o parser.

### A02 — Alta: configuração TLS parcial pode resultar em transporte sem TLS

**Confirmado pelo caminho de código; handshake/rede não executados.** `mqtt_cmd.rs:132` só constrói TLS quando CA, certificado e chave estão simultaneamente presentes e não vazios. A UI permite CA sem certificado/chave (`MqttPage.tsx:324`) e considera qualquer caminho TLS como configuração de segurança (`:696`).

Com apenas CA e TCP em porta diferente de 8883, `tls_config` fica None e a linha 202 seleciona `Transport::Tcp`. Em WebSockets, a ausência da configuração completa seleciona `Transport::Ws` na linha 186, mesmo que haja um caminho CA configurado. Isso pode contrariar a indicação de segurança da interface e permitir transmissão de credenciais sem a proteção esperada, caso o destino aceite o transporte escolhido.

O fallback da porta 8883 usa TLS com CA vazia; isso não comprova validação de servidor nem sucesso de conexão. O comentário “Inseguro/Simple” não foi tratado como evidência de que a validação é desabilitada.

Correção sugerida: modo de transporte explícito, TLS com autenticação de servidor independente de mTLS opcional, validação de pares cert/key e rejeição de configuração inconsistente antes de conectar. Não fazer fallback silencioso para transporte simples.

### A03 — Alta: cancelamento MQTT não cancela o trabalho e eventos não identificam a sessão

**Falha de cancelamento confirmada por inspeção; corrida completa depende de teste integrado.** O botão Cancelar (`MqttPage.tsx:1034`) só executa `setIsConnecting(false)`. O timer de cinco segundos (`:569`) também só libera a UI; nenhum deles chama cancelamento no backend. A tentativa pode continuar e publicar `connected` depois do cancelamento/timeout.

O backend (`mqtt_cmd.rs:218–224`) substitui o cliente e inicia uma task sem guardar/aguardar seu handle nem invalidar explicitamente a tentativa anterior. Os eventos `mqtt-status`, `mqtt-error` e `mqtt-message` não têm identificador de sessão; o listener da linha 458 aceita o status recebido sem verificar origem. Uma tentativa antiga pode, portanto, interferir no estado de uma tentativa posterior. Além disso, erro no event loop não limpa o cliente no estado compartilhado como parte de uma transição ordenada.

Correção sugerida: supervisor/token por sessão, cancelamento real e término da task anterior antes de substituição, snapshot global ordenado e filtro de eventos obsoletos, como no desenho Serial da etapa 7. Acrescentar testes para cancelar, timeout, nova tentativa e notificações tardias.

### A04 — Média: histórico MQTT sem limite

**Confirmado por inspeção.** `MqttPage.tsx:412` acrescenta cada mensagem ao array inteiro sem limite. A árvore reprocessa esse histórico no `useMemo` de `TopicTree.tsx:248`, embora apresente valores atuais por tópico. Os gráficos têm limite de 100 pontos, mas isso não limita o array `messages`. A página permanece montada depois do primeiro uso, inclusive quando oculta.

Impacto comprovado pelo contrato: retenção cresce conforme chegam mensagens. Não foram medidos travamento, vazão, latência ou consumo em uma sessão longa; não se declara regressão de desempenho medida.

Correção sugerida: separar último valor por tópico de histórico limitado; definir política de retenção e testar seus limites.

### A05 — Média: modo HEX MQTT não representa os bytes recebidos

**Confirmado com função real.** `TopicTree.tsx:28` usa `charCodeAt`, produzindo `E9` para `é`; a codificação UTF-8 correspondente é `C3 A9`. Antes disso, `mqtt_cmd.rs` já converte bytes com `String::from_utf8_lossy`, perdendo representação exata de payload binário inválido em UTF-8.

Correção sugerida: transportar os bytes originais separadamente e derivar texto/HEX deles. A decisão de suportar payload binário deve ser explícita. Não usar conversão de código UTF-16 como se fosse captura HEX do payload.

### A06 — Média: “Virtual” não confirma que a porta é virtual

**Confirmado na enumeração local e por inspeção.** `crates/serialhub-core/src/lib.rs` mapeia `SerialPortType::Unknown` para `Virtual`, preservando o contrato antigo. A CLI listou COM3, COM16, COM17, COM23 e COM24 como Virtual. O inventário PnP identifica COM3 como Intel AMT SOL e as outras quatro como BTHMODEM/Bluetooth. Esses nomes não comprovam um par virtual de teste.

Impacto: classificação pode induzir seleção incorreta para testes. O script da etapa 6 continua exigindo confirmação por com0com/PnP e excluindo COM3; nenhuma dessas portas foi aberta nesta auditoria.

Correção sugerida: representar Unknown como desconhecida e reservar “virtual” para detecção positiva; atualizar GUI/CLI/testes em conjunto, mantendo metadados úteis do Windows separados da enumeração portátil se necessário.

### A07 — Alta segundo npm audit: dependências de desenvolvimento com avisos de segurança

O registry consultado por `npm audit --json` reportou **16 entradas: 12 altas, 3 moderadas e 1 baixa**, sem crítica. São entradas de pacote do relatório, não uma contagem de explorações confirmadas. Entre as diretas aparecem Vite, TailwindCSS e PostCSS. `npm audit --omit=dev --json` retornou **zero**.

Isso exige atualização planejada da cadeia de build/dev e análise dos avisos por contexto; não demonstra vulnerabilidade explorável no bundle Tauri distribuído. Algumas correções sugeridas pelo npm envolvem mudança de versão major. Não foi executado `npm audit fix`, instalado pacote ou alterado lockfile.

Relatórios completos preservam nomes, advisory URLs, versões/faixas e propostas do registry. O `cargo-audit` não está instalado; a auditoria de advisories dos lockfiles Rust permanece pendente.

## Riscos e limitações, separados dos bugs confirmados

- **Logging Serial síncrono:** escrita/flush ocorre no leitor, com mutex. Disco ou driver bloqueado pode atrasar leitura e encerramento. Testes verificam ordenação, erros e liberação em transporte simulado; não existe medição de saturação nem garantia de prazo rígido. Não se atribui ganho/perda de desempenho sem medição.
- **Eventos de dados Serial:** snapshots de conexão têm revisão/sessão, e envio/pinos usam sessão esperada. Os payloads legados de dados/contadores ainda não carregam session_id. Entrega atrasada na ponte de eventos merece teste adicional, sem confundir com as falhas antigas já isoladas pelo supervisor.
- **Monitoramento frontend:** falha de inscrição/consulta do estado é registrada em console; não há reconciliação periódica/retry automático nesses hooks. Com falha da ponte, o estado pode ficar desatualizado. Não foi reproduzida falha real do IPC nesta auditoria.
- **CSP desabilitada:** `src-tauri/tauri.conf.json:26` contém `csp: null`. É uma lacuna de defesa em profundidade; não foi demonstrado XSS. Privilégios IPC e política de conteúdo merecem revisão específica antes de distribuição.
- **Encoding residual:** o copyright no tauri.conf.json contém `Â©`; problema de metadado localizado, apesar dos testes de textos/temas aprovados. Não se conclui que toda a aplicação ainda tenha o mesmo problema.
- **Automação:** há testes Node, Rust e Python, mas não há workflow `.github` identificado nem script `npm test`. A execução documentada é manual. Há verificações estáticas de wiring; elas não equivalem a teste de renderização/driver.
- **Taxa do Dashboard:** a telemetria do backend é publicada a cada 500 ms; os Hz configurados controlam animação/apresentação. Não representam aquisição de sensores a 120 Hz nem a taxa de leitura Serial.
- **Reprodução:** não foi criado outro checkout limpo nesta auditoria nem reinstaladas dependências com npm ci. Os builds usam os arquivos e dependências locais existentes; os manifests Cargo foram usados com `--locked`. Não foi gerado instalador nem testada instalação/distribuição.

## Verificações executadas

Todos os comandos abaixo foram executados na raiz do projeto no Windows/PowerShell. Nenhum abriu porta Serial ou conectou a broker.

| Comando | Resultado |
|---|---|
| `git status`, `git branch -vv`, `git fetch origin`, `git rev-list --left-right --count HEAD...origin/feature/shared-core-cli`, `git ls-files -u` | Branch sincronizada, 0/0, sem conflito ativo; alterações locais preservadas |
| `node --test tests/*.test.mjs` | 42 aprovados |
| `python -m unittest discover -s tests -p test_serial_integration.py` | 13 aprovados; testes do harness, não integração Serial nativa |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | 19 aprovados |
| `cargo test --locked --manifest-path crates/serialhub-core/Cargo.toml` | 13 aprovados |
| `cargo test --locked --manifest-path crates/serialhub-cli/Cargo.toml` | 21 unitários + 4 de integração aprovados |
| `cargo build --locked --manifest-path crates/serialhub-core/Cargo.toml` | Aprovado |
| `cargo build --locked --manifest-path crates/serialhub-cli/Cargo.toml` | Aprovado |
| `cargo check --locked --manifest-path src-tauri/Cargo.toml` | Aprovado |
| `npm run build` | Aprovado; JS principal 971,26 kB / gzip 271,26 kB; avisos de chunk acima de 500 kB e Browserslist desatualizado |
| `cargo tree --locked --manifest-path crates/serialhub-core/Cargo.toml --prefix none` e equivalente CLI | Sem dependências Tauri/WMI nas árvores examinadas |
| `crates/serialhub-cli/target/debug/serialhub.exe --help`, `--version`, `ports`, `ports --json` | Todos código 0; stdout JSON interpretado como array; somente enumeração |
| `node docs/paic/evidencias/auditoria-estado-atual-probes.mjs` | Reproduziu A01 e A05 com funções reais em VM isolada; não modificou protótipo do processo da aplicação |
| `npm audit --json` | Código 1; 16 entradas no relatório completo |
| `npm audit --omit=dev --json` | Código 0; zero entradas |
| `cargo audit --version` | Indisponível: `no such command: audit`; auditoria Rust não realizada |
| `python -B scripts/serial_integration.py inventory --output docs/paic/evidencias/auditoria-estado-atual-portas` | Inventário somente leitura, sem executar monitor |
| `git diff --check` | Aprovado; avisos informativos de normalização LF/CRLF |

**112 testes aprovados, zero falhas de teste.** O retorno 1 do npm audit representa os avisos de dependências; não é falha de compilação. Os probes são reproduções adicionais, não foram contados como testes aprovados da suíte. Artefatos pyc gerados pelo unittest foram removidos por caminho explícito; arquivos do usuário não foram apagados.

## Evidências e próximos passos

Novos arquivos desta auditoria: este documento, `evidencias/auditoria-estado-atual-probes.mjs` e `.json`, `auditoria-estado-atual-cli.json`, `auditoria-estado-atual-npm-completo.json`, `auditoria-estado-atual-npm-producao.json` e a pasta de inventário `auditoria-estado-atual-portas`. Nenhum arquivo de implementação foi alterado nesta auditoria.

Ordem sugerida: corrigir A01 e A02 com regressões determinísticas; dar às sessões MQTT cancelamento e isolamento equivalentes aos do Serial; atualizar dependências dev em mudança separada com reprodução limpa; corrigir classificação Unknown/HEX e definir retenção MQTT.

Continuam pendentes ensaios com par virtual confirmado (recepção binária, duração, Ctrl+C Windows nativo e código 130, reabertura, conexão/reconexão na GUI, perda de conexão e gravação durante encerramento), integração com broker local controlado para TLS/cancelamento/sessões e testes manuais de diálogo/clipboard. Inventário e testes simulados não aprovam esses cenários nativos. Nenhum equipamento físico foi utilizado, nenhum driver instalado e nenhum commit/push/merge realizado.
