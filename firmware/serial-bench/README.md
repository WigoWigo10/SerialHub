# Bancada Serial com ESP32-C6

O sketch gera uma carga repetível pela UART0 (8N1), usando o adaptador USB-Serial da placa. Não usa sensores, Wi-Fi nem MQTT. O perfil inicial é de 50 registros por segundo a 115200 baud, com 128 bytes por registro e 6.400 bytes/s de carga nominal.

Cada registro termina em LF e tem o formato `SHC6,<sequência>,<tempo em µs>,<padrão>`. A sequência começa em zero após reset. O tempo vem do relógio monotônico do microcontrolador e permite calcular a cadência na origem. O firmware deixa lacunas na sequência se perder prazos de emissão. Uma lacuna observada no host exige investigar a origem e o caminho de recepção. Os timestamps sozinhos não medem latência entre placa e PC, pois os relógios não estão sincronizados.

Na Arduino IDE, use o pacote **esp32 by Espressif Systems 3.3.7**, a placa **ESP32C6 Dev Module**, flash de 4 MB com modo DIO e **USB CDC On Boot** desabilitado. Confira a porta da placa antes de gravar. Na linha de comando, na raiz do SerialHub:

```powershell
$board = 'esp32:esp32:esp32c6:FlashSize=4M,FlashMode=dio,CDCOnBoot=default,UploadSpeed=230400'
$build = Join-Path $env:TEMP ('serialhub-c6-' + [guid]::NewGuid())
arduino-cli compile --fqbn $board --build-path $build firmware/serial-bench/serial_bench
arduino-cli upload --fqbn $board --input-dir $build --port COM58 firmware/serial-bench/serial_bench
```

Feche outros monitores da porta e capture uma janela com a CLI do SerialHub:

```powershell
cargo build --locked --manifest-path crates/serialhub-cli/Cargo.toml
$capture = Join-Path $env:TEMP ('serialhub-c6-capture-' + [guid]::NewGuid())
python -B firmware/serial-bench/capture.py --exe crates/serialhub-cli/target/debug/serialhub.exe --port COM58 --duration 30 --output $capture
```

A pasta da captura recebe os bytes brutos, o diagnóstico da CLI e um JSON com contagens de registros inválidos, lacunas e bytes parciais nas bordas. A continuidade é verificada entre o primeiro e o último registro válido da janela. Uma captura aprovada confirma recepção da carga aplicada na CLI. Para comparar a GUI, o próximo ensaio precisa medir CPU/RAM do processo e repetir a carga com a gravação ligada e desligada.

Para subir a carga, `BENCH_BAUD` e `BENCH_HZ` podem ser configurados na compilação, por exemplo com `--build-property 'compiler.cpp.extra_flags=-DBENCH_BAUD=921600 -DBENCH_HZ=500'`. Recompile, regrave e use a mesma taxa em `capture.py --baud`. A velocidade de upload é independente da velocidade de telemetria.

## Primeiro ensaio nativo

Em 18/11/2026, o sketch foi compilado com Arduino ESP32 3.3.7 e gravado em uma ESP32-C6 com flash de 4 MB, ligada ao Windows por um adaptador CH343 na COM58. O `esptool` verificou os hashes das regiões gravadas. A captura de 30 s com a CLI do SerialHub recebeu 192.001 bytes a 115200 baud. Foram 1.500 registros válidos, das sequências 85 a 1584, sem lacunas, repetição, inversão de ordem ou registros inválidos. A captura também reteve um byte parcial de borda. A CLI encerrou com código 0.

O firmware anterior foi copiado integralmente para `%LOCALAPPDATA%\SerialHub\Backups`, e a captura foi guardada em `%LOCALAPPDATA%\SerialHub\Captures`. A restauração do backup ainda não foi exercitada.

## Ensaio da GUI no Windows

Em 18/11/2026, o Monitor Serial do checkout `7ea6a76` foi executado em build de desenvolvimento com Tauri, WebView2 e Vite. Mantivemos a ESP32-C6 na COM58 com o mesmo firmware a 115200 baud, 8N1 e sem controle de fluxo. Foram amostradas duas janelas de 30 s na mesma conexão, com 31 amostras por janela e o terminal aberto. A gravação foi testada pelo botão REC e pelo diálogo nativo de salvamento.

| Gravação | CPU média do processo, em % de um núcleo lógico | Memória privada média do processo |
| --- | ---: | ---: |
| Desligada | 10,78% | 15,39 MiB |
| Ligada | 7,39% | 25,18 MiB |

Os números da tabela são do processo nativo da instância de teste. O WebView2 compartilhou processos com a instância instalada do SerialHub. Os contadores compartilhados foram guardados nos arquivos brutos e não podem ser atribuídos apenas ao ensaio. Foi feita uma execução em cada condição, na ordem acima, sem reiniciar o aplicativo entre elas. A diferença observada não demonstra efeito da gravação no consumo de CPU ou de memória.

O arquivo foi gravado por cerca de 44 s, incluindo o intervalo antes e depois da janela de métricas. Dos 282.432 bytes, 2.206 registros completos foram validados, das sequências 24731 a 26936, sem lacunas, duplicatas, inversões de ordem ou registros inválidos. Os 64 bytes restantes eram fragmentos nas bordas. Sem gravação, a recepção no terminal foi verificada visualmente. Depois de desconectar a GUI, a CLI reabriu a COM58 e validou 150 registros consecutivos em 3 s.

Os CSVs, resumos JSON e o log bruto foram guardados fora do repositório em `%LOCALAPPDATA%\SerialHub\Captures`.

