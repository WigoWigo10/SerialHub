#include <Arduino.h>
#include <esp_timer.h>

#ifndef BENCH_BAUD
#define BENCH_BAUD 115200
#endif

#ifndef BENCH_HZ
#define BENCH_HZ 50
#endif

constexpr size_t frameBytes = 128;
static_assert(BENCH_HZ > 0 && BENCH_HZ <= 1000000);
static_assert(uint64_t(BENCH_HZ) * frameBytes * 10 < BENCH_BAUD,
              "Bench traffic must fit in the UART 8N1 link");
constexpr int64_t periodUs = 1000000 / BENCH_HZ;

void sendFrames(void *) {
  uint64_t sequence = 0;
  int64_t nextFrameUs = esp_timer_get_time();

  for (;;) {
    const int64_t nowUs = esp_timer_get_time();
    if (nowUs < nextFrameUs) {
      delay(1);
      continue;
    }

    // Expose scheduler overruns as gaps instead of sending a burst to catch up.
    const int64_t missed = (nowUs - nextFrameUs) / periodUs;
    sequence += missed;
    nextFrameUs += (missed + 1) * periodUs;

    char frame[frameBytes];
    const int prefix = snprintf(frame, sizeof(frame), "SHC6,%020llu,%020llu,",
                                (unsigned long long)sequence++,
                                (unsigned long long)nowUs);
    for (size_t i = prefix; i < frameBytes - 1; ++i) {
      frame[i] = 'A' + (i - prefix) % 26;
    }
    frame[frameBytes - 1] = '\n';
    Serial0.write(reinterpret_cast<const uint8_t *>(frame), frameBytes);
  }
}

void setup() {
  Serial0.begin(BENCH_BAUD, SERIAL_8N1);
  // The Arduino loop task yields for 5 ticks every 2 s on single-core chips.
  if (xTaskCreate(sendFrames, "serial-bench", 4096, nullptr, 2, nullptr) != pdPASS) {
    Serial0.println("SHC6: could not start serial bench task");
  }
}

void loop() {
  delay(1000);
}
