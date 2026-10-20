# Correção A05 — payload MQTT original e HEX fiel aos bytes

Data: 20/10/2026, America/Manaus. Branch `feature/shared-core-cli`, referência `e7a8235` (A02, A03 e layout MQTT). Alterações locais, sem commit, push ou merge.

## Referência e reprodução

Lidos a auditoria `auditoria-estado-atual-2026-10-20.md` e os registros A01–A03. Conferidos status e diff antes de editar. Não foi encontrado AGENTS.md no repositório/ancestrais até `C:\`.

Executada a função real anterior `toHexDisplay`, extraída de `TopicTree.tsx` e transpilada em uma VM Node isolada: `é` produziu **E9**, enquanto seu payload UTF-8 é **C3 A9**. A função percorria unidades UTF-16 com `charCodeAt`; emoji também não correspondia aos bytes UTF-8. Antes dela, `Events for EventLoop` convertia a publicação com `String::from_utf8_lossy`, substituindo bytes inválidos e tornando impossível recuperar o payload original pelo texto.

Registrados hashes SHA-256 de 189 arquivos versionados/locais em `%TEMP%\serialhub-a05-baseline.json`. Ao final, 180 permanecem idênticos; os nove editados são exclusivamente os arquivos MQTT/testes/traduções relacionados abaixo. As alterações Serial da etapa 8, PDF, scripts, auditoria e evidências anteriores permanecem no disco e fora do índice. Em traduções, foram preservadas as entradas Serial anteriores. Nenhum manifest, lockfile, construtor TLS, perfil ou arquivo de coordenação Serial foi editado.

## Percurso e representação

```text
rumqttc Publish.payload (Bytes)
  → Incoming::Message (Vec<u8>)
  → Message {session_id, sequence, topic, payload_bytes: Vec<u8>, qos}
  → evento Tauri mqtt-message (payload_bytes como array JSON de inteiros 0–255)
  → store global: bytes próprios + texto UTF-8 derivado + validade UTF-8
  → árvore: bytes originais / texto / interpretação JSON
  → gráficos: somente apresentação textual de mensagens UTF-8 válidas
