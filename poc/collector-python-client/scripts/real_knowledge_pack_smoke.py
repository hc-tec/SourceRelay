"""Opt-in real Gateway smoke for the Bilibili knowledge-pack MVP.

The script only talks to the local /v2 Gateway. The Gateway and paired
extension perform the real browser work; this script never opens a browser or
reads credentials. It is intentionally separate from the default unit suite.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from intelligence_collector import CollectorClient, build_bilibili_account_knowledge_pack


async def run() -> dict[str, object]:
    origin = os.environ.get("COLLECTOR_SERVICE_ORIGIN", "http://127.0.0.1:43127")
    token = os.environ.get("COLLECTOR_SERVICE_TOKEN")
    profile_url = os.environ.get("COLLECTOR_KNOWLEDGE_PACK_PROFILE_URL")
    output_directory = os.environ.get("COLLECTOR_KNOWLEDGE_PACK_OUTPUT_DIR")
    binding_id = os.environ.get("COLLECTOR_KNOWLEDGE_PACK_BINDING_ID")
    if not token:
        raise RuntimeError("COLLECTOR_SERVICE_TOKEN is required")
    if not profile_url:
        raise RuntimeError("COLLECTOR_KNOWLEDGE_PACK_PROFILE_URL is required")
    if not output_directory:
        raise RuntimeError("COLLECTOR_KNOWLEDGE_PACK_OUTPUT_DIR is required")

    async with CollectorClient(origin=origin, token=token) as client:
        if binding_id is None:
            bindings = await client.list_browser_bindings()
            binding = next(
                (item for item in bindings if item.get("state") == "online"),
                None,
            )
            binding_id = binding.get("browserBindingId") if binding else None
        if not isinstance(binding_id, str):
            raise RuntimeError("online_browser_binding_missing")
        pack = await build_bilibili_account_knowledge_pack(
            client,
            browser_binding_id=binding_id,
            canonical_profile_url=profile_url,
            output_directory=Path(output_directory),
            maximum_video_details=int(os.environ.get("COLLECTOR_KNOWLEDGE_PACK_MAX_DETAILS", "1")),
        )
    if pack.state not in {"completed", "partial"}:
        raise RuntimeError(f"knowledge_pack_state:{pack.state}")
    return {
        "state": pack.state,
        "packId": pack.pack_id,
        "root": str(pack.root),
        "counts": pack.manifest.get("counts"),
        "capabilities": pack.manifest.get("capabilities"),
        "failures": pack.manifest.get("failures"),
    }


def main() -> int:
    try:
        print(json.dumps(asyncio.run(run()), ensure_ascii=False, separators=(",", ":")))
    except Exception as error:
        print(f"python_knowledge_pack_smoke_failed:{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
