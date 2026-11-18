"""Capture and validate an ESP32-C6 benchmark stream using the SerialHub CLI."""

import argparse
import json
import re
import subprocess
from pathlib import Path


FRAME = re.compile(rb"SHC6,(\d{20}),(\d{20})," + (b"ABCDEFGHIJKLMNOPQRSTUVWXYZ" * 4)[:80])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", type=Path, required=True)
    parser.add_argument("--port", required=True)
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--duration", type=int, default=30)
    parser.add_argument("--output", type=Path, required=True, help="New capture directory")
    args = parser.parse_args()
    if args.baud <= 0 or args.duration <= 0:
        parser.error("baud and duration must be positive")

    args.output.mkdir(parents=True, exist_ok=False)
    command = [str(args.exe.resolve()), "serial", "monitor", "--port", args.port,
               "--baud", str(args.baud), "--duration", str(args.duration)]
    with (args.output / "capture.bin").open("wb") as stdout, (args.output / "cli.stderr").open("wb") as stderr:
        process = subprocess.run(command, stdout=stdout, stderr=stderr, timeout=args.duration + 15)

    sequences = []
    timestamps = []
    invalid = 0
    boundary_bytes = 0
    with (args.output / "capture.bin").open("rb") as capture:
        for index, line in enumerate(capture):
            match = FRAME.fullmatch(line[:-1]) if line.endswith(b"\n") else None
            if match:
                sequences.append(int(match[1]))
                timestamps.append(int(match[2]))
            elif len(line) < 128 and (index == 0 or not line.endswith(b"\n")):
                boundary_bytes += len(line)
            else:
                invalid += 1

    steps = [new - old for old, new in zip(sequences, sequences[1:])]
    gaps = sum(step - 1 for step in steps if step > 1)
    non_increasing = sum(step <= 0 for step in steps)
    elapsed_us = timestamps[-1] - timestamps[0] if len(timestamps) >= 2 else 0
    passed = (process.returncode == 0 and len(sequences) >= 2 and elapsed_us > 0
              and not (invalid or gaps or non_increasing))
    summary = {
        "command": command,
        "exit_code": process.returncode,
        "captured_bytes": (args.output / "capture.bin").stat().st_size,
        "valid_frames": len(sequences),
        "first_sequence": sequences[0] if sequences else None,
        "last_sequence": sequences[-1] if sequences else None,
        "sequence_gaps": gaps,
        "non_increasing_sequence": non_increasing,
        "invalid_frames": invalid,
        "partial_boundary_bytes": boundary_bytes,
        "source_span_us": elapsed_us,
        "passed": passed,
    }
    report = json.dumps(summary, indent=2) + "\n"
    (args.output / "summary.json").write_text(report, encoding="utf-8")
    print(report, end="")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