```

Exemplo de evento:

```json
{"session_id":7,"sequence":3,"topic":"sensor","payload_bytes":[195,169,0,255],"qos":0}
```

- **Canônico:** `payload_bytes`, array de inteiros; inclusive vazio, NUL e valores não UTF-8. O backend não produz mais uma string canônica nem usa conversão com perda na recepção MQTT.
- **Sessões:** `session_id`, `sequence`, QoS e tópico mantidos. A filtragem A03 por identidade, estado conectado e sequência precede a admissão da mensagem. Contratos inválidos de bytes são rejeitados sem consumir a sequência; não se tenta reconstruir bytes a partir de texto legado.
- **Frontend:** o store copia o array recebido e deriva `payload` (texto de apresentação) e `payloadIsUtf8`. A árvore obtém sua apresentação diretamente dos bytes. Alterar TXT/HEX não altera a captura.
- **UTF-8:** cada publicação usa um decoder independente, sem `stream` e sem completar uma mensagem com bytes de outra. Decodificação estrita identifica validade; somente a apresentação textual inválida usa U+FFFD. BOM UTF-8 explícito é preservado como U+FEFF; não é removido silenciosamente. NUL e quebras de linha permanecem no texto decodificado e nos bytes.
- **HEX:** maiúsculas, dois dígitos por byte, separados por um espaço: `C3 A9 00 FF`. Não há `charCodeAt`, recodificação do texto ou serialização de JSON como origem do HEX.

### Árvore, JSON e gráficos

Tópicos comuns e níveis vazios mantêm a hierarquia. Dicionários sem protótipo, consultas próprias, separação entre filhos reais e campos JSON e identidades React do A01 permanecem. Os testes também cobrem colisões com os novos metadados `originalBytes` e `payloadIsUtf8`.

No modo TXT, objetos/arrays JSON de mensagens UTF-8 válidas continuam expandidos. Payload inválido em UTF-8 pode ser mostrado com substituições, mas não é reinterpretado como JSON válido depois dessa substituição. JSON inválido permanece texto, sem exceção propagada.

No modo HEX, **apenas tópicos MQTT reais** são mostrados, incluindo seus subtópicos reais. Campos JSON virtuais não têm um intervalo de bytes próprio: o parsing perde espaços, escapes e grafia lexical. Por isso não recebem HEX artificial. O nó da publicação exibe os bytes completos, preservando inclusive espaços e `\uXXXX` escritos no JSON original. Retornar a TXT restaura a expansão. O tooltip do modo HEX explica essa escolha.

Payload vazio tem indicação explícita de **0 bytes**, mantendo cópia de string vazia válida. Uma string JSON interpretada vazia é apresentada como `""`, sem ser confundida com publicação vazia.

Os callbacks reais de atualização/inicialização dos gráficos preservam a interpretação numérica/textual e o percurso JSON por propriedades próprias. Mensagens inválidas em UTF-8 não alimentam pontos numéricos obtidos de texto substituído. `MqttChart.tsx` recebe somente pontos numéricos e não manipula payloads; não precisou ser alterado.

### Cópia e exportação

Foi revisado o percurso de `navigator.clipboard.writeText` em `TopicTree.tsx`:

| Ação | Conteúdo copiado |
|---|---|
| Copiar tópico em HEX | Texto HEX dos bytes originais, dois dígitos por byte |
| Copiar tópico em TXT | Texto UTF-8 decodificado da publicação; bytes inválidos podem aparecer como U+FFFD |
| Copiar campo JSON em TXT | Valor interpretado como texto; objetos são serializados, strings não incluem as aspas JSON originais |

Tooltips distinguem as três semânticas. O callback aguarda a resolução da API de clipboard antes de confirmar sucesso; rejeições mostram erro, inclusive por falta de acesso ao clipboard. NUL no texto é preservado no valor passado à API; aplicativos de destino podem tratá-lo de outra forma. Para representação textual exata dos bytes, usar a cópia HEX.

Não há exportação/download/gravação de payloads na tela MQTT atual. Foram examinados `MqttPage`, `TopicTree` e `MqttChart`; não se acrescentou exportação nem se alteraram os fluxos de arquivo Serial da etapa 8. O envio MQTT continua textual e fora do escopo A05.

## Arquivos alterados

- `src-tauri/src/mqtt_session.rs`: recepção e evento com bytes originais; preserva o restante do ciclo A03.
- `src-tauri/src/mqtt_session/tests.rs`: serialização binária e ampliação da integração TCP existente.
- Novo `src/lib/mqttPayload.ts`: validação do array, decodificação por publicação e formatação HEX.
- `src/lib/mqttSession.ts`, `src/stores/mqttSessionStore.ts`: contrato de bytes e apresentação derivada em memória.
- `src/components/mqtt/TopicTree.tsx`: árvore, renderização e cópia; campos JSON somente em TXT.
- `src/components/pages/MqttPage.tsx`: gráficos ignoram texto substituído de UTF-8 inválido.
- `src/i18n/translations.ts`: indicações de payload vazio, semântica dos modos/cópia e falha de clipboard, em três idiomas.
- Novo `tests/mqtt-payload.test.mjs`; ajustes de contrato nos testes A01/A03 existentes, sem retirar suas regressões.
- Este registro.

## Verificações e evidências

| Comando/verificação | Resultado |
|---|---|
| Função anterior real em VM Node | A05 reproduzido: E9 em vez de C3 A9 |
| `node --test tests/*.test.mjs` | **116 aprovados**, zero falhas; 17 novos casos A05 e regressões anteriores |
| `cargo test --locked --offline --manifest-path src-tauri/Cargo.toml` | **42 aprovados**, zero falhas; um teste novo de serialização e integração existente ampliada |
| `npm run build` | **Aprovado**; avisos anteriores de Browserslist antigo e chunk acima de 500 kB |
| `cargo check --locked --offline --manifest-path src-tauri/Cargo.toml` | **Aprovado** |
| `git diff --check` | **Aprovado**; avisos informativos LF/CRLF |
| Comparação SHA-256 | 180/189 arquivos iniciais idênticos; nove alterações MQTT intencionais |

Cobertura: ASCII; `é` (C3 A9); emoji (F0 9F 98 80); vazio; zero; bytes inválidos; CR/LF/CRLF; BOM; todos os 256 valores de byte; arrays IPC inválidos; mensagens separadas C3 e A9; JSON aninhado/nome especial e representação lexical; payload binário e JSON inválido; troca de modo; cópia vazia, sucesso aguardado e falha simulada; gráficos reais para número/JSON e entradas inválidas.

Os testes frontend executam helper, store, funções reais da árvore, callback real de clipboard e callbacks reais dos gráficos. Renderizam o componente real com React DOM Server em contexto isolado, com hooks React reais e adaptadores para ícones/tradução/clipboard. Os testes A01 continuam comparando descritores dos protótipos antes/depois. **Essa renderização automatizada não é uma inspeção visual no WebView Windows.**

### TCP local real

O teste `loopback_real_mqtt_connect_cancel_and_reconnect` do A03 usa rumqttc real e servidor mínimo controlado em `127.0.0.1`, porta efêmera. Mantém cancelamento antes de CONNACK, liberação/reconexão e MQTT DISCONNECT. Após reconectar, recebe seis publicações separadas: `42`, sequência completa 00–FF, vazio, C3 incompleto, A9 isolado e `é😀\r\n`. Verifica bytes exatos, identidade da nova sessão, sequência de cada publicação e serialização JSON do evento sem campo textual canônico.

Essa integração passou. Não usa broker público nem equipamento físico. O servidor é uma fixture MQTT mínima, **não um broker completo**; o teste valida a recepção pelo EventLoop e o evento serializado, sem transportar esses mesmos eventos por uma janela Tauri real. As regressões TLS e de cancelamento A02/A03 também passaram.

## Compatibilidade, limitações e pendências

- Frontend e backend precisam ser atualizados/reiniciados juntos: o evento `mqtt-message` muda de `payload: string` para `payload_bytes: number[]`. Não há histórico de mensagens persistido a migrar. Texto legado não é recodificado como se preservasse bytes desconhecidos.
- Pendentes: inspeção visual de TXT/HEX/árvore/cópia no WebView Windows com o binário atualizado; clipboard Windows real (inclusive NUL e aplicativos de destino); publicação binária por broker completo com autenticação, TLS e WS/WSS e percurso IPC completo. Testes de dados, SSR e clipboard simulado não aprovam essas verificações manuais.
- Array JSON de bytes tem custo de serialização/memória; não foi medido ganho de desempenho. Retenção ilimitada A04, limites de tamanho/profundidade JSON e ambiguidade do identificador textual dos gráficos continuam fora do escopo.
- Sem envio binário, nova exportação, reconexão automática ou atualização de dependências. A01, TLS/credenciais A02 e identidade/ordenação/cleanup A03 foram preservados. Não houve commit, push ou merge.
