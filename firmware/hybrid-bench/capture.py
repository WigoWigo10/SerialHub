"""Compare events from the ESP32-C6 hybrid bench over Serial and MQTT."""

import argparse
import json
import math
import statistics
import threading
import time
from pathlib import Path
from typing import NamedTuple

import serial


TOPIC = "serialhub/bench/events"
MQTT_DRAIN_TIMEOUT = 45
MQTT_DELIVERY_GRACE = 5


class RunResult(NamedTuple):
    run_id: str
    count: int
    queue_drops: int
    drain_status: str
    published: int | None = None
    publish_failures: int | None = None


def configuration(path):
    values = json.loads(path.read_text(encoding="utf-8-sig"))
    port = int(values["broker_port"])
    fields = (
        (values["ssid"], 32), (values.get("password", ""), 64),
        (values["broker_host"], 63), (str(port), 5),
        (values.get("mqtt_user", ""), 32), (values.get("mqtt_password", ""), 64),
    )
    if not fields[0][0] or not fields[2][0] or not 1 <= port <= 65535:
        raise ValueError("Fill in the Wi-Fi SSID, broker host and port in the local config")
    for value, size in fields:
        if (not isinstance(value, str) or len(value.encode()) > size
                or any(char in value for char in "\t\r\n\0")):
            raise ValueError("Invalid field size or separator in the local config")
    return values, b"CONFIG\t" + b"\t".join(value.encode() for value, _ in fields) + b"\n"


def start_mqtt(config, host_override, observed):
    import paho.mqtt.client as mqtt

    ready = threading.Event()
    errors = []
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, protocol=mqtt.MQTTv311)
    if config.get("mqtt_user"):
        client.username_pw_set(config["mqtt_user"], config.get("mqtt_password"))

    def on_connect(connection, _userdata, _flags, reason, _properties):
        if reason.is_failure:
            errors.append(f"MQTT connection refused: {reason}")
            ready.set()
        else:
            connection.subscribe(TOPIC, qos=0)

    def on_subscribe(_client, _userdata, _mid, reasons, _properties):
        if not reasons or any(reason.is_failure for reason in reasons):
            errors.append("MQTT subscription refused")
        ready.set()

    def on_message(_client, _userdata, message):
        observed.append((time.perf_counter_ns(), message.payload))

    client.on_connect = on_connect
    client.on_subscribe = on_subscribe
    client.on_message = on_message
    client.connect(host_override or config["broker_host"], int(config["broker_port"]))
    client.loop_start()
    if not ready.wait(8) or errors:
        client.disconnect()
        client.loop_stop()
        raise RuntimeError(errors[0] if errors else "No MQTT subscription acknowledgement")
    return client


def receive(port, provision, captured, diagnostics):
    if provision:
        port.write(provision)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            line = port.readline().strip()
            if line.startswith(b"# DIAG "):
                diagnostics.write(line + b"\n")
            if line == b"# CONFIG_OK":
                break
            if line.startswith(b"# CONFIG_"):
                raise RuntimeError(line.decode())
        else:
            raise TimeoutError("ESP did not confirm configuration")

    deadline = time.monotonic() + 60
    retry_at = 0.0
    run_start = None
    queue_drops = None
    tracking = False
    data = bytearray()
    while time.monotonic() < deadline:
        now = time.monotonic()
        if run_start is None and now >= retry_at:
            port.write(b"START\n" if provision else b"SERIAL\n")
            retry_at = now + 1
        chunk = port.read(port.in_waiting or 1)
        if not chunk:
            continue
        data.extend(chunk)
        while b"\n" in data:
            raw, _, tail = data.partition(b"\n")
            data = bytearray(tail)
            line = bytes(raw).rstrip(b"\r")
            observed_at = time.perf_counter_ns()
            if line.startswith((b"# DIAG ", b"# STARTED ", b"# DONE ",
                                b"# MQTT_TRACKING ", b"# MQTT_DRAINED ")):
                diagnostics.write(line + b"\n")
            if line.startswith(b"# STARTED ") and run_start is None:
                _, _, run, count = line.split()
                run_start = run.decode(), int(count)
                deadline = time.monotonic() + 45
            elif run_start and line.startswith(b"# MQTT_TRACKING "):
                if line == f"# MQTT_TRACKING {run_start[0]}".encode():
                    tracking = bool(provision)
            elif run_start and queue_drops is None and line.startswith(b"# DONE "):
                _, _, run, count, skipped = line.split()
                if (run.decode(), int(count)) != run_start:
                    raise RuntimeError("ESP reported a different run at completion")
                queue_drops = int(skipped)
                if not tracking:
                    return RunResult(*run_start, queue_drops, "legacy" if provision else "disabled")
                deadline = time.monotonic() + MQTT_DRAIN_TIMEOUT
            elif queue_drops is not None and line.startswith(b"# MQTT_DRAINED "):
                _, _, run, published, failed = line.split()
                finished, failures = int(published), int(failed)
                if (run.decode() != run_start[0] or min(queue_drops, finished, failures) < 0
                        or queue_drops + finished + failures != run_start[1]):
                    raise RuntimeError("ESP reported inconsistent MQTT drain counts")
                return RunResult(*run_start, queue_drops, "drained", finished, failures)
            elif run_start and queue_drops is None and not line.startswith(b"# "):
                captured.append((observed_at, line))
        if len(data) > 4096:
            data.clear()
    if queue_drops is not None:
        return RunResult(*run_start, queue_drops, "timeout")
    raise TimeoutError("ESP did not finish the run; check the COM port and MQTT reachability")


