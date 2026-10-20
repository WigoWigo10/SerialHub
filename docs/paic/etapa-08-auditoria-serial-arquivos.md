# PAIC — Etapa 08: auditoria Serial e arquivos

Validação final: 20/10/2026, America/Manaus. Branch `feature/shared-core-cli`.
Referência local: `fc4bf32`, que substituiu `4034a62` para excluir o PDF e os scripts locais `leitor.py`, `leitor_diff.py` e `simulador_iot.py`. Esses quatro arquivos foram preservados no disco. O remoto ainda aponta para `4034a62`; não houve push nem alteração do remoto nesta tarefa. As mudanças desta etapa permanecem sem commit.

## Escopo e referências

Conferidos status e diff antes das alterações. Não foi encontrado AGENTS.md no repositório nem nos ancestrais até C:\. Lidos os registros anteriores, em especial as etapas 4 e 7. Preservados o supervisor de falhas, os tokens por sessão, o encerramento dos leitores e o acompanhamento global de conexão da etapa 7. Núcleo, CLI, manifests e lockfiles não mudaram nesta etapa.

Arquivos examinados: `src-tauri/src/commands/serial_cmd.rs` (abertura, configuração, leitura, escrita, controles e gravação), `serial_session.rs` (propriedade, cancelamento e supervisor), `lib.rs` (estado, registro de comandos e saída); `App.tsx`, `Sidebar.tsx`, `CommandBar.tsx`, `TerminalArea.tsx`, `DashboardPage.tsx`, `useDataMonitor.ts`, `useSerialConnection.ts`, `serialConnection.ts` e `settingsStore.ts` (estado, eventos, contadores e apresentação).

### Operações realmente oferecidas

- **Gravação contínua:** botão REC na configuração avançada. O diálogo escolhe o destino; o backend abre com `create + append`. RX é gravado como bytes recebidos. TX usa o formato diagnóstico legado: LF, `>>> [TX] `, bytes aceitos e LF adicional se necessário. Não há timestamps nem formatação ASCII/HEX do terminal nesse arquivo. Ele pode conter NUL e bytes inválidos em UTF-8. Agora o destino padrão é `serial_log.log`, e a interface explica anexação e inclusão de RX/TX.
- **Exportação visual:** não existe comando de exportar o terminal para arquivo. Há seleção e cópia para a área de transferência, que representam o texto exibido. Não foi criada uma exportação nesta auditoria.
- **Envio:** entrada textual codificada em UTF-8, com NONE, LF ou CRLF. HEX é um modo de visualização de RX/eco, não um parser de envio HEX. Colagem de JSON válido pode ser minificada pela interface antes do envio; o conteúdo efetivamente presente na entrada é o que se envia.
- **Apresentação:** xterm com scrollback de 10.000 linhas, seleção, limpeza e acompanhamento do fim do conteúdo. Não há pausa de aquisição ou botão de pausa da visualização. Ao sair da página, o terminal permanece montado e oculto; a Sidebar pode desmontar. Histórico de comandos limitado a 50 entradas.

### Fluxo após as correções

```text
SerialConnection → leitor supervisionado → SerialRecording.rx(bytes) → serial-data
write_serial → transmit_reported → prefixo aceito → log TX / serial-tx / serial-sent
SerialRecording → snapshot com revisão → evento + consulta → hook global → store
serial-data → contador global + SerialPresentation → xterm
```

`SerialRecording` possui o writer, caminho, revisão e último erro. Todos os acessos usam o mesmo mutex. Parar aguarda uma escrita em andamento, faz flush e descarta o writer antes de responder; dados processados depois desse ponto não entram no arquivo. Uma falha de escrita/flush interrompe a gravação, libera o writer, atualiza o estado global e informa que pode existir um trecho parcial. Não há repetição automática desse pacote. Falha do arquivo não encerra por si só a conexão Serial.

`transmit_reported` completa escritas parciais enquanto há progresso, repete `Interrupted` e reporta exatamente o prefixo aceito caso haja falha. Somente esse prefixo participa do eco, contador e arquivo. A mensagem de erro informa quantidade aceita e risco de duplicação em reenvio manual. Os comandos de envio e controle aceitam um `expected_session_id` opcional; a GUI o fornece para impedir aplicação em uma sessão substituta. Chamadores antigos sem o argumento continuam aceitos.

Os listeners da gravação ficam em `App`, com inscrição antes da consulta inicial e rejeição de revisões antigas. Gates compartilhados impedem operações duplicadas de conexão, gravação e envio durante chamadas pendentes, inclusive entre remontagens. Listeners locais ignoram callbacks após desmontagem e cancelam inscrições que terminam de resolver tardiamente.

## Matriz de comportamentos

