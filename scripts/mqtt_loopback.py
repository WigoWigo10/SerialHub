"""Run the SerialHub MQTT transport test against a temporary loopback Mosquitto."""

import argparse
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from collections import deque
from contextlib import ExitStack


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "src-tauri/src/commands/mqtt_transport/fixtures"


def verify_broker_burst(port, root):
    import paho.mqtt.client as mqtt

    messages, topics, size = 2000, 32, 1024
    ready = threading.Event()
    all_received = threading.Event()
    received = []
    subscriber = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    publisher = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    for client in (subscriber, publisher):
        client.tls_set(ca_certs=str(root / "ca.pem"))

    def on_message(_client, _userdata, message):
        received.append((message.topic, message.payload))
        if len(received) == messages:
            all_received.set()

    subscriber.on_message = on_message
    def on_connect(client, _userdata, _flags, reason, _properties):
        if not reason.is_failure:
            client.subscribe("serialhub/burst/#", qos=1)

    def on_subscribe(_client, _userdata, _mid, reasons, _properties):
        if reasons and not any(reason.is_failure for reason in reasons):
            ready.set()

    subscriber.on_connect = on_connect
    subscriber.on_subscribe = on_subscribe
    subscriber.connect("localhost", port)
    subscriber.loop_start()
    try:
        if not ready.wait(5):
            raise RuntimeError("TLS burst subscription was not acknowledged")
        publisher.connect("localhost", port)
        publisher.loop_start()
        start = time.monotonic()
        expected = [
            (f"serialhub/burst/{sequence % topics}", sequence.to_bytes(4, "big") + b"\xa5" * (size - 4))
            for sequence in range(messages)
        ]
        # Bound outstanding publishes to keep the broker's default queue meaningful.
        for offset in range(0, messages, 32):
            pending = [publisher.publish(topic, payload, qos=1)
                       for topic, payload in expected[offset:offset + 32]]
            for receipt in pending:
                receipt.wait_for_publish(5)
                if not receipt.is_published():
                    raise RuntimeError("TLS burst publication was not acknowledged")
        if not all_received.wait(5) or received != expected:
            raise RuntimeError(f"TLS burst sequence or payload mismatch ({len(received)}/{messages})")
        print(f"TLS burst via Paho: {messages} messages, {topics} topics, {size} B each, "
              f"{time.monotonic() - start:.2f} s", flush=True)
    finally:
        for client in (subscriber, publisher):
            client.disconnect()
            client.loop_stop()


def show_log(log_path):
    with log_path.open(encoding="utf-8", errors="replace") as log:
        print("".join(deque(log, maxlen=60)), end="")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mosquitto", default=shutil.which("mosquitto"),
                        help="path to Mosquitto with TLS and WebSocket support")
    args = parser.parse_args()
    if not args.mosquitto:
        parser.error("specify the Mosquitto executable using --mosquitto")
    executable = Path(args.mosquitto).resolve(strict=True)
    listeners = {"TLS": "mqtt", "MTLS": "mqtt", "WS": "websockets", "WSS": "websockets"}
    with tempfile.TemporaryDirectory(prefix="serialhub-mqtt-") as directory:
        root = Path(directory)
        for name in ("ca.pem", "server.pem", "server-key.pem"):
            shutil.copyfile(FIXTURES / name, root / name)
        env = os.environ.copy()
        config = ["allow_anonymous true", "persistence false", "log_type all"]
        ports = []
        with ExitStack() as reservations:
            for name, protocol in listeners.items():
                sock = reservations.enter_context(socket.socket())
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
                ports.append(port)
                env[f"SERIALHUB_TEST_{name}_PORT"] = str(port)
                config.extend((f"listener {port} 127.0.0.1", f"protocol {protocol}"))
                if name != "WS":
                    config.extend(("cafile ca.pem", "certfile server.pem", "keyfile server-key.pem"))
                if name == "MTLS":
                    config.append("require_certificate true")
            (root / "mosquitto.conf").write_text("\n".join(config) + "\n", encoding="ascii")
        log_path = root / "broker.log"
        with log_path.open("wb") as log:
            broker = subprocess.Popen([executable, "-c", "mosquitto.conf"], cwd=root,
                                      stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 8
                for port in ports:
                    while True:
                        if broker.poll() is not None or time.monotonic() >= deadline:
                            raise RuntimeError("Mosquitto did not start all loopback listeners")
                        try:
                            with socket.create_connection(("127.0.0.1", port), timeout=.2):
                                break
                        except OSError:
                            time.sleep(.1)
                verify_broker_burst(ports[0], root)
                result = subprocess.run(
                    ["cargo", "test", "--locked", "--manifest-path", "src-tauri/Cargo.toml",
                     "mosquitto_transport_and_lwt", "--", "--ignored", "--nocapture"],
                    cwd=ROOT, env=env,
                )
                if result.returncode:
                    show_log(log_path)
                return result.returncode
            except RuntimeError:
                show_log(log_path)
                raise
            finally:
                if broker.poll() is None:
                    broker.terminate()
                    broker.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