def wait_for_mqtt(result, observed):
    if result.drain_status == "legacy":
        time.sleep(2)
        return
    if result.drain_status != "drained":
        return
    # A successful QoS 0 write is local to the ESP. Give the broker and
    # subscriber time to deliver the final records before measuring the gap.
    deadline = time.monotonic() + MQTT_DELIVERY_GRACE
    matched_sequences = set()
    offset = 0
    while time.monotonic() < deadline:
        batch = observed[offset:]
        offset += len(batch)
        for _, wire in batch:
            frame = decode_frame(wire)
            if frame and frame.get("run") == result.run_id:
                seq = frame.get("seq")
                if type(seq) is int and 0 <= seq < result.count:
                    matched_sequences.add(seq)
        if len(matched_sequences) == result.count:
            return
        time.sleep(0.05)


def decode_frame(wire):
    try:
        frame = json.loads(wire)
    except (ValueError, UnicodeError):
        return None
    return frame if isinstance(frame, dict) else None


def index_records(observed, run, count, output):
    records = {}
    invalid = duplicates = 0
    with output.open("w", encoding="utf-8") as file:
        for received_ns, wire in observed:
            frame = decode_frame(wire)
            if frame is None:
                invalid += 1
                continue
            if frame.get("run") != run:
                continue
            seq = frame.get("seq")
            source = frame.get("source_us")
            if type(seq) is not int or not 0 <= seq < count or type(source) is not int or source < 0:
                invalid += 1
                continue
            file.write(json.dumps({"received_ns": received_ns, "frame": frame}) + "\n")
            if seq in records:
                duplicates += 1
            else:
                records[seq] = received_ns, wire
    return records, invalid, duplicates


def run(args):
    network, wire_config = configuration(args.config) if args.config else (None, None)
    args.output.mkdir(parents=True, exist_ok=False)
    uart = []
    mqtt_rx = []
    mqtt = start_mqtt(network, args.broker_client_host, mqtt_rx) if network else None
    try:
        with (serial.Serial(port=None, baudrate=921600, timeout=0.1, write_timeout=2) as port,
              (args.output / "diagnostics.log").open("wb") as diagnostics):
            port.dtr = False
            port.rts = False
            port.port = args.port
            port.open()
            time.sleep(1)
            port.reset_input_buffer()
            result = receive(port, wire_config, uart, diagnostics)
            if mqtt:
                wait_for_mqtt(result, mqtt_rx)
    finally:
        if mqtt:
            mqtt.disconnect()
            mqtt.loop_stop()

    run_id, count, queue_drops = result.run_id, result.count, result.queue_drops
    serial_map, serial_invalid, serial_duplicates = index_records(
        uart, run_id, count, args.output / "serial.jsonl")
    summary = {
        "run": run_id, "expected": count, "serial_received": len(serial_map),
        "serial_missing": count - len(serial_map), "serial_invalid": serial_invalid,
        "serial_duplicates": serial_duplicates, "firmware_mqtt_queue_drops": queue_drops,
    }
    passed = len(serial_map) == count and not (serial_invalid or serial_duplicates)
    if mqtt:
        mqtt_map, mqtt_invalid, mqtt_duplicates = index_records(
            mqtt_rx, run_id, count, args.output / "mqtt.jsonl")
        shared = serial_map.keys() & mqtt_map.keys()
        different = sum(serial_map[seq][1] != mqtt_map[seq][1] for seq in shared)
        delta = sorted((mqtt_map[seq][0] - serial_map[seq][0]) / 1e6 for seq in shared)
        summary.update(
            firmware_mqtt_drain_status=result.drain_status,
            firmware_mqtt_publish_successes=result.published,
            firmware_mqtt_publish_failures=result.publish_failures,
            mqtt_received=len(mqtt_map), mqtt_missing=count - len(mqtt_map),
            mqtt_invalid=mqtt_invalid, mqtt_duplicates=mqtt_duplicates,
            matched=len(shared), payload_differences=different,
            host_arrival_delta_ms=(
                {"min": delta[0], "median": statistics.median(delta),
                 "p95": delta[math.ceil(len(delta) * 0.95) - 1], "max": delta[-1]}
                if delta else None
            ),
        )
        passed = passed and len(mqtt_map) == count and not (
            different or mqtt_invalid or mqtt_duplicates or queue_drops
            or result.publish_failures or result.drain_status == "timeout")
    summary["passed"] = passed
    report = json.dumps(summary, indent=2) + "\n"
    (args.output / "summary.json").write_text(report, encoding="utf-8")
    print(report, end="")
    return 0 if passed else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", required=True)
    parser.add_argument("--output", type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--serial-only", action="store_true")
    mode.add_argument("--config", type=Path)
    parser.add_argument("--broker-client-host", help="Broker address for the collector, if different from the ESP address")
    args = parser.parse_args()
    try:
        return run(args)
    except (OSError, ValueError, RuntimeError) as error:
        parser.exit(1, f"{parser.prog}: {error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