Legenda de evidências: **R** = testes Rust com transporte/writer simulado e arquivos temporários; **N** = testes Node, incluindo verificações estáticas identificadas nos nomes; **G** = aplicação Tauri com eventos sintéticos/IPC e arquivos temporários, sem abrir porta; **C** = inspeção do código. “Pendente” significa que não foi comprovado por integração nativa. Gravidade refere-se ao problema anterior, quando aplicável.

| Cenário | Esperado pelo contrato existente | Observado, evidência e causa | Gravidade | Situação |
|---|---|---|---|---|
| Atualização e seleção de porta | Lista mais recente; selecionar abre com parâmetros escolhidos | Consultas antigas podiam substituir novas; token de consulta e guarda de montagem corrigem. N/C | Média | Bug confirmado, corrigido |
| Abrir, fechar e reconectar | Um proprietário e leitores encerrados antes da próxima sessão | Etapa 7 preservada; R verifica liberação e nova abertura simulada | Alta | Correto em simulação; nativo pendente |
| Falha ao abrir | Erro visível e histórico preservado | Tentativa apagava terminal antes de saber se abriu; remoção da limpeza automática. N/C | Alta | Bug confirmado, corrigido |
| Alterar parâmetros conectado | Reabertura; seleção representa configuração aplicada | Estado local se perdia ao remontar e era alterado antes do sucesso. Agora global em memória, aplicado após sucesso. C | Média | Bug confirmado, corrigido; reconfiguração nativa pendente |
| Timeout de leitura | Ausência temporária de dados | R da etapa 7 preserva sessão em TimedOut/WouldBlock/Interrupted | — | Correto em simulação |
| Falha fatal / troca de página | Supervisor libera sessão e estado global desconecta | R/N da etapa 7 continuam aprovados; sem dependência da Sidebar | Alta | Correto em simulação; portas virtuais pendentes |
| Cliques rápidos / remontagem | Uma ação pendente de cada espécie | Gates compartilhados e controles desabilitados; N testa duplicação e liberação após erro | Média | Corrigido; interação nativa com porta pendente |
| Respostas/eventos atrasados | Não modificar sessão nova ou widget descartado | Revisões, tokens de consulta, descarte de listener e expected_session_id; N/R/G | Alta | Corrigido nos contratos exercitados |
| ASCII/UTF-8 dividido | Caractere completo exibido uma vez | Decoder recriado por pacote com timestamps corrompia caracteres. Decoder streaming; N/G com C3 depois A9 | Média | Bug confirmado, corrigido |
| UTF-8 incompleto ao trocar sessão | Não completar caractere com bytes de outra sessão | Finalização/reset do decoder na mudança de sessão/conexão; N | Média | Corrigido |
| HEX / binário / byte zero | HEX fiel; texto pode ter caracteres não imprimíveis/substitutos | N cobre 00, FF, 80; RX do arquivo preserva bytes. ASCII é apresentação, não arquivo binário | — | Correto nos testes |
| CR, LF, CRLF em fragmentos | Preservar caracteres de controle e semântica do terminal | N verifica fragmentação e NUL; timestamps agora só ao iniciar texto de linha, sem timestamp antecipado após LF | Média | Corrigido |
| Eco local | Exibir apenas bytes aceitos | Antes removia quebras de linha e podia exibir bytes não enviados; N/R verificam prefixo e terminações | Alta | Bug confirmado, corrigido |
| Troca ASCII/HEX/timestamps | Não apagar histórico | Mudanças afetam dados futuros; histórico já apresentado não é reprocessado. N/C | — | Correto conforme implementação; produto pode redefinir |
| Limpar | Esvaziar viewport e scrollback, sem apagar arquivo | clear() retinha linha corrente; reset enfileirado após writes anteriores. N/G | Média | Bug confirmado, corrigido |
| Limpar durante UTF-8 parcial | Descartar fragmento visual anterior | Reset também reinicia decoder; N | — | Correto nos testes |
| Rolagem e seleção | Evitar puxar usuário ao final enquanto lê/seleciona | Scroll após write só se já estava no fim e sem seleção; C | Baixa | Correção implementada; gesto manual pendente |
| Cópia de seleção | Confirmar somente sucesso da clipboard | Exceção agora gera toast; seleção só limpa após sucesso. C | Baixa | Correção implementada; clipboard nativa pendente |
| Pausa | Só exigir recurso oferecido | Não existe; sair da página não pausa recepção. C | — | Não oferecido |
| RX/TX contadores | Contar bytes uma vez, independentemente da página | Dashboard e hook global somavam TX; G reproduziu 3 → 6, após correção 3 → 3. N confere ligação única | Média | Bug confirmado, corrigido |
| Reinício dos contadores | Preservar regra por sessão | Store reinicia em mudança de conexão/sessão; N da etapa 7 | — | Correto conforme contrato atual |
| Histórico longo | Limite conhecido; não prometer arquivo completo do terminal | Scrollback 10.000, comandos 50; nenhum ensaio prolongado de memória/throughput | — | Limites inspecionados; ensaio prolongado pendente |
| Texto e fim de linha | UTF-8 + terminador escolhido, sem bytes extras no envio | N cobre Unicode, NUL e NONE/LF/CRLF; texto vazio não envia pela UI | — | Correto nos testes |
| Entrada HEX inválida | Não tratar texto como HEX sem recurso de parser | Não há envio HEX; texto como “GG” continua texto. C | — | Não aplicável como validação HEX |
| Escrita parcial com progresso | Completar o restante e contabilizar aceito | Antes write único registrava toda entrada; R com write de 2 bytes por chamada | Alta | Bug confirmado, corrigido |
| Erro após prefixo / write zero | Informar falha sem inventar envio ou repetir prefixo | R verifica prefixo AB de ABCDE, erro, eco/contador/log AB; write zero falha | Alta | Bug confirmado, corrigido |
| Falha de envio na UI | Erro visível; não limpar rascunho ou registrar sucesso | N cobre retorno incompleto; UI só limpa após sucesso e preserva nova digitação concorrente. C | Média | Corrigido; envio nativo pendente |
| Iniciar/parar gravação | Resultado real antes da confirmação | N testa rejeições; G verifica estado global; snapshot do backend substitui boolean local otimista | Alta | Corrigido |
| Cancelar diálogo | Sem iniciar, criar arquivo ou toast de sucesso | N simula choose → null e confere ausência de start/stop; diálogo Windows não exercitado nesta conclusão | — | Correto em simulação; cancelamento nativo pendente |
| Arquivo existente | Anexar, sem truncar | R com sentinela binária e nome acentuado; G verifica sentinela intacta | Alta | Correto; diálogo de destino existente pendente |
| Trocar destino com REC ativo | Não perder writer ativo nem criar novo arquivo inadvertidamente | Antes substituía File sem checar; agora rejeita antes de abrir. R/G | Alta | Bug confirmado, corrigido |
| Caminho com espaços e acentos | Usar caminho literal | R/G em diretório temporário próprio | — | Correto |
| Extensão e formato | Identificar log diagnóstico misto RX/TX | .log padrão; ajuda explica append e bytes RX/TX; extensão não converte conteúdo. C/R | Média | Texto esclarecido |
| Arquivo vazio | Criar/parar sem erro; tamanho zero | R verifica tamanho e fechamento repetido | — | Correto |
| Erro ao abrir arquivo | Erro visível e REC desativado | R/G usam diretório como destino inválido; N testa falha sem sucesso | Alta | Corrigido |
| Erro ao escrever | Não seguir indicando gravação nem ocultar perda | Antes ignorava write_all/flush; R injeta falha após 3 bytes, verifica drop e snapshot de erro | Alta | Bug confirmado, corrigido |
| Erro no flush/finalização | Devolver erro após liberar writer | R injeta PermissionDenied; N verifica ausência de resultado de sucesso | Alta | Bug confirmado, corrigido |
| RX durante parar | Ordenar arquivo e término sem write após resposta | Mesmo mutex; R bloqueia writer e prova espera de finish + descarte de RX posterior | Alta | Correto no teste de concorrência |
| Desconectar durante REC | Preservar política anterior: gravação permanece aberta até Stop/Exit | G close sem sessão ativa mantém REC; R cobre término. Desconexão com RX real não foi exercitada | — | Parcialmente verificado; portas virtuais pendentes |
| Trocar página durante REC | Mesmo writer e estado ao retornar | G visita Configurações/Dashboard; hook na raiz, N cobre montagem/cancelamento | Média | Bug de estado local corrigido |
| Encerrar aplicação durante REC | Parar leitor antes de finalizar arquivo | C: Exit faz stop da sessão, finish e encerra supervisor; falha de finish vai a stderr | Alta | Código revisado; encerramento nativo com fluxo pendente |
| Arquivo vs visual | Não confundir log diagnóstico com exportação visual | RX bruto; TX marcado; sem timestamps/cores do terminal. R compara bytes exatos | — | Correto e documentado |

