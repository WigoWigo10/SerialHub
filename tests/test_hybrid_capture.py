import importlib.util
import io
import unittest
from pathlib import Path
from unittest.mock import patch


source = Path(__file__).resolve().parents[1] / "firmware/hybrid-bench/capture.py"
spec = importlib.util.spec_from_file_location("hybrid_capture", source)
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)

FRAME = b'{"run":"abcd","seq":0,"source_us":1}'
START = b"# STARTED abcd 1\n"
TRACKING = b"# MQTT_TRACKING abcd\n"
DONE = b"# DONE abcd 1 0\n"


class Clock:
    def __init__(self):
        self.now = 0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class SimulatedPort:
    def __init__(self, clock, chunks):
        self.clock = clock
        self.chunks = iter(chunks)
        self.writes = []

    @property
    def in_waiting(self):
        return 512

    def write(self, payload):
        self.writes.append(payload)

    def readline(self):
        return b"# CONFIG_OK\n"

    def read(self, _size):
        delay, chunk = next(self.chunks, (1, b""))
        self.clock.sleep(delay)
        return chunk


class HybridCaptureTest(unittest.TestCase):
    def receive(self, chunks, provision=b"test-config\n"):
        clock = Clock()
        port = SimulatedPort(clock, chunks)
        frames = []
        diagnostics = io.BytesIO()
        with patch.object(capture.time, "monotonic", clock.monotonic):
            result = capture.receive(port, provision, frames, diagnostics)
        return result, port, frames, diagnostics.getvalue()

    def test_waits_for_drain_after_serial_done_and_records_publish_failure(self):
        diagnostic = b"# DIAG 32700000 MQTT_PUBLISH_FAILED -3 0\n"
        drain = b"# MQTT_DRAINED abcd 0 1\n"
        result, port, frames, log = self.receive([
            (0, START + TRACKING + FRAME[:15]),
            (0, FRAME[15:] + b"\r\n" + DONE),
            (12, diagnostic + drain),
        ])
        self.assertEqual(result, capture.RunResult("abcd", 1, 0, "drained", 0, 1))
        self.assertEqual(port.writes, [b"test-config\n", b"START\n"])
        self.assertEqual([wire for _, wire in frames], [FRAME])
        self.assertEqual(log, START + TRACKING + DONE + diagnostic + drain)

    def test_missing_marker_returns_partial_result_after_deadline(self):
        result, _, frames, log = self.receive([(0, START + TRACKING + FRAME + b"\n" + DONE)])
        self.assertEqual(result, capture.RunResult("abcd", 1, 0, "timeout"))
        self.assertEqual(len(frames), 1)
        self.assertTrue(log.endswith(DONE))

    def test_inconsistent_drained_counts_are_rejected(self):
        for line in (b"# MQTT_DRAINED abcd 1 1\n", b"# MQTT_DRAINED another 1 0\n"):
            with self.subTest(line=line), self.assertRaisesRegex(RuntimeError, "inconsistent"):
                self.receive([(0, START + TRACKING + DONE + line)])

    def test_serial_only_and_legacy_still_finish_on_done(self):
        for provision, expected in ((None, "disabled"), (b"legacy-config\n", "legacy")):
            with self.subTest(provision=provision):
                result, _, _, _ = self.receive([(0, START + DONE)], provision)
                self.assertEqual(result.drain_status, expected)

    def test_delivery_grace_waits_for_a_matching_late_frame(self):
        clock = Clock()
        observed = [(0, FRAME.replace(b"abcd", b"else"))]

        def sleep(seconds):
            clock.sleep(seconds)
            if clock.now >= 3 and len(observed) == 1:
                observed.append((0, FRAME))

        with (patch.object(capture.time, "monotonic", clock.monotonic),
              patch.object(capture.time, "sleep", sleep)):
            capture.wait_for_mqtt(capture.RunResult("abcd", 1, 0, "drained", 1, 0), observed)
        self.assertGreaterEqual(clock.now, 3)
        self.assertLess(clock.now, 5)


if __name__ == "__main__":
    unittest.main()