## Referência da GUI a 921600 baud

No mesmo Windows e checkout, foi usado um build de desenvolvimento com identificador temporário `io.github.wigowigo10.serialhub.paicbench`. A árvore de processos confirmou um perfil WebView2 separado da instância instalada. O gerador original emitia registros de 128 bytes com alvo de 500 Hz, a 921600 baud, 8N1. A mesma conexão foi mantida em quatro janelas de 30 s na ordem desligada, ligada, ligada, desligada. Cada janela teve 31 amostras.

| Janela | CPU nativa (% de um núcleo) | CPU WebView2 (% de um núcleo) | Memória privada nativa (MiB) | Memória privada WebView2 (MiB) |
| --- | ---: | ---: | ---: | ---: |
| Desligada 1 | 50,41 | 223,03 | 15,85 | 628,62 |
| Ligada 1 | 55,00 | 224,57 | 25,39 | 966,39 |
| Ligada 2 | 53,14 | 244,47 | 25,21 | 1.063,37 |
| Desligada 2 | 46,23 | 219,89 | 24,88 | 1.203,24 |

A CPU do WebView2 soma vários processos e pode passar de 100% nessa escala. A memória do WebView2 subiu ao longo da sessão e atingiu a maior média na última janela, com gravação desligada. Este ensaio curto não estabelece a causa dessa tendência nem quantifica o efeito isolado da gravação. Sem gravação, a recepção foi observada no terminal. A verificação de sequência foi feita nos arquivos gravados e na CLI.

O log da GUI continha 36.522 registros completos a 498,99 Hz, zero registros inválidos e 37 lacunas de dois números, espaçadas por 1.000 ou 1.001 posições. A CLI já havia mostrado o mesmo padrão sem a GUI, além de bytes extras na borda inicial daquela captura. A rotina `yieldIfNecessary()` do Arduino ESP32 3.3.7 pausa a tarefa de `loop()` a cada dois segundos em chips de um núcleo. O padrão é consistente com essa pausa e levou à mudança do gerador para uma tarefa de transmissão dedicada.

Com o firmware corrigido, a CLI recebeu 14.998 registros consecutivos na janela de 30 s e 4.999 em 10 s após reabrir a porta. As duas execuções do monitor terminaram com código 0. O validador estrito sinalizou uma linha inválida no início de cada arquivo. A gravação iniciada depois que a GUI já estava recebendo dados teve 10.112 registros válidos a 500 Hz, sem lacunas, repetição, inversão de ordem ou registros inválidos, com 64 bytes parciais nas bordas. Essa contraprova verifica a sequência, sem repetir os contadores de CPU e memória. O firmware corrigido a 921600 baud ficou gravado na placa.

## Agrupamento de eventos Serial para a GUI

O backend do Monitor Serial agora agrega os bytes de RX em lotes de até 4.096 bytes ou até o temporizador de 16 ms da montagem do lote. O formato de `serial-data` continua sendo um array de bytes e seus limites não representam limites de mensagens ou de linhas. A exibição de RX pode ficar alguns milissegundos atrás do eco de TX e os horários mostrados no terminal continuam sendo horários da apresentação.

A fila comporta até 32 leituras de no máximo 1.024 bytes cada. Se o emissor atrasar, o leitor aguarda espaço em vez de descartar bytes na fila. Isso não limita o tempo de permanência no driver ou no WebView2 nem garante recepção sem perdas se o fluxo superar a capacidade de processamento. A gravação continua recebendo a leitura original antes do enfileiramento e mantendo o `flush` existente. Ao encerrar a sessão, o emissor drena as leituras aceitas, inclusive o lote final, antes de o backend publicar a desconexão. A CLI e o núcleo não mudaram.

Para esta comparação, ambos os builds de desenvolvimento usaram o firmware corrigido na COM58 a 921600 baud, com registros de 128 bytes a 500 Hz. A GUI ficou no Monitor Serial, em ASCII, com o DevTools fechado e o perfil do WebView2 separado da instância instalada. Foram quatro janelas de 25 s por build na ordem desligada, ligada, ligada, desligada, com 26 amostras por janela. A sessão anterior foi encerrada antes de abrir a seguinte. Os números são médias de duas janelas por condição, com os processos nativo e WebView2 somados.

| Gravação | CPU antes (% de um núcleo) | CPU após (% de um núcleo) | Memória privada antes (MiB) | Memória privada após (MiB) |
| --- | ---: | ---: | ---: | ---: |
| Desligada | 149,77 | 51,16 | 688,81 | 553,49 |
| Ligada | 145,81 | 53,86 | 811,70 | 609,05 |

A redução relativa observada no uso de CPU foi de 65,84% com a gravação desligada e 63,06% com ela ligada. O log anterior teve 30.758 registros válidos em 61,514 s. O log com agrupamento teve 31.350 em 62,698 s. Nenhum apresentou lacunas, duplicatas, inversões ou registros inválidos entre as bordas. O arquivo verifica o caminho de gravação. A recepção na GUI e a reabertura da porta foram verificadas visualmente, e a ordem e a integridade dos bytes enviados pelo agrupador foram verificadas em testes automatizados. Não foram medidas latência ponta a ponta e perdas no terminal durante as janelas sem gravação. As janelas curtas e a execução sequencial dos builds não estabelecem comportamento de longo prazo da memória.

Passaram 45 testes do backend e 160 testes do frontend, além das compilações. Os CSVs individuais, logs, resumos e `comparison.json` ficam em `%LOCALAPPDATA%\SerialHub\Captures\com58-batching-ad7068c0-3965-4a8e-b031-34881ab3d320`.
