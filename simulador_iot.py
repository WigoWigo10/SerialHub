import time
import random
import math
import json
import paho.mqtt.client as mqtt

# --- CONFIGURAÇÕES ---
BROKER = "broker.hivemq.com"
PORT = 1883
TOPIC_GRAFICO = "serialhub/simulador/temp_raw"   # Envia apenas o número
TOPIC_JSON    = "serialhub/simulador/dados"      # Envia JSON completo

# Identificador único
CLIENT_ID = f"SerialHub_Python_Sim_{random.randint(1000, 9999)}"

# --- LÓGICA DE SIMULAÇÃO ---
def gerar_temperatura(index):
    # Cria uma onda senoidal (sobe e desce) + ruído
    base = 25.0
    variacao = 10.0 * math.sin(index * 0.1) # Oscila entre 15 e 35 graus
    ruido = random.uniform(-0.5, 0.5)
    return base + variacao + ruido

# --- CALLBACKS MQTT (Atualizado para Paho v2) ---
# Nota: A versão 2 adicionou o argumento 'properties' no final
def on_connect(client, userdata, flags, reason_code, properties):
    if reason_code == 0:
        print(f"✅ Conectado ao Broker: {BROKER}")
        print(f"📡 Enviando dados para: {TOPIC_GRAFICO}")
    else:
        print(f"❌ Falha na conexão. Código: {reason_code}")

# --- SETUP ---
# Correção do Erro: Definindo explicitamente a versão da API (VERSION2)
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, CLIENT_ID)
client.on_connect = on_connect

print("🔌 Conectando ao HiveMQ...")
try:
    client.connect(BROKER, PORT, 60)
except Exception as e:
    print(f"Erro ao conectar (verifique sua internet ou firewall): {e}")
    exit()

# Inicia o loop em thread separada
client.loop_start()

# --- LOOP DE ENVIO ---
index = 0
try:
    while True:
        # 1. Gerar dados
        temp = gerar_temperatura(index)
        umidade = 50 + random.uniform(-5, 5)
        
        # 2. Preparar Payloads
        payload_raw = f"{temp:.2f}"
        
        payload_json = json.dumps({
            "temperatura": round(temp, 2),
            "umidade": round(umidade, 1),
            "bateria": 98,
            "status": "ativo"
        })

        # 3. Publicar
        client.publish(TOPIC_GRAFICO, payload_raw)
        client.publish(TOPIC_JSON, payload_json)

        # Log no terminal
        print(f"📤 [{TOPIC_GRAFICO}] Valor: {payload_raw} ºC")

        # Aguarda 0.5s para o gráfico ficar mais fluido
        time.sleep(0.5) 
        index += 1

except KeyboardInterrupt:
    print("\n🛑 Parando simulador...")
    client.loop_stop()
    client.disconnect()