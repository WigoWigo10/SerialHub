"""Windows/com0com integration harness. Never selects ports automatically.

Only duration/send/reopen open ports, after setupc list + live PnP verification.
The optional sender dependency is pyserial==3.5; inventory/tests use stdlib only.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

PAYLOAD = b"SERIALHUB ASCII\r\nline2\n\x00\xff\x80\xc3\x28END\r\n"
READY = b"Recebendo bytes;"
ENDED = "Duração encerrada".encode("utf-8")

INVENTORY_PS = r"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$serial = @(Get-CimInstance Win32_SerialPort |
    Select-Object DeviceID,Name,PNPDeviceID,Description)
$pnp = @(Get-CimInstance Win32_PnPEntity | Where-Object {
    $_.PNPClass -eq 'Ports' -or
    $_.Name -match 'com0com|virtual serial|virtual port|CNCA|CNCB|VSPE|HHD|ELTIMA'
} | Select-Object Name,PNPDeviceID,Service,Status,Manufacturer)
$drivers = @(Get-CimInstance Win32_SystemDriver | Where-Object {
    $_.Name -match 'com0com|vspe|vserial|vport|eltima|hhd' -or
    $_.DisplayName -match 'virtual serial|com0com'
} | Select-Object Name,DisplayName,State,PathName)
$registry = @()
if (Test-Path 'HKLM:\HARDWARE\DEVICEMAP\SERIALCOMM') {
    $registry = @((Get-ItemProperty 'HKLM:\HARDWARE\DEVICEMAP\SERIALCOMM').
        PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } |
        ForEach-Object { @{ device = $_.Name; port = $_.Value } })
}
@{serial_ports=$serial; pnp=$pnp; drivers=$drivers; registry=$registry} |
    ConvertTo-Json -Depth 6 -Compress
"""


def inventory():
    if os.name != "nt":
        raise RuntimeError("This procedure requires Windows.")
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", INVENTORY_PS],
        capture_output=True, timeout=30,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.decode("utf-8", errors="replace"))
    return json.loads(result.stdout.decode("utf-8-sig"))


def normalize_port(value):
    port = value.upper()
    if not re.fullmatch(r"COM[1-9][0-9]*", port) or port == "COM3":
        raise ValueError("Use an explicit COM number; COM3 Intel AMT is excluded.")
    return port


def parse_pairs(text):
    pairs = {}
    for line in text.splitlines():
        match = re.match(r"\s*CNC([AB])(\d+)\s+(.+)", line, re.IGNORECASE)
        if not match:
            continue
        side, number, params = match.groups()
        fields = dict(re.findall(r"(\w+)=([^,\s]+)", params.lower()))
        port = fields.get("portname", "").upper()
        if port == "COM#":
            port = fields.get("realportname", "").upper()
        if not re.fullmatch(r"COM[1-9][0-9]*", port):
            continue
        pair = pairs.setdefault(number, {})
        if side.upper() in pair:
            raise ValueError("Ambiguous setupc output; confirm mapping manually.")
        pair[side.upper()] = port
    return pairs


def confirm_pair(monitor, sender, mapping, live):
    monitor, sender = normalize_port(monitor), normalize_port(sender)
    if monitor == sender:
        raise ValueError("The endpoints must be different.")
    matches = [n for n, p in parse_pairs(mapping).items()
               if len(p) == 2 and set(p.values()) == {monitor, sender}]
    if len(matches) != 1:
        raise ValueError("setupc list did not confirm one matching A/B pair.")
    for port in (monitor, sender):
        devices = [p for p in live["pnp"]
                   if re.search(r"\(" + port + r"\)$", p.get("Name") or "", re.I)]
        if len(devices) != 1:
            raise ValueError(f"PnP did not uniquely identify {port}.")
        device = devices[0]
        identity = (device.get("Service") or "") + (device.get("PNPDeviceID") or "")
        if device.get("Status") != "OK" or "com0com" not in identity.lower():
            raise ValueError(f"{port} is not an active com0com endpoint in PnP.")
    return matches[0]


def open_sender(port):
    try:
        import serial
    except ImportError as error:
        raise RuntimeError("Install pyserial==3.5 in a separate venv; see stage 6.") from error
    # Driver control-line defaults apply; no hardware/software handshake required.
    return serial.Serial(port, 115200, bytesize=8, parity="N", stopbits=1,
                         timeout=0.05, write_timeout=2,
                         xonxoff=False, rtscts=False, dsrdtr=False)


def write_payload(sender, payload):
    offset = 0
    while offset < len(payload):
        count = sender.write(payload[offset:])
        if not count or count > len(payload) - offset:
            raise RuntimeError("Sender made invalid write progress.")
        offset += count
    sender.flush()


