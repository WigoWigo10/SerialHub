# Correção A04 — retenção limitada do estado MQTT

Data: 20/10/2026, America/Manaus. Branch atual `feature/shared-core-cli`; HEAD `e7a8235`. A05 e alterações Serial/etapa 8 já estavam locais e foram preservadas. Sem commit, push ou merge nesta tarefa.

## Leitura, referência e preservação

Lidos a auditoria e os registros A01, A02, A03 e A05; conferidos status, branch e diff. Nenhum AGENTS.md encontrado no repositório/ancestrais até `C:\`.

Antes de editar, registrados SHA-256 de 192 arquivos versionados e locais em `%TEMP%\serialhub-a04-baseline.json`. Sete arquivos de integração/testes MQTT receberam alterações intencionais; os demais 185 permanecem idênticos. As traduções Serial/etapa 8 e MQTT A02/A03/A05 anteriores foram preservadas. Backend A05, contrato `payload_bytes`, TLS, credenciais, comandos, lockfiles, documentação/evidências anteriores, PDF e scripts locais não foram editados. O índice continua vazio.

## Diagnóstico do percurso anterior

```text
rumqttc → evento com sessão/sequência/bytes → monitor global A03
        → mqttSessionStore.messages sem limite
        → TopicTree.buildTree(todo o histórico) a cada alteração
        → MqttPage: cursor baseado no comprimento do array, processamento dos novos itens
          → chartHistory: 100 amostras por chave, mas chaves ocultas não eram removidas
```

- Cada publicação criava uma cópia do array inteiro de mensagens e era mantida indefinidamente, inclusive com a página oculta.
- A árvore exibia somente o último valor, mas reconstruía tópicos e JSON percorrendo todas as publicações. Repetia decodificação UTF-8 e parsing de dados antigos.
- Limitar o array sem mudar o cursor `processedMessages` impediria atualizações de gráficos quando o tamanho deixasse de crescer. O cursor foi removido.
- A inicialização de gráficos copiava/revertia o histórico para localizar o último valor. As séries tinham 100 pontos, mas ocultar gráficos removia apenas a seleção visível; as chaves antigas continuavam recebendo pontos.
- A05 já copiava os bytes recebidos para propriedade do store e derivava texto; a árvore também derivava texto. Campos JSON objeto eram serializados durante construção, duplicando strings de subárvores.
- A lista de assinaturas exibidas não possuía limite de quantidade.

O crescimento do contrato foi confirmado por inspeção. Não se mediu consumo de CPU/RAM, travamento ou vazão; os resultados abaixo são limites do estado retido, não medições de desempenho.

## Limites centralizados

Todos estão em `src/lib/mqttLimits.ts`, sem novas dependências ou preferências persistidas.

| Coleção/entrada | Valor inicial | Motivo/política |
|---|---:|---|
| Histórico | 500 publicações | Janela recente finita; inclui payload vazio |
| Histórico: soma dos payloads | 2 MiB (2.097.152 bytes) | Complementa contagem para publicações grandes |
| Últimos valores | 256 tópicos com publicação própria | Limita tópicos inéditos sucessivos, inclusive payloads vazios |
| Últimos valores: soma dos payloads | 4 MiB (4.194.304 bytes) | Orçamento independente da janela histórica |
| Uma publicação retida | 256 KiB (262.144 bytes) | Evita que uma publicação monopolize os orçamentos; rejeição integral acima disso |
| Nome de tópico/filtro | 1.024 bytes UTF-8 e 32 níveis | Limita metadados e profundidade dos caminhos, incluindo níveis vazios |
| Gráficos rastreados | 3 séries no total | Não há séries ocultas acumuladas |
| Amostras de cada série | 100 | Mantém a janela anterior; máximo de 300 pontos numéricos |
| Assinaturas exibidas | 128 filtros distintos | Metadados limitados também por nome/profundidade |
| Expansão visual JSON | 256 nós virtuais por tópico, 8 níveis | Limita estrutura derivada; indica visualmente a expansão incompleta |

São valores iniciais conservadores para inspeção de telemetria, ajustáveis centralmente no código após ensaio com cargas reais. **Não são limites do protocolo MQTT.** O backend continua aceitando pacotes segundo o limite de 1 MiB já configurado; esta etapa decide o que conservar no frontend, sem alterar conexão, ACK, assinatura ou envio MQTT.

**Contagem de payload não mede memória total.** Arrays JavaScript de números, texto UTF-16, nós, nomes, caminhos, metadados, parsing temporário, React e IPC têm custos adicionais. Histórico e últimos valores podem compartilhar a mesma mensagem/array de bytes; seus orçamentos são lógicos e independentes, e sua soma não é uma medida de RAM. Nomes/profundidades e estruturas derivadas também têm limites, sem promessa de um teto em bytes para o processo.

## Arquitetura e descarte

```text
evento válido da sessão atual, com sequência nova e payload_bytes
  → validação do contrato A05 e da retenção
  → cópia própria e íntegra do payload; apresentação TXT derivada
  → histórico FIFO limitado por quantidade E bytes
  → Map de últimos valores limitado por quantidade E bytes
  → atualização imutável somente do caminho do tópico recebido
  → atualização das séries selecionadas, com janela de 100 amostras