## Evidências e verificações

Em `evidencias/etapa-08-baseline.json`, a referência `4034a62` é a anterior à correção da seleção de arquivos do commit. O código Serial relevante dessa referência é o mesmo de `fc4bf32`. A GUI anterior reteve conteúdo após limpar e contou seis para um evento de três bytes. O campo `fragmentText` passou por conversão de encoding no coletor: o boolean `replacement: false` **não comprova** correção do UTF-8. A reprodução determinística do decoder anterior é `new TextDecoder().decode(Uint8Array.of(0xC3)) + new TextDecoder().decode(Uint8Array.of(0xA9))`, que produz dois U+FFFD; com streaming o resultado é U+00E9. O teste de regressão verifica esse contrato.

`evidencias/etapa-08-gui-resultados.json` registra a verificação posterior na aplicação: U+00E9 conferido por codepoints, limpeza completa, TX=3, gravação global entre páginas, recusa de troca de destino ativo sem criar o outro arquivo, preservação da sentinela, erro de abertura, argumentos antigos opcionais e recusa de sessão obsoleta em envio/controle. Foram usados eventos sintéticos e IPC de gravação com arquivos temporários próprios; **não houve leitura/escrita de porta física ou virtual**. A emissão sintética de `serial-data` não atravessa o logger Rust; esse caminho foi coberto separadamente pelos testes Rust. Preferências e contadores utilizados na inspeção foram restaurados. Os arquivos temporários foram removidos.

