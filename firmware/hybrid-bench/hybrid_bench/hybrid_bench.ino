#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <esp_random.h>
#include <esp_timer.h>
#include <atomic>

namespace {
constexpr uint32_t kBaud = 921600;
constexpr uint32_t kCount = 600;
constexpr int64_t kPeriodUs = 50000;
constexpr char kTopic[] = "serialhub/bench/events";

struct Frame {
  char json[112];
};

struct NetworkConfig {
  char ssid[33];
  char password[65];
  char host[64];
  char mqttUser[33];
  char mqttPassword[65];
  uint16_t port;
};

NetworkConfig network{};
QueueHandle_t outbound;
std::atomic<bool> mqttReady{false};
bool configured = false;
char command[280];
size_t commandLength = 0;
bool commandOverflow = false;
uint32_t runId = 0;
uint32_t sequence = kCount;
uint32_t skippedQueue = 0;
bool sendMqtt = false;
int64_t nextEventUs = 0;

void publishTask(void *) {
  WiFiClient socket;
  socket.setConnectionTimeout(1500);
  PubSubClient mqtt(socket);
  mqtt.setServer(network.host, network.port);
  mqtt.setSocketTimeout(2);
  char clientId[32];
  snprintf(clientId, sizeof(clientId), "sh-bench-%08lx",
           static_cast<unsigned long>(esp_random()));
  int64_t retryAt = 0;
  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      mqttReady.store(false);
      if (socket.connected()) socket.stop();
      delay(50);
      continue;
    }
    if (!mqtt.connected()) {
      mqttReady.store(false);
      if (esp_timer_get_time() >= retryAt) {
        const bool connected = network.mqttUser[0]
            ? mqtt.connect(clientId, network.mqttUser, network.mqttPassword)
            : mqtt.connect(clientId);
        if (connected) socket.setNoDelay(true);
        retryAt = esp_timer_get_time() + 2000000;
      }
      delay(10);
      continue;
    }
    mqttReady.store(mqtt.loop());
    Frame frame{};
    if (mqttReady.load() && xQueueReceive(outbound, &frame, pdMS_TO_TICKS(10))) {
      mqtt.publish(kTopic, frame.json, false);
    }
  }
}

void configure(char *arguments) {
  if (configured || sequence < kCount) {
    Serial0.println("# CONFIG_REJECTED reset the board to change settings");
    return;
  }
  char *fields[6] = {arguments};
  for (size_t i = 1; i < 6; ++i) {
    char *separator = strchr(fields[i - 1], '\t');
    if (!separator) {
      Serial0.println("# CONFIG_INVALID");
      return;
    }
    *separator = '\0';
    fields[i] = separator + 1;
  }
  char *end;
  const long port = strtol(fields[3], &end, 10);
  if (!fields[0][0] || strlen(fields[0]) >= sizeof(network.ssid) ||
      strlen(fields[1]) >= sizeof(network.password) || !fields[2][0] ||
      strlen(fields[2]) >= sizeof(network.host) || *end || port < 1 || port > 65535 ||
      strlen(fields[4]) >= sizeof(network.mqttUser) ||
      strlen(fields[5]) >= sizeof(network.mqttPassword)) {
    Serial0.println("# CONFIG_INVALID");
    return;
  }
  strcpy(network.ssid, fields[0]);
  strcpy(network.password, fields[1]);
  strcpy(network.host, fields[2]);
  strcpy(network.mqttUser, fields[4]);
  strcpy(network.mqttPassword, fields[5]);
  network.port = static_cast<uint16_t>(port);
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(network.ssid, network.password);
  memset(network.password, 0, sizeof(network.password));
  configured = xTaskCreate(publishTask, "bench-mqtt", 6144, nullptr, 1, nullptr) == pdPASS;
  Serial0.println(configured ? "# CONFIG_OK" : "# CONFIG_TASK_FAILED");
}

void beginRun(bool hybrid) {
  if (sequence < kCount) {
    Serial0.println("# BUSY");
    return;
  }
  if (hybrid && !mqttReady.load()) {
    Serial0.println("# WAIT_MQTT");
    return;
  }
  runId = esp_random();
  sequence = 0;
  skippedQueue = 0;
  sendMqtt = hybrid;
  nextEventUs = esp_timer_get_time();
  Serial0.printf("# STARTED %08lx %lu\n", static_cast<unsigned long>(runId),
                 static_cast<unsigned long>(kCount));
}

void readCommands() {
  for (size_t i = 0; i < sizeof(command) && Serial0.available(); ++i) {
    char value = static_cast<char>(Serial0.read());
    if (value == '\n') {
      command[commandLength] = '\0';
      if (!commandOverflow) {
        if (strncmp(command, "CONFIG\t", 7) == 0) configure(command + 7);
        else if (strcmp(command, "START") == 0) beginRun(true);
        else if (strcmp(command, "SERIAL") == 0) beginRun(false);
        else Serial0.println("# UNKNOWN_COMMAND");
      }
      memset(command, 0, sizeof(command));
      commandLength = 0;
      commandOverflow = false;
    } else if (value != '\r') {
      if (commandLength < sizeof(command) - 1) command[commandLength++] = value;
      else commandOverflow = true;
    }
  }
}
}  // namespace

void setup() {
  Serial0.begin(kBaud, SERIAL_8N1);
  outbound = xQueueCreate(32, sizeof(Frame));
  if (!outbound) {
    Serial0.println("# QUEUE_FAILED");
    return;
  }
  Serial0.println("# SERIALHUB_HYBRID_READY");
}

void loop() {
  if (!outbound) {
    delay(1000);
    return;
  }
  readCommands();
  const int64_t now = esp_timer_get_time();
  if (sequence < kCount && now >= nextEventUs) {
    Frame frame{};
    snprintf(frame.json, sizeof(frame.json),
             "{\"run\":\"%08lx\",\"seq\":%lu,\"source_us\":%lld}",
             static_cast<unsigned long>(runId), static_cast<unsigned long>(sequence),
             static_cast<long long>(now));
    Serial0.println(frame.json);
    if (sendMqtt && xQueueSend(outbound, &frame, 0) != pdPASS) ++skippedQueue;
    ++sequence;
    const int64_t following = nextEventUs + kPeriodUs;
    nextEventUs = following > now ? following : now + kPeriodUs;
    if (sequence == kCount) {
      Serial0.printf("# DONE %08lx %lu %lu\n", static_cast<unsigned long>(runId),
                     static_cast<unsigned long>(sequence), static_cast<unsigned long>(skippedQueue));
    }
  }
  delay(1);
}