```

### Três decisões diferentes

1. **Histórico cheio:** remove publicações completas mais antigas até satisfazer os dois limites. Incrementa `discards.history` por mensagem. Não remove o último valor do tópico, não limpa seus gráficos e não trunca payload.
2. **Últimos valores cheios:** remove o tópico há mais tempo sem atualização aceita. A ordem é a de atualização do `Map`, independente do relógio de parede; atualizar tópico existente o move para o final. Incrementa `discards.topics`. Remove seu payload da árvore, campos JSON, séries e seleção associada. Preserva subtópicos reais ainda retidos e poda grupos vazios.
3. **Publicação grande/nome fora do limite:** não entra no histórico, nos últimos valores, na árvore ou nos gráficos. Incrementa `discards.payloads` ou `discards.topicShape`. A sequência é consumida para impedir replay. Não há texto/HEX parcial; para o mesmo tópico, permanece o **último valor retido anteriormente**, com seu timestamp antigo. O contador informa que chegou uma publicação não conservada.

Contratos de bytes inválidos, eventos antigos, duplicados ou de sessão desconectada continuam rejeitados pelos filtros A03/A05; não são contados como descartes normais de retenção. Contadores saturam em `Number.MAX_SAFE_INTEGER`, sem coleções auxiliares crescentes. Contam descartes automáticos da sessão; limpezas manuais não incrementam nem zeram esses contadores.

Evictar o último valor não exige apagar a mesma publicação da janela histórica independente. Se ainda estiver no histórico, seus bytes continuam legitimamente retidos dentro do orçamento histórico. Não se mantém cópia extra na árvore ou nos gráficos após remover o tópico. Ao sair de ambos os conjuntos, a aplicação deixa de referenciar o payload pelo estado corrente; não foi medido quando o coletor de lixo devolve memória ao sistema.

### Árvore incremental e derivados

`mqttTree.ts` reúne os modelos/funções reais antes locais em `TopicTree.tsx`. O redutor recebe uma publicação, constrói somente esse caminho/JSON e o incorpora por cópia dos nós do caminho. Ramos não alterados preservam identidade. Não reexecuta publicações históricas nem reconstrói a árvore completa a partir delas. Remoção de tópico limpa seus metadados e JSON, preserva filhos reais retidos e poda o caminho quando vazio.

A árvore mantém dicionários sem protótipo, consultas próprias, filhos MQTT separados de campos JSON e identidades React distintas do A01. Nomes como `__proto__`, `constructor`, `prototype`, `toString`, `hasOwnProperty`, metadados novos e níveis vazios continuam literais. Os novos limites são de tamanho/profundidade, não uma blacklist de nomes.

A expansão JSON aplica orçamento de nós/profundidade por publicação. O nó mostra `…` com tooltip quando a visualização foi limitada. **O payload não é truncado**: cópia TXT do tópico e HEX continuam completos. Objetos JSON derivados não ficam retidos como subárvores parseadas ou como strings serializadas repetidas: para copiar um campo objeto, conserva-se uma referência ao texto de origem e um caminho limitado; parsing e serialização ocorrem no clique. Falhas de cópia, inclusive JSON extremamente profundo, são capturadas e não geram confirmação falsa. Strings/números expandidos são apresentações derivadas; HEX continua reservado a publicações reais, conforme A05.

O renderer ainda percorre/ordena os nós retidos para apresentar a árvore. As atualizações ainda copiam estruturas **limitadas** de histórico/Map/amostras e fazem parsing da publicação recebida. Não se afirma complexidade constante nem ganho medido de CPU.

### Gráficos e assinaturas

Séries foram movidas da página para o store global. A atualização ocorre por evento admitido, mesmo com a página desmontada/oculta e depois que o histórico atinge o limite. Inicialização consulta o último valor retido, sem copiar/inverter histórico. As séries mantêm somente origem, caminho de campo e pontos numéricos, sem referências a mensagens ou arrays de payload.

Ocultar/parar/remove seleção **libera a série**; voltar a selecionar começa no último valor disponível. Não há aquisição de gráficos ocultos. Evicção do tópico, limpeza de últimos valores ou nova sessão remove suas séries. Campo JSON removido, binário, não numérico ou fora da expansão limitada também remove a série desse campo. Tópico direto temporariamente não numérico não acrescenta pontos; pode voltar a produzir pontos numéricos dentro da mesma série. Só números finitos ou strings numéricas são admitidos: substituir um campo por objeto com `toString`/`constructor` literais não causa coerção insegura nem quebra a recepção.

O contrato textual `tópico.campo` dos gráficos foi preservado; a ambiguidade já documentada entre pontos literais em nomes e campos não foi redesenhada. O limite de três agora conta todas as séries retidas, não apenas as visíveis.

A UI impede novas assinaturas ao atingir 128 filtros ou ultrapassar tamanho/profundidade; o store também protege quantidade e identidade de sessão. Remover uma assinatura libera sua entrada; sair de conectado limpa as assinaturas. Isso limita o estado exibido, sem redesenhar operações concorrentes de subscribe/SUBACK ou a gestão de assinaturas pelo broker.

## Limpeza, sessão e interface

| Ação | Histórico | Últimos valores/árvore | Gráficos | Sequência/contadores |
|---|---|---|---|---|
| Limpar histórico (lixeira) | Esvazia mensagens e bytes | Preserva | Preserva | Preserva; não permite replay |
| Limpar tópicos e gráficos | Preserva | Esvazia | Esvazia | Preserva; não permite replay |
| Desconectar/erro/timeout terminal | Preserva para inspeção | Preserva para inspeção | Congela | Nenhuma nova mensagem é aceita |
| Nova identidade/tentativa | Esvazia | Esvazia | Esvazia | Reinicia sequência e contadores da nova sessão |
| Trocar/desmontar página | Preserva dentro dos limites | Preserva | Atualiza pelo store global | Listener continua na raiz App |

Reconectar agora inicia inspeção vazia na reserva da **nova identidade**, mesmo que a conexão venha a falhar. Isso evita misturar brokers/sessões; difere do histórico acumulado entre sessões anterior. O backend, TLS, credenciais e protocolo de estado A03 não mudaram. Eventos/snapshots atrasados da identidade anterior não podem preencher nem limpar a nova inspeção.

No Explorer aparecem quantidade/bytes de histórico e tópicos, seus limites e contadores separados de mensagens removidas, tópicos removidos, payloads grandes rejeitados e tópicos longos/profundos rejeitados. Há botão distinto para limpar tópicos e gráficos. Tooltip explica que `B` contabiliza apenas payload e que os descartes são da sessão.

## Arquivos desta alteração

Novos:

- `src/lib/mqttLimits.ts`: limites e validação de tamanho/profundidade de nomes.
- `src/lib/mqttRetention.ts`: redutor de retenção, descarte, gráficos e contadores.
- `src/lib/mqttTree.ts`: modelo, processamento protegido, atualização/poda incremental e expansão limitada.
- `tests/mqtt-retention.test.mjs`: contratos de retenção com volumes finitos.
- Este registro.

Integração: `mqttSessionStore.ts`, `MqttPage.tsx`, `TopicTree.tsx`, traduções e testes MQTT A01/A03/A05 existentes. Os testes anteriores foram adaptados aos módulos reais extraídos e ao reset por nova sessão; as duas verificações de gráficos A01 foram reunidas preservando casos de nomes literais e propriedades herdadas. A05 continua cobrindo byte a byte, modos TXT/HEX, renderização SSR e cópia.

## Validação automatizada — entrega inicial

| Comando/verificação | Resultado |
|---|---|
| `node --test tests/mqtt-retention.test.mjs` | 17 casos determinísticos A04 aprovados na suíte final |
| `node --test tests/*.test.mjs` | **133 aprovados**, zero falhas; regressões MQTT/Serial/temas/Dashboard |
| `npm run build` | **Aprovado**; avisos preexistentes Browserslist antigo e chunk acima de 500 kB |
| `cargo check --locked --offline --manifest-path src-tauri/Cargo.toml` | **Aprovado**, backend e A05 locais preservados |
| `git diff --check` | **Aprovado**; avisos informativos LF/CRLF |
| Hashes do estado anterior | 185/192 idênticos; sete arquivos MQTT/testes/traduções alterados intencionalmente |

Testes verificam cada orçamento de contagem/bytes, atualização repetida do mesmo tópico, tópicos distintos e vazios, LRU por atualização, publicação binária/vazia/grande, limites de metadados e expansão JSON, preservação do último valor quando a mensagem sai do histórico, ramos imutáveis/pruning, bytes completos, liberação de gráficos órfãos, limite de séries/amostras/assinaturas, limpezas independentes, desconexão/reconexão e proteção contra eventos antigos. As verificações de orçamento calculam os totais realmente retidos; não dependem de hardware, broker público ou duração de um teste de carga.

O backend não recebeu mudanças nesta etapa. As 42 regressões Rust da A05 já estavam aprovadas com os mesmos arquivos; não foram repetidas como se fossem novos testes A04. A validação backend executada nesta tarefa foi `cargo check`.

## Inspeção visual e ensaio prolongado — pendentes

- Inspeção visual no WebView Windows dos contadores, avisos de expansão, limpezas, gráficos e troca de página sob recepção real. Testes SSR da árvore e verificações estáticas de wiring não substituem essa inspeção.
- Ensaio prolongado com broker controlado para diferentes distribuições de tópicos/tamanhos; medir CPU, RAM, latência, GC e comportamento da interface. Nenhuma dessas métricas foi medida/aprovada aqui.
- Validar se os limites iniciais atendem à telemetria do projeto; ajustar centralmente com evidência e sem chamar um orçamento de payload de memória total.

## Filas e tarefas fora da retenção — diagnóstico inicial

Na entrega inicial foi identificada separadamente a fila temporária `queued` em `startMqttMonitor`, então em `mqttSession.ts`, enquanto aguardava inscrição/snapshot inicial. Ela não tinha orçamento: IPC bloqueado, com mensagens chegando, podia fazê-la crescer antes da admissão pelo store. **Essa pendência foi concluída na complementação abaixo.** A distinção entre estado retido, fila da ponte e filas internas do runtime continua necessária; não se declara todo o pipeline/processo limitado em memória.

Filas internas do runtime Tauri/WebView/OS e buffers transitórios rumqttc também não são cobertos pelos limites do estado retido. A fila de requisições do AsyncClient já usa capacidade 100 e pacotes de 1 MiB; isso não limita filas de eventos do frontend. Tarefas, deadlines e cleanup continuam os do A03; não foram criadas novas tasks, timers ou filas por publicação nesta correção.

Perfis salvos, entrada de publicação e configurações editadas pelo usuário não foram redesenhados; não crescem como histórico de publicações recebidas. Nenhuma dependência foi atualizada. Sem commit, push ou merge.

## Complementação — fila limitada e reconciliação inicial

Ainda em 20/10/2026, na mesma branch e HEAD, preservando todas as alterações locais A04/A05 e Serial anteriores. Conferidos Git e AGENTS.md quando existente; novamente nenhum encontrado. Snapshot de preservação: `%TEMP%\serialhub-a04-sync-baseline.json`, 197 arquivos iniciais. Esta complementação não faz commit, push, merge nem atualiza dependências.

### Ordem de inscrição e sincronização

`startMqttMonitor` foi movido para `src/lib/mqttMonitor.ts`, com reexportação em `mqttSession.ts` para manter os consumidores.

1. Publica fase `syncing`, inicia deadline e solicita os listeners de estado e mensagens. Callbacks já podem chegar enquanto as promessas de inscrição terminam.
2. **Estados e erros são aplicados imediatamente**, comparando identidade/revisão com o estado global, sem ocupar a fila de publicações. Uma falha de comunicação não fica escondida atrás de dados nem é descartada por falta de espaço nessa fila.
3. Publicações válidas ficam no buffer, sem copiar/decodificar payload. A consulta `mqtt_connection_state` só começa depois de ambas as inscrições confirmadas. Uma única consulta por inscrição, sem retry automático.
4. Aplica o snapshot somente se ainda for mais recente que o estado observado/global; um snapshot antigo não regride uma transição já recebida.
5. Marca a ponte `live` e drena publicações por sessão e sequência, consultando novamente o estado a cada item. Estados terminais e identidades substituídas invalidam seus dados pendentes. A aplicação da fila é síncrona e protegida contra drain reentrante.
6. Em modo ao vivo, mensagens prontas seguem diretamente para o store A04/A05. Se uma mensagem chegar antes de seu estado correspondente, usa o mesmo buffer limitado e um prazo finito para aguardar o estado; não é aplicada prematuramente nem vira outra sessão.

`live` descreve a ponte sincronizada, não uma confirmação MQTT: o backend pode continuar em `connecting`, sob seu timeout A03 de 10 s, enquanto o snapshot já foi obtido. O prazo novo da ponte não reduz o prazo de conexão da rede.

### Limites e política do buffer

Novos valores no mesmo `MQTT_LIMITS`:

| Limite | Valor | Alcance |
|---|---:|---|
| Publicações temporárias | 128 | Inclui payload vazio |
| Soma de payloads temporários | 1 MiB (1.048.576 bytes) | Complementa a quantidade; não mede memória total |
| Publicação individual temporária | 256 KiB | Reutiliza `payloadBytes`; acima disso rejeita integralmente |
| Sincronização inicial | 5.000 ms | Desde a inscrição, incluindo espera por listeners e snapshot |
| Espera de estado após snapshot | 5.000 ms por conjunto pendente | Começa quando há dados aguardando estado; não é prolongada por mais mensagens |

Um item inicialmente aguardando snapshot pode passar até mais 5 s aguardando um estado posterior ao snapshot aceito. Os dois intervalos são explícitos e finitos. Ao esvaziar a fila ao vivo, esse timer é cancelado; um novo conjunto futuro ganha um novo prazo. Há no máximo um timer ativo por monitor. Relógio injetável permite testes sem espera real; em produção usa `setTimeout`/`clearTimeout`, sem controlar prazo por data de calendário.

Ao exceder quantidade ou bytes, remove publicações **completas**, começando pela menor dupla `(session_id, sequence)`. Conserva as mais novas nessa ordem lógica, inclusive quando a entrega da ponte ocorre fora de ordem. Não altera bytes, não guarda prefixos e não apresenta conteúdo parcial. Metadados de itens que precisam do buffer também obedecem aos limites de nome/profundidade A04.

Uma publicação pronta ao vivo, sem precisar de buffer, continua sujeita diretamente à retenção A04: payload grande e nome grande incrementam os contadores de retenção existentes. Se precisar passar pelo buffer, a rejeição pertence ao buffer. Não há dupla contabilização do mesmo descarte nas duas camadas.

### Informação mínima para ordenar estado e dados

A03 tinha `revision` global nos estados e `sequence` nas mensagens, mas não ligava os dois. Adicionado **`state_revision`** à mensagem Rust/JSON/TypeScript: a revisão do estado conectado em que o backend recebeu a publicação. É copiada sob o mesmo mutex de identidade/estado/sequência já existente, exclusivamente durante `connected`, junto com `session_id` e `payload_bytes`.

O monitor só entrega dados quando a identidade é a atual, o estado global é conectado e `state_revision <= snapshot.revision`. Caso o estado correspondente ainda não tenha chegado, aguarda com os limites acima. Estados terminais não são substituídos por mensagens. O store também rejeita revisão de mensagem ausente, inválida ou futura, como defesa independente da ponte.

Não foi adicionado histórico de estados nem replay de payload no backend. O snapshot contém estado, **não mensagens**; portanto não se usa sua revisão como se fosse um corte da sequência de publicações. Os itens pendentes da identidade ainda conectada são processados em sequência e filtrados pelo `lastSequence` global. Isso evita duplicação inclusive após remount; dados de sequência menor que a já aplicada não substituem valores mais recentes.

Eventos recebidos antes da inscrição, períodos sem listener e descartes deliberados não são recuperáveis por esse mecanismo. Não se promete entrega MQTT exatamente uma vez nem deduplicação de publicações distintas que tenham payload igual. Redelivery do broker recebe outra sequência interna no backend. Os contadores descrevem notificações descartadas nesta ponte, não um inventário ilimitado de todos os IDs já vistos/evictados.

Frontend/backend precisam ser atualizados juntos por causa de `state_revision`. Não há fallback que invente revisão para eventos antigos. O payload canônico continua sendo `payload_bytes`, sem alteração de TLS, autenticação, nomes especiais ou política de retenção A04.

### Descartes, falha e interface

O progresso do monitor é separado de `MqttRetention` e contém apenas fase, geração de inscrição, quantidade/bytes pendentes, erro limitado a 500 caracteres e seis contadores saturados em `Number.MAX_SAFE_INTEGER`:

| Contador | Motivo |
|---|---|
| `capacity` | Publicação completa removida por quantidade/bytes |
| `oversize` | Publicação individual grande demais para o buffer |
| `obsolete` | Sessão antiga ou estado já terminal |
| `duplicate` | Identidade/sequência já na fila ou já aplicada; inclui entrega atrasada inferior ao watermark |
| `invalid` | Contrato de bytes/identidade/revisão inválido ou nome fora do orçamento temporário |
| `closed` | Item pendente liberado ao encerrar/falhar/desmontar o monitor |

O Explorer mostra fase, fila atual e contadores expansíveis com rótulo **Descartes da fila**, separado dos descartes do histórico/tópicos. Esses contadores pertencem à **inscrição atual**: reiniciam na nova inscrição/retry manual e permanecem através de trocas de sessão enquanto ela vive. Os contadores de retenção continuam pertencendo à sessão A04. Não há lista persistente de erros ou de IDs descartados.

Rejeição/erro síncrono de inscrição ou snapshot, deadline ou espera de estado vencida encerra o monitor com fase `failed`: limpa fila/bytes/referências ao snapshot, cancela timer, executa unlisteners já obtidos e destaca as continuações pendentes. Inscrições que terminarem depois executam seu unlistener uma vez; respostas/rejeições tardias não atualizam aplicação. O dispose repetido é idempotente. A função de cleanup oferece `done`, resolvido ao término local, inclusive se uma promessa nativa nunca responder.

Promises de `invoke/listen` já entregues ao runtime não têm cancelamento forçado nesta API. Não se aguarda indefinidamente uma tarefa async local; handlers usam células destacáveis que deixam de referenciar adapter/fila ao encerrar. Uma inscrição nativa ainda pendente só poderá fornecer seu unlistener quando responder. Isso encerra o ciclo local, mas não prova cancelamento físico de trabalho interno do runtime/SO. Não foram criadas tasks de conexão adicionais.

Falha da ponte **não equivale a desconectar o MQTT no backend** e não fabrica estado `disconnected`. O estado retido é preservado para inspeção, com aviso visível de possível desatualização; publish/subscribe são bloqueados enquanto a ponte não estiver `live`. A UI oferece **Tentar sincronizar**, que faz cleanup e inicia uma inscrição nova com prazo próprio, sem retry automático. Caso a GUI ainda indique uma tentativa em andamento, mantém acesso ao cancelamento real A03. A geração da inscrição protege o progresso contra callbacks de uma inscrição anterior.

### Arquivos e verificações da complementação

Novos: `src/lib/mqttMonitor.ts` e `tests/mqtt-monitor.test.mjs`.

Alterados: `mqttSession.ts` (tipo/reexportação), `mqttLimits.ts`, `mqttSessionStore.ts`, `useMqttSession.ts`, `MqttPage.tsx`, traduções, `src-tauri/src/mqtt_session.rs` e seus testes, fixtures/harness dos testes MQTT existentes e este documento. Os orçamentos de histórico/últimos valores/gráficos e o redutor `mqttRetention.ts` permanecem inalterados.

Comparação final com o snapshot inicial da complementação: **185/197 arquivos idênticos**, 12 arquivos de integração/documentação/testes modificados intencionalmente. Removendo somente as novas entradas `mqtt_sync_*` em memória, o hash das traduções anteriores também coincide. Arquivos novos são apenas o módulo do monitor e seus testes. Índice Git vazio; demais alterações locais preservadas.

| Comando | Resultado da complementação |
|---|---|
| `node --test tests/mqtt-monitor.test.mjs` | 20 testes determinísticos da ponte na suíte final |
| `node --test tests/*.test.mjs` | **153 aprovados**, zero falhas |
| `cargo test --locked --offline --manifest-path src-tauri/Cargo.toml` | **42 aprovados**, incluindo TLS, sessões e TCP local binário A05 com a revisão nova |
| `npm run build` | **Aprovado**, avisos anteriores de Browserslist/chunk |
| `cargo check --locked --offline --manifest-path src-tauri/Cargo.toml` | **Aprovado** |
| `git diff --check` | **Aprovado**, avisos informativos LF/CRLF |

Os novos testes usam listeners/promessas controlados e relógio simulado: dados antes da confirmação de inscrição e durante resolução do snapshot; limites por contagem/bytes; vazio/binário/grande; perda por capacidade sem misturar contadores; duplicação/ordenação; estado e erro durante fila cheia; desconexão/reconexão durante sincronização; resposta antiga; mensagem anterior ao evento de conexão; rejeição, timeout e erro síncrono; inscrição/snapshot que responde depois do dispose; espera de estado ao vivo; drain reentrante com mensagens e falha fatal; watermark após remount; geração de progresso; proteção direta do store contra revisão futura. Verificações de UI/hook identificadas como estáticas não equivalem a interação visual.

O teste Rust TCP de A03/A05 foi repetido com rumqttc real e confirma a revisão de estado nas seis publicações binárias/textuais, além de bytes, sessão/sequência, cancelamento e liberação. É uma fixture MQTT mínima local; não é broker completo nem exercício do IPC/WebView inteiro.

**Continuam pendentes:** inspeção visual no Windows, ensaio prolongado e falhas reais da ponte com broker controlado; medição de CPU/RAM/GC/latência; auditoria das filas internas Tauri/WebView/OS/rumqttc. A fila própria do monitor e o estado retido agora têm limites explícitos distintos, sem afirmar que toda a memória ou todas as filas do processo estejam limitadas. Sem commit, push, merge ou atualização de dependências.
