# Bancada híbrida com a ESP32-C6

A ESP envia o mesmo JSON pela UART a 921600 baud (8N1) e pelo MQTT no tópico `serialhub/bench/events`. Um ensaio tem 600 eventos, a 20 Hz, cada um com identificador do ensaio (`run`), número de sequência (`seq`) e tempo monotônico na placa (`source_us`). O ensaio Serial de 500 Hz continua no [firmware anterior](../serial-bench/README.md).

Use **ESP32C6 Dev Module**, Arduino ESP32 3.3.7, PubSubClient 2.8, flash 4 MB em DIO e USB CDC On Boot desabilitado. Na raiz do repositório:

```powershell
$board = 'esp32:esp32:esp32c6:FlashSize=4M,FlashMode=dio,CDCOnBoot=default,UploadSpeed=230400'
$build = Join-Path $env:TEMP ('serialhub-hybrid-' + [guid]::NewGuid())
arduino-cli compile -b $board --build-path $build firmware/hybrid-bench/hybrid_bench
arduino-cli upload -b $board --input-dir $build -p COM58 firmware/hybrid-bench/hybrid_bench
```

O coletor usa PySerial 3.5 e, no modo híbrido, Paho MQTT 2.1.0. Feche outros monitores da porta. Para testar apenas a UART:

```powershell
$capture = Join-Path $env:TEMP ('hybrid-serial-' + [guid]::NewGuid())
python -B firmware/hybrid-bench/capture.py --port COM58 --serial-only --output $capture
```

Para o teste híbrido, use Wi-Fi de 2,4 GHz e um broker MQTT/TCP de bancada alcançável pela ESP. Configure o SSID, a senha do Wi-Fi, o endereço do broker na rede e a porta em um JSON fora do repositório. Se o broker exigir credenciais, informe também `mqtt_user` e `mqtt_password`. A configuração é enviada por USB após a assinatura no PC e permanece em memória até o reset. Use um broker dedicado na rede de bancada, pois este firmware de teste usa TCP sem TLS e publica em QoS 0.

```json
{
  "ssid": "rede-de-bancada",
  "password": "senha-do-wifi",
  "broker_host": "endereco-do-pc-na-rede",
  "broker_port": 21883
}
```

Reinicie a ESP antes de repetir um ensaio híbrido, para limpar a configuração anterior. Rode:

```powershell
$capture = Join-Path $env:TEMP ('hybrid-capture-' + [guid]::NewGuid())
python -B firmware/hybrid-bench/capture.py --port COM58 --config "$env:LOCALAPPDATA/SerialHub/Bench/wifi.json" --output $capture
```

Se o broker usar endereços distintos para o PC e a placa, informe `--broker-client-host` para o coletor. O resumo verifica perdas, duplicatas e igualdade dos payloads por sequência. Registra mínimo, mediana, p95 por posto mais próximo e máximo da diferença **MQTT menos Serial** entre as observações no PC. A diferença inclui o caminho de recepção e o agendamento do coletor. Calcule essas métricas apenas para as sequências recebidas nos dois canais e leia os valores junto com a contagem de perdas. Se a fila do firmware encher, a ESP continua emitindo pela UART, e o resumo contabiliza os descartes da fila.

Em 19/11/2026, o firmware foi compilado e gravado na ESP32-C6 da COM58. O modo somente Serial entregou 600 de 600 eventos, sem lacunas, registros inválidos ou duplicatas. O coletor também foi exercitado contra um Mosquitto local com uma UART simulada e comparou os payloads byte a byte.

No ensaio físico híbrido `4d94966a`, a placa publicou por Wi-Fi para um Mosquitto temporário no PC, com autenticação de bancada e MQTT/TCP em QoS 0. O coletor recebeu 600 de 600 registros em cada canal, na ordem de 0 a 599. Os 600 payloads coincidiram byte a byte, sem lacunas, duplicatas, registros inválidos ou descartes na fila da placa. A diferença dos tempos de recepção no PC teve mediana de 50,61 ms, mínimo de 1,49 ms e máximo de 272,33 ms. Foi uma única execução, coletada pelo script Python.

## Repetição física e verificação na GUI

Uma rodada adicional com a configuração original recebeu 600 eventos pela Serial e 295 pelo MQTT, com 252 descartes na fila da placa. O firmware de bancada foi recompilado com o modo de economia de energia do Wi-Fi desativado e `TCP_NODELAY` aplicado ao socket após cada conexão MQTT. A taxa de publicação, o tamanho da fila e o QoS 0 foram preservados.

O coletor recebeu 600 eventos pela COM58 em cada uma das três rodadas seguintes. Todos os payloads pareados coincidiram byte a byte.

| Ensaio | Recebidos via MQTT | Descartes na fila da ESP | Mediana (ms) | p95 (ms) |
| --- | ---: | ---: | ---: | ---: |
| `531c4529` | 600/600 | 0 | 9,65 | 38,67 |
| `752c9824` | 484/600 | 83 | 9,02 | 43,37 |
| `80ca5b86` | 600/600 | 0 | 14,11 | 67,55 |

No ensaio `17d6b39c`, a GUI Tauri no Windows abriu a COM58 a 921600 baud e assinou `serialhub/bench/events` no Mosquitto local. Um observador temporário registrou os eventos da WebView, e o REC da aplicação criou `serial_COM58_921600baud_2026-11-19_10-03-52-059.log`. O arquivo gravou o comando `START` e os 600 registros Serial na ordem de 0 a 599. A sessão MQTT da GUI recebeu os 62 eventos que o broker encaminhou ao aplicativo, todos iguais aos pares Serial. A ESP desconectou do broker durante a rodada e relatou 536 descartes na fila. A GUI permaneceu conectada e registrou zero descartes no histórico.

O fluxo simultâneo e a gravação Serial foram verificados. A entrega dos 600 eventos por MQTT permanece instável nesta bancada. Correlacione a próxima captura com o motivo de desconexão Wi-Fi, o RSSI e o retorno de `publish()` na ESP para localizar as perdas restantes.
