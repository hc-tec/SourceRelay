"""UTF-8 command-line entry point for auditing an existing Gateway trace."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Mapping

from .audit import audit_trace, render_markdown


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create a deterministic citation audit from a Gateway trace."
    )
    parser.add_argument("trace_file", help="UTF-8 JSON trace written by a Gateway runtime")
    parser.add_argument(
        "--output",
        "-o",
        required=True,
        help="UTF-8 Markdown output path",
    )
    parser.add_argument(
        "--expected-platform",
        action="append",
        dest="expected_platforms",
        metavar="PLATFORM",
        help="Platform expected in the audit; repeat for multiple platforms.",
    )
    return parser


def load_trace(path: Path) -> list[Mapping[str, Any]]:
    """Load either the current event list or a future envelope with events."""

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError) as exc:
        raise ValueError(f"Could not read trace file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"Trace file is not valid UTF-8 JSON: {path}") from exc

    events: object
    if isinstance(payload, list):
        events = payload
    elif isinstance(payload, Mapping):
        events = payload.get("events")
    else:
        events = None
    if not isinstance(events, list):
        raise ValueError("Trace JSON must be an event list or an object with an events list.")
    invalid_count = sum(1 for event in events if not isinstance(event, Mapping))
    if invalid_count:
        raise ValueError(f"Trace contains {invalid_count} non-object event(s).")
    return [event for event in events if isinstance(event, Mapping)]


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    trace_path = Path(args.trace_file).resolve()
    output_path = Path(args.output).resolve()
    try:
        trace = load_trace(trace_path)
    except ValueError as exc:
        build_parser().error(str(exc))
    report = audit_trace(trace, expected_platforms=args.expected_platforms)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(render_markdown(report), encoding="utf-8")
    print(f"Gateway citation audit written to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