def check_capture(stdout, stderr, code, expected):
    if code != 0:
        raise RuntimeError(f"Monitor returned {code}, expected 0.")
    if stdout != expected:
        raise RuntimeError(f"Byte mismatch: expected {expected.hex()}, got {stdout.hex()}.")
    if READY not in stderr or ENDED not in stderr:
        raise RuntimeError("Expected monitor state messages absent from stderr.")
    if expected and expected in stderr:
        raise RuntimeError("Payload unexpectedly present in stderr.")


def run_monitor(exe, port, duration, output, label, sender=None):
    command = [str(exe), "serial", "monitor", "--port", port,
               "--baud", "115200", "--duration", str(duration)]
    start = time.monotonic()
    outpath, errpath = output / f"{label}.stdout.bin", output / f"{label}.stderr.bin"
    with outpath.open("wb") as out, errpath.open("wb") as err:
        process = subprocess.Popen(command, stdout=out, stderr=err)
        try:
            if sender is not None:
                deadline = time.monotonic() + 10
                while READY not in errpath.read_bytes():
                    if process.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError("Monitor did not become ready before send.")
                    time.sleep(0.02)
                write_payload(sender, PAYLOAD)
            code = process.wait(timeout=duration + 15)
        finally:
            if process.poll() is None:
                process.kill()  # failed harness run; never counts as native cancellation
                process.wait(timeout=10)
    stdout, stderr = outpath.read_bytes(), errpath.read_bytes()
    result = {"command": command, "exit": code, "seconds": time.monotonic() - start,
              "stdout_hex": stdout.hex(), "stdout_sha256": hashlib.sha256(stdout).hexdigest(),
              "stderr_file": errpath.name}
    (output / f"{label}.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    check_capture(stdout, stderr, code, PAYLOAD if sender is not None else b"")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["inventory", "confirm", "duration", "send", "reopen"])
    parser.add_argument("--setupc", type=Path, help="Installed com0com setupc.exe (list only)")
    parser.add_argument("--monitor-port")
    parser.add_argument("--sender-port")
    parser.add_argument("--exe", type=Path)
    parser.add_argument("--duration", type=float, default=5)
    parser.add_argument("--output", type=Path, required=True, help="New evidence directory")
    args = parser.parse_args(argv)
    if args.mode != "inventory":
        if not args.setupc or not args.monitor_port or not args.sender_port:
            parser.error("Provide setupc and both explicitly confirmed endpoints.")
        try:
            args.monitor_port = normalize_port(args.monitor_port)
            args.sender_port = normalize_port(args.sender_port)
        except ValueError as error:
            parser.error(str(error))
        if not 3 <= args.duration <= 600:
            parser.error("duration must be between 3 and 600 seconds.")
        if args.mode in ("duration", "reopen") and (not args.exe or not args.exe.is_file()):
            parser.error("Provide the compiled serialhub.exe.")
    args.output.mkdir(parents=True, exist_ok=False)
    report = {"mode": args.mode, "passed": False, "native_monitor_test": False}
    try:
        live = inventory()
        (args.output / "inventory.json").write_text(json.dumps(live, indent=2), encoding="utf-8")
        if args.mode == "inventory":
            report.update(passed=True, meaning="Read-only inventory; not a serial test.")
        else:
            mapping = subprocess.run([str(args.setupc.resolve()), "list"], capture_output=True, timeout=15)
            (args.output / "setupc-list.stdout.bin").write_bytes(mapping.stdout)
            (args.output / "setupc-list.stderr.bin").write_bytes(mapping.stderr)
            if mapping.returncode:
                raise RuntimeError(f"setupc list returned {mapping.returncode}.")
            report["pair_id"] = confirm_pair(args.monitor_port, args.sender_port,
                                             mapping.stdout.decode("utf-8", errors="replace"), live)
            report.update(monitor_port=args.monitor_port, sender_port=args.sender_port)
            (args.output / "expected.bin").write_bytes(PAYLOAD)
            if args.mode == "confirm":
                report.update(passed=True, meaning="Pair confirmed; no port opened.")
            elif args.mode == "send":
                with open_sender(args.sender_port) as sender:
                    write_payload(sender, PAYLOAD)
                report.update(passed=True, meaning="Sent only; GUI reception must be inspected.")
            elif args.mode == "duration":
                with open_sender(args.sender_port) as sender:
                    report["duration"] = run_monitor(args.exe.resolve(), args.monitor_port,
                                                      args.duration, args.output, "duration", sender)
                report["reopen"] = run_monitor(args.exe.resolve(), args.monitor_port,
                                                0.25, args.output, "reopen")
                report.update(passed=True, native_monitor_test=True)
            else:
                report["reopen"] = run_monitor(args.exe.resolve(), args.monitor_port,
                                                0.25, args.output, "reopen")
                report.update(passed=True, native_monitor_test=True)
    except Exception as error:
        report["error"] = str(error)
        print(str(error), file=sys.stderr)
    finally:
        (args.output / "result.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=True))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
