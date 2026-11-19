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

Se o broker usar endereços distintos para o PC e a placa, informe `--broker-client-host` para o coletor. O resumo verifica perdas, duplicatas e igualdade dos payloads por sequência. Registra também a diferença **MQTT menos Serial** entre as observações no PC. Esse valor inclui o caminho de recepção e o agendamento do coletor. Ele não representa latência absoluta entre a placa e o PC. O atraso na rede ou no broker pode ocupar a fila do firmware. Se ela encher, a ESP continua emitindo pela UART, e o resumo contabiliza as perdas da fila.

Em 19/11/2026, o firmware foi compilado e gravado na ESP32-C6 da COM58. O modo somente Serial entregou 600 de 600 eventos, sem lacunas, registros inválidos ou duplicatas. O coletor também foi exercitado contra um Mosquitto local com uma UART simulada e comparou os payloads byte a byte.

No ensaio físico híbrido `4d94966a`, a placa publicou por Wi-Fi para um Mosquitto temporário no PC, com autenticação de bancada e MQTT/TCP em QoS 0. O coletor recebeu 600 de 600 registros em cada canal, na ordem de 0 a 599. Os 600 payloads coincidiram byte a byte, sem lacunas, duplicatas, registros inválidos ou descartes na fila da placa. A diferença dos tempos de recepção no PC teve mediana de 50,61 ms, mínimo de 1,49 ms e máximo de 272,33 ms. Foi uma única execução, coletada pelo script Python.
