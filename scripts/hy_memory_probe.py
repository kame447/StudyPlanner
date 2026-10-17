"""Synthetic Hy Memory compatibility probe for the Laplance user-context index.

Run explicitly with configured embedding/LLM credentials; no application data is read.
"""

from __future__ import annotations

import argparse
import json
import uuid
from collections.abc import Mapping
from typing import Any


FIXTURES = (
    ("math-time", "私は数学の復習を夕方に行いたい。"),
    ("english-goal", "TOEICの目標は800点です。"),
)


def recover_source_ids(search_response: Mapping[str, Any], revision: int) -> list[str]:
    """Accept evidence only if a returned memory retains its original source metadata."""
    bucket = search_response.get("memories")
    if not isinstance(bucket, Mapping):
        raise ValueError("Hy Memory returned no structured memory channels")
    normal = bucket.get("normal")
    if not isinstance(normal, list):
        raise ValueError("Hy Memory returned no normal memory list")

    found: list[str] = []
    seen: set[str] = set()
    for memory in normal[:64]:
        if not isinstance(memory, Mapping):
            continue
        meta = memory.get("meta")
        if not isinstance(meta, Mapping):
            continue
        source_id = meta.get("laplance_source_id")
        source_revision = meta.get("laplance_source_revision")
        if (
            isinstance(source_id, str)
            and source_id
            and source_revision == revision
            and not isinstance(source_revision, bool)
            and source_id not in seen
        ):
            seen.add(source_id)
            found.append(source_id)
    return found


def run_probe(mode: str) -> dict[str, Any]:
    try:
        from hy_memory import HyMemoryClient
    except ImportError as exc:
        raise RuntimeError("Install the isolated Python package: pip install hy-memory==2.0.2") from exc

    user_id = f"laplance-synthetic-probe-{uuid.uuid4().hex}"
    revision = 1
    client = HyMemoryClient(mode=mode)
    try:
        for source_id, text in FIXTURES:
            client.add(
                text,
                user_id=user_id,
                agent_id="laplance-probe",
                session_id="synthetic-session",
                scene="chat",
                metadata={
                    "laplance_source_id": source_id,
                    "laplance_source_revision": revision,
                },
            )
        result = client.search(
            "ユーザーはいつ数学を勉強したい？",
            user_ids=[user_id],
            agent_ids=["laplance-probe"],
            scene="chat",
            limit=10,
        )
        source_ids = recover_source_ids(result, revision)
        return {
            "mode": mode,
            "returned_count": len(result.get("memories", {}).get("normal", [])),
            "attributed_source_ids": source_ids,
            "attribution_observed": bool(source_ids),
        }
    finally:
        try:
            client.delete_all(user_id=user_id)
        finally:
            client.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("lite", "pro"), default="lite")
    args = parser.parse_args()
    print(json.dumps(run_probe(args.mode), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