Comandos finais, executados na raiz do repositório em PowerShell:

| Comando | Resultado |
|---|---|
| `node --test tests/*.test.mjs` | 42 aprovados, zero falhas; inclui 14 testes da auditoria, testes de credenciais, temas, Dashboard e ciclo global Serial |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | 19 aprovados, zero falhas; 8 novos testes de gravação/transmissão, regressões da etapa 7 preservadas |
| `cargo test --locked --manifest-path crates/serialhub-core/Cargo.toml` | 13 aprovados, zero falhas |
| `cargo test --locked --manifest-path crates/serialhub-cli/Cargo.toml` | 21 unitários + 4 de integração aprovados, zero falhas |
| `npm run build` | Aprovado; avisos de Browserslist desatualizado e chunk JS acima de 500 kB |
| `cargo check --locked --manifest-path src-tauri/Cargo.toml` | Aprovado |
| `git diff --check` | Aprovado; Git informa normalização futura LF/CRLF em dois arquivos, sem erro de whitespace |

Total: 99 testes aprovados. As verificações estáticas Node não substituem interação de componentes/GUI; os casos respectivos estão identificados nos nomes dos testes. Não foi feita medição nem alegação de ganho de desempenho.

## Arquivos alterados

- Backend: `commands/serial_cmd.rs`, `lib.rs`; novos `serial_recording.rs` e `serial_recording/tests.rs`. Supervisor e núcleo não foram substituídos.
- Frontend: `App.tsx`, `Sidebar.tsx`, `CommandBar.tsx`, `TerminalArea.tsx`, `DashboardPage.tsx` (somente remoção do contador TX duplicado), `useDataMonitor.ts`, `serialConnection.ts`, `settingsStore.ts`, `translations.ts`.
- Novos módulos: `useSerialRecording.ts`, `serialActions.ts`, `serialPresentation.ts`, `tests/serial-audit.test.mjs`, este registro e os dois JSON de evidência.

## Limitações e decisões futuras

Não há par virtual confirmado. Permanecem pendentes: conexão/recepção/desconexão/reconexão da GUI com tráfego nativo, alteração de parâmetros, DTR/RTS efetivos, erros reais de driver, perda de conexão durante REC e encerramento com dados chegando. COM3 Intel AMT SOL não é porta de teste e não foi aberta. O procedimento da etapa 6 continua sendo a referência para integração com par virtual.

Cancelar o diálogo nativo, escolher destino existente e sua eventual mensagem de substituição, gestos de seleção/rolagem e clipboard exigem verificação manual adicional. O backend anexa independentemente do diálogo. Falhas de capacidade/permissão e flush foram simuladas; não se provocou falta de espaço nem se alteraram arquivos do usuário.

Logging continua síncrono. Disco/driver bloqueado pode atrasar leitura e desconexão; não se comprovou um problema de desempenho nem existe prazo rígido de encerramento. O cancelamento Serial pode descartar dados ainda no driver ou uma leitura interrompida; não promete drenar todo o dispositivo. O cutoff da gravação é a aquisição do mutex pelo Stop, não um instante físico no cabo.

Flush e descarte do File não garantem persistência física em disco. Erros do fechamento implícito do sistema operacional não são retornados por Drop. Saída normal tenta finalizar e informa erro em stderr; encerramento forçado e perda de energia não têm garantia. Nenhuma mensagem afirma que flush torna o arquivo fisicamente durável.

Decisões que podem exigir definição de produto, sem bloquear estas correções: oferecer captura RX binária pura separada do log diagnóstico RX/TX; criar exportação visual e escolher seu formato; reformatar retrospectivamente o histórico ao alternar modos; manter contadores acumulados após desconectar; mudar a política atual de REC continuar aberto entre conexões. Não foram introduzidas essas funcionalidades nem reenvio automático após falha parcial.
