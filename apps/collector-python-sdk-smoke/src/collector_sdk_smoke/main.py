from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any

from intelligence_collector import CollectorClient, CollectorClientError

from .config import AppConfig
from .service import CollectorApplication


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="collector-python-sdk",
        description="Reference upper-layer application for the user-owned-browser Collector API.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("capabilities", help="print the runtime capability catalog")
    subparsers.add_parser("openapi", help="print the machine-readable /v2 OpenAPI document")
    subparsers.add_parser("bindings", help="print safe summaries of online browser bindings")
    collect = subparsers.add_parser("collect", help="submit one UTF-8 JSON request")
    collect.add_argument(
        "request_file",
        type=Path,
        help="UTF-8 JSON file containing one registered /v2 collect request",
    )
    return parser


async def execute(args: argparse.Namespace) -> dict[str, Any] | list[dict[str, Any]]:
    config = AppConfig.from_env()
    async with CollectorClient(origin=config.origin, token=config.token) as client:
        app = CollectorApplication(client)
        if args.command == "capabilities":
            return await app.capabilities()
        if args.command == "openapi":
            return await app.openapi()
        if args.command == "bindings":
            return await app.bindings()
        if args.command == "collect":
            request = json.loads(args.request_file.read_text(encoding="utf-8"))
            if not isinstance(request, dict):
                raise ValueError("request file must contain one JSON object")
            return await app.collect(request)
        raise ValueError(f"unknown_command:{args.command}")


def main() -> int:
    args = build_parser().parse_args()
    try:
        result = asyncio.run(execute(args))
    except (CollectorClientError, OSError, ValueError, json.JSONDecodeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
