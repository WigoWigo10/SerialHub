"""Harness contract tests only; no Windows device/driver is used."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "serial_integration.py"
spec = importlib.util.spec_from_file_location("serial_integration", SCRIPT)
integration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(integration)

MAPPING = "CNCA0 PortName=COM10\nCNCB0 PortName=COM11\n"


def live_pair():
    return {"pnp": [{"Name": f"com0com - serial port emulator ({port})",
                     "Service": "com0com", "PNPDeviceID": "com0com\\port",
                     "Status": "OK"} for port in ("COM10", "COM11")]}


class HarnessTests(unittest.TestCase):
    def test_pair_requires_same_a_b_identifier(self):
        self.assertEqual(integration.confirm_pair("COM10", "COM11", MAPPING, live_pair()), "0")
        with self.assertRaises(ValueError):
            integration.confirm_pair("COM10", "COM11", MAPPING.replace("CNCB0", "CNCB1"), live_pair())

    def test_windows_assigned_real_port_name(self):
        mapping = "CNCA2 PortName=COM#,RealPortName=COM10\nCNCB2 PortName=COM11"
        self.assertEqual(integration.confirm_pair("COM10", "COM11", mapping, live_pair()), "2")

    def test_rejects_physical_pnp_identity(self):
        live = live_pair()
        live["pnp"][0].update(Service="Serial", PNPDeviceID="PCI\\VEN_8086")
        with self.assertRaises(ValueError):
            integration.confirm_pair("COM10", "COM11", MAPPING, live)

    def test_rejects_missing_disabled_or_ambiguous_endpoint(self):
        disabled = live_pair()
        disabled["pnp"][0]["Status"] = "Error"
        ambiguous = live_pair()
        ambiguous["pnp"].append(ambiguous["pnp"][0].copy())
        for live in ({"pnp": []}, disabled, ambiguous):
            with self.assertRaises(ValueError):
                integration.confirm_pair("COM10", "COM11", MAPPING, live)
        with self.assertRaises(ValueError):
            integration.parse_pairs(MAPPING + "CNCA0 PortName=COM12")

    def test_com3_same_port_and_invalid_names_are_rejected(self):
        for monitor, sender in [("com3", "COM11"), ("COM10", "COM10"), ("COM10;exit", "COM11")]:
            with self.assertRaises(ValueError):
                integration.confirm_pair(monitor, sender, MAPPING, live_pair())

    def test_payload_contains_ascii_crlf_lf_nul_and_non_utf8(self):
        payload = integration.PAYLOAD
        for part in (b"SERIALHUB ASCII", b"\r\n", b"line2\n", b"\x00", b"\xff\x80"):
            self.assertIn(part, payload)
        with self.assertRaises(UnicodeDecodeError):
            payload.decode("utf-8")

    def test_partial_sender_writes_preserve_every_byte(self):
        accepted = bytearray()
        sender = Mock()

        def write(data):
            accepted.extend(data[:2])
            return min(2, len(data))

        sender.write.side_effect = write
        integration.write_payload(sender, integration.PAYLOAD)
        self.assertEqual(bytes(accepted), integration.PAYLOAD)
        sender.flush.assert_called_once()

    def test_stalled_sender_fails(self):
        sender = Mock()
        sender.write.return_value = 0
        with self.assertRaises(RuntimeError):
            integration.write_payload(sender, integration.PAYLOAD)

    def test_exact_bytes_exit_and_stderr_are_checked(self):
        status = integration.READY + integration.ENDED
        integration.check_capture(integration.PAYLOAD, status, 0, integration.PAYLOAD)
        for out, err, code in [(integration.PAYLOAD + b"\n", status, 0),
                               (integration.PAYLOAD, status, 1),
                               (integration.PAYLOAD, b"", 0),
                               (integration.PAYLOAD, status + integration.PAYLOAD, 0)]:
            with self.assertRaises(RuntimeError):
                integration.check_capture(out, err, code, integration.PAYLOAD)

    def test_monitor_captures_binary_files_and_checks_reopen_empty(self):
        def fake_start(command, stdout, stderr):
            self.assertEqual(stdout.mode, "wb")
            self.assertEqual(stderr.mode, "wb")
            self.assertIn("--duration", command)
            stderr.write(integration.READY + integration.ENDED)
            stderr.flush()
            process = Mock()
            process.wait.return_value = 0
            process.poll.return_value = 0
            return process

        with tempfile.TemporaryDirectory() as tmp, patch.object(integration.subprocess, "Popen", side_effect=fake_start):
            result = integration.run_monitor(Path("serialhub.exe"), "COM10", 0.25, Path(tmp), "reopen")
            self.assertEqual(result["exit"], 0)
            self.assertEqual((Path(tmp) / "reopen.stdout.bin").read_bytes(), b"")
            self.assertEqual(json.loads((Path(tmp) / "reopen.json").read_text())["stdout_hex"], "")

    def test_duration_runner_waits_for_ready_then_captures_raw_payload(self):
        sender = Mock()

        def fake_start(command, stdout, stderr):
            stderr.write(integration.READY + integration.ENDED)
            stderr.flush()

            def send(data):
                stdout.write(data)
                stdout.flush()
                return len(data)

            sender.write.side_effect = send
            process = Mock()
            process.wait.return_value = 0
            process.poll.return_value = 0
            return process

        with tempfile.TemporaryDirectory() as tmp, patch.object(integration.subprocess, "Popen", side_effect=fake_start):
            integration.run_monitor(Path("serialhub.exe"), "COM10", 5, Path(tmp), "duration", sender)
            self.assertEqual((Path(tmp) / "duration.stdout.bin").read_bytes(), integration.PAYLOAD)
            sender.flush.assert_called_once()

    def test_failed_start_does_not_send_payload(self):
        sender = Mock()

        def failed_start(command, stdout, stderr):
            process = Mock()
            process.poll.return_value = 1
            return process

        with tempfile.TemporaryDirectory() as tmp, patch.object(integration.subprocess, "Popen", side_effect=failed_start):
            with self.assertRaises(RuntimeError):
                integration.run_monitor(Path("serialhub.exe"), "COM10", 5, Path(tmp), "duration", sender)
            sender.write.assert_not_called()

    def test_com3_rejection_occurs_before_inventory_or_open(self):
        with patch.object(integration, "inventory") as inventory, patch.object(integration, "open_sender") as sender:
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                integration.main(["send", "--setupc", "setupc.exe", "--monitor-port", "COM3",
                                  "--sender-port", "COM11", "--output", "unused"])
            self.assertEqual(error.exception.code, 2)
            inventory.assert_not_called()
            sender.assert_not_called()


if __name__ == "__main__":
    unittest.main()
